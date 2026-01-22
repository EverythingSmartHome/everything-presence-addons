import { Router } from 'express';
import crypto from 'crypto';
import { ZoneReader } from '../ha/zoneReader';
import { ZoneWriter } from '../ha/zoneWriter';
import type { IHaReadTransport } from '../ha/readTransport';
import type { IHaWriteClient } from '../ha/writeClient';
import type { DeviceProfileLoader } from '../domain/deviceProfiles';
import { zoneBackupStorage } from '../config/zoneBackupStorage';
import { deviceMappingStorage } from '../config/deviceMappingStorage';
import { deviceEntityService } from '../domain/deviceEntityService';
import { rectToPolygon, isValidPolygon } from '../domain/polygonUtils';
import type { ZoneRect, ZonePolygon, EntityMappings } from '../domain/types';
import type { ZoneBackup } from '../types/zoneBackup';
import { logger } from '../logger';

export interface ZoneBackupsRouterDependencies {
  readTransport: IHaReadTransport;
  writeClient: IHaWriteClient;
  profileLoader: DeviceProfileLoader;
}

const generateId = (): string => {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
};

const parseEntityMappings = (value: unknown): EntityMappings | undefined => {
  if (!value) return undefined;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as EntityMappings;
    } catch {
      return undefined;
    }
  }
  if (typeof value === 'object') {
    return value as EntityMappings;
  }
  return undefined;
};

const parseZoneIndex = (id: string): number => {
  const match = id.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
};

const sortZonesByIndex = (zones: ZoneRect[]): ZoneRect[] =>
  [...zones].sort((a, b) => parseZoneIndex(a.id) - parseZoneIndex(b.id));

const isValidRect = (zone: ZoneRect): boolean =>
  Number.isFinite(zone.width) && Number.isFinite(zone.height) && zone.width > 0 && zone.height > 0;

