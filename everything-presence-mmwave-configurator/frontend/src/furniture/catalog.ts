import { FurnitureType } from '../api/types';

/**
 * Furniture catalog defining all available furniture types
 * Dimensions are in millimeters (mm)
 */
export const FURNITURE_CATALOG: FurnitureType[] = [
  // ========== BEDROOM ==========
  {
    id: 'bed-single',
    label: 'Single Bed',
    category: 'bedroom',
    defaultWidth: 900,
    defaultDepth: 2000,
    defaultHeight: 500,
  },
  {
    id: 'bed-double',
    label: 'Double Bed',
    category: 'bedroom',
    defaultWidth: 1350,
    defaultDepth: 1900,
    defaultHeight: 500,
  },
  {
    id: 'bed-queen',
    label: 'Queen Bed',
    category: 'bedroom',
    defaultWidth: 1600,
    defaultDepth: 2000,
    defaultHeight: 500,
  },
  {
    id: 'bed-king',
    label: 'King Bed',
    category: 'bedroom',
    defaultWidth: 1800,
    defaultDepth: 2000,
    defaultHeight: 500,
  },
  {
    id: 'nightstand',
    label: 'Nightstand',
    category: 'bedroom',
    defaultWidth: 450,
    defaultDepth: 450,
    defaultHeight: 500,
  },
  {
    id: 'dresser',
    label: 'Dresser',
    category: 'bedroom',
    defaultWidth: 1200,
    defaultDepth: 500,
    defaultHeight: 900,
  },
  {
    id: 'wardrobe',
    label: 'Wardrobe',
    category: 'bedroom',
    defaultWidth: 1000,
    defaultDepth: 600,
    defaultHeight: 2000,
  },
  {
    id: 'bed-super-king',
    label: 'Super King Bed',
    category: 'bedroom',
    defaultWidth: 1800,
    defaultDepth: 2200,
    defaultHeight: 500,
  },
  {
    id: 'bed-bunk',
    label: 'Bunk Bed',
    category: 'bedroom',
    defaultWidth: 1000,
    defaultDepth: 2000,
    defaultHeight: 1600,
  },
  {
    id: 'crib',
    label: 'Crib / Cot',
    category: 'bedroom',
    defaultWidth: 700,
    defaultDepth: 1400,
    defaultHeight: 900,
  },
  {
    id: 'vanity',
    label: 'Vanity / Dressing Table',
    category: 'bedroom',
    defaultWidth: 1000,
    defaultDepth: 450,
    defaultHeight: 750,
  },
  {
    id: 'chest-of-drawers',
    label: 'Chest of Drawers',
    category: 'bedroom',
    defaultWidth: 800,
    defaultDepth: 450,
    defaultHeight: 1000,
  },
  {
    id: 'wardrobe-double',
    label: 'Double Wardrobe',
    category: 'bedroom',
    defaultWidth: 1800,
    defaultDepth: 600,
    defaultHeight: 2000,
  },
  {
    id: 'ottoman-bedroom',
    label: 'Bedroom Ottoman',
    category: 'bedroom',
    defaultWidth: 1200,
    defaultDepth: 450,
    defaultHeight: 450,
  },
  {
    id: 'changing-table',
    label: 'Changing Table',
    category: 'bedroom',
    defaultWidth: 900,
    defaultDepth: 500,
    defaultHeight: 900,
  },

  // ========== LIVING ROOM ==========
  {
    id: 'sofa-2seat',
    label: '2-Seat Sofa',
    category: 'living-room',
    defaultWidth: 1500,
    defaultDepth: 900,
    defaultHeight: 800,
  },
  {
    id: 'sofa-3seat',
    label: '3-Seat Sofa',
    category: 'living-room',
    defaultWidth: 2000,
    defaultDepth: 900,
    defaultHeight: 800,
  },
  {
    id: 'sofa-lshaped',
    label: 'L-Shaped Sofa',
    category: 'living-room',
    defaultWidth: 2500,
    defaultDepth: 1800,
    defaultHeight: 800,
  },
  {
    id: 'armchair',
    label: 'Armchair',
    category: 'living-room',
    defaultWidth: 900,
    defaultDepth: 900,
    defaultHeight: 800,
  },
  {
    id: 'coffee-table',
    label: 'Coffee Table',
    category: 'living-room',
    defaultWidth: 1200,
    defaultDepth: 600,
    defaultHeight: 400,
  },
  {
    id: 'tv-stand',
    label: 'TV Stand',
    category: 'living-room',
    defaultWidth: 1500,
    defaultDepth: 450,
    defaultHeight: 500,
  },
  {
    id: 'bookshelf',
    label: 'Bookshelf',
    category: 'living-room',
    defaultWidth: 800,
    defaultDepth: 300,
    defaultHeight: 1800,
  },
  {
    id: 'recliner',
    label: 'Recliner Chair',
    category: 'living-room',
    defaultWidth: 900,
    defaultDepth: 1000,
    defaultHeight: 1000,
  },
  {
    id: 'ottoman',
    label: 'Ottoman / Footstool',
    category: 'living-room',
    defaultWidth: 600,
    defaultDepth: 600,
    defaultHeight: 400,
  },
  {
    id: 'side-table',
    label: 'Side Table',
    category: 'living-room',
    defaultWidth: 500,
    defaultDepth: 500,
    defaultHeight: 550,
  },
  {
    id: 'console-table',
    label: 'Console Table',
    category: 'living-room',
    defaultWidth: 1200,
    defaultDepth: 350,
    defaultHeight: 750,
  },
  {
    id: 'entertainment-center',
    label: 'Entertainment Center',
    category: 'living-room',
    defaultWidth: 2000,
    defaultDepth: 500,
    defaultHeight: 600,
  },
  {
    id: 'chaise-lounge',
    label: 'Chaise Lounge',
    category: 'living-room',
    defaultWidth: 800,
    defaultDepth: 1600,
    defaultHeight: 800,
  },
  {
    id: 'bean-bag',
    label: 'Bean Bag',
    category: 'living-room',
    defaultWidth: 900,
    defaultDepth: 900,
    defaultHeight: 700,
  },
  {
    id: 'floor-lamp',
    label: 'Floor Lamp',
    category: 'living-room',
    defaultWidth: 400,
    defaultDepth: 400,
    defaultHeight: 1500,
  },
  {
    id: 'plant-large',
    label: 'Large Plant / Pot',
    category: 'living-room',
    defaultWidth: 500,
    defaultDepth: 500,
    defaultHeight: 1200,
  },
  {
    id: 'fireplace',
    label: 'Fireplace',
    category: 'living-room',
    defaultWidth: 1200,
    defaultDepth: 400,
    defaultHeight: 1000,
  },
  {
    id: 'storage-cabinet',
    label: 'Storage Cabinet',
    category: 'living-room',
    defaultWidth: 1000,
    defaultDepth: 450,
    defaultHeight: 800,
  },
  {
    id: 'room-divider',
    label: 'Room Divider',
    category: 'living-room',
    defaultWidth: 1500,
    defaultDepth: 100,
    defaultHeight: 1800,
  },

  // ========== OFFICE ==========
  {
    id: 'desk-standard',
    label: 'Standard Desk',
    category: 'office',
    defaultWidth: 1200,
    defaultDepth: 600,
    defaultHeight: 750,
  },
  {
    id: 'desk-lshaped',
    label: 'L-Shaped Desk',
    category: 'office',
    defaultWidth: 1500,
    defaultDepth: 1500,
    defaultHeight: 750,
  },
  {
    id: 'desk-gaming',
    label: 'Gaming Desk',
    category: 'office',
    defaultWidth: 1400,
    defaultDepth: 700,
    defaultHeight: 750,
  },
  {
    id: 'chair-office',
    label: 'Office Chair',
    category: 'office',
    defaultWidth: 600,
    defaultDepth: 600,
    defaultHeight: 900,
  },
  {
    id: 'bookshelf-office',
    label: 'Bookshelf',
    category: 'office',
    defaultWidth: 800,
    defaultDepth: 300,
    defaultHeight: 1800,
  },
  {
    id: 'desk-standing',
    label: 'Standing Desk',
    category: 'office',
    defaultWidth: 1400,
    defaultDepth: 700,
    defaultHeight: 1100,
  },
  {
    id: 'filing-cabinet',
    label: 'Filing Cabinet',
    category: 'office',
    defaultWidth: 400,
    defaultDepth: 600,
    defaultHeight: 700,
  },
  {
    id: 'printer-stand',
    label: 'Printer Stand',
    category: 'office',
    defaultWidth: 600,
    defaultDepth: 500,
    defaultHeight: 600,
  },
  {
    id: 'meeting-table',
    label: 'Meeting Table',
    category: 'office',
    defaultWidth: 2400,
    defaultDepth: 1200,
    defaultHeight: 750,
  },
  {
    id: 'conference-chair',
    label: 'Conference Chair',
    category: 'office',
    defaultWidth: 600,
    defaultDepth: 600,
    defaultHeight: 850,
  },
  {
    id: 'credenza',
    label: 'Credenza / Sideboard',
    category: 'office',
    defaultWidth: 1500,
    defaultDepth: 450,
    defaultHeight: 700,
  },
  {
    id: 'whiteboard',
    label: 'Whiteboard',
    category: 'office',
    defaultWidth: 1200,
    defaultDepth: 100,
    defaultHeight: 900,
  },
  {
    id: 'server-rack',
    label: 'Server Rack',
    category: 'office',
    defaultWidth: 600,
    defaultDepth: 800,
    defaultHeight: 2000,
  },

  // ========== DINING ==========
  {
    id: 'dining-table-4',
    label: 'Dining Table (4-seat)',
    category: 'dining',
    defaultWidth: 1200,
    defaultDepth: 800,
    defaultHeight: 750,
  },
  {
    id: 'dining-table-6',
    label: 'Dining Table (6-seat)',
    category: 'dining',
    defaultWidth: 1800,
    defaultDepth: 900,
    defaultHeight: 750,
  },
  {
    id: 'chair-dining',
    label: 'Dining Chair',
    category: 'dining',
    defaultWidth: 450,
    defaultDepth: 450,
    defaultHeight: 850,
  },
  {
    id: 'dining-table-8',
    label: 'Dining Table (8-seat)',
    category: 'dining',
    defaultWidth: 2400,
    defaultDepth: 1000,
    defaultHeight: 750,
  },
  {
    id: 'dining-table-round',
    label: 'Round Dining Table',
    category: 'dining',
    defaultWidth: 1200,
    defaultDepth: 1200,
    defaultHeight: 750,
  },
  {
    id: 'bar-table',
    label: 'Bar / High Table',
    category: 'dining',
    defaultWidth: 1200,
    defaultDepth: 600,
    defaultHeight: 1050,
  },
  {
    id: 'bar-stool',
    label: 'Bar Stool',
    category: 'dining',
    defaultWidth: 400,
    defaultDepth: 400,
    defaultHeight: 750,
  },
  {
    id: 'sideboard',
    label: 'Sideboard / Buffet',
    category: 'dining',
    defaultWidth: 1600,
    defaultDepth: 500,
    defaultHeight: 850,
  },
  {
    id: 'dining-bench',
    label: 'Dining Bench',
    category: 'dining',
    defaultWidth: 1400,
    defaultDepth: 400,
    defaultHeight: 450,
  },
  {
    id: 'china-cabinet',
    label: 'China Cabinet',
    category: 'dining',
    defaultWidth: 1200,
    defaultDepth: 450,
    defaultHeight: 1800,
  },
  {
    id: 'kitchen-island',
    label: 'Kitchen Island',
    category: 'dining',
    defaultWidth: 1800,
    defaultDepth: 900,
    defaultHeight: 900,
  },
  {
    id: 'breakfast-bar',
    label: 'Breakfast Bar',
    category: 'dining',
    defaultWidth: 2000,
    defaultDepth: 500,
    defaultHeight: 1050,
  },

  // ========== RUGS ==========
  {
    id: 'rug-small-round',
    label: 'Small Round Rug',
    category: 'all',
    defaultWidth: 1200,
    defaultDepth: 1200,
    defaultHeight: 10,
  },
  {
    id: 'rug-medium-round',
    label: 'Medium Round Rug',
    category: 'all',
    defaultWidth: 1800,
    defaultDepth: 1800,
    defaultHeight: 10,
  },
  {
    id: 'rug-small-rect',
    label: 'Small Rectangular Rug',
    category: 'all',
    defaultWidth: 1500,
    defaultDepth: 2000,
    defaultHeight: 10,
  },
  {
    id: 'rug-medium-rect',
    label: 'Medium Rectangular Rug',
    category: 'all',
    defaultWidth: 2000,
    defaultDepth: 3000,
    defaultHeight: 10,
  },
  {
    id: 'rug-large-rect',
    label: 'Large Rectangular Rug',
    category: 'all',
    defaultWidth: 2500,
    defaultDepth: 3500,
    defaultHeight: 10,
  },
  {
    id: 'rug-runner',
    label: 'Runner Rug',
    category: 'all',
    defaultWidth: 800,
    defaultDepth: 3000,
    defaultHeight: 10,
  },

  // ========== BATHROOM ==========
  {
    id: 'bathtub',
    label: 'Bathtub',
    category: 'all',
    defaultWidth: 1700,
    defaultDepth: 750,
    defaultHeight: 600,
  },
  {
    id: 'shower-enclosure',
    label: 'Shower Enclosure',
    category: 'all',
    defaultWidth: 900,
    defaultDepth: 900,
    defaultHeight: 2000,
  },
  {
    id: 'shower-walk-in',
    label: 'Walk-in Shower',
    category: 'all',
    defaultWidth: 1200,
    defaultDepth: 900,
    defaultHeight: 2000,
  },
  {
    id: 'toilet',
    label: 'Toilet',
    category: 'all',
    defaultWidth: 400,
    defaultDepth: 700,
    defaultHeight: 800,
  },
  {
    id: 'sink-bathroom',
    label: 'Bathroom Sink / Vanity',
    category: 'all',
    defaultWidth: 600,
    defaultDepth: 500,
    defaultHeight: 850,
  },
  {
    id: 'double-vanity',
    label: 'Double Vanity',
    category: 'all',
    defaultWidth: 1500,
    defaultDepth: 550,
    defaultHeight: 850,
  },

  // ========== UTILITY / HALLWAY ==========
  {
    id: 'shoe-rack',
    label: 'Shoe Rack',
    category: 'all',
    defaultWidth: 800,
    defaultDepth: 350,
    defaultHeight: 500,
  },
  {
    id: 'coat-rack',
    label: 'Coat Rack / Stand',
    category: 'all',
    defaultWidth: 500,
    defaultDepth: 500,
    defaultHeight: 1800,
  },
  {
    id: 'hallway-console',
    label: 'Hallway Console',
    category: 'all',
    defaultWidth: 1000,
    defaultDepth: 350,
    defaultHeight: 800,
  },
  {
    id: 'umbrella-stand',
    label: 'Umbrella Stand',
    category: 'all',
    defaultWidth: 250,
    defaultDepth: 250,
    defaultHeight: 600,
  },
  {
    id: 'storage-bench',
    label: 'Storage Bench',
    category: 'all',
    defaultWidth: 1000,
    defaultDepth: 400,
    defaultHeight: 450,
  },

  // ========== APPLIANCES / MISC ==========
  {
    id: 'washing-machine',
    label: 'Washing Machine',
    category: 'all',
    defaultWidth: 600,
    defaultDepth: 600,
    defaultHeight: 850,
  },
  {
    id: 'dryer',
    label: 'Dryer',
    category: 'all',
    defaultWidth: 600,
    defaultDepth: 600,
    defaultHeight: 850,
  },
  {
    id: 'refrigerator',
    label: 'Refrigerator',
    category: 'all',
    defaultWidth: 700,
    defaultDepth: 700,
    defaultHeight: 1800,
  },
  {
    id: 'exercise-bike',
    label: 'Exercise Bike',
    category: 'all',
    defaultWidth: 500,
    defaultDepth: 1000,
    defaultHeight: 1200,
  },
  {
    id: 'treadmill',
    label: 'Treadmill',
    category: 'all',
    defaultWidth: 800,
    defaultDepth: 1800,
    defaultHeight: 1400,
  },
  {
    id: 'piano-upright',
    label: 'Upright Piano',
    category: 'all',
    defaultWidth: 1500,
    defaultDepth: 600,
    defaultHeight: 1200,
  },
  {
    id: 'piano-grand',
    label: 'Grand Piano',
    category: 'all',
    defaultWidth: 1500,
    defaultDepth: 2200,
    defaultHeight: 1000,
  },
  {
    id: 'chest-storage',
    label: 'Storage Chest / Trunk',
    category: 'all',
    defaultWidth: 1000,
    defaultDepth: 500,
    defaultHeight: 500,
  },
  {
    id: 'floor-mirror',
    label: 'Floor Mirror',
    category: 'all',
    defaultWidth: 600,
    defaultDepth: 100,
    defaultHeight: 1600,
  },
  {
    id: 'pet-bed-small',
    label: 'Pet Bed (Small)',
    category: 'all',
    defaultWidth: 500,
    defaultDepth: 400,
    defaultHeight: 150,
  },
  {
    id: 'pet-bed-large',
    label: 'Pet Bed (Large)',
    category: 'all',
    defaultWidth: 900,
    defaultDepth: 700,
    defaultHeight: 200,
  },
  {
    id: 'baby-gate',
    label: 'Baby Gate',
    category: 'all',
    defaultWidth: 900,
    defaultDepth: 50,
    defaultHeight: 800,
  },
];

