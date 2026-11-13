import http from 'http';
import path from 'path';
import { loadConfig, redactedHaConfig } from './config';
import { logger } from './logger';
import { createServer, TransportStatus } from './server';
import { HaWriteClient } from './ha/writeClient';
import { createReadTransport, TransportFactoryResult } from './ha/transportFactory';
import { isSslVerificationDisabled } from './ha/haHttp';
import { DeviceProfileLoader } from './domain/deviceProfiles';
import { createLiveWebSocketServer, LIVE_WS_PATH } from './routes/liveWs';
import { createDeviceLogsWebSocketServer, DEVICE_LOGS_WS_PATH } from './routes/deviceLogsWs';
import { attachWebSocketRoutes } from './routes/wsUpgrade';
import { DeviceHostResolver } from './domain/deviceHostResolver';
import { EsphomeApiClient } from './esphome/apiClient';
import { deviceApiStorage } from './config/deviceApiStorage';
import { deviceMappingStorage } from './config/deviceMappingStorage';
import { createLanFirmwareServer } from './lanFirmwareServer';
import { debugSession } from './debug/debugSession';

const start = async () => {
  try {
    const config = loadConfig();

    // Resume (or close out) a debug session that was recording before a restart.
    debugSession.init();

    if (isSslVerificationDisabled()) {
      logger.warn(
        'VERIFY_SSL=false: TLS certificate verification is disabled for all requests to Home Assistant'
      );
    }

    logger.info('Initializing Home Assistant clients...');

    // 1. Initialize Write Client (always REST, always available)
    logger.info('Initializing REST write client...');
    const writeClient = new HaWriteClient(config.ha);
    logger.info('REST write client ready');

    // 2. Initialize Read Transport (WS preferred, REST fallback)
    logger.info('Initializing read transport (WebSocket preferred)...');
    let transportResult: TransportFactoryResult;
    try {
      transportResult = await createReadTransport(
        {
          baseUrl: config.ha.baseUrl,
          token: config.ha.token,
          mode: config.ha.mode,
        },
        {
          wsConnectionTimeout: 5000,
          preferWebSocket: true,
          restPollingInterval: 1000,
        }
      );
    } catch (err) {
      logger.error({ err }, 'Failed to initialize read transport - no HA connectivity');
      throw err;
    }

    const { transport: readTransport, activeTransport, wsAvailable, restAvailable } = transportResult;

    // Log transport status
    if (activeTransport === 'websocket') {
      logger.info('Read transport: WebSocket (real-time updates)');
    } else {
      logger.info({ pollingInterval: 1000 }, 'Read transport: REST (polling mode)');
    }
    logger.info(
      { readTransport: activeTransport, writeTransport: 'rest', wsAvailable, restAvailable },
      'Transport status'
    );

    // 3. Initialize profile loader
    const profileLoader = new DeviceProfileLoader(
      path.resolve(__dirname, '../config/device-profiles'),
      path.resolve(process.cwd(), 'config/device-profiles'),
    );

    // Build transport status for API exposure
    const transportStatus: TransportStatus = {
      readTransport: activeTransport,
      writeTransport: 'rest',
      wsAvailable,
      restAvailable,
    };

    // 4. Create Express app with dependencies
    const app = createServer(config, {
      readTransport,
      writeClient,
      profileLoader,
      transportStatus,
    });

    // 5. Create HTTP server
    const httpServer = http.createServer(app);

    // 6. Attach WebSocket servers (frontend connections), routed by path
    const hostResolver = new DeviceHostResolver({
      baseUrl: config.ha.baseUrl,
      token: config.ha.token,
      listDevices: () => readTransport.listDevices(),
    });
    attachWebSocketRoutes(httpServer, {
      [LIVE_WS_PATH]: createLiveWebSocketServer(readTransport, profileLoader),
      [DEVICE_LOGS_WS_PATH]: createDeviceLogsWebSocketServer({
        storage: deviceApiStorage,
        lookupHost: (deviceId) => hostResolver.lookup(deviceId),
        expectedNodeName: (deviceId) => deviceMappingStorage.getMapping(deviceId)?.esphomeNodeName,
        createClient: ({ host, noisePsk }) => new EsphomeApiClient({ host, noisePsk }),
      }),
    });

    // 7. Start LAN Firmware Server (separate port for device firmware downloads)
    createLanFirmwareServer(config.firmware.lanPort);

    // 8. Start main server listening
    httpServer.listen(config.port, () => {
      logger.info(
        {
          port: config.port,
          firmwareLanPort: config.firmware.lanPort,
          ha: redactedHaConfig(config.ha),
          readTransport: activeTransport,
          writeTransport: 'rest',
        },
        'Zone Configurator backend started',
      );
    });
  } catch (error) {
    logger.error({ error, message: (error as Error).message, stack: (error as Error).stack }, 'Failed to start backend');
    process.exit(1);
  }
};

start();