export const createZoneBackupsRouter = (deps: ZoneBackupsRouterDependencies): Router => {
  const router = Router();
  const zoneReader = new ZoneReader(deps.readTransport);
  const zoneWriter = new ZoneWriter(deps.writeClient);

  /**
   * GET /api/zone-backups
   * List backups (optionally filtered by deviceId).
   */
  router.get('/', (req, res) => {
    const deviceId = typeof req.query?.deviceId === 'string' ? req.query.deviceId : undefined;
    const backups = zoneBackupStorage.listBackups();
    const filtered = deviceId ? backups.filter((backup) => backup.deviceId === deviceId) : backups;
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return res.json({ backups: filtered });
  });

  /**
   * GET /api/zone-backups/:backupId
   * Fetch a single backup.
   */
  router.get('/:backupId', (req, res) => {
    const { backupId } = req.params;
    const backup = zoneBackupStorage.getBackup(backupId);
    if (!backup) {
      return res.status(404).json({ message: 'Backup not found' });
    }
    return res.json({ backup });
  });

  /**
   * DELETE /api/zone-backups/:backupId
   * Delete a backup.
   */
  router.delete('/:backupId', (req, res) => {
    const { backupId } = req.params;
    const deleted = zoneBackupStorage.deleteBackup(backupId);
    if (!deleted) {
      return res.status(404).json({ message: 'Backup not found' });
    }
    return res.json({ deleted: true });
  });

  /**
   * POST /api/zone-backups
   * Create a backup from device rectangular zones.
   * Body: { deviceId, profileId, entityNamePrefix?, entityMappings? }
   */
  router.post('/', async (req, res) => {
    const deviceId = req.body?.deviceId as string | undefined;
    const profileId = req.body?.profileId as string | undefined;
    const entityNamePrefix = req.body?.entityNamePrefix as string | undefined;
    const entityMappings = parseEntityMappings(req.body?.entityMappings);

    if (!deviceId) {
      return res.status(400).json({ message: 'deviceId is required' });
    }
    if (!profileId) {
      return res.status(400).json({ message: 'profileId is required' });
    }

    const profile = deps.profileLoader.getProfileById(profileId);
    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    const prefix =
      entityNamePrefix ||
      deviceEntityService.getDeviceNamePrefix(deviceId) ||
      undefined;
    if (!prefix) {
      return res.status(400).json({ message: 'entityNamePrefix is required when device mapping is missing' });
    }

    try {
      const zones = await zoneReader.readZones(profile.entityMap as any, prefix, entityMappings, deviceId);
      const mapping = deviceMappingStorage.getMapping(deviceId);
      const backup: ZoneBackup = {
        id: generateId(),
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        source: 'device',
        deviceId,
        deviceName: mapping?.deviceName,
        profileId,
        firmwareVersion: mapping?.firmwareVersion,
        zones,
        zoneLabels: mapping?.zoneLabels ?? undefined,
        metadata: {
          entityNamePrefix: prefix,
        },
      };

      zoneBackupStorage.saveBackup(backup);
      return res.json({ backup });
    } catch (error) {
      logger.error({ error, deviceId }, 'Failed to create zone backup');
      return res.status(500).json({ message: 'Failed to create zone backup' });
    }
  });

  /**
   * POST /api/zone-backups/import
   * Import backups from JSON.
   */
  router.post('/import', (req, res) => {
    const payload = req.body?.backups ?? req.body?.backup ?? req.body;
    const candidates = Array.isArray(payload) ? payload : payload ? [payload] : [];
    const importedAt = new Date().toISOString();
    const valid: ZoneBackup[] = [];

    for (const entry of candidates) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const deviceId = typeof entry.deviceId === 'string' ? entry.deviceId : undefined;
      const profileId = typeof entry.profileId === 'string' ? entry.profileId : undefined;
      const zones = Array.isArray(entry.zones) ? (entry.zones as ZoneRect[]) : undefined;
      if (!deviceId || !profileId || !zones) {
        continue;
      }

      valid.push({
        id: typeof entry.id === 'string' && entry.id ? entry.id : generateId(),
        schemaVersion: 1,
        createdAt: typeof entry.createdAt === 'string' && entry.createdAt ? entry.createdAt : importedAt,
        source: entry.source === 'device' ? 'device' : 'import',
        deviceId,
        deviceName: typeof entry.deviceName === 'string' ? entry.deviceName : undefined,
        profileId,
        firmwareVersion: typeof entry.firmwareVersion === 'string' ? entry.firmwareVersion : undefined,
        zones,
        zoneLabels: entry.zoneLabels && typeof entry.zoneLabels === 'object' ? entry.zoneLabels : undefined,
        metadata: entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : undefined,
        importedAt,
      });
    }

    if (valid.length === 0) {
      return res.status(400).json({ message: 'No valid backups found in import payload' });
    }

    zoneBackupStorage.saveBackups(valid);
    return res.json({ backups: valid, imported: valid.length });
  });

  /**
   * POST /api/zone-backups/:backupId/restore
   * Restore a backup by converting rectangular zones to polygons.
   * Body: { deviceId?, profileId?, entityNamePrefix?, entityMappings? }
   */
  router.post('/:backupId/restore', async (req, res) => {
    const { backupId } = req.params;
    const backup = zoneBackupStorage.getBackup(backupId);
    if (!backup) {
      return res.status(404).json({ message: 'Backup not found' });
    }

    const deviceId = (req.body?.deviceId as string | undefined) ?? backup.deviceId;
    const profileId = (req.body?.profileId as string | undefined) ?? backup.profileId;
    const entityNamePrefix = req.body?.entityNamePrefix as string | undefined;
    const entityMappings = parseEntityMappings(req.body?.entityMappings);

    if (!deviceId) {
      return res.status(400).json({ message: 'deviceId is required' });
    }
    if (!profileId) {
      return res.status(400).json({ message: 'profileId is required' });
    }

    const profile = deps.profileLoader.getProfileById(profileId);
    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    const capabilities = profile.capabilities as { polygonZones?: boolean } | null;
    if (!capabilities?.polygonZones) {
      return res.status(409).json({ message: 'Polygon zones are not supported for this device profile' });
    }

    const prefix =
      entityNamePrefix ||
      deviceEntityService.getDeviceNamePrefix(deviceId) ||
      undefined;
    if (!prefix) {
      return res.status(400).json({ message: 'entityNamePrefix is required when device mapping is missing' });
    }

    const limits = profile.limits ?? {};
    const maxZones = limits.maxZones ?? 4;
    const maxExclusion = limits.maxExclusionZones ?? 2;
    const maxEntry = limits.maxEntryZones ?? 2;

    const regularZones = sortZonesByIndex(
      backup.zones.filter((zone) => zone.type === 'regular' && isValidRect(zone))
    ).slice(0, maxZones);
    const exclusionZones = sortZonesByIndex(
      backup.zones.filter((zone) => zone.type === 'exclusion' && isValidRect(zone))
    ).slice(0, maxExclusion);
    const entryZones = sortZonesByIndex(
      backup.zones.filter((zone) => zone.type === 'entry' && isValidRect(zone))
    ).slice(0, maxEntry);

    // Restore writes zones sequentially into slot 1..N regardless of original slot index.
    // If a backup has gaps (e.g. Exclusion 2 only), it will be restored into Exclusion 1.
    // Normalize IDs here so restored labels + verification line up with the restored slots.
    const regularIdMap = new Map<string, string>();
    const exclusionIdMap = new Map<string, string>();
    const entryIdMap = new Map<string, string>();

    const polygons: ZonePolygon[] = [
      ...regularZones.map((zone, idx) => {
        const newId = `Zone ${idx + 1}`;
        regularIdMap.set(zone.id, newId);
        return { ...rectToPolygon(zone), id: newId };
      }),
      ...exclusionZones.map((zone, idx) => {
        const newId = `Exclusion ${idx + 1}`;
        exclusionIdMap.set(zone.id, newId);
        return { ...rectToPolygon(zone), id: newId };
      }),
      ...entryZones.map((zone, idx) => {
        const newId = `Entry ${idx + 1}`;
        entryIdMap.set(zone.id, newId);
        return { ...rectToPolygon(zone), id: newId };
      }),
    ].filter((zone) => isValidPolygon(zone.vertices));

    try {
      await zoneWriter.setPolygonMode(profile.entityMap as any, prefix, true, entityMappings, deviceId);
      const result = await zoneWriter.applyPolygonZones(profile.entityMap as any, polygons, prefix, entityMappings, deviceId);

      const warnings = [...result.failures];
      if (backup.zoneLabels) {
        const mapping = deviceMappingStorage.getMapping(deviceId);
        if (!mapping) {
          warnings.push({
            description: 'Zone labels not restored (device mapping missing)',
            error: 'MAPPING_NOT_FOUND',
          });
        } else {
          const remappedLabels: Record<string, string> = {};
          for (const [oldId, label] of Object.entries(backup.zoneLabels)) {
            const remapped =
              regularIdMap.get(oldId) ?? exclusionIdMap.get(oldId) ?? entryIdMap.get(oldId) ?? null;
            if (remapped) {
              remappedLabels[remapped] = label;
            }
          }
          const merged = { ...(mapping.zoneLabels ?? {}), ...remappedLabels };
          await deviceMappingStorage.saveMapping({
            ...mapping,
            zoneLabels: merged,
            lastUpdated: new Date().toISOString(),
          });
        }
      }

      return res.json({
        ok: result.ok,
        warnings,
        backupId,
        applied: {
          regular: regularZones.length,
          exclusion: exclusionZones.length,
          entry: entryZones.length,
        },
      });
    } catch (error) {
      logger.error({ error, backupId, deviceId }, 'Failed to restore zone backup');
      return res.status(500).json({ message: 'Failed to restore zone backup' });
    }
  });

  return router;
};