/**
 * Get furniture type by ID
 */
export const getFurnitureType = (id: string): FurnitureType | undefined => {
  return FURNITURE_CATALOG.find((f) => f.id === id);
};

/**
 * Get all furniture types for a specific category
 */
export const getFurnitureByCategory = (category: string): FurnitureType[] => {
  if (category === 'all') {
    return FURNITURE_CATALOG;
  }
  return FURNITURE_CATALOG.filter((f) => f.category === category);
};

/**
 * Get all available categories
 */
export const getFurnitureCategories = (): Array<{ id: string; label: string }> => {
  return [
    { id: 'all', label: 'All' },
    { id: 'bedroom', label: 'Bedroom' },
    { id: 'living-room', label: 'Living Room' },
    { id: 'office', label: 'Office' },
    { id: 'dining', label: 'Dining' },
  ];
};

// ==================== Custom Furniture Support ====================

import { CustomFurnitureType } from '../api/types';

/**
 * Convert custom furniture to FurnitureType format
 */
export const customFurnitureToType = (custom: CustomFurnitureType): FurnitureType => ({
  id: custom.id,
  label: custom.label,
  category: custom.category,
  defaultWidth: custom.defaultWidth,
  defaultDepth: custom.defaultDepth,
  defaultHeight: custom.defaultHeight,
});

/**
 * Get all furniture including custom furniture
 */
export const getAllFurniture = (customFurniture: CustomFurnitureType[] = []): FurnitureType[] => {
  const customAsTypes = customFurniture.map(customFurnitureToType);
  return [...FURNITURE_CATALOG, ...customAsTypes];
};

/**
 * Get furniture by category including custom furniture
 */
export const getAllFurnitureByCategory = (
  category: string,
  customFurniture: CustomFurnitureType[] = []
): FurnitureType[] => {
  const allFurniture = getAllFurniture(customFurniture);
  if (category === 'all') {
    return allFurniture;
  }
  return allFurniture.filter((f) => f.category === category);
};
