/**
 * Floor Materials Module
 *
 * This module provides floor material definitions and SVG patterns for the room builder.
 *
 * ## Adding a New Floor Material
 *
 * 1. Add the material definition to `catalog.ts`:
 *    - Add an entry with id, label, emoji, color, and category
 *
 * 2. Add the SVG pattern to `patterns.tsx`:
 *    - Create a pattern with id="floor-{your-material-id}"
 *
 * 3. Update the `floorMaterial` type in `api/types.ts` to include your new ID.
 *
 * That's it! The new floor will automatically appear in the UI.
 */

import React from 'react';
import { FLOOR_CATALOG, FloorMaterialDef, FloorCategory, getFloorMaterial, getFloorsByCategory, getFloorCategories } from './catalog';
import { FLOOR_PATTERNS, getFloorPattern, generateCustomFloorPattern } from './patterns';
import { CustomFloorMaterial } from '../api/types';

// Re-export catalog types and functions
export type { FloorMaterialDef, FloorCategory };
export { FLOOR_CATALOG, getFloorMaterial, getFloorsByCategory, getFloorCategories };
export { FLOOR_PATTERNS, getFloorPattern, generateCustomFloorPattern };

/**
 * Combined floor material definition including pattern
 * This provides backwards compatibility with the old FLOOR_MATERIALS structure
 */
export interface FloorMaterialDefinition {
  id: string;
  label: string;
  emoji: string;
  color: string;
  pattern: React.ReactNode;
}

/**
 * Combined floor materials record (backwards compatible with old structure)
 * Maps material ID to full definition including pattern
 */
export const FLOOR_MATERIALS: Record<string, FloorMaterialDefinition> = FLOOR_CATALOG.reduce(
  (acc, material) => {
    const pattern = FLOOR_PATTERNS[material.id];
    if (pattern) {
      acc[material.id] = {
        id: material.id,
        label: material.label,
        emoji: material.emoji,
        color: material.color,
        pattern,
      };
    }
    return acc;
  },
  {} as Record<string, FloorMaterialDefinition>
);

/**
 * Get fill properties for floor rendering
 * @param mode - Fill mode: 'overlay' for blue overlay, 'material' for floor material
 * @param material - Material type when mode is 'material'
 * @returns Fill string and opacity value
 */
export const getFloorFill = (
  mode?: 'overlay' | 'material',
  material?: string
): { fill: string; opacity: number } => {
  // Default to overlay mode
  if (mode !== 'material' || !material || material === 'none') {
    return {
      fill: '#0ea5e9', // Default blue overlay
      opacity: 0.1,
    };
  }

  // Return pattern for selected material
  const materialDef = FLOOR_MATERIALS[material];
  if (!materialDef) {
    // Fallback to overlay if material not found
    return {
      fill: '#0ea5e9',
      opacity: 0.1,
    };
  }

  return {
    fill: `url(#floor-${material})`,
    opacity: 1.0,
  };
};

interface FloorMaterialDefsProps {
  customFloors?: CustomFloorMaterial[];
}

/**
 * FloorMaterialDefs component - renders all pattern definitions
 * Place this inside the SVG <defs> section
 *
 * @param customFloors - Optional array of custom floor materials to include
 */
export const FloorMaterialDefs: React.FC<FloorMaterialDefsProps> = ({ customFloors = [] }) => {
  return (
    <>
      {/* Built-in floor patterns */}
      {Object.values(FLOOR_MATERIALS).map((material) => (
        <React.Fragment key={material.id}>{material.pattern}</React.Fragment>
      ))}
      {/* Custom floor patterns */}
      {customFloors.map((custom) => (
        <React.Fragment key={custom.id}>
          {generateCustomFloorPattern(custom.id, custom.color, custom.patternType)}
        </React.Fragment>
      ))}
    </>
  );
};

/**
 * Get all floors including custom floors for display in UI
 */
export const getAllFloors = (customFloors: CustomFloorMaterial[] = []): FloorMaterialDef[] => {
  const customAsDefs: FloorMaterialDef[] = customFloors.map((c) => ({
    id: c.id,
    label: c.label,
    emoji: c.emoji,
    color: c.color,
    category: c.category,
  }));
  return [...FLOOR_CATALOG, ...customAsDefs];
};

/**
 * Get floors by category including custom floors
 */
export const getAllFloorsByCategory = (
  category: FloorCategory | 'all',
  customFloors: CustomFloorMaterial[] = []
): FloorMaterialDef[] => {
  const allFloors = getAllFloors(customFloors);
  if (category === 'all') {
    return allFloors;
  }
  return allFloors.filter((f) => f.category === category);
};
