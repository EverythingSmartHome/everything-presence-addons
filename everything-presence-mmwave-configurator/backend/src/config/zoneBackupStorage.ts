import fs from 'fs';
import path from 'path';
import { logger } from '../logger';
import type { ZoneBackup } from '../types/zoneBackup';

const DATA_DIR = process.env.DATA_DIR ?? '/config/everything-presence-zone-configurator';
const BACKUPS_FILE = path.join(DATA_DIR, 'zone-backups.json');

const ensureDataDir = () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
};

const readBackups = (): ZoneBackup[] => {
  ensureDataDir();
  if (!fs.existsSync(BACKUPS_FILE)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(BACKUPS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ZoneBackup[]) : [];
  } catch (error) {
    logger.warn({ error }, 'Failed to read zone backups; returning empty');
    return [];
  }
};

const writeBackups = (backups: ZoneBackup[]): void => {
  ensureDataDir();
  fs.writeFileSync(BACKUPS_FILE, JSON.stringify(backups, null, 2));
};

export const zoneBackupStorage = {
  listBackups: (): ZoneBackup[] => readBackups(),

  getBackup: (id: string): ZoneBackup | undefined =>
    readBackups().find((backup) => backup.id === id),

  saveBackup: (backup: ZoneBackup): ZoneBackup => {
    const backups = readBackups();
    const index = backups.findIndex((entry) => entry.id === backup.id);
    if (index >= 0) {
      backups[index] = backup;
    } else {
      backups.push(backup);
    }
    writeBackups(backups);
    return backup;
  },

  saveBackups: (incoming: ZoneBackup[]): ZoneBackup[] => {
    const backups = readBackups();
    const byId = new Map(backups.map((backup) => [backup.id, backup]));
    for (const backup of incoming) {
      byId.set(backup.id, backup);
    }
    const merged = Array.from(byId.values());
    writeBackups(merged);
    return incoming;
  },

  deleteBackup: (id: string): boolean => {
    const backups = readBackups();
    const next = backups.filter((entry) => entry.id !== id);
    if (next.length === backups.length) {
      return false;
    }
    writeBackups(next);
    return true;
  },
};
