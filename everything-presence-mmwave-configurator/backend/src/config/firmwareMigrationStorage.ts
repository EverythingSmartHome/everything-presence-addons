import fs from 'fs';
import path from 'path';
import { logger } from '../logger';

export type FirmwareMigrationPhase =
  | 'idle'
  | 'backing_up'
  | 'installing'
  | 'resync_wait'
  | 'resyncing'
  | 'restoring'
  | 'verifying'
  | 'complete'
  | 'error';

export interface FirmwareMigrationState {
  deviceId: string;
  phase: FirmwareMigrationPhase;
  backupId: string | null;
  preparedVersion: string | null;
  startedAt: string;
  updatedAt: string;
  lastError: string | null;
}

interface FirmwareMigrationFile {
  version: 1;
  byDeviceId: Record<string, FirmwareMigrationState>;
  activeDeviceId: string | null;
}

const DATA_DIR = process.env.DATA_DIR ?? '/config/everything-presence-zone-configurator';
const MIGRATION_FILE = path.join(DATA_DIR, 'firmware-migrations.json');

const ensureDataDir = () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
};

const readFile = (): FirmwareMigrationFile => {
  ensureDataDir();
  if (!fs.existsSync(MIGRATION_FILE)) {
    return { version: 1, byDeviceId: {}, activeDeviceId: null };
  }
  try {
    const raw = fs.readFileSync(MIGRATION_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<FirmwareMigrationFile>;
    if (parsed && parsed.version === 1 && parsed.byDeviceId && typeof parsed.byDeviceId === 'object') {
      return {
        version: 1,
        byDeviceId: parsed.byDeviceId as Record<string, FirmwareMigrationState>,
        activeDeviceId: typeof parsed.activeDeviceId === 'string' ? parsed.activeDeviceId : null,
      };
    }
  } catch (error) {
    logger.warn({ error }, 'Failed to read firmware migration state; returning empty');
  }
  return { version: 1, byDeviceId: {}, activeDeviceId: null };
};

const writeFile = (data: FirmwareMigrationFile) => {
  ensureDataDir();
  fs.writeFileSync(MIGRATION_FILE, JSON.stringify(data, null, 2));
};

const isActivePhase = (phase: FirmwareMigrationPhase): boolean =>
  ['backing_up', 'installing', 'resync_wait', 'resyncing', 'restoring', 'verifying'].includes(phase);

export const firmwareMigrationStorage = {
  get: (deviceId: string): FirmwareMigrationState | null => {
    const file = readFile();
    return file.byDeviceId[deviceId] ?? null;
  },

  getActive: (): FirmwareMigrationState | null => {
    const file = readFile();
    const deviceId = file.activeDeviceId;
    if (!deviceId) return null;
    return file.byDeviceId[deviceId] ?? null;
  },

  upsert: (deviceId: string, patch: Partial<Omit<FirmwareMigrationState, 'deviceId' | 'startedAt' | 'updatedAt'>> & { phase: FirmwareMigrationPhase }): FirmwareMigrationState => {
    const file = readFile();
    const now = new Date().toISOString();
    const existing = file.byDeviceId[deviceId];
    const next: FirmwareMigrationState = {
      deviceId,
      phase: patch.phase,
      backupId: typeof patch.backupId === 'string' ? patch.backupId : patch.backupId ?? existing?.backupId ?? null,
      preparedVersion:
        typeof patch.preparedVersion === 'string'
          ? patch.preparedVersion
          : patch.preparedVersion ?? existing?.preparedVersion ?? null,
      startedAt: existing?.startedAt ?? now,
      updatedAt: now,
      lastError: typeof patch.lastError === 'string' ? patch.lastError : patch.lastError ?? existing?.lastError ?? null,
    };

    file.byDeviceId[deviceId] = next;
    if (isActivePhase(next.phase)) {
      file.activeDeviceId = deviceId;
    } else if (file.activeDeviceId === deviceId) {
      file.activeDeviceId = null;
    }
    writeFile(file);
    return next;
  },

  clear: (deviceId: string): void => {
    const file = readFile();
    delete file.byDeviceId[deviceId];
    if (file.activeDeviceId === deviceId) {
      file.activeDeviceId = null;
    }
    writeFile(file);
  },
};

