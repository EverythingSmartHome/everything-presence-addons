import { logger } from '../logger';
import { IHaReadTransport, ReadTransportConfig, TransportFactoryOptions } from './readTransport';
import { WsReadTransport } from './wsReadTransport';
import { RestReadTransport } from './restReadTransport';

/**
 * Result of creating a read transport
 */
export interface TransportFactoryResult {
  transport: IHaReadTransport;
  activeTransport: 'websocket' | 'rest';
  wsAvailable: boolean;
  restAvailable: boolean;
}

/**
 * Creates the appropriate read transport based on availability.
 *
 * Attempts WebSocket first (preferred for real-time updates),
 * falls back to REST if WebSocket fails.
 *
 * @param config - Configuration with baseUrl and token
 * @param options - Factory options (timeouts, preferences)
 * @returns The created transport and availability info
 */
export async function createReadTransport(
  config: ReadTransportConfig,
  options: TransportFactoryOptions = {}
): Promise<TransportFactoryResult> {
  const {
    wsConnectionTimeout = 5000,
    preferWebSocket = true,
    restPollingInterval = 1000,
  } = options;

  let wsAvailable = false;
  let restAvailable = false;
  let transport: IHaReadTransport;

  // Check for forced REST mode (useful for testing)
  const forceRest = process.env.FORCE_REST_TRANSPORT === 'true';
  if (forceRest) {
    logger.info('TransportFactory: FORCE_REST_TRANSPORT=true, skipping WebSocket');
  }

  // Try WebSocket first if preferred (and not forced to REST)
  if (preferWebSocket && !forceRest) {
    logger.info('TransportFactory: Attempting WebSocket connection...');

    const wsTransport = new WsReadTransport(config);

    try {
      // Race between connection and timeout
      await Promise.race([
        wsTransport.connect(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('WebSocket connection timeout')), wsConnectionTimeout)
        ),
      ]);

      wsAvailable = true;
      transport = wsTransport;

      logger.info('TransportFactory: WebSocket connection successful');

      // Still check if REST is available (for status reporting)
      restAvailable = await testRestConnection(config);

      return {
        transport,
        activeTransport: 'websocket',
        wsAvailable,
        restAvailable,
      };
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'TransportFactory: WebSocket connection failed, trying REST fallback'
      );
      wsTransport.disconnect();
    }
  }

  // Fall back to REST
  logger.info('TransportFactory: Attempting REST connection...');

  const restTransport = new RestReadTransport(config, restPollingInterval);

  try {
    await restTransport.connect();
    restAvailable = true;
    transport = restTransport;

    logger.info(
      { pollingInterval: restPollingInterval },
      'TransportFactory: REST connection successful (polling mode)'
    );

    return {
      transport,
      activeTransport: 'rest',
      wsAvailable,
      restAvailable,
    };
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'TransportFactory: REST connection also failed'
    );
    throw new Error('Failed to connect to Home Assistant via WebSocket or REST');
  }
}

/**
 * Test if REST API is reachable
 */
async function testRestConnection(config: ReadTransportConfig): Promise<boolean> {
  try {
    let baseUrl = config.baseUrl.replace(/\/+$/, '');
    if (!baseUrl.endsWith('/api')) {
      baseUrl = baseUrl + '/api';
    }

    const res = await fetch(`${baseUrl}/`, {
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
    });

    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Create a WebSocket-only transport (no fallback).
 * Useful when you specifically need WebSocket features.
 */
export function createWsTransport(config: ReadTransportConfig): WsReadTransport {
  return new WsReadTransport(config);
}

/**
 * Create a REST-only transport (no WebSocket).
 * Useful for testing or when WebSocket is known to be unavailable.
 */
export function createRestTransport(
  config: ReadTransportConfig,
  pollingInterval: number = 1000
): RestReadTransport {
  return new RestReadTransport(config, pollingInterval);
}
