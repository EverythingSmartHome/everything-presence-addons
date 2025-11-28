/**
 * Floor Material Catalog
 *
 * This file defines all available floor materials.
 * To add a new floor material:
 * 1. Add an entry to FLOOR_CATALOG below with a unique id
 * 2. Create the corresponding SVG pattern in patterns.tsx
 *
 * Dimensions in patterns are in millimeters (mm) for consistency with the room coordinate system.
 */

export type FloorCategory = 'wood' | 'carpet' | 'hard' | 'other';

export interface FloorMaterialDef {
  /** Unique identifier - used as pattern ID suffix (e.g., 'wood-oak' -> pattern id 'floor-wood-oak') */
  id: string;
  /** Display name shown in UI */
  label: string;
  /** Emoji for quick visual identification in dropdowns */
  emoji: string;
  /** Primary/base color hex code */
  color: string;
  /** Category for grouping in UI */
  category: FloorCategory;
}

/**
 * Floor material catalog
 * Add new materials here - patterns are defined separately in patterns.tsx
 */
export const FLOOR_CATALOG: FloorMaterialDef[] = [
  // ========== WOOD FLOORS ==========
  {
    id: 'wood-oak',
    label: 'Oak',
    emoji: '🪵',
    color: '#C9A66B',
    category: 'wood',
  },
  {
    id: 'wood-walnut',
    label: 'Walnut',
    emoji: '🌰',
    color: '#5D4037',
    category: 'wood',
  },
  {
    id: 'wood-cherry',
    label: 'Cherry',
    emoji: '🍒',
    color: '#8B4513',
    category: 'wood',
  },
  {
    id: 'wood-ash',
    label: 'Ash',
    emoji: '🌳',
    color: '#E8DCC8',
    category: 'wood',
  },
  {
    id: 'wood-mahogany',
    label: 'Mahogany',
    emoji: '🟤',
    color: '#4A2020',
    category: 'wood',
  },
  {
    id: 'wood-herringbone',
    label: 'Herringbone',
    emoji: '🔶',
    color: '#B8956E',
    category: 'wood',
  },

  // ========== CARPET FLOORS ==========
  {
    id: 'carpet-beige',
    label: 'Beige Carpet',
    emoji: '🧶',
    color: '#D9C8B0',
    category: 'carpet',
  },
  {
    id: 'carpet-gray',
    label: 'Gray Carpet',
    emoji: '⬜',
    color: '#9E9E9E',
    category: 'carpet',
  },
  {
    id: 'carpet-charcoal',
    label: 'Charcoal Carpet',
    emoji: '⬛',
    color: '#4A4A4A',
    category: 'carpet',
  },
  {
    id: 'carpet-navy',
    label: 'Navy Carpet',
    emoji: '🔵',
    color: '#2C3E50',
    category: 'carpet',
  },
  {
    id: 'carpet-burgundy',
    label: 'Burgundy Carpet',
    emoji: '🟥',
    color: '#722F37',
    category: 'carpet',
  },

  // ========== HARD FLOORS ==========
  {
    id: 'tile-white',
    label: 'White Tile',
    emoji: '⬜',
    color: '#F5F5F5',
    category: 'hard',
  },
  {
    id: 'tile-gray',
    label: 'Gray Tile',
    emoji: '🔲',
    color: '#B0B0B0',
    category: 'hard',
  },
  {
    id: 'tile-terracotta',
    label: 'Terracotta',
    emoji: '🟧',
    color: '#C45A35',
    category: 'hard',
  },
  {
    id: 'marble-white',
    label: 'White Marble',
    emoji: '💎',
    color: '#F0EDE8',
    category: 'hard',
  },
  {
    id: 'marble-black',
    label: 'Black Marble',
    emoji: '🖤',
    color: '#2A2A2A',
    category: 'hard',
  },
  {
    id: 'slate',
    label: 'Slate',
    emoji: '🪨',
    color: '#4A5568',
    category: 'hard',
  },
  {
    id: 'concrete',
    label: 'Concrete',
    emoji: '🏗️',
    color: '#9CA3AF',
    category: 'hard',
  },
  {
    id: 'vinyl-light',
    label: 'Light Vinyl',
    emoji: '📋',
    color: '#E5D9C9',
    category: 'hard',
  },
];

/**
 * Get a floor material by ID
 */
export const getFloorMaterial = (id: string): FloorMaterialDef | undefined => {
  return FLOOR_CATALOG.find((f) => f.id === id);
};

/**
 * Get all floor materials for a category
 */
export const getFloorsByCategory = (category: FloorCategory | 'all'): FloorMaterialDef[] => {
  if (category === 'all') {
    return FLOOR_CATALOG;
  }
  return FLOOR_CATALOG.filter((f) => f.category === category);
};

/**
 * Get all available floor categories
 */
export const getFloorCategories = (): Array<{ id: FloorCategory | 'all'; label: string }> => {
  return [
    { id: 'all', label: 'All' },
    { id: 'wood', label: 'Wood' },
    { id: 'carpet', label: 'Carpet' },
    { id: 'hard', label: 'Hard Floors' },
  ];
};
