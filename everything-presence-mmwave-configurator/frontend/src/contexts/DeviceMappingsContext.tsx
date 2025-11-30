import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
import {
  DeviceMapping,
  SettingsGroup,
  ResolvedEntity,
  EntityCategory,
  getDeviceMapping,
  getDeviceSettings,
  getEntitiesByCategory,
} from '../api/deviceMappings';

// ─────────────────────────────────────────────────────────────────
// Context Types
// ─────────────────────────────────────────────────────────────────

interface DeviceMappingState {
  mapping: DeviceMapping | null;
  loading: boolean;
  error: string | null;
  lastFetched: number | null;
}

interface DeviceMappingsContextValue {
  /** Get mapping for a device (cached, fetches if not loaded) */
  getMapping: (deviceId: string) => Promise<DeviceMapping | null>;

  /** Get cached mapping synchronously (returns null if not loaded) */
  getCachedMapping: (deviceId: string) => DeviceMapping | null;

  /** Get entity ID from cached mapping */
  getEntityId: (deviceId: string, entityKey: string) => string | null;

  /** Get settings for a device */
  getSettings: (deviceId: string) => Promise<SettingsGroup[]>;

  /** Get entities by category */
  getEntities: (deviceId: string, category: EntityCategory) => Promise<ResolvedEntity[]>;

  /** Check if device has valid mappings (cached) */
  hasValidMappings: (deviceId: string) => boolean;

  /** Check if a specific device is loading */
  isLoading: (deviceId: string) => boolean;

  /** Get error for a specific device */
  getError: (deviceId: string) => string | null;

  /** Force refresh mapping for a device */
  refreshMapping: (deviceId: string) => Promise<void>;

  /** Clear cache for a device (or all if no deviceId) */
  clearCache: (deviceId?: string) => void;
}

// ─────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────

const DeviceMappingsContext = createContext<DeviceMappingsContextValue | null>(null);

// ─────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────

interface DeviceMappingsProviderProps {
  children: ReactNode;
  /** Cache TTL in milliseconds (default: 5 minutes) */
  cacheTtl?: number;
}

export const DeviceMappingsProvider: React.FC<DeviceMappingsProviderProps> = ({
  children,
  cacheTtl = 5 * 60 * 1000, // 5 minutes default
}) => {
  const [mappings, setMappings] = useState<Map<string, DeviceMappingState>>(new Map());
  const [settingsCache, setSettingsCache] = useState<Map<string, SettingsGroup[]>>(new Map());

  // Check if cache entry is valid
  const isCacheValid = useCallback(
    (state: DeviceMappingState | undefined): boolean => {
      if (!state || !state.lastFetched) return false;
      return Date.now() - state.lastFetched < cacheTtl;
    },
    [cacheTtl]
  );

  // Get mapping (with caching)
  const getMapping = useCallback(
    async (deviceId: string): Promise<DeviceMapping | null> => {
      const existing = mappings.get(deviceId);

      // Return cached if valid
      if (existing && isCacheValid(existing) && !existing.loading) {
        return existing.mapping;
      }

      // Already loading
      if (existing?.loading) {
        // Wait for existing request to complete
        return new Promise((resolve) => {
          const checkLoaded = () => {
            const state = mappings.get(deviceId);
            if (state && !state.loading) {
              resolve(state.mapping);
            } else {
              setTimeout(checkLoaded, 50);
            }
          };
          setTimeout(checkLoaded, 50);
        });
      }

      // Start loading
      setMappings((prev) => {
        const next = new Map(prev);
        next.set(deviceId, {
          mapping: existing?.mapping ?? null,
          loading: true,
          error: null,
          lastFetched: existing?.lastFetched ?? null,
        });
        return next;
      });

      try {
        const mapping = await getDeviceMapping(deviceId);
        setMappings((prev) => {
          const next = new Map(prev);
          next.set(deviceId, {
            mapping,
            loading: false,
            error: null,
            lastFetched: Date.now(),
          });
          return next;
        });
        return mapping;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Failed to load mapping';
        setMappings((prev) => {
          const next = new Map(prev);
          next.set(deviceId, {
            mapping: null,
            loading: false,
            error: errorMsg,
            lastFetched: null,
          });
          return next;
        });
        return null;
      }
    },
    [mappings, isCacheValid]
  );

  // Get cached mapping synchronously
  const getCachedMapping = useCallback(
    (deviceId: string): DeviceMapping | null => {
      return mappings.get(deviceId)?.mapping ?? null;
    },
    [mappings]
  );

  // Get entity ID from cached mapping
  const getEntityId = useCallback(
    (deviceId: string, entityKey: string): string | null => {
      const state = mappings.get(deviceId);
      if (!state?.mapping) return null;
      return state.mapping.mappings[entityKey] ?? null;
    },
    [mappings]
  );

  // Get settings (with caching)
  const getSettings = useCallback(
    async (deviceId: string): Promise<SettingsGroup[]> => {
      // Check cache
      const cached = settingsCache.get(deviceId);
      if (cached) return cached;

      // Fetch and cache
      const settings = await getDeviceSettings(deviceId);
      setSettingsCache((prev) => {
        const next = new Map(prev);
        next.set(deviceId, settings);
        return next;
      });
      return settings;
    },
    [settingsCache]
  );

  // Get entities by category
  const getEntities = useCallback(
    async (deviceId: string, category: EntityCategory): Promise<ResolvedEntity[]> => {
      return await getEntitiesByCategory(deviceId, category);
    },
    []
  );

  // Check if device has valid mappings
  const hasValidMappings = useCallback(
    (deviceId: string): boolean => {
      const state = mappings.get(deviceId);
      if (!state?.mapping) return false;
      return !!(state.mapping.mappings.presence || state.mapping.mappings.presenceEntity);
    },
    [mappings]
  );

  // Check if loading
  const isLoading = useCallback(
    (deviceId: string): boolean => {
      return mappings.get(deviceId)?.loading ?? false;
    },
    [mappings]
  );

  // Get error
  const getError = useCallback(
    (deviceId: string): string | null => {
      return mappings.get(deviceId)?.error ?? null;
    },
    [mappings]
  );

  // Force refresh
  const refreshMapping = useCallback(
    async (deviceId: string): Promise<void> => {
      // Clear cache first
      setMappings((prev) => {
        const next = new Map(prev);
        next.delete(deviceId);
        return next;
      });
      setSettingsCache((prev) => {
        const next = new Map(prev);
        next.delete(deviceId);
        return next;
      });
      // Fetch fresh
      await getMapping(deviceId);
    },
    [getMapping]
  );

  // Clear cache
  const clearCache = useCallback((deviceId?: string): void => {
    if (deviceId) {
      setMappings((prev) => {
        const next = new Map(prev);
        next.delete(deviceId);
        return next;
      });
      setSettingsCache((prev) => {
        const next = new Map(prev);
        next.delete(deviceId);
        return next;
      });
    } else {
      setMappings(new Map());
      setSettingsCache(new Map());
    }
  }, []);

  const value = useMemo<DeviceMappingsContextValue>(
    () => ({
      getMapping,
      getCachedMapping,
      getEntityId,
      getSettings,
      getEntities,
      hasValidMappings,
      isLoading,
      getError,
      refreshMapping,
      clearCache,
    }),
    [
      getMapping,
      getCachedMapping,
      getEntityId,
      getSettings,
      getEntities,
      hasValidMappings,
      isLoading,
      getError,
      refreshMapping,
      clearCache,
    ]
  );

  return (
    <DeviceMappingsContext.Provider value={value}>
      {children}
    </DeviceMappingsContext.Provider>
  );
};

