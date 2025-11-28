/**
 * Floor Materials - Re-export from floors/ module
 *
 * This file is kept for backwards compatibility.
 * The actual definitions are now in src/floors/ for better organization.
 *
 * @see ../floors/catalog.ts - Material definitions
 * @see ../floors/patterns.tsx - SVG patterns
 * @see ../floors/index.ts - Combined exports
 */
export {
  FLOOR_MATERIALS,
  FloorMaterialDefs,
  getFloorFill,
  type FloorMaterialDefinition,
} from '../floors';
