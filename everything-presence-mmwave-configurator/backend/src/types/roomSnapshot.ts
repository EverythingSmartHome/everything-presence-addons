import type { RoomConfig } from '../domain/types';

export type RoomSnapshotReason = 'auto';

export interface RoomSnapshot {
  id: string;
  schemaVersion: 1;
  createdAt: string;
  reason: RoomSnapshotReason;
  roomId: string;
  roomName?: string;
  /** Full room configuration as it looked *before* the save that triggered this snapshot. */
  room: RoomConfig;
}