// ─────────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────────

/**
 * Hook to access the device mappings context.
 */
export const useDeviceMappings = (): DeviceMappingsContextValue => {
  const context = useContext(DeviceMappingsContext);
  if (!context) {
    throw new Error('useDeviceMappings must be used within a DeviceMappingsProvider');
  }
  return context;
};

/**
 * Hook to get device mapping with automatic loading.
 */
export const useDeviceMapping = (deviceId: string | undefined) => {
  const { getMapping, getCachedMapping, isLoading, getError, refreshMapping } = useDeviceMappings();
  const [loaded, setLoaded] = useState(false);

  React.useEffect(() => {
    if (deviceId && !loaded) {
      getMapping(deviceId).then(() => setLoaded(true));
    }
  }, [deviceId, loaded, getMapping]);

  return {
    mapping: deviceId ? getCachedMapping(deviceId) : null,
    loading: deviceId ? isLoading(deviceId) : false,
    error: deviceId ? getError(deviceId) : null,
    refresh: deviceId ? () => refreshMapping(deviceId) : () => Promise.resolve(),
  };
};

/**
 * Hook to get a single entity ID.
 */
export const useDeviceEntity = (deviceId: string | undefined, entityKey: string) => {
  const { getEntityId } = useDeviceMappings();
  const { mapping, loading, error } = useDeviceMapping(deviceId);

  const entityId = React.useMemo(() => {
    if (!deviceId || !mapping) return null;
    return getEntityId(deviceId, entityKey);
  }, [deviceId, entityKey, mapping, getEntityId]);

  return { entityId, loading, error };
};

/**
 * Hook to get device settings.
 */
export const useDeviceSettings = (deviceId: string | undefined) => {
  const { getSettings } = useDeviceMappings();
  const [settings, setSettings] = useState<SettingsGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (!deviceId) {
      setSettings([]);
      return;
    }

    setLoading(true);
    setError(null);

    getSettings(deviceId)
      .then((result) => {
        setSettings(result);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load settings');
        setLoading(false);
      });
  }, [deviceId, getSettings]);

  return { settings, loading, error };
};

export default DeviceMappingsContext;
