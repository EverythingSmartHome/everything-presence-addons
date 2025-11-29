import { useState, useEffect, useCallback } from 'react';
import { HeatmapResponse, EntityMappings } from '../api/types';
import { fetchHeatmap } from '../api/client';

interface UseHeatmapOptions {
  deviceId: string | null;
  profileId: string | null;
  entityNamePrefix: string | null;
  entityMappings?: EntityMappings;
  hours: number;
  enabled: boolean;
}

interface UseHeatmapResult {
  data: HeatmapResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export const useHeatmap = (options: UseHeatmapOptions): UseHeatmapResult => {
  const [data, setData] = useState<HeatmapResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { deviceId, profileId, entityNamePrefix, entityMappings, hours, enabled } = options;

  const load = useCallback(async () => {
    if (!enabled || !deviceId || !profileId || !entityNamePrefix) {
      setData(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetchHeatmap(deviceId, profileId, entityNamePrefix, hours, 400, entityMappings);
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load heatmap');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [deviceId, profileId, entityNamePrefix, entityMappings, hours, enabled]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, refresh: load };
};
