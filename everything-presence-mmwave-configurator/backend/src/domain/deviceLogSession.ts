import type { DeviceApiConnection, HostSource } from '../config/deviceApiStorage';
import {
  ApiCloseReason,
  ApiErrorCode,
  DeviceIdentity,
  DeviceLogMessage,
  EsphomeApiError,
  logLevelValue,
} from '../esphome/apiClient';
import type { EntityStateLine } from '../esphome/entityStates';
import { decodeNoisePsk } from '../esphome/noise';
import { parseLogLine } from '../esphome/logLine';
import type { HostLookupResult } from './deviceHostResolver';

/**
 * One live log view of one device. Created when the user opens the log viewer
 * and stopped when they close it; nothing is kept afterwards.
 *
 * Host selection (Home Assistant is only asked when needed):
 *  1. Saved host  → connect. Manual hosts are never re-resolved.
 *  2. No saved host, or the saved HA host is unreachable / is a different
 *     device → ask HA once; if it reports a different host, save it and retry once.
 */

export type SessionErrorCode = ApiErrorCode | 'no_host' | 'wrong_device' | 'invalid_key' | 'busy';

export type SessionMessage =
  | { type: 'status'; state: 'resolving' }
  | { type: 'status'; state: 'connecting'; host: string; hostSource: HostSource | null; encrypted: boolean }
  | { type: 'status'; state: 'connected'; host: string; hostSource: HostSource | null; encrypted: boolean; device: DeviceIdentity }
  | { type: 'status'; state: 'closed'; reason: ApiCloseReason | 'stopped'; message: string }
  | { type: 'error'; code: SessionErrorCode; message: string; needs?: 'host' | 'key' | 'remove_key' }
  | { type: 'log'; ts: string; level: string; tag: string | null; msg: string };

export interface LogClientLike {
  connect(): Promise<DeviceIdentity>;
  subscribeLogs(level: number, dumpConfig: boolean): void;
  subscribeStates?(): Promise<void>;
  close(reason?: ApiCloseReason): void;
  on(event: 'log', listener: (log: DeviceLogMessage) => void): unknown;
  on(event: 'state', listener: (state: EntityStateLine) => void): unknown;
  on(event: 'close', listener: (info: { reason: ApiCloseReason; error?: EsphomeApiError }) => void): unknown;
}

export interface DeviceLogSessionDeps {
  storage: {
    get(deviceId: string): DeviceApiConnection;
    saveResolvedHost(deviceId: string, host: string): void;
  };
  lookupHost: (deviceId: string) => Promise<HostLookupResult>;
  /** ESPHome node name HA knows for the device, used to detect a reused IP. */
  expectedNodeName: (deviceId: string) => string | undefined;
  createClient: (options: { host: string; noisePsk: Buffer | null }) => LogClientLike;
}

const RE_RESOLVE_ON: SessionErrorCode[] = ['unreachable', 'timeout', 'wrong_device'];

const NEEDS: Partial<Record<SessionErrorCode, 'host' | 'key' | 'remove_key'>> = {
  no_host: 'host',
  unreachable: 'host',
  timeout: 'host',
  wrong_device: 'host',
  encryption_required: 'key',
  bad_key: 'key',
  invalid_key: 'key',
  encryption_not_supported: 'remove_key',
};

const CLOSE_MESSAGES: Record<ApiCloseReason, string> = {
  user: 'Disconnected.',
  device_disconnected: 'The device ended the connection (it may be rebooting).',
  socket_closed: 'The connection to the device was lost.',
  timeout: 'The device stopped responding.',
  error: 'The connection failed.',
};

const VERBOSE_LEVEL = logLevelValue('VERBOSE');

const normalizeNodeName = (name: string): string => name.trim().toLowerCase().replace(/_/g, '-');

type AttemptResult = { ok: true } | { ok: false; code: SessionErrorCode; message: string };

export class DeviceLogSession {
  private client: LogClientLike | null = null;
  private stopped = false;
  private level: number;
  private showStates: boolean;
  /**
   * Set when a VERBOSE line arrives while subscribed at VERBOSE or above: the
   * firmware then logs state publishes itself, so STATE lines would duplicate them.
   */
  private firmwareLogsStates = false;

  constructor(
    private readonly deviceId: string,
    private readonly deps: DeviceLogSessionDeps,
    private readonly emit: (message: SessionMessage) => void,
    level = 'DEBUG',
    showStates = true,
  ) {
    this.level = logLevelValue(level);
    this.showStates = showStates;
  }

