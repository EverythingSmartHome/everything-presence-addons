import { Router } from 'express';
import { storage } from '../config/storage';
import { roomSnapshotStorage } from '../config/roomSnapshotStorage';
import { logger } from '../logger';
import { deviceEntityService } from '../domain/deviceEntityService';
import { normalizeRoom, parseRoomShell, parseZone } from '../domain/roomNormalization';
import { RoomConfig } from '../domain/types';

export const createRoomsRouter = (): Router => {
  const router = Router();

  const applyDeviceMappingPrefix = (room: RoomConfig): RoomConfig => {
    if (room.entityNamePrefix || !room.deviceId) {
      return room;
    }

    const mappingPrefix = deviceEntityService.getDeviceNamePrefix(room.deviceId);
    if (!mappingPrefix) {
      return room;
    }

    return {
      ...room,
      entityNamePrefix: mappingPrefix,
    };
  };

  router.get('/', (_req, res) => {
    res.json({ rooms: storage.listRooms() });
  });

  router.get('/:id', (req, res) => {
    const room = storage.getRoom(req.params.id);
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }
    return res.json({ room });
  });

  router.post('/', (req, res) => {
    const room = applyDeviceMappingPrefix(normalizeRoom(req.body));
    storage.saveRoom(room);
    res.json({ room });
  });

  router.put('/:id', (req, res) => {
    const existing = storage.getRoom(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Room not found' });
    }
    const body = req.body ?? {};
    const merged: any = { ...existing, ...body };

    // A room outline is expensive to redraw and impossible to recover from a
    // shallow merge, so it is only ever removed on an explicit request: send
    // `roomShell: null` to clear it. An absent key, an empty `points` array, or
    // anything else that does not parse to a usable shell keeps what is stored.
    const shellProvided = Object.prototype.hasOwnProperty.call(body, 'roomShell');
    const explicitClear = shellProvided && body.roomShell === null;
    if (existing.roomShell && !explicitClear && !parseRoomShell(merged.roomShell)) {
      if (shellProvided) {
        logger.warn(
          { roomId: existing.id },
          'Ignoring room update that would erase the stored room outline; send roomShell: null to clear it explicitly',
        );
      }
      merged.roomShell = existing.roomShell;
    }

    const room = applyDeviceMappingPrefix(normalizeRoom(merged, existing.id));
    storage.saveRoom(room);
    return res.json({ room });
  });

  router.get('/:id/snapshots', (req, res) => {
    const snapshots = roomSnapshotStorage.listSnapshots(req.params.id);
    return res.json({ snapshots });
  });

  router.post('/:id/snapshots/:snapshotId/restore', (req, res) => {
    const snapshot = roomSnapshotStorage.getSnapshot(req.params.snapshotId);
    if (!snapshot || snapshot.roomId !== req.params.id) {
      return res.status(404).json({ message: 'Snapshot not found' });
    }
    // saveRoom snapshots the current state first, so a restore is itself undoable.
    const room = applyDeviceMappingPrefix(normalizeRoom(snapshot.room, req.params.id));
    storage.saveRoom(room);
    return res.json({ room });
  });

  router.get('/:id/zones', (req, res) => {
    const room = storage.getRoom(req.params.id);
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }
    return res.json({ zones: room.zones });
  });

  router.put('/:id/zones', (req, res) => {
    const room = storage.getRoom(req.params.id);
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }
    const zones = Array.isArray(req.body?.zones)
      ? req.body.zones.map((z: any, idx: number) => parseZone(z, `zone-${idx + 1}`))
      : [];
    const updated: RoomConfig = { ...room, zones };
    storage.saveRoom(updated);
    return res.json({ room: updated });
  });

  router.delete('/:id', (req, res) => {
    const removed = storage.deleteRoom(req.params.id);
    if (!removed) {
      return res.status(404).json({ message: 'Room not found' });
    }
    return res.json({ ok: true });
  });

  return router;
};
