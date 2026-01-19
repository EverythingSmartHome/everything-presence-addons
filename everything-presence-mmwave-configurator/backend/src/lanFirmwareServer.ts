import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { logger } from './logger';
import { firmwareStorage } from './config/firmwareStorage';

/**
 * Create a dedicated HTTP server for serving firmware files to ESP devices
 * This server runs on a separate port (default 38080) and serves firmware
 * over plain HTTP (no TLS) for compatibility with ESP devices that have
 * limited memory for HTTPS connections.
 */
export const createLanFirmwareServer = (port: number): http.Server => {
  const app = express();

  // Middleware to log requests
  app.use((req, res, next) => {
    logger.debug({ method: req.method, url: req.url }, 'LAN firmware server request');
    next();
  });

  /**
   * Health check endpoint
   */
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', server: 'lan-firmware', port });
  });

  /**
   * Serve the rewritten manifest for a device/token
   * URL: /fw/:deviceId/:token/manifest.json
   */
  app.get('/fw/:deviceId/:token/manifest.json', (req, res) => {
    const { deviceId, token } = req.params;

    logger.info({ deviceId, token }, 'Manifest requested');

    // Look up the cache entry
    const entry = firmwareStorage.getCacheEntry(deviceId, token);

    if (!entry) {
      logger.warn({ deviceId, token }, 'Manifest not found or expired');
      return res.status(404).json({ error: 'Firmware not found or expired' });
    }

    // Check if file exists
    if (!fs.existsSync(entry.manifestPath)) {
      logger.error({ deviceId, token, manifestPath: entry.manifestPath }, 'Manifest file missing');
      return res.status(404).json({ error: 'Manifest file not found' });
    }

    // Set appropriate headers
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache');

    // Send the manifest file
    res.sendFile(entry.manifestPath, (err) => {
      if (err) {
        logger.error({ error: err, deviceId, token }, 'Error sending manifest');
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to send manifest' });
        }
      } else {
        logger.info({ deviceId, token }, 'Manifest served successfully');
      }
    });
  });

  /**
   * Serve firmware binary files
   * URL: /fw/:deviceId/:token/:filename
   */
  app.get('/fw/:deviceId/:token/:filename', (req, res) => {
    const { deviceId, token, filename } = req.params;

    // Prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      logger.warn({ deviceId, token, filename }, 'Invalid filename - possible directory traversal');
      return res.status(400).json({ error: 'Invalid filename' });
    }

    logger.info({ deviceId, token, filename }, 'Binary requested');

    // Look up the cache entry
    const entry = firmwareStorage.getCacheEntry(deviceId, token);

    if (!entry) {
      logger.warn({ deviceId, token }, 'Cache entry not found');
      return res.status(404).json({ error: 'Firmware not found or expired' });
    }

    // Find the binary path matching the requested filename
    const binaryPath = entry.binaryPaths.find((p) => path.basename(p) === filename);

    if (!binaryPath) {
      logger.warn({ deviceId, token, filename, availableFiles: entry.binaryPaths.map(p => path.basename(p)) }, 'Binary file not found in cache entry');
      return res.status(404).json({ error: 'Binary file not found' });
    }

    // Check if file exists
    if (!fs.existsSync(binaryPath)) {
      logger.error({ deviceId, token, binaryPath }, 'Binary file missing from disk');
      return res.status(404).json({ error: 'Binary file not found on disk' });
    }

    // Get file stats for Content-Length header
    const stats = fs.statSync(binaryPath);

    // Set appropriate headers for binary download
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Send the binary file
    res.sendFile(binaryPath, (err) => {
      if (err) {
        logger.error({ error: err, deviceId, token, filename }, 'Error sending binary');
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to send binary' });
        }
      } else {
        logger.info({ deviceId, token, filename, size: stats.size }, 'Binary served successfully');
      }
    });
  });

  /**
   * List cached firmware (for debugging)
   * URL: /fw/list
   */
  app.get('/fw/list', (_req, res) => {
    const entries = firmwareStorage.getAllEntries();
    res.json({
      count: entries.length,
      entries: entries.map((e) => ({
        deviceId: e.deviceId,
        token: e.token,
        version: e.version,
        cachedAt: new Date(e.cachedAt).toISOString(),
        binaryCount: e.binaryPaths.length,
      })),
    });
  });

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ error: err.message }, 'LAN firmware server error');
    res.status(500).json({ error: 'Internal server error' });
  });

  // Create HTTP server
  const server = http.createServer(app);

  // Start listening
  server.listen(port, '0.0.0.0', () => {
    logger.info({ port }, 'LAN Firmware Server started (plain HTTP for ESP devices)');
  });

  // Handle server errors
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error({ port }, 'LAN Firmware Server port already in use');
    } else {
      logger.error({ error: err.message }, 'LAN Firmware Server error');
    }
  });

  return server;
};
