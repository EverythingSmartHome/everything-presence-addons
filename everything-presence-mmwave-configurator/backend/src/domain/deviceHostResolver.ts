import type { DeviceRegistryEntry } from '../ha/readTransport';
import { haFetch } from '../ha/haHttp';
import { isValidHost } from '../config/deviceApiStorage';

/**
 * Finds the address Home Assistant's ESPHome integration uses for a device,
 * from that config entry's diagnostics (`data.config.data.host`). HA keeps
 * this current when the device's IP changes (zeroconf), and the diagnostics
 * redact the encryption key, so only the host is taken.
 *
 * Called only when the log viewer has no saved host for the device, or the
 * saved one failed. Never polled.
 */

export type HostLookupFailure =
  | 'device_not_found'
  | 'no_esphome_entry'
  | 'diagnostics_unavailable'
  | 'host_not_in_diagnostics';

export type HostLookupResult = { ok: true; host: string } | { ok: false; reason: HostLookupFailure; detail?: string };

export interface DeviceHostResolverDeps {
  /** HA REST base URL ending in /api. */
  baseUrl: string;
  token: string;
  listDevices: () => Promise<DeviceRegistryEntry[]>;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** Pull `host` out of an ESPHome config entry diagnostics payload. */
export const extractHostFromDiagnostics = (body: unknown): string | null => {
  const root = asRecord(body);
  const data = asRecord(root?.data);
  const config = asRecord(data?.config);
  const entryData = asRecord(config?.data);
  const host = entryData?.host;
  if (typeof host === 'string' && isValidHost(host)) return host.trim();
  return null;
};

const diagnosticsDomain = (body: unknown): string | null => {
  const root = asRecord(body);
  const manifest = asRecord(root?.integration_manifest);
  if (typeof manifest?.domain === 'string') return manifest.domain;
  const config = asRecord(asRecord(root?.data)?.config);
  return typeof config?.domain === 'string' ? config.domain : null;
};

export class DeviceHostResolver {
  private readonly fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  private readonly timeoutMs: number;

  constructor(private readonly deps: DeviceHostResolverDeps) {
    this.fetchImpl = deps.fetchImpl ?? haFetch;
    this.timeoutMs = deps.timeoutMs ?? 10_000;
  }

  async lookup(deviceId: string): Promise<HostLookupResult> {
    const devices = await this.deps.listDevices();
    const device = devices.find((d) => d.id === deviceId);
    if (!device) return { ok: false, reason: 'device_not_found' };

    const entryIds = await this.esphomeEntryIds(device);
    if (entryIds.length === 0) return { ok: false, reason: 'no_esphome_entry' };

    let lastFailure: HostLookupResult = { ok: false, reason: 'host_not_in_diagnostics' };
    for (const entryId of entryIds) {
      const res = await this.get(`/diagnostics/config_entry/${encodeURIComponent(entryId)}`);
      if (!res.ok) {
        lastFailure = { ok: false, reason: 'diagnostics_unavailable', detail: `HTTP ${res.status}` };
        continue;
      }
      const body: unknown = await res.json();
      const domain = diagnosticsDomain(body);
      if (domain && domain !== 'esphome') continue;
      const host = extractHostFromDiagnostics(body);
      if (host) return { ok: true, host };
    }
    return lastFailure;
  }

  /**
   * ESPHome devices normally belong to exactly one config entry, so no extra
   * request is needed. With several, ask HA which of them are ESPHome entries.
   */
  private async esphomeEntryIds(device: DeviceRegistryEntry): Promise<string[]> {
    const entries = device.config_entries ?? [];
    if (entries.length <= 1) return entries;
    try {
      const res = await this.get('/config/config_entries/entry?domain=esphome');
      if (res.ok) {
        const list = (await res.json()) as Array<{ entry_id?: string; domain?: string }>;
        const esphome = new Set(
          list.filter((e) => e.domain === undefined || e.domain === 'esphome').map((e) => e.entry_id),
        );
        const matched = entries.filter((id) => esphome.has(id));
        if (matched.length > 0) return matched;
      }
    } catch {
      // Fall through and try each entry's diagnostics instead.
    }
    return entries;
  }

  private get(path: string): Promise<Response> {
    return this.fetchImpl(`${this.deps.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.deps.token}` },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }
}
