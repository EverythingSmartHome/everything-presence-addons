import fs from 'fs';
import path from 'path';
import { logger } from '../logger';

/**
 * Per-device native API connection details for the live log viewer.
 *
 * Kept in its own file (not in device mappings) because it may hold an API
 * encryption key: this file is never returned by any API nor included in the
 * debug bundle. Only `hasKey` is ever exposed.
 */

export type HostSource = 'ha' | 'manual';

export interface DeviceApiConnection {
  /** Hostname or IP address of the device's native API. */
  host?: string;
  /** 'ha' = read from Home Assistant's ESPHome config entry; 'manual' = entered by the user. */
  hostSource?: HostSource;
  /** Base64 API encryption key (secret). */
  noisePsk?: string;
  updatedAt?: string;
}

interface StoreFile {
  devices: Record<string, DeviceApiConnection>;
}

const DEFAULT_DATA_DIR = '/config/everything-presence-zone-configurator';
const FILE_NAME = 'device-api-connections.json';

// Hostname (RFC 1123 labels), IPv4, or bracket-less IPv6.
const HOSTNAME = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.?$/;
const IPV6 = /^[0-9A-Fa-f:]+(?:%[A-Za-z0-9_.-]+)?$/;

export const isValidHost = (value: string): boolean => {
  const host = value.trim();
  if (!host || host.length > 253) return false;
  return HOSTNAME.test(host) || (host.includes(':') && IPV6.test(host));
};

export class DeviceApiStorage {
  private readonly file: string;

  constructor(dataDir: string = process.env.DATA_DIR ?? DEFAULT_DATA_DIR) {
    this.file = path.join(dataDir, FILE_NAME);
  }

  get(deviceId: string): DeviceApiConnection {
    return { ...(this.read().devices[deviceId] ?? {}) };
  }

  /** Save a host found in Home Assistant. Never overrides a manual host. */
  saveResolvedHost(deviceId: string, host: string): void {
    this.update(deviceId, (current) =>
      current.hostSource === 'manual' ? current : { ...current, host, hostSource: 'ha' },
    );
  }

  /** Set a manual host, or clear it (null) so the next connection reads Home Assistant again. */
  setManualHost(deviceId: string, host: string | null): void {
    this.update(deviceId, (current) => {
      if (host === null) {
        const { host: _h, hostSource: _s, ...rest } = current;
        return rest;
      }
      return { ...current, host: host.trim(), hostSource: 'manual' };
    });
  }

  setNoisePsk(deviceId: string, key: string | null): void {
    this.update(deviceId, (current) => {
      if (key === null) {
        const { noisePsk: _k, ...rest } = current;
        return rest;
      }
      return { ...current, noisePsk: key.trim() };
    });
  }

  private update(deviceId: string, fn: (current: DeviceApiConnection) => DeviceApiConnection): void {
    const store = this.read();
    const next = fn(store.devices[deviceId] ?? {});
    const { updatedAt: _u, ...meaningful } = next;
    if (Object.keys(meaningful).length === 0) {
      delete store.devices[deviceId];
    } else {
      store.devices[deviceId] = { ...next, updatedAt: new Date().toISOString() };
    }
    this.write(store);
  }

  private read(): StoreFile {
    try {
      if (!fs.existsSync(this.file)) return { devices: {} };
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
      if (parsed && typeof parsed === 'object' && parsed.devices && typeof parsed.devices === 'object') {
        return { devices: parsed.devices as Record<string, DeviceApiConnection> };
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to read device API connection settings; ignoring');
    }
    return { devices: {} };
  }

  private write(store: StoreFile): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}

export const deviceApiStorage = new DeviceApiStorage();
