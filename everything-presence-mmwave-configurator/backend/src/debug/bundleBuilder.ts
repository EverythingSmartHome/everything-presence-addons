import os from 'os';
import type { DeviceMapping } from '../config/deviceMappingStorage';
import type { AppSettings, RoomConfig } from '../domain/types';
import type { IHaReadTransport } from '../ha/readTransport';
import { diagnoseMappings, MappingDiagnosticsResult } from './mappingDiagnostics';
import { createRedactor } from './redact';
import type { DebugSessionStatus } from './debugSession';
import type { LogBufferSnapshot } from './logBuffer';

export const DEBUG_BUNDLE_FORMAT_VERSION = 1;

export interface DebugBundleSources {
  appVersion: string;
  haMode: string;
  transportStatus?: { readTransport: string; writeTransport: string; wsAvailable: boolean; restAvailable: boolean };
  readTransport?: Pick<IHaReadTransport, 'listEntityRegistry' | 'getAllStates' | 'listDevices' | 'isConnected'>;
  listMappings: () => DeviceMapping[];
  getMissingRequired?: (deviceId: string) => string[];
  listRooms: () => RoomConfig[];
  getSettings: () => AppSettings;
  listProfiles?: () => Array<{ id: string; label?: string; schemaVersion?: string }>;
  sessionStatus: () => DebugSessionStatus;
  serverLogs: () => LogBufferSnapshot;
  clientLogs: () => LogBufferSnapshot & { browserDropped?: number };
  /** Optional; failures are recorded in errors[] but never fail the bundle. */
  getHaVersion?: () => Promise<string | undefined>;
  /** Secret values to scrub (never written to the bundle). */
  knownSecrets?: string[];
  now?: () => Date;
}

export interface DebugBundleOptions {
  includeNetworkDetails?: boolean;
}

export interface BundleError {
  section: string;
  message: string;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';

/**
 * Collect mapping diagnostics from Home Assistant. Each lookup is independent
 * so a failing registry or state call degrades the result instead of failing.
 */
export const collectMappingDiagnostics = async (
  sources: Pick<DebugBundleSources, 'readTransport' | 'listMappings' | 'getMissingRequired'>,
  errors: BundleError[],
): Promise<MappingDiagnosticsResult & { registryAvailable: boolean }> => {
  const mappings = sources.listMappings();
  let registry: Awaited<ReturnType<IHaReadTransport['listEntityRegistry']>> | null = null;
  let states: Awaited<ReturnType<IHaReadTransport['getAllStates']>> | null = null;
  let devices: Awaited<ReturnType<IHaReadTransport['listDevices']>> | null = null;

  if (sources.readTransport) {
    const [registryResult, statesResult, devicesResult] = await Promise.allSettled([
      sources.readTransport.listEntityRegistry(),
      sources.readTransport.getAllStates(),
      sources.readTransport.listDevices(),
    ]);
    if (registryResult.status === 'fulfilled') registry = registryResult.value;
    else errors.push({ section: 'diagnostics.entityRegistry', message: errorMessage(registryResult.reason) });
    if (statesResult.status === 'fulfilled') states = statesResult.value;
    else errors.push({ section: 'diagnostics.states', message: errorMessage(statesResult.reason) });
    if (devicesResult.status === 'fulfilled') devices = devicesResult.value;
    else errors.push({ section: 'diagnostics.deviceRegistry', message: errorMessage(devicesResult.reason) });
  } else {
    errors.push({ section: 'diagnostics', message: 'Home Assistant connection not available' });
  }

  const result = diagnoseMappings({
    mappings,
    registry: registry ?? [],
    states,
    devices,
    getMissingRequired: sources.getMissingRequired,
  });

  if (!registry) {
    // Without the registry every entity would look missing; say so instead.
    return { ...result, problemCount: 0, registryAvailable: false };
  }
  return { ...result, registryAvailable: true };
};

/**
 * Build the debug bundle. Every section is collected independently; failures
 * are listed in `errors` and the rest of the bundle is still produced.
 * Diagnostics run on raw data and redaction is applied to the whole bundle last.
 */
export const buildDebugBundle = async (
  sources: DebugBundleSources,
  options: DebugBundleOptions = {},
): Promise<Record<string, unknown>> => {
  const errors: BundleError[] = [];
  const now = sources.now?.() ?? new Date();

  const section = <T>(name: string, fn: () => T): T | null => {
    try {
      return fn();
    } catch (error) {
      errors.push({ section: name, message: errorMessage(error) });
      return null;
    }
  };

  const app = section('app', () => ({
    version: sources.appVersion,
    haMode: sources.haMode,
    transport: sources.transportStatus ?? null,
    haConnected: sources.readTransport ? sources.readTransport.isConnected : null,
    node: process.version,
    platform: `${os.platform()} ${os.arch()}`,
    uptimeSec: Math.round(process.uptime()),
    memoryRssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
  }));

  let haVersion: string | null = null;
  if (sources.getHaVersion) {
    try {
      haVersion = (await sources.getHaVersion()) ?? null;
    } catch (error) {
      errors.push({ section: 'homeAssistant.version', message: errorMessage(error) });
    }
  }

  const session = section('session', () => sources.sessionStatus());

  let diagnostics: unknown = null;
  try {
    diagnostics = await collectMappingDiagnostics(sources, errors);
  } catch (error) {
    errors.push({ section: 'diagnostics', message: errorMessage(error) });
  }

  const deviceMappings = section('deviceMappings', () => sources.listMappings());
  const rooms = section('rooms', () => sources.listRooms());
  const settings = section('settings', () => sources.getSettings());
  const profiles = sources.listProfiles
    ? section('deviceProfiles', () =>
        sources.listProfiles!().map((p) => ({ id: p.id, label: p.label, schemaVersion: p.schemaVersion })),
      )
    : null;
  const serverLogs = section('serverLogs', () => sources.serverLogs());
  const clientLogs = section('clientLogs', () => sources.clientLogs());

  const bundle = {
    format: 'everything-presence-zone-configurator-debug-bundle',
    formatVersion: DEBUG_BUNDLE_FORMAT_VERSION,
    generatedAt: now.toISOString(),
    redaction: {
      secrets: 'removed',
      macAddresses: 'replaced with mac#N placeholders',
      ipAddresses: options.includeNetworkDetails ? 'included (private sharing only)' : 'replaced with ip#N placeholders',
      ssids: 'removed',
    },
    app,
    homeAssistant: { version: haVersion },
    session,
    diagnostics,
    deviceMappings,
    rooms,
    settings,
    deviceProfiles: profiles,
    serverLogs,
    clientLogs,
    errors,
  };

  // Redaction is not wrapped: if it throws, no (unredacted) bundle is emitted.
  return createRedactor({
    includeNetworkDetails: options.includeNetworkDetails,
    knownSecrets: sources.knownSecrets,
  }).redact(bundle);
};
