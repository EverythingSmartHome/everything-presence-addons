import { useState, useEffect, useCallback } from 'react';

export interface DisplaySettings {
  showWalls: boolean;
  showFurniture: boolean;
  showDoors: boolean;
  showZones: boolean;
  showDeviceIcon: boolean;
  showDeviceRadar: boolean;
  showTargets: boolean;
  showAlignedDirection: boolean;
  clipRadarToWalls: boolean;
  // Heatmap settings
  heatmapEnabled: boolean;
  heatmapHours: number;
  heatmapThreshold: number;
}

const STORAGE_KEY = 'everything-presence-zone-configurator-display-settings';

const defaultSettings: DisplaySettings = {
  showWalls: true,
  showFurniture: true,
  showDoors: true,
  showZones: true,
  showDeviceIcon: true,
  showDeviceRadar: false,
  showTargets: true,
  showAlignedDirection: false,
  clipRadarToWalls: true,
  // Heatmap defaults
  heatmapEnabled: false,
  heatmapHours: 24,
  heatmapThreshold: 0.15,
};

const loadSettings = (): DisplaySettings => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to handle any new settings added in future
      return { ...defaultSettings, ...parsed };
    }
  } catch (e) {
    console.warn('Failed to load display settings from localStorage:', e);
  }
  return defaultSettings;
};

const saveSettings = (settings: DisplaySettings): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('Failed to save display settings to localStorage:', e);
  }
};

export const useDisplaySettings = () => {
  const [settings, setSettings] = useState<DisplaySettings>(loadSettings);

  // Save to localStorage whenever settings change
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // Individual setters for convenience
  const setShowWalls = useCallback((value: boolean) => {
    setSettings((prev) => ({ ...prev, showWalls: value }));
  }, []);

  const setShowFurniture = useCallback((value: boolean) => {
    setSettings((prev) => ({ ...prev, showFurniture: value }));
  }, []);

  const setShowDoors = useCallback((value: boolean) => {
    setSettings((prev) => ({ ...prev, showDoors: value }));
  }, []);

  const setShowZones = useCallback((value: boolean) => {
    setSettings((prev) => ({ ...prev, showZones: value }));
  }, []);

  const setShowDeviceIcon = useCallback((value: boolean) => {
    setSettings((prev) => ({ ...prev, showDeviceIcon: value }));
  }, []);

  const setShowDeviceRadar = useCallback((value: boolean) => {
    setSettings((prev) => ({ ...prev, showDeviceRadar: value }));
  }, []);

  const setShowTargets = useCallback((value: boolean) => {
    setSettings((prev) => ({ ...prev, showTargets: value }));
  }, []);

  const setShowAlignedDirection = useCallback((value: boolean) => {
    setSettings((prev) => ({ ...prev, showAlignedDirection: value }));
  }, []);

  const setClipRadarToWalls = useCallback((value: boolean) => {
    setSettings((prev) => ({ ...prev, clipRadarToWalls: value }));
  }, []);

  const setHeatmapEnabled = useCallback((value: boolean) => {
    setSettings((prev) => ({ ...prev, heatmapEnabled: value }));
  }, []);

  const setHeatmapHours = useCallback((value: number) => {
    setSettings((prev) => ({ ...prev, heatmapHours: value }));
  }, []);

  const setHeatmapThreshold = useCallback((value: number) => {
    setSettings((prev) => ({ ...prev, heatmapThreshold: value }));
  }, []);

  return {
    // Settings values
    showWalls: settings.showWalls,
    showFurniture: settings.showFurniture,
    showDoors: settings.showDoors,
    showZones: settings.showZones,
    showDeviceIcon: settings.showDeviceIcon,
    showDeviceRadar: settings.showDeviceRadar,
    showTargets: settings.showTargets,
    showAlignedDirection: settings.showAlignedDirection,
    clipRadarToWalls: settings.clipRadarToWalls,
    heatmapEnabled: settings.heatmapEnabled,
    heatmapHours: settings.heatmapHours,
    heatmapThreshold: settings.heatmapThreshold,
    // Setters
    setShowWalls,
    setShowFurniture,
    setShowDoors,
    setShowZones,
    setShowDeviceIcon,
    setShowDeviceRadar,
    setShowTargets,
    setShowAlignedDirection,
    setClipRadarToWalls,
    setHeatmapEnabled,
    setHeatmapHours,
    setHeatmapThreshold,
  };
};
