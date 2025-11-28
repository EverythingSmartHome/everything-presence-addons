/**
 * Material-based color system for furniture
 * Colors chosen to represent realistic materials: wood, fabric, metal, etc.
 */

export interface FurnitureColors {
  fill: string;
  stroke: string;
  icon: string;
}

/**
 * Color palettes for different materials
 */
const MATERIAL_COLORS = {
  // Wood tones
  oak: { fill: '#D4A574', stroke: '#B8936A', icon: '#E8D5C4' },
  walnut: { fill: '#5C4033', stroke: '#4A3329', icon: '#8B6F5C' },
  mahogany: { fill: '#C04000', stroke: '#A03500', icon: '#D97556' },
  pine: { fill: '#E3C08C', stroke: '#D4B07F', icon: '#F5E6D3' },

  // Fabric colors
  beige: { fill: '#E8D5C4', stroke: '#D4C2B1', icon: '#F5EBE0' },
  gray: { fill: '#8B8B8B', stroke: '#6E6E6E', icon: '#B0B0B0' },
  darkGray: { fill: '#4A4A4A', stroke: '#3A3A3A', icon: '#6E6E6E' },
  blue: { fill: '#4A6FA5', stroke: '#3D5A87', icon: '#7A9BC8' },
  navy: { fill: '#2C3E50', stroke: '#1F2D3D', icon: '#5D6D7E' },

  // Metal finishes
  steel: { fill: '#B0B0B0', stroke: '#909090', icon: '#D0D0D0' },
  blackMetal: { fill: '#2C2C2C', stroke: '#1C1C1C', icon: '#4A4A4A' },

  // White goods
  white: { fill: '#F5F5F5', stroke: '#E0E0E0', icon: '#FFFFFF' },
  cream: { fill: '#FFF8DC', stroke: '#F5E8C0', icon: '#FFFEF0' },
};

/**
 * Map furniture types to material colors
 */
const FURNITURE_COLOR_MAP: Record<string, FurnitureColors> = {
  // Bedroom - Natural wood with fabric bedding
  'bed-single': MATERIAL_COLORS.oak,
  'bed-double': MATERIAL_COLORS.oak,
  'bed-queen': MATERIAL_COLORS.oak,
  'bed-king': MATERIAL_COLORS.oak,
  'nightstand': MATERIAL_COLORS.walnut,
  'dresser': MATERIAL_COLORS.walnut,
  'wardrobe': MATERIAL_COLORS.pine,

  // Living Room - Mix of fabric and wood
  'sofa-2seat': MATERIAL_COLORS.gray,
  'sofa-3seat': MATERIAL_COLORS.gray,
  'sofa-lshaped': MATERIAL_COLORS.darkGray,
  'armchair': MATERIAL_COLORS.blue,
  'coffee-table': MATERIAL_COLORS.walnut,
  'tv-stand': MATERIAL_COLORS.blackMetal,
  'bookshelf': MATERIAL_COLORS.oak,

  // Office - Modern materials, darker tones
  'desk-standard': MATERIAL_COLORS.walnut,
  'desk-lshaped': MATERIAL_COLORS.mahogany,
  'desk-gaming': MATERIAL_COLORS.blackMetal,
  'chair-office': MATERIAL_COLORS.navy,
  'bookshelf-office': MATERIAL_COLORS.oak,

  // Dining - Traditional wood tones
  'dining-table-4': MATERIAL_COLORS.mahogany,
  'dining-table-6': MATERIAL_COLORS.mahogany,
  'chair-dining': MATERIAL_COLORS.oak,
};

/**
 * Get realistic colors for a furniture type
 * @param typeId - The furniture type ID
 * @param isSelected - Whether the furniture is currently selected
 * @returns Color values for fill, stroke, and icon
 */
export const getFurnitureColors = (typeId: string, isSelected: boolean = false): FurnitureColors => {
  const colors = FURNITURE_COLOR_MAP[typeId] || MATERIAL_COLORS.oak; // Default to oak if not found

  // If selected, use cyan/aqua highlight color
  if (isSelected) {
    return {
      fill: '#0ea5e9',
      stroke: '#0ea5e9',
      icon: '#7dd3fc',
    };
  }

  return colors;
};
