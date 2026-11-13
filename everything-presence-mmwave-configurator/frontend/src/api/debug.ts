import { ingressAware } from './client';
import { filenameFromDisposition } from '../utils/debugCaptureUtils';

export type DebugStopReason = 'user' | 'timeout' | 'restart';

export interface DebugStatus {
  active: boolean;
  sessionId: string | null;
  startedAt: string | null;
  expiresAt: string | null;
  stoppedAt: string | null;
  stopReason: DebugStopReason | null;
  remainingMs: number;
  restarts: number;
  maxDurationMs: number;
  logLevel: string;
  server: { entries: number; dropped: number; bytes: number };
  client: { entries: number; dropped: number };
}

export type MappedEntityStatus = 'ok' | 'renamed' | 'missing' | 'wrong_device' | 'disabled' | 'unavailable';

export interface MappedEntityDiagnosis {
  key: string;
  entityId: string;
  status: MappedEntityStatus;
  currentEntityId?: string;
  actualDeviceId?: string | null;
  disabledBy?: string | null;
  state?: string;
}

export interface DeviceMappingDiagnosis {
  deviceId: string;
  deviceName: string;
  profileId: string;
  deviceFound: boolean | null;
  missingRequiredKeys: string[];
  summary: Record<MappedEntityStatus, number>;
  entities: MappedEntityDiagnosis[];
}

export interface MappingDiagnosticsResponse {
  diagnostics: {
    deviceCount: number;
    problemCount: number;
    statesChecked: boolean;
    registryAvailable: boolean;
    devices: DeviceMappingDiagnosis[];
  };
  errors: Array<{ section: string; message: string }>;
}

const handle = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T;
};

export const fetchDebugStatus = async (): Promise<DebugStatus> =>
  handle<DebugStatus>(await fetch(ingressAware('api/debug/status'), { cache: 'no-store' }));

export const startDebugSessionRequest = async (): Promise<DebugStatus> =>
  handle<DebugStatus>(await fetch(ingressAware('api/debug/start'), { method: 'POST' }));

export const stopDebugSessionRequest = async (): Promise<DebugStatus> =>
  handle<DebugStatus>(await fetch(ingressAware('api/debug/stop'), { method: 'POST' }));

export const fetchMappingDiagnostics = async (): Promise<MappingDiagnosticsResponse> =>
  handle<MappingDiagnosticsResponse>(await fetch(ingressAware('api/debug/diagnostics'), { cache: 'no-store' }));

/** Fetch the redacted bundle and save it via a Blob download. */
export const downloadDebugBundle = async (includeNetworkDetails: boolean): Promise<string> => {
  const query = includeNetworkDetails ? '?includeNetworkDetails=1' : '';
  const res = await fetch(ingressAware(`api/debug/bundle${query}`), { cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  const stamp = new Date().toISOString().replace(/\..+/, '').replace(/[:T]/g, '-');
  const filename = filenameFromDisposition(res.headers.get('Content-Disposition'), `zone-configurator-debug-${stamp}.json`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return filename;
};
