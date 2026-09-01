import { useState, useEffect, useCallback } from 'react';
import { MARKER_SCALE_MAX, MARKER_SCALE_MIN, normalizeDeviceMarkerSettings } from '../utils/deviceMarkerSettings';

export interface DisplaySettings {
  showWalls: boolean;
  showFurniture: boolean;
  showDoors: boolean;
  showZones: boolean;
  showDeviceIcon: boolean;
  showDeviceRadar: boolean;
  deviceMarkerStyle: 'icon' | 'node';
  deviceMarkerScale: number;
  deviceMarkerOpacity: number;
  showMaxDistanceOverlay: boolean;
  showTriggerDistanceOverlay: boolean;
  showTargets: boolean;
  targetMarkerScale: number;
  showZoneLabels: boolean;
  zoneLabelScale: number;
  showAlignedDirection: boolean;
  clipRadarToWalls: boolean;
  units: 'metric' | 'imperial';
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
  deviceMarkerStyle: 'icon',
  deviceMarkerScale: 0.5,
  deviceMarkerOpacity: 1,
  showMaxDistanceOverlay: true,
  showTriggerDistanceOverlay: false,
  showTargets: true,
  targetMarkerScale: 1,
  showZoneLabels: true,
  zoneLabelScale: 1,
  showAlignedDirection: false,
  clipRadarToWalls: true,
  units: 'metric',
  // Heatmap defaults
  heatmapEnabled: false,
  heatmapHours: 24,
  heatmapThreshold: 0.15,
};

export const normalizeDisplaySettings = (value: unknown): DisplaySettings => {
  const parsed = value && typeof value === 'object' ? value as Partial<DisplaySettings> : {};
  return {
    ...defaultSettings,
    ...parsed,
    ...normalizeDeviceMarkerSettings(parsed),
  };
};

const loadSettings = (): DisplaySettings => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to handle any new settings added in future
      return normalizeDisplaySettings(parsed);
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

  const setDeviceMarkerStyle = useCallback((value: 'icon' | 'node') => {
    if (value !== 'icon' && value !== 'node') return;
    setSettings((prev) => ({ ...prev, deviceMarkerStyle: value }));
  }, []);

  const setDeviceMarkerScale = useCallback((value: number) => {
    if (!Number.isFinite(value)) return;
    setSettings((prev) => ({ ...prev, deviceMarkerScale: Math.min(MARKER_SCALE_MAX, Math.max(MARKER_SCALE_MIN, value)) }));
  }, []);

  const setDeviceMarkerOpacity = useCallback((value: number) => {
    if (!Number.isFinite(value)) return;
    setSettings((prev) => ({ ...prev, deviceMarkerOpacity: Math.round(Math.min(1, Math.max(0.1, value)) * 10) / 10 }));
  }, []);

  const setShowMaxDistanceOverlay = useCallback((value: boolean) => {
    setSettings((prev) => ({ ...prev, showMaxDistanceOverlay: value }));
  }, []);

  const setShowTriggerDistanceOverlay = useCallback((value: boolean) => {
    setSettings((prev) => ({ ...prev, showTriggerDistanceOverlay: value }));
  }, []);

  const setShowTargets = useCallback((value: boolean) => {
    setSettings((prev) => ({ ...prev, showTargets: value }));
  }, []);

  const setTargetMarkerScale = useCallback((value: number) => {
    setSettings((prev) => ({ ...prev, targetMarkerScale: Math.min(MARKER_SCALE_MAX, Math.max(MARKER_SCALE_MIN, value)) }));
  }, []);

  const setShowZoneLabels = useCallback((value: boolean) => {
    setSettings((prev) => ({ ...prev, showZoneLabels: value }));
  }, []);

  const setZoneLabelScale = useCallback((value: number) => {
    setSettings((prev) => ({ ...prev, zoneLabelScale: Math.min(MARKER_SCALE_MAX, Math.max(MARKER_SCALE_MIN, value)) }));
  }, []);

  const setShowAlignedDirection = useCallback((value: boolean) => {
    setSettings((prev) => ({ ...prev, showAlignedDirection: value }));
  }, []);

  const setClipRadarToWalls = useCallback((value: boolean) => {
    setSettings((prev) => ({ ...prev, clipRadarToWalls: value }));
  }, []);

  const setUnits = useCallback((value: 'metric' | 'imperial') => {
    setSettings((prev) => ({ ...prev, units: value }));
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
    deviceMarkerStyle: settings.deviceMarkerStyle,
    deviceMarkerScale: settings.deviceMarkerScale,
    deviceMarkerOpacity: settings.deviceMarkerOpacity,
    showMaxDistanceOverlay: settings.showMaxDistanceOverlay,
    showTriggerDistanceOverlay: settings.showTriggerDistanceOverlay,
    showTargets: settings.showTargets,
    targetMarkerScale: settings.targetMarkerScale,
    showZoneLabels: settings.showZoneLabels,
    zoneLabelScale: settings.zoneLabelScale,
    showAlignedDirection: settings.showAlignedDirection,
    clipRadarToWalls: settings.clipRadarToWalls,
    units: settings.units,
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
    setDeviceMarkerStyle,
    setDeviceMarkerScale,
    setDeviceMarkerOpacity,
    setShowMaxDistanceOverlay,
    setShowTriggerDistanceOverlay,
    setShowTargets,
    setTargetMarkerScale,
    setShowZoneLabels,
    setZoneLabelScale,
    setShowAlignedDirection,
    setClipRadarToWalls,
    setUnits,
    setHeatmapEnabled,
    setHeatmapHours,
    setHeatmapThreshold,
  };
};
