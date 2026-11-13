import { ingressAware } from './client';

export const DEVICE_LOG_LEVELS = ['ERROR', 'WARN', 'INFO', 'CONFIG', 'DEBUG', 'VERBOSE', 'VERY_VERBOSE'] as const;
export type DeviceLogLevel = (typeof DEVICE_LOG_LEVELS)[number];

export interface DeviceIdentity {
  name?: string;
  friendlyName?: string;
  esphomeVersion?: string;
  projectName?: string;
  projectVersion?: string;
  apiVersion?: string;
}

export type DeviceLogServerMessage =
  | { type: 'status'; state: 'resolving' }
  | { type: 'status'; state: 'connecting'; host: string; hostSource: 'ha' | 'manual' | null; encrypted: boolean }
  | {
      type: 'status';
      state: 'connected';
      host: string;
      hostSource: 'ha' | 'manual' | null;
      encrypted: boolean;
      device: DeviceIdentity;
    }
  | { type: 'status'; state: 'closed'; reason: string; message: string }
  | { type: 'error'; code: string; message: string; needs?: 'host' | 'key' | 'remove_key' }
  | { type: 'log'; ts: string; level: string; tag: string | null; msg: string }
  | { type: 'dropped'; count: number };

export interface DeviceApiConnectionView {
  host: string | null;
  hostSource: 'ha' | 'manual' | null;
  hasKey: boolean;
}

export const deviceLogsWsUrl = (): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${ingressAware('api/device-logs/ws')}`;
};

const handle = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // keep status text
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
};

export const fetchDeviceApiConnection = async (deviceId: string) =>
  handle<DeviceApiConnectionView>(await fetch(ingressAware(`api/devices/${encodeURIComponent(deviceId)}/api-connection`)));

/** `null` or '' clears a value; omitted fields are left unchanged. */
export const updateDeviceApiConnection = async (
  deviceId: string,
  update: { manualHost?: string | null; encryptionKey?: string | null },
) =>
  handle<DeviceApiConnectionView>(
    await fetch(ingressAware(`api/devices/${encodeURIComponent(deviceId)}/api-connection`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    }),
  );
