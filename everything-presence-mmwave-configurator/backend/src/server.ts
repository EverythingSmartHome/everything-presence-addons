import fs from 'fs';
import path from 'path';
import express, { NextFunction, Request, Response } from 'express';
import pinoHttp from 'pino-http';
import { AppConfig } from './config';
import { logger, logLevelController } from './logger';
import { createMetaRouter } from './routes/meta';
import { createDebugRouter } from './routes/debug';
import { debugSession } from './debug/debugSession';
import { createDevicesRouter, DevicesRouterDependencies } from './routes/devices';
import { createEntityDiscoveryRouter } from './routes/entityDiscovery';
import { createRoomsRouter } from './routes/rooms';
import { createZonesRouter } from './routes/zones';
import { createSettingsRouter } from './routes/settings';
import { createLiveRouter } from './routes/live';
import { createCustomAssetsRouter } from './routes/customAssets';
import { createHeatmapRouter } from './routes/heatmap';
import { createDeviceMappingsRouter } from './routes/deviceMappings';
import { createFirmwareRouter } from './routes/firmware';
import { createZoneBackupsRouter } from './routes/zoneBackups';
import type { IHaReadTransport } from './ha/readTransport';
import type { IHaWriteClient } from './ha/writeClient';
import type { DeviceProfileLoader } from './domain/deviceProfiles';
import { deviceEntityService } from './domain/deviceEntityService';
import { migrationService } from './domain/migrationService';

export interface TransportStatus {
  readTransport: 'websocket' | 'rest';
  writeTransport: 'rest';
  wsAvailable: boolean;
  restAvailable: boolean;
}

export interface ServerDependencies {
  readTransport: IHaReadTransport;
  writeClient: IHaWriteClient;
  profileLoader: DeviceProfileLoader;
  transportStatus: TransportStatus;
}

const DEBUG_STATUS_PATH = '/api/debug/status';
const DEBUG_CLIENT_LOGS_PATH = '/api/debug/client-logs';

export const createServer = (config: AppConfig, deps?: ServerDependencies): express.Express => {
  const app = express();

  const httpLogger = pinoHttp({
    logger,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    autoLogging: {
      // Debug polling and client log uploads would otherwise flood the captured logs.
      ignore: (req) => {
        const url = req.url ?? '';
        return url.startsWith(DEBUG_STATUS_PATH) || url.startsWith(DEBUG_CLIENT_LOGS_PATH);
      },
    },
  });
  // pino-http logs through a child logger; keep it at the debug session level.
  logLevelController.register(httpLogger.logger);
  app.use(httpLogger);

  // Client log batches may exceed the global 100 KB body limit. Registered first,
  // so the global parser below skips bodies that are already parsed.
  app.use(DEBUG_CLIENT_LOGS_PATH, express.json({ limit: '1mb' }));
  app.use(express.json());

  app.use('/api/meta', createMetaRouter(config, deps?.transportStatus));
  app.use('/api/debug', createDebugRouter({
    config,
    session: debugSession,
    transportStatus: deps?.transportStatus,
    readTransport: deps?.readTransport,
    profileLoader: deps?.profileLoader,
  }));
  app.use('/api/rooms', createRoomsRouter());
  app.use('/api/zones', createZonesRouter());
  app.use('/api/settings', createSettingsRouter());
  app.use('/api/custom-assets', createCustomAssetsRouter());
  app.use('/api/device-mappings', createDeviceMappingsRouter({ readTransport: deps?.readTransport, profileLoader: deps?.profileLoader }));

  // Routes that require HA dependencies
  if (deps) {
    // Initialize deviceEntityService with profileLoader
    deviceEntityService.setProfileLoader(deps.profileLoader);

    // Run migration on startup (async, non-blocking)
    migrationService.migrateAllOnStartup().catch((error) => {
      logger.error({ error }, 'Entity mapping migration failed on startup');
    });
    const devicesDeps: DevicesRouterDependencies = {
      readTransport: deps.readTransport,
      writeClient: deps.writeClient,
      profileLoader: deps.profileLoader,
    };
    app.use('/api/devices', createDevicesRouter(devicesDeps));
    app.use('/api/devices', createEntityDiscoveryRouter({
      readTransport: deps.readTransport,
      profileLoader: deps.profileLoader,
    }));
    app.use('/api/devices', createHeatmapRouter({
      haConfig: config.ha,
      readTransport: deps.readTransport,
      profileLoader: deps.profileLoader,
    }));
    app.use('/api/live', createLiveRouter(deps.readTransport, deps.writeClient, deps.profileLoader));

    // Firmware update routes
    app.use('/api/firmware', createFirmwareRouter({
      config: config.firmware,
      writeClient: deps.writeClient,
      readTransport: deps.readTransport,
    }));

    // Zone backup and restore routes
    app.use('/api/zone-backups', createZoneBackupsRouter({
      readTransport: deps.readTransport,
      writeClient: deps.writeClient,
      profileLoader: deps.profileLoader,
    }));
  }

  app.use('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  if (config.frontendDist && fs.existsSync(config.frontendDist)) {
    const indexHtml = path.join(config.frontendDist, 'index.html');

    app.use(express.static(config.frontendDist));
    app.get('*', (_req, res) => {
      res.sendFile(indexHtml);
    });
    logger.info({ frontendDist: config.frontendDist }, 'Serving frontend assets');
  } else {
    logger.warn(
      { frontendDist: config.frontendDist },
      'Frontend assets not found; UI will not be served by backend',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, 'Unhandled error');
    res.status(500).json({ message: 'Internal server error' });
  });

  return app;
};
