import type { ZoneRect } from '../domain/types';

export type ZoneBackupSource = 'device' | 'import';

export interface ZoneBackup {
  id: string;
  schemaVersion: 1;
  createdAt: string;
  source: ZoneBackupSource;
  deviceId: string;
  deviceName?: string;
  profileId: string;
  firmwareVersion?: string;
  zones: ZoneRect[];
  zoneLabels?: Record<string, string>;
  metadata?: {
    model?: string;
    entityNamePrefix?: string;
    notes?: string;
  };
  importedAt?: string;
}
