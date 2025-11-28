export interface DiscoveredDevice {
  id: string;
  name: string;
  manufacturer?: string;
  model?: string;
  entityNamePrefix?: string; // e.g., "bedroom_ep_lite"
  firmwareVersion?: string; // Software/firmware version (e.g., "1.3.2")
}

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

export interface Point {
  x: number;
  y: number;
}

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

export interface FurnitureType {
  id: string; // e.g., 'bed-double', 'sofa-2seat'
  label: string; // Display name
  category: 'bedroom' | 'living-room' | 'office' | 'dining' | 'all';
  defaultWidth: number; // mm
  defaultDepth: number; // mm (depth in 2D top-down view)
  defaultHeight: number; // mm (vertical height for future 3D)
  iconUrl?: string; // Path to furniture icon/image
  svgPath?: string; // SVG path data for custom shapes
}

export interface FurnitureInstance {
  id: string; // Unique instance ID
  typeId: string; // References FurnitureType.id
  x: number; // Position in mm (room coordinates, center point)
  y: number; // Position in mm (room coordinates, center point)
  width: number; // Scaled width in mm
  depth: number; // Scaled depth in mm (2D)
  height: number; // Vertical height in mm (for future use)
  rotationDeg: number; // 0-360 degrees
  aspectRatioLocked: boolean; // Whether aspect ratio is locked during resize
}

export interface Door {
  id: string; // Unique door ID
  segmentIndex: number; // Which wall segment (0 to N-1)
  positionOnSegment: number; // 0.0 to 1.0 - position along the segment
  widthMm: number; // Door width in millimeters (typically 800-900mm)
  swingDirection: 'in' | 'out'; // Door swing direction relative to room
  swingSide: 'left' | 'right'; // Which side the hinge is on
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
  floorMaterial?: 'wood-oak' | 'wood-walnut' | 'wood-cherry' | 'wood-ash' | 'wood-mahogany' | 'wood-herringbone' | 'carpet-beige' | 'carpet-gray' | 'carpet-charcoal' | 'carpet-navy' | 'carpet-burgundy' | 'tile-white' | 'tile-gray' | 'tile-terracotta' | 'marble-white' | 'marble-black' | 'slate' | 'concrete' | 'vinyl-light' | 'none';
  devicePlacement?: DevicePlacement;
  furniture?: FurnitureInstance[]; // Added furniture support
  doors?: Door[]; // Added door support
  metadata?: Record<string, unknown>;
}

export interface AppSettings {
  wizardCompleted: boolean;
  wizardStep?: string;
  outlineDone?: boolean;
  placementDone?: boolean;
  zonesReady?: boolean;
}

export interface LiveState {
  deviceId: string;
  profileId: string;
  timestamp: number;
  presence?: boolean;
  distance?: number | null;
  speed?: number | null;
  energy?: number | null;
  targetCount?: number;
  mmwave?: boolean;
  pir?: boolean;
  temperature?: number | null;
  humidity?: number | null;
  illuminance?: number | null;
  co2?: number | null;
  targets?: Array<{
    id: number;
    x: number | null;
    y: number | null;
    distance?: number | null;
    speed?: number | null;
    angle?: number | null;
    resolution?: number | null;
    active?: boolean;
  }>;
  // Zone occupancy status (EPL)
  zoneOccupancy?: {
    zone1?: boolean;
    zone2?: boolean;
    zone3?: boolean;
    zone4?: boolean;
  };
  // Assumed presence status (entry/exit feature)
  assumedPresent?: boolean;
  assumedPresentRemaining?: number; // seconds remaining
  config?: EP1Config;
}

// Everything Presence One (EP1) specific types
export type EP1Mode = 'Presence Detection' | 'Distance and Speed';

export interface EP1EnvironmentalData {
  temperature: number | null;
  humidity: number | null;
  illuminance: number | null;
}

export interface EP1DistanceData {
  distance: number | null;    // meters
  speed: number | null;        // m/s
  energy: number | null;       // signal strength
  targetCount: number;         // 0 or 1
}

export interface EP1PresenceData {
  occupancy: boolean;
  mmwave: boolean;
  pir: boolean;
}

export interface EP1Config {
  mode: EP1Mode | null;
  distanceMin: number | null;
  distanceMax: number | null;
  triggerDistance: number | null;
  sensitivity: number | null;
  triggerSensitivity: number | null;
  offLatency: number | null;
  onLatency: number | null;
  thresholdFactor?: number | null;
  microMotionEnabled?: boolean;
  updateRate?: string | null;
  // EPL-specific (installation angle for coordinate system rotation)
  installationAngle?: number;
}

export interface EP1LiveData {
  deviceId: string;
  profileId: string;
  timestamp: number;
  presence: boolean;
  mmwave: boolean;
  pir: boolean;
  temperature: number | null;
  humidity: number | null;
  illuminance: number | null;
  distance: number | null;
  speed: number | null;
  energy: number | null;
  targetCount: number;
  config: EP1Config;
}

export interface ZoneAvailabilityEntry {
  enabled: boolean;
  disabledBy: 'user' | 'integration' | 'config_entry' | null;
}

export type ZoneAvailability = Record<string, ZoneAvailabilityEntry>;

// Full response from zone-availability endpoint including feature availability
export interface ZoneAvailabilityResponse {
  availability: ZoneAvailability;
  polygonZonesAvailable: boolean;
  entryZonesAvailable: boolean;
}

// Custom floor material added by user
export interface CustomFloorMaterial {
  id: string;
  label: string;
  emoji: string;
  color: string; // Hex color for the floor
  category: 'wood' | 'carpet' | 'hard' | 'other';
  patternType: 'solid' | 'stripes' | 'checker' | 'dots';
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
  shape: 'rectangle' | 'rounded' | 'circle' | 'lshaped';
  createdAt: number;
}

// Heatmap types
export interface HeatmapCell {
  x: number;
  y: number;
  count: number;
  intensity: number; // 0-1 normalized
}

export interface HeatmapZoneStat {
  zoneId: string;
  zoneName: string;
  sampleCount: number;
  percentage: number;
}

export interface HourlyBreakdown {
  hour: number; // 0-23
  count: number;
  percentage: number;
}

export interface AveragePosition {
  x: number;
  y: number;
}

export interface HeatmapResponse {
  resolution: number;
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
  cells: HeatmapCell[];
  stats: {
    totalSamples: number;
    maxCount: number;
    timeRange: {
      start: string;
      end: string;
    };
    dataAvailable: boolean;
  };
  zoneStats?: HeatmapZoneStat[];
  hourlyBreakdown?: HourlyBreakdown[];
  averagePosition?: AveragePosition;
}
