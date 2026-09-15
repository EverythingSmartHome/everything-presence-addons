import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { logger } from '../logger';
import type { RoomConfig } from '../domain/types';
import type { RoomSnapshot } from '../types/roomSnapshot';

const DATA_DIR = process.env.DATA_DIR ?? '/config/everything-presence-zone-configurator';
const SNAPSHOTS_FILE = path.join(DATA_DIR, 'room-snapshots.json');

/** How many snapshots we retain per room before pruning the oldest. */
export const MAX_SNAPSHOTS_PER_ROOM = 20;

const ensureDataDir = () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
};

const readSnapshots = (): RoomSnapshot[] => {
  ensureDataDir();
  if (!fs.existsSync(SNAPSHOTS_FILE)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(SNAPSHOTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RoomSnapshot[]) : [];
  } catch (error) {
    logger.warn({ error }, 'Failed to read room-snapshots.json; returning empty');
    return [];
  }
};

const writeSnapshots = (snapshots: RoomSnapshot[]): void => {
  ensureDataDir();
  fs.writeFileSync(SNAPSHOTS_FILE, JSON.stringify(snapshots, null, 2));
};

const generateId = (): string => {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
};

const prune = (snapshots: RoomSnapshot[], roomId: string): RoomSnapshot[] => {
  const forRoom = snapshots.filter((snapshot) => snapshot.roomId === roomId);
  if (forRoom.length <= MAX_SNAPSHOTS_PER_ROOM) {
    return snapshots;
  }
  const keep = new Set(
    [...forRoom]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .slice(0, MAX_SNAPSHOTS_PER_ROOM)
      .map((snapshot) => snapshot.id),
  );
  return snapshots.filter((snapshot) => snapshot.roomId !== roomId || keep.has(snapshot.id));
};

export const roomSnapshotStorage = {
  listSnapshots: (roomId?: string): RoomSnapshot[] => {
    const snapshots = roomId ? readSnapshots().filter((s) => s.roomId === roomId) : readSnapshots();
    // Newest first so callers can offer "restore previous version" without sorting.
    return [...snapshots].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  },

  getSnapshot: (id: string): RoomSnapshot | undefined => readSnapshots().find((snapshot) => snapshot.id === id),

  /** Store the pre-save state of a room so an accidental overwrite stays recoverable. */
  appendSnapshot: (room: RoomConfig): RoomSnapshot => {
    const snapshot: RoomSnapshot = {
      id: generateId(),
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      reason: 'auto',
      roomId: room.id,
      roomName: room.name,
      room,
    };
    try {
      const snapshots = readSnapshots();
      snapshots.push(snapshot);
      writeSnapshots(prune(snapshots, room.id));
    } catch (error) {
      // Snapshots are a safety net; never fail the save they are protecting.
      logger.warn({ error, roomId: room.id }, 'Failed to write room snapshot');
    }
    return snapshot;
  },

  deleteSnapshot: (id: string): boolean => {
    const snapshots = readSnapshots();
    const next = snapshots.filter((snapshot) => snapshot.id !== id);
    if (next.length === snapshots.length) {
      return false;
    }
    writeSnapshots(next);
    return true;
  },
};
