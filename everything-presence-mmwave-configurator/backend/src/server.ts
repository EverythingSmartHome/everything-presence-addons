import fs from 'fs';
import path from 'path';
import express, { NextFunction, Request, Response } from 'express';
import pinoHttp from 'pino-http';
import { AppConfig } from './config';
import { logger } from './logger';
import { createMetaRouter } from './routes/meta';
import { createDevicesRouter, DevicesRouterDependencies } from './routes/devices';
import { createEntityDiscoveryRouter } from './routes/entityDiscovery';
import { createRoomsRouter } from './routes/rooms';
import { createZonesRouter } from './routes/zones';
import { createSettingsRouter } from './routes/settings';
import { createLiveRouter } from './routes/live';
import { createCustomAssetsRouter } from './routes/customAssets';
import { createHeatmapRouter } from './routes/heatmap';
import type { IHaReadTransport } from './ha/readTransport';
import type { IHaWriteClient } from './ha/writeClient';
import type { DeviceProfileLoader } from './domain/deviceProfiles';

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

export const createServer = (config: AppConfig, deps?: ServerDependencies): express.Express => {
  const app = express();

  app.use(
    pinoHttp({
      logger,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    }),
  );

  app.use(express.json());

  app.use('/api/meta', createMetaRouter(config, deps?.transportStatus));
  app.use('/api/rooms', createRoomsRouter());
  app.use('/api/zones', createZonesRouter());
  app.use('/api/settings', createSettingsRouter());
  app.use('/api/custom-assets', createCustomAssetsRouter());

  // Routes that require HA dependencies
  if (deps) {
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
