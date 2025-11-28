import { useState, useEffect } from 'react';
import { fetchCustomFloors, fetchCustomFurniture } from '../api/client';
import { CustomFloorMaterial, CustomFurnitureType, FurnitureType } from '../api/types';
import { FloorMaterialDef } from '../floors/catalog';

interface CustomAssetsState {
  customFloors: CustomFloorMaterial[];
  customFurniture: CustomFurnitureType[];
  loading: boolean;
  error: string | null;
}

/**
 * Hook to fetch and manage custom floor materials and furniture types
 */
export const useCustomAssets = () => {
  const [state, setState] = useState<CustomAssetsState>({
    customFloors: [],
    customFurniture: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    const loadCustomAssets = async () => {
      try {
        const [floorsRes, furnitureRes] = await Promise.all([
          fetchCustomFloors(),
          fetchCustomFurniture(),
        ]);
        setState({
          customFloors: floorsRes.floors,
          customFurniture: furnitureRes.furniture,
          loading: false,
          error: null,
        });
      } catch (err) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load custom assets',
        }));
      }
    };
    loadCustomAssets();
  }, []);

  return state;
};

/**
 * Convert custom floor material to FloorMaterialDef format
 */
export const customFloorToMaterialDef = (custom: CustomFloorMaterial): FloorMaterialDef => ({
  id: custom.id,
  label: custom.label,
  emoji: custom.emoji,
  color: custom.color,
  category: custom.category,
});

/**
 * Convert custom furniture type to FurnitureType format
 */
export const customFurnitureToType = (custom: CustomFurnitureType): FurnitureType => ({
  id: custom.id,
  label: custom.label,
  category: custom.category,
  defaultWidth: custom.defaultWidth,
  defaultDepth: custom.defaultDepth,
  defaultHeight: custom.defaultHeight,
});
