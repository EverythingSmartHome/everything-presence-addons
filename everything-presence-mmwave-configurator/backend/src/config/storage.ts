import fs from 'fs';
import path from 'path';
import { AppSettings, CustomFloorMaterial, CustomFurnitureType, RoomConfig } from '../domain/types';
import { logger } from '../logger';

// Use /config/everything-presence-zone-configurator for persistent storage across add-on reinstalls
// The /config directory is mapped to Home Assistant's config folder via config:rw in config.yaml
// Using /data would cause data loss on reinstall as it's container-internal storage
const DATA_DIR = process.env.DATA_DIR ?? '/config/everything-presence-zone-configurator';
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CUSTOM_FLOORS_FILE = path.join(DATA_DIR, 'custom-floors.json');
const CUSTOM_FURNITURE_FILE = path.join(DATA_DIR, 'custom-furniture.json');

const ensureDataDir = () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
};

const readRooms = (): RoomConfig[] => {
  ensureDataDir();
  if (!fs.existsSync(ROOMS_FILE)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(ROOMS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RoomConfig[]) : [];
  } catch (error) {
    logger.warn({ error }, 'Failed to read rooms.json; returning empty');
    return [];
  }
};

const writeRooms = (rooms: RoomConfig[]) => {
  ensureDataDir();
  fs.writeFileSync(ROOMS_FILE, JSON.stringify(rooms, null, 2));
};

const readSettings = (): AppSettings => {
  ensureDataDir();
  if (!fs.existsSync(SETTINGS_FILE)) {
    return {
      wizardCompleted: false,
      wizardStep: 'device',
      outlineDone: false,
      placementDone: false,
      zonesReady: false,
      defaultRoomId: null,
    };
  }
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const rawDefaultRoom = (parsed as any).defaultRoomId;
      return {
        wizardCompleted: Boolean((parsed as any).wizardCompleted),
        wizardStep: typeof (parsed as any).wizardStep === 'string' ? (parsed as any).wizardStep : 'device',
        outlineDone: Boolean((parsed as any).outlineDone),
        placementDone: Boolean((parsed as any).placementDone),
        zonesReady: Boolean((parsed as any).zonesReady),
        defaultRoomId:
          typeof rawDefaultRoom === 'string'
            ? rawDefaultRoom
            : rawDefaultRoom === null
            ? null
            : undefined,
      };
    }
    return {
      wizardCompleted: false,
      wizardStep: 'device',
      outlineDone: false,
      placementDone: false,
      zonesReady: false,
      defaultRoomId: null,
    };
  } catch (error) {
    logger.warn({ error }, 'Failed to read settings.json; returning defaults');
    return {
      wizardCompleted: false,
      wizardStep: 'device',
      outlineDone: false,
      placementDone: false,
      zonesReady: false,
      defaultRoomId: null,
    };
  }
};

const writeSettings = (settings: AppSettings) => {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
};

// Custom floor materials
const readCustomFloors = (): CustomFloorMaterial[] => {
  ensureDataDir();
  if (!fs.existsSync(CUSTOM_FLOORS_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(CUSTOM_FLOORS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CustomFloorMaterial[]) : [];
  } catch (error) {
    logger.warn({ error }, 'Failed to read custom-floors.json; returning empty');
    return [];
  }
};

const writeCustomFloors = (floors: CustomFloorMaterial[]) => {
  ensureDataDir();
  fs.writeFileSync(CUSTOM_FLOORS_FILE, JSON.stringify(floors, null, 2));
};

// Custom furniture types
const readCustomFurniture = (): CustomFurnitureType[] => {
  ensureDataDir();
  if (!fs.existsSync(CUSTOM_FURNITURE_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(CUSTOM_FURNITURE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CustomFurnitureType[]) : [];
  } catch (error) {
    logger.warn({ error }, 'Failed to read custom-furniture.json; returning empty');
    return [];
  }
};

const writeCustomFurniture = (furniture: CustomFurnitureType[]) => {
  ensureDataDir();
  fs.writeFileSync(CUSTOM_FURNITURE_FILE, JSON.stringify(furniture, null, 2));
};

export const storage = {
  // Rooms
  listRooms: (): RoomConfig[] => readRooms(),
  getRoom: (id: string): RoomConfig | undefined => readRooms().find((r) => r.id === id),
  saveRoom: (room: RoomConfig): RoomConfig => {
    const rooms = readRooms();
    const idx = rooms.findIndex((r) => r.id === room.id);
    if (idx >= 0) {
      rooms[idx] = room;
    } else {
      rooms.push(room);
    }
    writeRooms(rooms);
    return room;
  },
  deleteRoom: (id: string): boolean => {
    const rooms = readRooms();
    const next = rooms.filter((r) => r.id !== id);
    if (next.length === rooms.length) {
      return false;
    }
    writeRooms(next);
    return true;
  },

  // Settings
  getSettings: (): AppSettings => readSettings(),
  saveSettings: (settings: Partial<AppSettings>): AppSettings => {
    const current = readSettings();
    const merged: AppSettings = { ...current, ...settings };
    writeSettings(merged);
    return merged;
  },

  // Custom floor materials
  listCustomFloors: (): CustomFloorMaterial[] => readCustomFloors(),
  getCustomFloor: (id: string): CustomFloorMaterial | undefined => readCustomFloors().find((f) => f.id === id),
  saveCustomFloor: (floor: CustomFloorMaterial): CustomFloorMaterial => {
    const floors = readCustomFloors();
    const idx = floors.findIndex((f) => f.id === floor.id);
    if (idx >= 0) {
      floors[idx] = floor;
    } else {
      floors.push(floor);
    }
    writeCustomFloors(floors);
    return floor;
  },
  deleteCustomFloor: (id: string): boolean => {
    const floors = readCustomFloors();
    const next = floors.filter((f) => f.id !== id);
    if (next.length === floors.length) {
      return false;
    }
    writeCustomFloors(next);
    return true;
  },

  // Custom furniture types
  listCustomFurniture: (): CustomFurnitureType[] => readCustomFurniture(),
  getCustomFurniture: (id: string): CustomFurnitureType | undefined => readCustomFurniture().find((f) => f.id === id),
  saveCustomFurniture: (furniture: CustomFurnitureType): CustomFurnitureType => {
    const items = readCustomFurniture();
    const idx = items.findIndex((f) => f.id === furniture.id);
    if (idx >= 0) {
      items[idx] = furniture;
    } else {
      items.push(furniture);
    }
    writeCustomFurniture(items);
    return furniture;
  },
  deleteCustomFurniture: (id: string): boolean => {
    const items = readCustomFurniture();
    const next = items.filter((f) => f.id !== id);
    if (next.length === items.length) {
      return false;
    }
    writeCustomFurniture(next);
    return true;
  },
};
