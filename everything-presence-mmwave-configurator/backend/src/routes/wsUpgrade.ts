import type { Server } from 'http';
import type { WebSocketServer } from 'ws';

/**
 * Route WebSocket upgrades by path. Several `ws` servers attached with
 * `{ server, path }` do not coexist: the first one rejects (HTTP 400) any
 * upgrade whose path it does not own. Servers are created with
 * `noServer: true` and dispatched here instead.
 */
export const attachWebSocketRoutes = (httpServer: Server, routes: Record<string, WebSocketServer>): void => {
  httpServer.on('upgrade', (req, socket, head) => {
    let pathname = '/';
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      // fall through to "not found"
    }
    const wss = routes[pathname];
    if (!wss) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });
};
