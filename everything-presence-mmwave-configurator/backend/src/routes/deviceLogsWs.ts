import { WebSocketServer, WebSocket } from 'ws';
import { logger } from '../logger';
import { DeviceLogSession, DeviceLogSessionDeps, SessionMessage } from '../domain/deviceLogSession';

/**
 * WebSocket endpoint for the live device log viewer (/api/device-logs/ws).
 *
 * Client → server: { type: 'start', deviceId, level?, states? } | { type: 'set_level', level }
 *                  | { type: 'set_states', show } | { type: 'stop' }
 * Server → client: SessionMessage (status / error / log)
 *
 * A device connection exists only while a viewer has the log panel open: it
 * is opened on 'start' and closed on 'stop' or when this socket closes.
 */

export const DEVICE_LOGS_WS_PATH = '/api/device-logs/ws';
const MAX_SESSIONS = 8;
/** Drop log lines for a slow browser rather than buffering without bound. */
const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;

export const createDeviceLogsWebSocketServer = (deps: DeviceLogSessionDeps): WebSocketServer => {
  const wss = new WebSocketServer({ noServer: true });
  const sessions = new Set<DeviceLogSession>();

  wss.on('connection', (ws: WebSocket) => {
    let session: DeviceLogSession | null = null;
    let droppedLines = 0;

    const send = (message: SessionMessage | { type: 'dropped'; count: number }) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (message.type === 'log' && ws.bufferedAmount > MAX_BUFFERED_BYTES) {
        droppedLines += 1;
        return;
      }
      if (droppedLines > 0 && ws.bufferedAmount <= MAX_BUFFERED_BYTES) {
        ws.send(JSON.stringify({ type: 'dropped', count: droppedLines }));
        droppedLines = 0;
      }
      ws.send(JSON.stringify(message));
    };

    const stopSession = () => {
      if (!session) return;
      session.stop();
      sessions.delete(session);
      session = null;
    };

    ws.on('message', (data) => {
      let message: { type?: unknown; deviceId?: unknown; level?: unknown; states?: unknown; show?: unknown };
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      switch (message.type) {
        case 'start': {
          stopSession();
          if (typeof message.deviceId !== 'string' || !message.deviceId) {
            send({ type: 'error', code: 'protocol_error', message: 'deviceId is required' });
            return;
          }
          if (sessions.size >= MAX_SESSIONS) {
            send({ type: 'error', code: 'busy', message: 'Too many log viewers are open. Close one and try again.' });
            return;
          }
          const level = typeof message.level === 'string' ? message.level : 'DEBUG';
          const current = new DeviceLogSession(message.deviceId, deps, send, level, message.states !== false);
          session = current;
          sessions.add(current);
          logger.info({ deviceId: message.deviceId }, 'Device log viewer opened');
          current.start().catch((error) => {
            logger.warn({ error, deviceId: message.deviceId }, 'Device log session failed');
            send({ type: 'error', code: 'protocol_error', message: (error as Error).message });
          });
          return;
        }
        case 'set_level':
          if (typeof message.level === 'string') session?.setLevel(message.level);
          return;
        case 'set_states':
          if (typeof message.show === 'boolean') session?.setShowStates(message.show);
          return;
        case 'stop':
          stopSession();
          send({ type: 'status', state: 'closed', reason: 'stopped', message: 'Disconnected.' });
          return;
        default:
      }
    });

    ws.on('close', () => {
      if (session) logger.info('Device log viewer closed');
      stopSession();
    });
    ws.on('error', () => stopSession());
  });

  return wss;
};
