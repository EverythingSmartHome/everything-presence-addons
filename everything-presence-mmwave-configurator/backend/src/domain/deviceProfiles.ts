import fs from 'fs';
import path from 'path';
import { logger } from '../logger';

export interface DeviceProfileLimits {
  maxZones?: number;
  maxExclusionZones?: number;
  maxEntryZones?: number;
  maxRangeMeters?: number;
  fieldOfViewDegrees?: number;
}

export interface DeviceProfile {
  id: string;
  label: string;
  manufacturer: string;
  capabilities: unknown;
  limits: DeviceProfileLimits;
  entityMap: Record<string, unknown>;
  iconUrl?: string;
}

export class DeviceProfileLoader {
  private readonly dir: string;

  constructor(dir: string, fallbackDir?: string) {
    this.dir = fs.existsSync(dir) ? dir : fallbackDir ?? dir;
  }

  listProfiles(): DeviceProfile[] {
    if (!fs.existsSync(this.dir)) {
      logger.warn({ dir: this.dir }, 'Device profiles directory missing');
      return [];
    }

    const files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json'));

    return files.flatMap((file) => {
      const fullPath = path.join(this.dir, file);
      try {
        const raw = fs.readFileSync(fullPath, 'utf-8');
        const parsed = JSON.parse(raw) as DeviceProfile;
        return [parsed];
      } catch (error) {
        logger.warn({ file: fullPath, error }, 'Failed to parse device profile');
        return [];
      }
    });
  }

  getProfileById(id: string): DeviceProfile | undefined {
    return this.listProfiles().find((p) => p.id === id);
  }
}
