export interface ZoneRect {
  id: string;
  type: 'regular' | 'exclusion' | 'entry';
  x: number;
  y: number;
  width: number;
  height: number;
  enabled?: boolean; // Whether this zone slot is active/configured
  label?: string; // Custom display label (e.g., "Bed", "Chair")
}

export interface Point {
  x: number;
  y: number;
}

export interface ZonePolygon {
  id: string;
  type: 'regular' | 'exclusion' | 'entry';
  vertices: Point[]; // At least 3 vertices for a valid polygon
  enabled?: boolean;
  label?: string;
}

// Union type for both zone shapes
export type Zone = ZoneRect | ZonePolygon;

// Type guard to check if a zone is a polygon
export function isZonePolygon(zone: Zone): zone is ZonePolygon {
  return 'vertices' in zone;
}

// Type guard to check if a zone is a rectangle
export function isZoneRect(zone: Zone): zone is ZoneRect {
  return 'width' in zone && 'height' in zone;
}

export interface RoomShell {
  points: Array<{ x: number; y: number }>;
}

export interface DevicePlacement {
  x: number;
  y: number;
  rotationDeg?: number;
}

export interface FurnitureInstance {
  id: string;
  typeId: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  height: number;
  rotationDeg: number;
  aspectRatioLocked: boolean;
}

export interface Door {
  id: string;
  segmentIndex: number;
  positionOnSegment: number;
  widthMm: number;
  swingDirection: 'in' | 'out';
  swingSide: 'left' | 'right';
}

// ─────────────────────────────────────────────────────────────────
// Entity Mapping Types - Resolved entity IDs stored after discovery
// ─────────────────────────────────────────────────────────────────

/**
 * Set of entity IDs for a zone's coordinate entities.
 */
export interface ZoneEntitySet {
  beginX: string;
  endX: string;
  beginY: string;
  endY: string;
  offDelay?: string;
}

/**
 * Set of entity IDs for a tracking target.
 */
export interface TargetEntitySet {
  x: string;
  y: string;
  speed?: string;
  resolution?: string;
  angle?: string;
  distance?: string;
  active?: string;
}

/**
 * Resolved entity mappings - actual entity IDs stored after discovery.
 * These replace runtime template resolution with direct lookups.
 */
export interface EntityMappings {
  // Discovery metadata
  discoveredAt: string;           // ISO timestamp of discovery
  autoMatchedCount: number;       // How many were auto-matched
  manuallyMappedCount: number;    // How many user manually mapped

  // Core presence/sensor entities
  presenceEntity?: string;
  mmwaveEntity?: string;
  pirEntity?: string;
  temperatureEntity?: string;
  humidityEntity?: string;
  illuminanceEntity?: string;
  co2Entity?: string;

  // Distance/tracking entities (EP1)
  distanceEntity?: string;
  speedEntity?: string;
  energyEntity?: string;
  targetCountEntity?: string;
  modeEntity?: string;

  // Configuration entities
  distanceMinEntity?: string;
  maxDistanceEntity?: string;
  triggerDistanceEntity?: string;
  sensitivityEntity?: string;
  triggerSensitivityEntity?: string;
  offLatencyEntity?: string;
  onLatencyEntity?: string;
  thresholdFactorEntity?: string;
  microMotionEntity?: string;
  updateRateEntity?: string;
  installationAngleEntity?: string;
  polygonZonesEnabledEntity?: string;

  // EPL tracking target count
  trackingTargetCountEntity?: string;

  // Zone configuration entities (EPL rectangular zones)
  zoneConfigEntities?: {
    zone1?: ZoneEntitySet;
    zone2?: ZoneEntitySet;
    zone3?: ZoneEntitySet;
    zone4?: ZoneEntitySet;
  };

  // Exclusion zone entities (EPL)
  exclusionZoneConfigEntities?: {
    exclusion1?: ZoneEntitySet;
    exclusion2?: ZoneEntitySet;
  };

  // Entry zone entities (EPL)
  entryZoneConfigEntities?: {
    entry1?: ZoneEntitySet;
    entry2?: ZoneEntitySet;
  };

  // Polygon zone text entities (EPL)
  polygonZoneEntities?: {
    zone1?: string;
    zone2?: string;
    zone3?: string;
    zone4?: string;
  };

  polygonExclusionEntities?: {
    exclusion1?: string;
    exclusion2?: string;
  };

  polygonEntryEntities?: {
    entry1?: string;
    entry2?: string;
  };

  // Tracking target entities (EPL)
  trackingTargets?: {
    target1?: TargetEntitySet;
    target2?: TargetEntitySet;
    target3?: TargetEntitySet;
  };

  // Settings entities (device configuration controls)
  settingsEntities?: Record<string, string>;

  // Allow additional custom mappings
  [key: string]: unknown;
}

export interface RoomConfig {
  id: string;
  name: string;
  deviceId?: string;
  profileId?: string;
  units: 'metric' | 'imperial';
  zones: ZoneRect[];

  // Entity identification - NEW: entityMappings is preferred
  entityMappings?: EntityMappings;  // Resolved entity IDs from discovery
  entityNamePrefix?: string;        // DEPRECATED: Legacy fallback for template resolution

  roomShell?: RoomShell;
  roomShellFillMode?: 'overlay' | 'material';
  floorMaterial?: 'wood-oak' | 'wood-walnut' | 'carpet-beige' | 'carpet-gray' | 'carpet-blue' | 'carpet-brown' | 'carpet-green' | 'tile' | 'laminate' | 'concrete' | 'none';
  devicePlacement?: DevicePlacement;
  furniture?: FurnitureInstance[];
  doors?: Door[];
  metadata?: Record<string, unknown>;
}

export interface AppSettings {
  wizardCompleted: boolean;
  wizardStep?: string;
  outlineDone?: boolean;
  placementDone?: boolean;
  zonesReady?: boolean;
}

// Custom floor material added by user
export interface CustomFloorMaterial {
  id: string;
  label: string;
  emoji: string;
  color: string; // Hex color for the floor
  category: 'wood' | 'carpet' | 'hard' | 'other';
  patternType: 'solid' | 'stripes' | 'checker' | 'dots'; // Simple pattern types we can generate
  createdAt: number;
}

// Custom furniture type added by user
export interface CustomFurnitureType {
  id: string;
  label: string;
  category: 'bedroom' | 'living-room' | 'office' | 'dining' | 'all';
  defaultWidth: number; // mm
  defaultDepth: number; // mm
  defaultHeight: number; // mm
  color: string; // Hex color for the furniture icon
  shape: 'rectangle' | 'rounded' | 'circle' | 'lshaped'; // Simple shapes we can render
  createdAt: number;
}
