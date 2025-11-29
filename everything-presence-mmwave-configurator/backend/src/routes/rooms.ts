import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { storage } from '../config/storage';
import { DevicePlacement, Door, EntityMappings, FurnitureInstance, RoomConfig, RoomShell, ZoneRect, ZoneEntitySet, TargetEntitySet } from '../domain/types';

export const createRoomsRouter = (): Router => {
  const router = Router();

  const parseZone = (zone: any, fallbackId?: string): ZoneRect => ({
    id: zone?.id ?? fallbackId ?? uuidv4(),
    type: zone?.type === 'exclusion' || zone?.type === 'entry' ? zone.type : 'regular',
    x: Number(zone?.x ?? 0),
    y: Number(zone?.y ?? 0),
    width: Number(zone?.width ?? 0),
    height: Number(zone?.height ?? 0),
    enabled: zone?.enabled !== undefined ? Boolean(zone.enabled) : undefined,
    label: typeof zone?.label === 'string' && zone.label.trim() ? zone.label.trim() : undefined,
  });

  const parseRoomShell = (shell: any): RoomShell | undefined => {
    if (!shell || !Array.isArray(shell.points)) return undefined;
    const points = shell.points
      .map((p: any) => ({
        x: Number(p?.x ?? 0),
        y: Number(p?.y ?? 0),
      }))
      .filter((p: any) => Number.isFinite(p.x) && Number.isFinite(p.y));
    return points.length ? { points } : undefined;
  };

  const parseDevicePlacement = (placement: any): DevicePlacement | undefined => {
    if (!placement) return undefined;
    const x = Number(placement?.x ?? 0);
    const y = Number(placement?.y ?? 0);
    const rotationDeg = placement?.rotationDeg !== undefined ? Number(placement.rotationDeg) : undefined;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    return {
      x,
      y,
      rotationDeg: Number.isFinite(rotationDeg) ? rotationDeg : undefined,
    };
  };

  const parseFurniture = (furniture: any): FurnitureInstance | null => {
    if (!furniture || typeof furniture.id !== 'string' || typeof furniture.typeId !== 'string') {
      return null;
    }
    const x = Number(furniture?.x ?? 0);
    const y = Number(furniture?.y ?? 0);
    const width = Number(furniture?.width ?? 0);
    const depth = Number(furniture?.depth ?? 0);
    const height = Number(furniture?.height ?? 0);
    const rotationDeg = Number(furniture?.rotationDeg ?? 0);
    const aspectRatioLocked = Boolean(furniture?.aspectRatioLocked);

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(depth)) {
      return null;
    }

    return {
      id: furniture.id,
      typeId: furniture.typeId,
      x,
      y,
      width,
      depth,
      height,
      rotationDeg,
      aspectRatioLocked,
    };
  };

  const parseDoor = (door: any): Door | null => {
    if (!door || typeof door.id !== 'string') {
      return null;
    }
    const segmentIndex = Number(door?.segmentIndex ?? 0);
    const positionOnSegment = Number(door?.positionOnSegment ?? 0.5);
    const widthMm = Number(door?.widthMm ?? 800);
    const swingDirection = door?.swingDirection === 'out' ? 'out' : 'in';
    const swingSide = door?.swingSide === 'right' ? 'right' : 'left';

    if (!Number.isFinite(segmentIndex) || !Number.isFinite(positionOnSegment) || !Number.isFinite(widthMm)) {
      return null;
    }

    return {
      id: door.id,
      segmentIndex,
      positionOnSegment,
      widthMm,
      swingDirection,
      swingSide,
    };
  };

  const parseZoneEntitySet = (set: any): ZoneEntitySet | undefined => {
    if (!set || typeof set !== 'object') return undefined;
    const beginX = typeof set.beginX === 'string' ? set.beginX : undefined;
    const endX = typeof set.endX === 'string' ? set.endX : undefined;
    const beginY = typeof set.beginY === 'string' ? set.beginY : undefined;
    const endY = typeof set.endY === 'string' ? set.endY : undefined;
    // Must have all coordinate entities
    if (!beginX || !endX || !beginY || !endY) return undefined;
    return {
      beginX,
      endX,
      beginY,
      endY,
      offDelay: typeof set.offDelay === 'string' ? set.offDelay : undefined,
    };
  };

  const parseTargetEntitySet = (set: any): TargetEntitySet | undefined => {
    if (!set || typeof set !== 'object') return undefined;
    const x = typeof set.x === 'string' ? set.x : undefined;
    const y = typeof set.y === 'string' ? set.y : undefined;
    // Must have at least x and y
    if (!x || !y) return undefined;
    return {
      x,
      y,
      speed: typeof set.speed === 'string' ? set.speed : undefined,
      resolution: typeof set.resolution === 'string' ? set.resolution : undefined,
      angle: typeof set.angle === 'string' ? set.angle : undefined,
      distance: typeof set.distance === 'string' ? set.distance : undefined,
      active: typeof set.active === 'string' ? set.active : undefined,
    };
  };

  const parseEntityMappings = (mappings: any): EntityMappings | undefined => {
    if (!mappings || typeof mappings !== 'object') return undefined;

    const result: EntityMappings = {
      discoveredAt: typeof mappings.discoveredAt === 'string' ? mappings.discoveredAt : new Date().toISOString(),
      autoMatchedCount: typeof mappings.autoMatchedCount === 'number' ? mappings.autoMatchedCount : 0,
      manuallyMappedCount: typeof mappings.manuallyMappedCount === 'number' ? mappings.manuallyMappedCount : 0,
    };

    // Parse flat string entity mappings
    const stringKeys = [
      'presenceEntity', 'mmwaveEntity', 'pirEntity', 'temperatureEntity',
      'humidityEntity', 'illuminanceEntity', 'co2Entity', 'distanceEntity',
      'speedEntity', 'energyEntity', 'targetCountEntity', 'modeEntity',
      'maxDistanceEntity', 'installationAngleEntity', 'polygonZonesEnabledEntity',
      'trackingTargetCountEntity',
    ];
    for (const key of stringKeys) {
      if (typeof mappings[key] === 'string') {
        (result as any)[key] = mappings[key];
      }
    }

    // Parse zone config entities
    if (mappings.zoneConfigEntities && typeof mappings.zoneConfigEntities === 'object') {
      result.zoneConfigEntities = {};
      for (const [zoneKey, set] of Object.entries(mappings.zoneConfigEntities)) {
        const parsed = parseZoneEntitySet(set);
        if (parsed) {
          (result.zoneConfigEntities as any)[zoneKey] = parsed;
        }
      }
    }

    // Parse exclusion zone entities
    if (mappings.exclusionZoneConfigEntities && typeof mappings.exclusionZoneConfigEntities === 'object') {
      result.exclusionZoneConfigEntities = {};
      for (const [zoneKey, set] of Object.entries(mappings.exclusionZoneConfigEntities)) {
        const parsed = parseZoneEntitySet(set);
        if (parsed) {
          (result.exclusionZoneConfigEntities as any)[zoneKey] = parsed;
        }
      }
    }

    // Parse entry zone entities
    if (mappings.entryZoneConfigEntities && typeof mappings.entryZoneConfigEntities === 'object') {
      result.entryZoneConfigEntities = {};
      for (const [zoneKey, set] of Object.entries(mappings.entryZoneConfigEntities)) {
        const parsed = parseZoneEntitySet(set);
        if (parsed) {
          (result.entryZoneConfigEntities as any)[zoneKey] = parsed;
        }
      }
    }

    // Parse polygon zone entities (simple string mappings)
    const polygonGroups = ['polygonZoneEntities', 'polygonExclusionEntities', 'polygonEntryEntities'] as const;
    for (const groupKey of polygonGroups) {
      if (mappings[groupKey] && typeof mappings[groupKey] === 'object') {
        (result as any)[groupKey] = {};
        for (const [zoneKey, entityId] of Object.entries(mappings[groupKey])) {
          if (typeof entityId === 'string') {
            (result as any)[groupKey][zoneKey] = entityId;
          }
        }
      }
    }

    // Parse tracking targets
    if (mappings.trackingTargets && typeof mappings.trackingTargets === 'object') {
      result.trackingTargets = {};
      for (const [targetKey, set] of Object.entries(mappings.trackingTargets)) {
        const parsed = parseTargetEntitySet(set);
        if (parsed) {
          (result.trackingTargets as any)[targetKey] = parsed;
        }
      }
    }

    return result;
  };

  const normalizeRoom = (body: any, existingId?: string): RoomConfig => ({
    id: body?.id ?? existingId ?? uuidv4(),
    name: typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : 'Untitled room',
    deviceId: typeof body?.deviceId === 'string' && body.deviceId.trim() ? body.deviceId.trim() : undefined,
    profileId: typeof body?.profileId === 'string' && body.profileId.trim() ? body.profileId.trim() : undefined,
    units: body?.units === 'imperial' ? 'imperial' : 'metric',
    zones: Array.isArray(body?.zones)
      ? body.zones.map((z: any, idx: number) => parseZone(z, `zone-${idx + 1}`))
      : [],
    // Entity identification - entityMappings is preferred, entityNamePrefix is legacy fallback
    entityMappings: parseEntityMappings(body?.entityMappings),
    entityNamePrefix: typeof body?.entityNamePrefix === 'string' && body.entityNamePrefix.trim() ? body.entityNamePrefix.trim() : undefined,
    roomShell: parseRoomShell(body?.roomShell),
    roomShellFillMode: body?.roomShellFillMode === 'overlay' || body?.roomShellFillMode === 'material' ? body.roomShellFillMode : undefined,
    floorMaterial: ['wood-oak', 'wood-walnut', 'carpet-beige', 'carpet-gray', 'carpet-blue', 'carpet-brown', 'carpet-green', 'tile', 'laminate', 'concrete', 'none'].includes(body?.floorMaterial) ? body.floorMaterial : undefined,
    devicePlacement: parseDevicePlacement(body?.devicePlacement),
    furniture: Array.isArray(body?.furniture)
      ? body.furniture.map(parseFurniture).filter((f: FurnitureInstance | null) => f !== null)
      : undefined,
    doors: Array.isArray(body?.doors)
      ? body.doors.map(parseDoor).filter((d: Door | null) => d !== null)
      : undefined,
    metadata: body?.metadata ?? {},
  });

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
    const room = normalizeRoom(req.body);
    storage.saveRoom(room);
    res.json({ room });
  });

  router.put('/:id', (req, res) => {
    const existing = storage.getRoom(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Room not found' });
    }
    const room = normalizeRoom({ ...existing, ...req.body }, existing.id);
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