  async start(): Promise<void> {
    const saved = this.deps.storage.get(this.deviceId);

    let psk: Buffer | null = null;
    if (saved.noisePsk) {
      psk = decodeNoisePsk(saved.noisePsk);
      if (!psk) {
        return this.error('invalid_key', 'The saved encryption key is not valid. Enter it again.');
      }
    }

    if (saved.host) {
      const first = await this.attempt(saved.host, saved.hostSource ?? null, psk);
      if (first.ok || this.stopped) return;
      if (saved.hostSource === 'manual' || !RE_RESOLVE_ON.includes(first.code)) {
        return this.error(first.code, first.message);
      }
      // The saved HA host failed: ask HA once whether the address changed.
      this.emit({ type: 'status', state: 'resolving' });
      const lookup = await this.safeLookup();
      if (this.stopped) return;
      if (!lookup.ok || lookup.host === saved.host) {
        return this.error(first.code, first.message);
      }
      this.deps.storage.saveResolvedHost(this.deviceId, lookup.host);
      const second = await this.attempt(lookup.host, 'ha', psk);
      if (!second.ok && !this.stopped) this.error(second.code, second.message);
      return;
    }

    this.emit({ type: 'status', state: 'resolving' });
    const lookup = await this.safeLookup();
    if (this.stopped) return;
    if (!lookup.ok) {
      return this.error('no_host', `Could not find this device's address in Home Assistant (${lookup.reason}). Enter it manually.`);
    }
    this.deps.storage.saveResolvedHost(this.deviceId, lookup.host);
    const result = await this.attempt(lookup.host, 'ha', psk);
    if (!result.ok && !this.stopped) this.error(result.code, result.message);
  }

  /** Change the subscription level on the open connection. */
  setLevel(level: string): void {
    this.level = logLevelValue(level);
    // Below VERBOSE the firmware no longer sends its own state lines.
    if (this.level < VERBOSE_LEVEL) this.firmwareLogsStates = false;
    try {
      this.client?.subscribeLogs(this.level, false);
    } catch {
      // Not connected yet; the new level is used when the subscription starts.
    }
  }

  /**
   * Show or hide STATE lines. Hidden lines are not sent to the viewer at all;
   * turning them back on shows changes from then on.
   */
  setShowStates(show: boolean): void {
    this.showStates = show;
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.client?.close('user');
    this.client = null;
  }

  private async safeLookup(): Promise<HostLookupResult> {
    try {
      return await this.deps.lookupHost(this.deviceId);
    } catch (error) {
      return { ok: false, reason: 'diagnostics_unavailable', detail: (error as Error).message };
    }
  }

  private async attempt(host: string, hostSource: HostSource | null, psk: Buffer | null): Promise<AttemptResult> {
    const encrypted = psk !== null;
    this.emit({ type: 'status', state: 'connecting', host, hostSource, encrypted });
    const client = this.deps.createClient({ host, noisePsk: psk });
    this.client = client;

    let device: DeviceIdentity;
    try {
      device = await client.connect();
    } catch (error) {
      this.client = null;
      if (error instanceof EsphomeApiError) return { ok: false, code: error.code, message: error.message };
      return { ok: false, code: 'protocol_error', message: (error as Error).message };
    }

    if (this.stopped) {
      client.close('user');
      return { ok: true };
    }

    const expected = this.deps.expectedNodeName(this.deviceId);
    if (expected && device.name && normalizeNodeName(expected) !== normalizeNodeName(device.name)) {
      client.close('user');
      this.client = null;
      return {
        ok: false,
        code: 'wrong_device',
        message: `${host} is a different device ("${device.name}", expected "${expected}").`,
      };
    }

    // Entity state changes as `STATE` lines, like `esphome logs` shows them.
    // The device replays every current state on subscribe; the first state of
    // each entity is skipped (even while hidden) so only changes appear.
    // Lines still in flight from a VERBOSE subscription are ignored after the
    // level is lowered, so they cannot switch STATE lines off again.
    const seenEntities = new Set<string>();
    client.on('log', (log) => {
      if (log.level >= VERBOSE_LEVEL && this.level >= VERBOSE_LEVEL) this.firmwareLogsStates = true;
      const parsed = parseLogLine(log.level, log.message);
      this.emit({ type: 'log', ts: new Date().toISOString(), ...parsed });
    });
    client.on('state', (state) => {
      if (!seenEntities.has(state.id)) {
        seenEntities.add(state.id);
        return;
      }
      if (this.firmwareLogsStates || !this.showStates) return;
      if (state.text) {
        this.emit({ type: 'log', ts: new Date().toISOString(), level: 'STATE', tag: state.kind, msg: state.text });
      }
    });
    client.on('close', ({ reason, error }) => {
      if (this.stopped) return;
      this.client = null;
      this.emit({ type: 'status', state: 'closed', reason, message: error?.message ?? CLOSE_MESSAGES[reason] });
    });

    client.subscribeLogs(this.level, true);
    // Best effort: if listing entities fails the log stream carries on.
    client.subscribeStates?.().catch(() => undefined);
    this.emit({ type: 'status', state: 'connected', host, hostSource, encrypted, device });
    return { ok: true };
  }

  private error(code: SessionErrorCode, message: string): void {
    if (this.stopped) return;
    const needs = NEEDS[code];
    this.emit({ type: 'error', code, message, ...(needs ? { needs } : {}) });
  }
}
