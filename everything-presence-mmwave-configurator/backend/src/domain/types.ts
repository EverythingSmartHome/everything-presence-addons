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

export interface RoomConfig {
  id: string;
  name: string;
  deviceId?: string;
  entityNamePrefix?: string; // e.g., "bedroom_ep_lite" - used to construct entity IDs
  profileId?: string;
  units: 'metric' | 'imperial';
  zones: ZoneRect[];
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
