import { Router } from 'express';
import { AppConfig, HaConfig } from '../config';
import { storage } from '../config/storage';
import { deviceMappingStorage } from '../config/deviceMappingStorage';
import { deviceEntityService } from '../domain/deviceEntityService';
import type { DeviceProfileLoader } from '../domain/deviceProfiles';
import type { IHaReadTransport } from '../ha/readTransport';
import { haFetch } from '../ha/haHttp';
import type { TransportStatus } from '../server';
import { logger } from '../logger';
import { buildDebugBundle, collectMappingDiagnostics, BundleError, DebugBundleSources } from '../debug/bundleBuilder';
import { createRedactor } from '../debug/redact';
import { DebugSessionService } from '../debug/debugSession';
import { readAppVersion } from './meta';

export interface DebugRouterDependencies {
  config: AppConfig;
  session: DebugSessionService;
  transportStatus?: TransportStatus;
  readTransport?: IHaReadTransport;
  profileLoader?: DeviceProfileLoader;
}

const HA_VERSION_TIMEOUT_MS = 3000;

/**
 * Optional Home Assistant core version lookup via REST /api/config. Only the
 * version string is returned; the token is used for the request and nothing else.
 */
const fetchHaVersion = async (ha: HaConfig): Promise<string | undefined> => {
  const res = await haFetch(`${ha.baseUrl}/config`, {
    headers: { Authorization: `Bearer ${ha.token}` },
    signal: AbortSignal.timeout(HA_VERSION_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Home Assistant /api/config returned ${res.status}`);
  }
  const body = (await res.json()) as { version?: unknown };
  return typeof body.version === 'string' ? body.version : undefined;
};

const isTruthyFlag = (value: unknown): boolean =>
  typeof value === 'string' && ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());

export const createDebugRouter = (deps: DebugRouterDependencies): Router => {
  const router = Router();
  const appVersion = readAppVersion();
  const { session, readTransport, profileLoader, config } = deps;
  const getMissingRequired = profileLoader
    ? (deviceId: string) => deviceEntityService.getMissingEntities(deviceId)
    : undefined;

  const sources = (): DebugBundleSources => ({
    appVersion,
    haMode: config.ha.mode,
    transportStatus: deps.transportStatus,
    readTransport,
    listMappings: () => deviceMappingStorage.listMappings(),
    getMissingRequired,
    listRooms: () => storage.listRooms(),
    getSettings: () => storage.getSettings(),
    listProfiles: profileLoader ? () => profileLoader.listProfiles() : undefined,
    sessionStatus: () => session.status(),
    serverLogs: () => session.serverLogs(),
    clientLogs: () => session.clientLogs(),
    getHaVersion: readTransport ? () => fetchHaVersion(config.ha) : undefined,
    knownSecrets: [config.ha.token],
  });

  router.get('/status', (_req, res) => {
    res.json(session.status());
  });

  router.post('/start', (_req, res) => {
    res.json(session.start());
  });

  router.post('/stop', (_req, res) => {
    res.json(session.stop('user'));
  });

  router.post('/client-logs', (req, res) => {
    const body = (req.body ?? {}) as { sessionId?: unknown; entries?: unknown; dropped?: unknown };
    res.json(session.addClientLogs(body.sessionId, body.entries, body.dropped));
  });

  router.get('/diagnostics', async (req, res) => {
    try {
      const errors: BundleError[] = [];
      const diagnostics = await collectMappingDiagnostics(
        { readTransport, listMappings: () => deviceMappingStorage.listMappings(), getMissingRequired },
        errors,
      );
      const redactor = createRedactor({
        includeNetworkDetails: isTruthyFlag(req.query.includeNetworkDetails),
        knownSecrets: [config.ha.token],
      });
      res.json(redactor.redact({ diagnostics, errors }));
    } catch (error) {
      logger.error({ error }, 'Failed to build mapping diagnostics');
      res.status(500).json({ message: 'Failed to build mapping diagnostics' });
    }
  });

  router.get('/bundle', async (req, res) => {
    try {
      const bundle = await buildDebugBundle(sources(), {
        includeNetworkDetails: isTruthyFlag(req.query.includeNetworkDetails),
      });
      const stamp = new Date().toISOString().replace(/\..+/, '').replace(/[:T]/g, '-');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="zone-configurator-debug-${stamp}.json"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(JSON.stringify(bundle, null, 2));
    } catch (error) {
      logger.error({ error }, 'Failed to build debug bundle');
      res.status(500).json({ message: 'Failed to build debug bundle' });
    }
  });

  return router;
};
