import React, { useState, useEffect, useCallback } from 'react';
import { EntityMappings } from '../api/types';
import {
  discoverEntities,
  getDeviceEntities,
  DiscoveryResult,
  EntityMatchResult,
  EntityRegistryEntry,
  groupMatchResultsByCategory,
  getTemplateKeyLabel,
} from '../api/entityDiscovery';
import { saveDeviceMapping, DeviceMapping } from '../api/deviceMappings';
import { useDeviceMappings } from '../contexts/DeviceMappingsContext';

interface EntityDiscoveryProps {
  deviceId: string;
  profileId: string;
  deviceName: string;
  onComplete: (mappings: EntityMappings) => void;
  onCancel: () => void;
  onBack?: () => void;
}

type DiscoveryStatus = 'loading' | 'success' | 'partial' | 'error';

export const EntityDiscovery: React.FC<EntityDiscoveryProps> = ({
  deviceId,
  profileId,
  deviceName,
  onComplete,
  onCancel,
  onBack,
}) => {
  const { refreshMapping } = useDeviceMappings();
  const [status, setStatus] = useState<DiscoveryStatus>('loading');
  const [saving, setSaving] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState<DiscoveryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualOverrides, setManualOverrides] = useState<Record<string, string>>({});
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [allEntities, setAllEntities] = useState<EntityRegistryEntry[]>([]);

  const runDiscovery = useCallback(async () => {
    setStatus('loading');
    setError(null);

    try {
      const result = await discoverEntities(deviceId, profileId);
      setDiscoveryResult(result);
      setAllEntities(result.deviceEntities);

      if (result.allMatched) {
        setStatus('success');
      } else {
        setStatus('partial');
        // Auto-expand groups with unmatched entities
        const groups = groupMatchResultsByCategory(result.results);
        const groupsWithUnmatched = new Set<string>();
        for (const [groupName, results] of Object.entries(groups)) {
          if (results.some((r) => !r.matchedEntityId && !r.isOptional)) {
            groupsWithUnmatched.add(groupName);
          }
        }
        setExpandedGroups(groupsWithUnmatched);
      }
    } catch (err) {
      setError((err as Error).message);
      setStatus('error');

      // Try to at least get the device entities for manual mapping
      try {
        const { entities } = await getDeviceEntities(deviceId);
        setAllEntities(entities);
      } catch {
        // Ignore - we'll just have no entities
      }
    }
  }, [deviceId, profileId]);

  useEffect(() => {
    runDiscovery();
  }, [runDiscovery]);

  const handleOverride = (templateKey: string, entityId: string) => {
    setManualOverrides((prev) => ({
      ...prev,
      [templateKey]: entityId,
    }));
  };

  const buildFinalMappings = (): EntityMappings => {
    if (!discoveryResult) {
      return {
        discoveredAt: new Date().toISOString(),
        autoMatchedCount: 0,
        manuallyMappedCount: Object.keys(manualOverrides).length,
      };
    }

    // Start with suggested mappings
    const mappings: EntityMappings = {
      ...discoveryResult.suggestedMappings,
      discoveredAt: new Date().toISOString(),
      autoMatchedCount: discoveryResult.matchedCount,
      manuallyMappedCount: Object.keys(manualOverrides).length,
    };

    // Apply manual overrides
    for (const [key, entityId] of Object.entries(manualOverrides)) {
      // Skip empty values (user cleared the selection)
      if (!entityId) continue;

      // Handle nested keys like "zoneConfigEntities.zone1.beginX" or "polygonZoneEntities.zone1"
      const parts = key.split('.');
      if (parts.length === 1) {
        // Flat key like "distanceMinEntity"
        (mappings as Record<string, unknown>)[key] = entityId;
      } else if (parts.length === 2) {
        // 2-part key like "polygonZoneEntities.zone1" or "trackingTargets.target1"
        const [group, subKey] = parts;
        if (!(mappings as Record<string, unknown>)[group]) {
          (mappings as Record<string, unknown>)[group] = {};
        }
        const groupObj = (mappings as Record<string, unknown>)[group] as Record<string, unknown>;
        groupObj[subKey] = entityId;
      } else if (parts.length === 3) {
        // 3-part key like "zoneConfigEntities.zone1.beginX" or "trackingTargets.target1.x"
        const [group, zoneKey, prop] = parts;
        if (!(mappings as Record<string, unknown>)[group]) {
          (mappings as Record<string, unknown>)[group] = {};
        }
        const groupObj = (mappings as Record<string, unknown>)[group] as Record<string, unknown>;
        if (!groupObj[zoneKey]) {
          groupObj[zoneKey] = {};
        }
        (groupObj[zoneKey] as Record<string, unknown>)[prop] = entityId;
      }
    }

    return mappings;
  };

  const handleContinue = async () => {
    setSaving(true);
    try {
      const mappings = buildFinalMappings();

      // Convert EntityMappings to flat DeviceMapping format for storage
      const flatMappings: Record<string, string> = {};

      // Known metadata keys that are NOT entity IDs
      const metadataKeys = new Set(['discoveredAt', 'autoMatchedCount', 'manuallyMappedCount']);

      // Extract flat entity mappings from the nested structure
      for (const [key, value] of Object.entries(mappings)) {
        // Skip metadata keys
        if (metadataKeys.has(key)) continue;

        // Capture ALL string values that look like entity IDs (contain a dot like "sensor.device_name")
        // This handles both legacy keys (presenceEntity) and new format keys (maxDistance, polygonZonesEnabled)
        if (typeof value === 'string' && value.includes('.')) {
          flatMappings[key] = value;
        }
      }

      // Handle zone config entities - convert 'zone1.beginX' -> 'zone1BeginX' to match profile entities keys
      if (mappings.zoneConfigEntities) {
        for (const [zoneKey, zoneData] of Object.entries(mappings.zoneConfigEntities)) {
          if (zoneData && typeof zoneData === 'object') {
            // Extract zone number from 'zone1', 'zone2', etc.
            const zoneNum = zoneKey.replace('zone', '');
            for (const [prop, entityId] of Object.entries(zoneData as unknown as Record<string, string>)) {
              if (entityId) {
                // Convert 'beginX' to 'BeginX', combine: zone1BeginX
                const capitalizedProp = prop.charAt(0).toUpperCase() + prop.slice(1);
                flatMappings[`zone${zoneNum}${capitalizedProp}`] = entityId;
              }
            }
          }
        }
      }

      // Handle exclusion zone entities - convert 'exclusion1.beginX' -> 'exclusion1BeginX'
      if (mappings.exclusionZoneEntities) {
        for (const [zoneKey, zoneData] of Object.entries(mappings.exclusionZoneEntities)) {
          if (zoneData && typeof zoneData === 'object') {
            // Extract exclusion number from 'exclusion1', 'exclusion2', etc.
            const exclusionNum = zoneKey.replace('exclusion', '');
            for (const [prop, entityId] of Object.entries(zoneData as unknown as Record<string, string>)) {
              if (entityId) {
                const capitalizedProp = prop.charAt(0).toUpperCase() + prop.slice(1);
                flatMappings[`exclusion${exclusionNum}${capitalizedProp}`] = entityId;
              }
            }
          }
        }
      }

      // Handle entry zone entities - convert 'entry1.beginX' -> 'entry1BeginX'
      if (mappings.entryZoneEntities) {
        for (const [zoneKey, zoneData] of Object.entries(mappings.entryZoneEntities)) {
          if (zoneData && typeof zoneData === 'object') {
            // Extract entry number from 'entry1', 'entry2', etc.
            const entryNum = zoneKey.replace('entry', '');
            for (const [prop, entityId] of Object.entries(zoneData as unknown as Record<string, string>)) {
              if (entityId) {
                const capitalizedProp = prop.charAt(0).toUpperCase() + prop.slice(1);
                flatMappings[`entry${entryNum}${capitalizedProp}`] = entityId;
              }
            }
          }
        }
      }

      // Handle polygon zone entities - convert 'zone1' -> 'polygonZone1' to match profile entities keys
      if (mappings.polygonZoneEntities) {
        for (const [zoneKey, entityId] of Object.entries(mappings.polygonZoneEntities)) {
          if (entityId) {
            // Convert 'zone1' to 'polygonZone1', 'zone2' to 'polygonZone2', etc.
            const index = zoneKey.replace('zone', '');
            flatMappings[`polygonZone${index}`] = entityId;
          }
        }
      }

      // Handle polygon exclusion entities - convert 'exclusion1' -> 'polygonExclusion1'
      if (mappings.polygonExclusionEntities) {
        for (const [zoneKey, entityId] of Object.entries(mappings.polygonExclusionEntities)) {
          if (entityId) {
            // Convert 'exclusion1' to 'polygonExclusion1', etc.
            const index = zoneKey.replace('exclusion', '');
            flatMappings[`polygonExclusion${index}`] = entityId;
          }
        }
      }

      // Handle polygon entry entities - convert 'entry1' -> 'polygonEntry1'
      if (mappings.polygonEntryEntities) {
        for (const [zoneKey, entityId] of Object.entries(mappings.polygonEntryEntities)) {
          if (entityId) {
            // Convert 'entry1' to 'polygonEntry1', etc.
            const index = zoneKey.replace('entry', '');
            flatMappings[`polygonEntry${index}`] = entityId;
          }
        }
      }

      // Handle tracking targets - convert 'target1.x' -> 'target1X' to match profile entities keys
      if (mappings.trackingTargets) {
        for (const [targetKey, targetData] of Object.entries(mappings.trackingTargets)) {
          if (targetData && typeof targetData === 'object') {
            // Extract target number from 'target1', 'target2', etc.
            const targetNum = targetKey.replace('target', '');
            for (const [prop, entityId] of Object.entries(targetData as unknown as Record<string, string>)) {
              if (entityId) {
                // Convert 'x' to 'X', 'speed' to 'Speed', etc. and combine: target1X, target1Speed
                const capitalizedProp = prop.charAt(0).toUpperCase() + prop.slice(1);
                flatMappings[`target${targetNum}${capitalizedProp}`] = entityId;
              }
            }
          }
        }
      }

      // Handle settings entities - these are stored with their key directly (e.g., 'maxDistance')
      // so deviceEntityService.getSettingsGrouped() can find them by key
      if (mappings.settingsEntities) {
        for (const [settingKey, entityId] of Object.entries(mappings.settingsEntities)) {
          if (entityId) {
            flatMappings[settingKey] = entityId;
          }
        }
      }

      // Build device mapping for storage
      const deviceMapping: DeviceMapping = {
        deviceId,
        profileId,
        deviceName,
        discoveredAt: mappings.discoveredAt || new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        confirmedByUser: true, // User confirmed by clicking Continue
        autoMatchedCount: mappings.autoMatchedCount || 0,
        manuallyMappedCount: mappings.manuallyMappedCount || 0,
        mappings: flatMappings,
        unmappedEntities: discoveryResult?.results
          .filter(r => !r.matchedEntityId && !manualOverrides[r.templateKey])
          .map(r => r.templateKey) || [],
      };

      // Save to device storage
      await saveDeviceMapping(deviceMapping);

      // Refresh the context cache
      await refreshMapping(deviceId);

      // Continue with the legacy flow
      onComplete(mappings);
    } catch (err) {
      console.error('Failed to save device mapping:', err);
      // Still continue with the flow even if saving fails
      // The legacy room.entityMappings will be used as fallback
      const mappings = buildFinalMappings();
      onComplete(mappings);
    } finally {
      setSaving(false);
    }
  };

  const toggleGroup = (groupName: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      return next;
    });
  };

  const getConfidenceIcon = (confidence: string) => {
    switch (confidence) {
      case 'exact':
        return '✓';
      case 'suffix':
      case 'name':
        return '~';
      default:
        return '?';
    }
  };

  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case 'exact':
        return 'text-green-400';
      case 'suffix':
      case 'name':
        return 'text-yellow-400';
      default:
        return 'text-red-400';
    }
  };

  const renderEntityRow = (result: EntityMatchResult) => {
    const effectiveEntityId = manualOverrides[result.templateKey] || result.matchedEntityId;
    const isOverridden = !!manualOverrides[result.templateKey];
    const isMatched = !!effectiveEntityId;

    return (
      <div
        key={result.templateKey}
        className={`flex items-center justify-between py-2 px-3 rounded-lg ${
          isMatched ? 'bg-slate-800/30' : 'bg-red-500/10 border border-red-500/30'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className={`text-lg ${isMatched ? getConfidenceColor(result.matchConfidence) : 'text-red-400'}`}>
            {isMatched ? (isOverridden ? '✎' : getConfidenceIcon(result.matchConfidence)) : '✗'}
          </span>
          <span className="text-sm text-slate-300 truncate">
            {getTemplateKeyLabel(result.templateKey)}
          </span>
          {result.isOptional && (
            <span className="text-xs text-slate-500">(optional)</span>
          )}
        </div>

        <div className="flex items-center gap-2 ml-2">
          {isMatched && !isOverridden ? (
            <span className="text-xs text-slate-400 font-mono truncate max-w-[200px]">
              {effectiveEntityId}
            </span>
          ) : (
            <select
              value={effectiveEntityId || ''}
              onChange={(e) => handleOverride(result.templateKey, e.target.value)}
              className="text-xs bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-300 max-w-[200px]"
            >
              <option value="">Select entity...</option>
              {result.candidates.length > 0 ? (
                result.candidates.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {candidate}
                  </option>
                ))
              ) : (
                allEntities.map((entity) => (
                  <option key={entity.entity_id} value={entity.entity_id}>
                    {entity.entity_id}
                  </option>
                ))
              )}
            </select>
          )}

          {isMatched && !isOverridden && (
            <button
              onClick={() => handleOverride(result.templateKey, '')}
              className="text-xs text-slate-500 hover:text-slate-300"
              title="Change entity"
            >
              ✎
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderGroupedResults = () => {
    if (!discoveryResult) return null;

    const groups = groupMatchResultsByCategory(discoveryResult.results);

    return (
      <div className="space-y-3">
        {Object.entries(groups).map(([groupName, results]) => {
          const matchedCount = results.filter((r) => r.matchedEntityId || manualOverrides[r.templateKey]).length;
          const totalRequired = results.filter((r) => !r.isOptional).length;
          const isExpanded = expandedGroups.has(groupName);
          const hasUnmatched = results.some((r) => !r.matchedEntityId && !r.isOptional && !manualOverrides[r.templateKey]);

          return (
            <div key={groupName} className="border border-slate-700 rounded-lg overflow-hidden">
              <button
                onClick={() => toggleGroup(groupName)}
                className={`w-full flex items-center justify-between px-4 py-3 text-left ${
                  hasUnmatched ? 'bg-red-500/10' : 'bg-slate-800/50'
                } hover:bg-slate-800/70 transition-colors`}
              >
                <div className="flex items-center gap-2">
                  <span className={hasUnmatched ? 'text-red-400' : 'text-green-400'}>
                    {hasUnmatched ? '⚠' : '✓'}
                  </span>
                  <span className="font-medium text-slate-200">{groupName}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">
                    {matchedCount}/{results.length} matched
                  </span>
                  <span className="text-slate-500">{isExpanded ? '▼' : '▶'}</span>
                </div>
              </button>

              {isExpanded && (
                <div className="px-3 py-2 space-y-1 bg-slate-900/50">
                  {results.map(renderEntityRow)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const canContinue = status === 'success' || status === 'partial';
  const totalMatched = discoveryResult
    ? discoveryResult.matchedCount + Object.keys(manualOverrides).filter((k) => manualOverrides[k]).length
    : 0;
  const totalEntities = discoveryResult?.results.length || 0;
  const percentage = totalEntities > 0 ? Math.round((totalMatched / totalEntities) * 100) : 0;

  return (
    <div className="h-full flex flex-col bg-slate-900">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-slate-700">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <div>
            <h2 className="text-lg font-semibold text-white">Discovering Entities</h2>
            <p className="text-sm text-slate-400">{deviceName}</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
        {status === 'loading' && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-12 h-12 border-4 border-aqua-500 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-slate-300">Discovering entities for your device...</p>
            <p className="text-sm text-slate-500 mt-1">This may take a few seconds</p>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mb-4">
              <span className="text-3xl text-red-400">!</span>
            </div>
            <p className="text-red-400 font-medium mb-2">Discovery Failed</p>
            <p className="text-sm text-slate-400 text-center max-w-md">{error}</p>
            <button
              onClick={runDiscovery}
              className="mt-4 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors"
            >
              Try Again
            </button>
          </div>
        )}

        {(status === 'success' || status === 'partial') && discoveryResult && (
          <>
            {/* Summary */}
            <div className={`mb-6 p-4 rounded-xl ${status === 'success' ? 'bg-green-500/10 border border-green-500/30' : 'bg-yellow-500/10 border border-yellow-500/30'}`}>
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${status === 'success' ? 'bg-green-500/20' : 'bg-yellow-500/20'}`}>
                  <span className={`text-xl ${status === 'success' ? 'text-green-400' : 'text-yellow-400'}`}>
                    {status === 'success' ? '✓' : '!'}
                  </span>
                </div>
                <div>
                  <p className={`font-medium ${status === 'success' ? 'text-green-400' : 'text-yellow-400'}`}>
                    {status === 'success' ? 'All entities matched!' : 'Some entities need attention'}
                  </p>
                  <p className="text-sm text-slate-400">
                    Found {totalMatched} of {totalEntities} entities ({percentage}%)
                  </p>
                </div>
              </div>

              {/* Progress bar */}
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${status === 'success' ? 'bg-green-500' : 'bg-yellow-500'}`}
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>

            {/* Entity groups */}
            {renderGroupedResults()}

            {/* Re-discover button */}
            <div className="mt-4 flex justify-center">
              <button
                onClick={runDiscovery}
                className="text-sm text-slate-400 hover:text-slate-200 flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Re-discover entities
              </button>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 px-6 py-4 border-t border-slate-700 flex justify-between">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleContinue}
          disabled={!canContinue || saving}
          className={`px-6 py-2 rounded-lg font-medium transition-colors ${
            canContinue && !saving
              ? 'bg-aqua-500 hover:bg-aqua-400 text-slate-900'
              : 'bg-slate-700 text-slate-500 cursor-not-allowed'
          }`}
        >
          {saving ? 'Saving...' : 'Continue'}
        </button>
      </div>
    </div>
  );
};
