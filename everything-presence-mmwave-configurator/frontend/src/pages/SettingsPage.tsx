import React, { useState, useEffect } from 'react';
import { fetchRooms, deleteRoom, updateRoom, createRoom } from '../api/rooms';
import {
  fetchSettings,
  updateSettings,
  fetchDevices,
  fetchProfiles,
  fetchZoneBackups,
  createZoneBackup,
  restoreZoneBackup,
  deleteZoneBackup,
  importZoneBackups,
} from '../api/client';
import {
  fetchCustomFloors,
  createCustomFloor,
  deleteCustomFloor,
  fetchCustomFurniture,
  createCustomFurniture,
  deleteCustomFurniture,
} from '../api/client';
import {
  RoomConfig,
  CustomFloorMaterial,
  CustomFurnitureType,
  EntityMappings,
  DiscoveredDevice,
  DeviceProfile,
  ZoneBackup,
} from '../api/types';
import { EntityDiscovery } from '../components/EntityDiscovery';
import { FirmwareUpdateSection } from '../components/FirmwareUpdateSection';
import { useDeviceMappings } from '../contexts/DeviceMappingsContext';
import { getDeviceMapping, DeviceMapping } from '../api/deviceMappings';

interface SettingsPageProps {
  onBack?: () => void;
  onRoomDeleted?: (roomId: string) => void;
  onRoomUpdated?: (room: RoomConfig) => void;
}

type SettingsTab = 'general' | 'firmware';

export const SettingsPage: React.FC<SettingsPageProps> = ({ onBack, onRoomDeleted, onRoomUpdated }) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [rooms, setRooms] = useState<RoomConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deletingRoomId, setDeletingRoomId] = useState<string | null>(null);
  const [syncingRoom, setSyncingRoom] = useState<RoomConfig | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [defaultRoomId, setDefaultRoomId] = useState<string | null>(null);
  const [updatingDefaultRoomId, setUpdatingDefaultRoomId] = useState<string | null>(null);
  const [clearingDefaultRoom, setClearingDefaultRoom] = useState(false);
  const [renamingRoomId, setRenamingRoomId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [unlinkingDeviceRoomId, setUnlinkingDeviceRoomId] = useState<string | null>(null);
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [profiles, setProfiles] = useState<DeviceProfile[]>([]);

  // Zone backups state
  const [selectedBackupDeviceId, setSelectedBackupDeviceId] = useState('');
  const [zoneBackups, setZoneBackups] = useState<ZoneBackup[]>([]);
  const [backupMapping, setBackupMapping] = useState<DeviceMapping | null>(null);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [restoringBackupId, setRestoringBackupId] = useState<string | null>(null);
  const [deletingBackupId, setDeletingBackupId] = useState<string | null>(null);
  const [importingBackups, setImportingBackups] = useState(false);

  // Device mappings context - used to refresh cache after resync
  const { refreshMapping } = useDeviceMappings();

  // Custom assets state
  const [customFloors, setCustomFloors] = useState<CustomFloorMaterial[]>([]);
  const [customFurniture, setCustomFurniture] = useState<CustomFurnitureType[]>([]);
  const [showFloorForm, setShowFloorForm] = useState(false);
  const [showFurnitureForm, setShowFurnitureForm] = useState(false);

  // Floor form state
  const [floorLabel, setFloorLabel] = useState('');
  const [floorEmoji, setFloorEmoji] = useState('🎨');
  const [floorColor, setFloorColor] = useState('#808080');
  const [floorCategory, setFloorCategory] = useState<'wood' | 'carpet' | 'hard' | 'other'>('other');
  const [floorPattern, setFloorPattern] = useState<'solid' | 'stripes' | 'checker' | 'dots'>('solid');

  // Furniture form state
  const [furnitureLabel, setFurnitureLabel] = useState('');
  const [furnitureCategory, setFurnitureCategory] = useState<'bedroom' | 'living-room' | 'office' | 'dining' | 'all'>('all');
  const [furnitureWidth, setFurnitureWidth] = useState(1000);
  const [furnitureDepth, setFurnitureDepth] = useState(1000);
  const [furnitureHeight, setFurnitureHeight] = useState(500);
  const [furnitureColor, setFurnitureColor] = useState('#6B7280');
  const [furnitureShape, setFurnitureShape] = useState<'rectangle' | 'rounded' | 'circle' | 'lshaped'>('rectangle');

  useEffect(() => {
    const load = async () => {
      try {
        const [roomsRes, floorsRes, furnitureRes, settingsRes, devicesRes, profilesRes] = await Promise.all([
          fetchRooms(),
          fetchCustomFloors(),
          fetchCustomFurniture(),
          fetchSettings(),
          fetchDevices(),
          fetchProfiles(),
        ]);
        setRooms(roomsRes.rooms);
        setCustomFloors(floorsRes.floors);
        setCustomFurniture(furnitureRes.furniture);
        setDefaultRoomId(typeof settingsRes.settings.defaultRoomId === 'string' ? settingsRes.settings.defaultRoomId : null);
        const epDevices = devicesRes.devices.filter(
          (device) =>
            device.manufacturer?.toLowerCase().includes('everything') ||
            device.model?.toLowerCase().includes('presence')
        );
        setDevices(epDevices);
        setProfiles(profilesRes.profiles ?? []);
        if (!selectedBackupDeviceId && epDevices.length > 0) {
          setSelectedBackupDeviceId(epDevices[0].id);
        }
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    const loadBackups = async () => {
      if (!selectedBackupDeviceId) {
        setZoneBackups([]);
        setBackupMapping(null);
        return;
      }

      setLoadingBackups(true);
      try {
        const [backupsRes, mapping] = await Promise.all([
          fetchZoneBackups(selectedBackupDeviceId),
          getDeviceMapping(selectedBackupDeviceId),
        ]);
        setZoneBackups(backupsRes.backups ?? []);
        setBackupMapping(mapping);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load zone backups');
      } finally {
        setLoadingBackups(false);
      }
    };

    loadBackups();
  }, [selectedBackupDeviceId]);

  const handleDeleteRoom = async (roomId: string, roomName: string) => {
    if (!confirm(`Are you sure you want to delete the room "${roomName}"? This action cannot be undone.`)) {
      return;
    }

    setDeletingRoomId(roomId);
    try {
      await deleteRoom(roomId);
      setRooms((prev) => prev.filter((r) => r.id !== roomId));
      onRoomDeleted?.(roomId);
      if (defaultRoomId === roomId) {
        await updateSettings({ defaultRoomId: null });
        setDefaultRoomId(null);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete room');
    } finally {
      setDeletingRoomId(null);
    }
  };

  const handleSetDefaultRoom = async (room: RoomConfig) => {
    setUpdatingDefaultRoomId(room.id);
    try {
      await updateSettings({ defaultRoomId: room.id });
      setDefaultRoomId(room.id);
      setSuccess(`Default room set to "${room.name}"`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update default room');
    } finally {
      setUpdatingDefaultRoomId(null);
    }
  };

  const handleClearDefaultRoom = async () => {
    if (!defaultRoomId) return;
    if (!confirm('Clear the default room selection?')) {
      return;
    }
    setClearingDefaultRoom(true);
    try {
      await updateSettings({ defaultRoomId: null });
      setDefaultRoomId(null);
      setSuccess('Default room cleared');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear default room');
    } finally {
      setClearingDefaultRoom(false);
    }
  };

  const handleStartRename = (room: RoomConfig) => {
    setRenamingRoomId(room.id);
    setRenameValue(room.name);
  };

  const handleCancelRename = () => {
    setRenamingRoomId(null);
    setRenameValue('');
  };

  const handleSaveRename = async (roomId: string) => {
    const trimmedName = renameValue.trim();
    if (!trimmedName) {
      setError('Room name cannot be empty');
      return;
    }

    try {
      const result = await updateRoom(roomId, { name: trimmedName });
      setRooms((prev) =>
        prev.map((r) => (r.id === roomId ? { ...r, name: result.room.name } : r))
      );
      setSuccess(`Room renamed to "${trimmedName}"`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename room');
    } finally {
      setRenamingRoomId(null);
      setRenameValue('');
    }
  };

  const handleStartSync = (room: RoomConfig) => {
    if (!room.deviceId || !room.profileId) {
      setError('This room is not linked to a device. Re-sync requires a linked device.');
      return;
    }
    setSyncingRoom(room);
    setIsSyncing(true);
  };

  const handleSyncComplete = async (mappings: EntityMappings) => {
    if (!syncingRoom) return;

    try {
      await updateRoom(syncingRoom.id, { entityMappings: mappings });
      // Update local state
      setRooms((prev) =>
        prev.map((r) => (r.id === syncingRoom.id ? { ...r, entityMappings: mappings } : r))
      );

      // Refresh device mapping cache so other pages see the new mappings
      if (syncingRoom.deviceId) {
        await refreshMapping(syncingRoom.deviceId);
      }

      setSuccess(`Entity mappings updated for "${syncingRoom.name}"`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update entity mappings');
    } finally {
      setSyncingRoom(null);
      setIsSyncing(false);
    }
  };

  const handleSyncCancel = () => {
    setSyncingRoom(null);
    setIsSyncing(false);
  };

  const handleUnlinkDevice = async (room: RoomConfig) => {
    if (!room.deviceId) return;

    const confirmMessage = `Are you sure you want to unlink the device from "${room.name}"?\n\nThis will:\n• Remove the device association\n• Clear entity mappings\n\nThe room geometry, furniture, and zones will be preserved.`;
    if (!confirm(confirmMessage)) {
      return;
    }

    setUnlinkingDeviceRoomId(room.id);
    try {
      // Update room to remove device association and entity mappings
      // Keep: name, zones, roomShell, furniture, doors, devicePlacement, etc.
      // Note: Empty strings are converted to undefined by backend's normalizeRoom
      // Note: null is used for entityMappings because undefined is stripped from JSON
      const result = await updateRoom(room.id, {
        deviceId: '',
        profileId: '',
        entityMappings: null as unknown as undefined,
        entityNamePrefix: '',
      });

      setRooms((prev) =>
        prev.map((r) => (r.id === room.id ? result.room : r))
      );

      // Notify parent (App.tsx) so it can update its rooms state
      onRoomUpdated?.(result.room);

      setSuccess(`Device unlinked from "${room.name}". Room data preserved.`);
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlink device');
    } finally {
      setUnlinkingDeviceRoomId(null);
    }
  };

  const handleExportRoom = (room: RoomConfig) => {
    // Create a sanitized copy of the room for export
    const exportData = {
      ...room,
      exportedAt: new Date().toISOString(),
      exportedFrom: 'Zone Configurator v1.0'
    };

    // Convert to JSON and create a downloadable file
    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    // Generate filename with timestamp: RoomName_YYYY-MM-DD_HHmmss.json
    const timestamp = new Date().toISOString()
      .replace(/T/, '_')
      .replace(/\..+/, '')
      .replace(/:/g, '')
      .slice(0, 17); // YYYY-MM-DD_HHmmss
    const sanitizedName = room.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    a.download = `room_${sanitizedName}_${timestamp}.json`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleBackupAllRooms = () => {
    if (rooms.length === 0) {
      setError('No rooms to backup');
      return;
    }

    // Create backup data with all rooms
    const backupData = {
      rooms: rooms,
      exportedAt: new Date().toISOString(),
      exportedFrom: 'Zone Configurator v1.0',
      roomCount: rooms.length,
    };

    // Convert to JSON and create a downloadable file
    const jsonString = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    // Generate filename: backup_all_rooms_YYYY-MM-DD_HHmmss.json
    const timestamp = new Date().toISOString()
      .replace(/T/, '_')
      .replace(/\..+/, '')
      .replace(/:/g, '')
      .slice(0, 17);
    a.download = `backup_all_rooms_${timestamp}.json`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportRoom = () => {
    // Create a file input element
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const importedData = JSON.parse(text);

        // Check if this is a multi-room backup or single room
        const isBackup = Array.isArray(importedData.rooms);
        const roomsToImport: RoomConfig[] = isBackup ? importedData.rooms : [importedData];

        // Validate all rooms
        for (const room of roomsToImport) {
          if (!room.name || !Array.isArray(room.zones)) {
            setError('Invalid room configuration file: missing required fields');
            return;
          }
        }

        // Prompt for room name(s)
        const importPromises: Promise<void>[] = [];

        for (const importedRoom of roomsToImport) {
          const defaultName = isBackup ? importedRoom.name : `${importedRoom.name} (imported)`;
          const newName = prompt(
            `Enter a name for the imported room:\n\nOriginal name: "${importedRoom.name}"`,
            defaultName
          );

          if (!newName) {
            // User cancelled
            continue;
          }

          // Generate a new ID for the imported room
          const generateId = () => {
            if (typeof crypto !== 'undefined' && crypto.randomUUID) {
              return crypto.randomUUID();
            }
            // Fallback: simple UUID v4 implementation
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
              const r = Math.random() * 16 | 0;
              const v = c === 'x' ? r : (r & 0x3 | 0x8);
              return v.toString(16);
            });
          };

          const newRoom: RoomConfig = {
            ...importedRoom,
            id: generateId(),
            name: newName.trim(),
          };

          // Add the imported room via API
          importPromises.push(
            createRoom(newRoom).then(() => {}).catch(() => {
              throw new Error(`Failed to import room: ${newRoom.name}`);
            })
          );
        }

        if (importPromises.length === 0) {
          setError('Import cancelled');
          return;
        }

        // Wait for all imports to complete
        await Promise.all(importPromises);

        // Reload rooms list
        const roomsResponse = await fetchRooms();
        setRooms(roomsResponse.rooms);
        const count = importPromises.length;
        setSuccess(`Successfully imported ${count} room${count > 1 ? 's' : ''}`);
        setTimeout(() => setSuccess(null), 3000);

      } catch (err) {
        setError(`Failed to import room: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    };

    input.click();
  };

  // ==================== Zone Backup Handlers ====================
  const selectedBackupDevice = devices.find((device) => device.id === selectedBackupDeviceId) ?? null;
  const selectedBackupRoom = rooms.find((room) => room.deviceId === selectedBackupDeviceId) ?? null;
  const selectedBackupProfileId = backupMapping?.profileId ?? selectedBackupRoom?.profileId ?? '';
  const selectedBackupProfile =
    profiles.find((profile) => profile.id === selectedBackupProfileId) ?? null;
  const backupEntityNamePrefix =
    selectedBackupRoom?.entityNamePrefix || selectedBackupDevice?.entityNamePrefix || undefined;
  const backupEntityMappings = backupMapping ? undefined : selectedBackupRoom?.entityMappings;

  const summarizeZones = (zones: ZoneBackup['zones']) => {
    return zones.reduce(
      (acc, zone) => {
        if (zone.type === 'exclusion') {
          acc.exclusion += 1;
        } else if (zone.type === 'entry') {
          acc.entry += 1;
        } else {
          acc.regular += 1;
        }
        return acc;
      },
      { regular: 0, exclusion: 0, entry: 0 }
    );
  };

  const reloadZoneBackups = async (deviceId: string) => {
    try {
      const backupsRes = await fetchZoneBackups(deviceId);
      setZoneBackups(backupsRes.backups ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh zone backups');
    }
  };

  const handleCreateZoneBackup = async () => {
    if (!selectedBackupDeviceId) {
      setError('Select a device to back up zones.');
      return;
    }

    if (!selectedBackupProfileId) {
      setError('Device profile not found. Run entity discovery to sync the device.');
      return;
    }

    if (!backupEntityNamePrefix && !backupMapping) {
      setError('Entity name prefix is missing. Link the device to a room or re-sync entities.');
      return;
    }

    setCreatingBackup(true);
    try {
      await createZoneBackup({
        deviceId: selectedBackupDeviceId,
        profileId: selectedBackupProfileId,
        entityNamePrefix: backupEntityNamePrefix,
        entityMappings: backupEntityMappings,
      });
      await reloadZoneBackups(selectedBackupDeviceId);
      setSuccess('Zone backup created.');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create zone backup');
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleRestoreZoneBackup = async (backup: ZoneBackup) => {
    if (!selectedBackupDeviceId) {
      setError('Select a device before restoring.');
      return;
    }

    if (!selectedBackupProfileId) {
      setError('Device profile not found. Run entity discovery to sync the device.');
      return;
    }

    if (!backupEntityNamePrefix && !backupMapping) {
      setError('Entity name prefix is missing. Link the device to a room or re-sync entities.');
      return;
    }

    setRestoringBackupId(backup.id);
    try {
      const result = await restoreZoneBackup(backup.id, {
        deviceId: selectedBackupDeviceId,
        profileId: selectedBackupProfileId,
        entityNamePrefix: backupEntityNamePrefix,
        entityMappings: backupEntityMappings,
      });

      if (!result.ok) {
        setError('Restore completed with errors. Check warnings and try again.');
      } else if (result.warnings && result.warnings.length > 0) {
        setSuccess(`Restore completed with ${result.warnings.length} warning(s).`);
        setTimeout(() => setSuccess(null), 4000);
      } else {
        setSuccess('Backup restored as polygon zones.');
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore zone backup');
    } finally {
      setRestoringBackupId(null);
    }
  };

  const handleDeleteZoneBackup = async (backupId: string) => {
    if (!confirm('Delete this zone backup?')) return;
    setDeletingBackupId(backupId);
    try {
      await deleteZoneBackup(backupId);
      setZoneBackups((prev) => prev.filter((entry) => entry.id !== backupId));
      setSuccess('Zone backup deleted.');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete zone backup');
    } finally {
      setDeletingBackupId(null);
    }
  };

  const downloadJson = (filename: string, data: unknown) => {
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadBackup = (backup: ZoneBackup) => {
    const timestamp = new Date(backup.createdAt)
      .toISOString()
      .replace(/T/, '_')
      .replace(/\..+/, '')
      .replace(/:/g, '')
      .slice(0, 17);
    const labelBase =
      backup.deviceName ||
      selectedBackupDevice?.name ||
      backup.deviceId;
    const sanitized = labelBase.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    downloadJson(`zone_backup_${sanitized}_${timestamp}.json`, backup);
  };

  const handleDownloadAllBackups = () => {
    if (zoneBackups.length === 0) {
      setError('No backups available to download.');
      return;
    }
    const timestamp = new Date().toISOString()
      .replace(/T/, '_')
      .replace(/\..+/, '')
      .replace(/:/g, '')
      .slice(0, 17);
    downloadJson(`zone_backups_${timestamp}.json`, { backups: zoneBackups });
  };

  const handleImportBackups = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setImportingBackups(true);
      try {
        const text = await file.text();
        const payload = JSON.parse(text);
        const result = await importZoneBackups(payload);
        if (selectedBackupDeviceId) {
          await reloadZoneBackups(selectedBackupDeviceId);
        }
        setSuccess(`Imported ${result.imported} backup(s).`);
        setTimeout(() => setSuccess(null), 4000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to import zone backups');
      } finally {
        setImportingBackups(false);
      }
    };

    input.click();
  };

  // ==================== Custom Floor Handlers ====================
  const resetFloorForm = () => {
    setFloorLabel('');
    setFloorEmoji('🎨');
    setFloorColor('#808080');
    setFloorCategory('other');
    setFloorPattern('solid');
  };

  const handleCreateFloor = async () => {
    if (!floorLabel.trim()) {
      setError('Floor name is required');
      return;
    }
    try {
      const res = await createCustomFloor({
        label: floorLabel.trim(),
        emoji: floorEmoji,
        color: floorColor,
        category: floorCategory,
        patternType: floorPattern,
      });
      setCustomFloors((prev) => [...prev, res.floor]);
      setShowFloorForm(false);
      resetFloorForm();
      setSuccess('Custom floor material created');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create floor');
    }
  };

  const handleDeleteFloor = async (id: string, label: string) => {
    if (!confirm(`Delete custom floor "${label}"? This cannot be undone.`)) return;
    try {
      await deleteCustomFloor(id);
      setCustomFloors((prev) => prev.filter((f) => f.id !== id));
      setSuccess('Custom floor material deleted');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete floor');
    }
  };

  // ==================== Custom Furniture Handlers ====================
  const resetFurnitureForm = () => {
    setFurnitureLabel('');
    setFurnitureCategory('all');
    setFurnitureWidth(1000);
    setFurnitureDepth(1000);
    setFurnitureHeight(500);
    setFurnitureColor('#6B7280');
    setFurnitureShape('rectangle');
  };

  const handleCreateFurniture = async () => {
    if (!furnitureLabel.trim()) {
      setError('Furniture name is required');
      return;
    }
    try {
      const res = await createCustomFurniture({
        label: furnitureLabel.trim(),
        category: furnitureCategory,
        defaultWidth: furnitureWidth,
        defaultDepth: furnitureDepth,
        defaultHeight: furnitureHeight,
        color: furnitureColor,
        shape: furnitureShape,
      });
      setCustomFurniture((prev) => [...prev, res.furniture]);
      setShowFurnitureForm(false);
      resetFurnitureForm();
      setSuccess('Custom furniture type created');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create furniture');
    }
  };

  const handleDeleteFurniture = async (id: string, label: string) => {
    if (!confirm(`Delete custom furniture "${label}"? This cannot be undone.`)) return;
    try {
      await deleteCustomFurniture(id);
      setCustomFurniture((prev) => prev.filter((f) => f.id !== id));
      setSuccess('Custom furniture type deleted');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete furniture');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="mx-auto max-w-4xl px-6 py-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          {onBack && (
            <button
              onClick={onBack}
              className="group flex items-center gap-2 rounded-lg bg-slate-800/50 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-slate-800"
            >
              <span className="inline-block transition-transform group-hover:-translate-x-0.5">←</span> Back
            </button>
          )}
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <div className="w-20" /> {/* Spacer for alignment */}
        </div>

        {/* Tab Navigation */}
        <div className="mb-6 flex gap-2 border-b border-slate-700/50 pb-2">
          <button
            onClick={() => setActiveTab('general')}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              activeTab === 'general'
                ? 'bg-cyan-600 text-white'
                : 'bg-slate-800/50 text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            General
          </button>
          <button
            onClick={() => setActiveTab('firmware')}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              activeTab === 'firmware'
                ? 'bg-cyan-600 text-white'
                : 'bg-slate-800/50 text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            Firmware Updates
          </button>
        </div>

        {/* Error Toast */}
        {error && (
          <div className="mb-6 rounded-xl border border-rose-500/50 bg-rose-500/10 px-6 py-3 text-rose-100">
            {error}
          </div>
        )}

        {/* Success Toast */}
        {success && (
          <div className="mb-6 rounded-xl border border-emerald-500/50 bg-emerald-500/10 px-6 py-3 text-emerald-100">
            ✓ {success}
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-200">
            <div
              className="h-10 w-10 animate-spin rounded-full border-4 border-slate-700 border-t-cyan-400"
              aria-label="Loading"
            />
            <div className="text-sm text-slate-400">Loading rooms and custom assets…</div>
          </div>
        ) : (
          <>
            {/* General Tab */}
            {activeTab === 'general' && (
              <div className="space-y-6">
                {/* Room Management Section */}
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Room Management</h2>
                <div className="flex gap-2">
                  <button
                    onClick={handleBackupAllRooms}
                    disabled={rooms.length === 0}
                    className="rounded-lg border border-purple-600/50 bg-purple-600/10 px-4 py-2 text-sm font-semibold text-purple-100 transition-all hover:bg-purple-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Export all rooms to a single backup file"
                  >
                    💾 Backup All
                  </button>
                  <button
                    onClick={handleImportRoom}
                    className="rounded-lg border border-blue-600/50 bg-blue-600/10 px-4 py-2 text-sm font-semibold text-blue-100 transition-all hover:bg-blue-600/20"
                    title="Import room configuration from JSON file"
                  >
                    📤 Import
                  </button>
                  <button
                    onClick={handleClearDefaultRoom}
                    disabled={!defaultRoomId || clearingDefaultRoom}
                    className="rounded-lg border border-amber-600/50 bg-amber-600/10 px-4 py-2 text-sm font-semibold text-amber-100 transition-all hover:bg-amber-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Clear the default room selection"
                  >
                    {clearingDefaultRoom ? 'Clearing...' : 'Clear Default'}
                  </button>
                </div>
              </div>

            {rooms.length === 0 ? (
              <div className="py-8 text-center text-slate-400">
                No rooms configured. Use the "Add Device" wizard to create a room.
              </div>
            ) : (
              <div className="space-y-3">
                {rooms.map((room) => (
                  <div
                    key={room.id}
                    className="flex items-center justify-between rounded-lg border border-slate-700/50 bg-slate-800/50 p-4"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 font-semibold text-white">
                        {renamingRoomId === room.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleSaveRename(room.id);
                                } else if (e.key === 'Escape') {
                                  handleCancelRename();
                                }
                              }}
                              autoFocus
                              className="rounded border border-cyan-500 bg-slate-700 px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                            />
                            <button
                              onClick={() => handleSaveRename(room.id)}
                              className="rounded bg-cyan-600 px-2 py-1 text-xs font-semibold text-white hover:bg-cyan-500"
                            >
                              Save
                            </button>
                            <button
                              onClick={handleCancelRename}
                              className="rounded bg-slate-600 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-500"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <>
                            <span>{room.name}</span>
                            <button
                              onClick={() => handleStartRename(room)}
                              className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-white"
                              title="Rename room"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                              </svg>
                            </button>
                          </>
                        )}
                        {defaultRoomId === room.id && renamingRoomId !== room.id && (
                          <span className="rounded-full border border-emerald-500/50 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-200">
                            Default
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-slate-400">
                        {room.deviceId ? 'Device linked' : 'No device linked'}
                        {room.roomShell?.points && room.roomShell.points.length > 0 && (
                          <span className="ml-2">· Room outline set</span>
                        )}
                        {room.furniture && room.furniture.length > 0 && (
                          <span className="ml-2">· {room.furniture.length} furniture</span>
                        )}
                      </div>
                      {room.entityMappings ? (
                        <div className="text-xs text-emerald-400 mt-1">
                          ✓ Entities synced ({room.entityMappings.autoMatchedCount || 0} auto-matched)
                        </div>
                      ) : room.deviceId ? (
                        <div className="text-xs text-yellow-400 mt-1">
                          ⚠ Entities not synced - consider re-syncing
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2 justify-end">
                      <button
                        onClick={() => handleSetDefaultRoom(room)}
                        disabled={defaultRoomId === room.id || updatingDefaultRoomId === room.id}
                        className="rounded-lg border border-emerald-600/50 bg-emerald-600/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition-all hover:bg-emerald-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Set this room as the default for the live dashboard"
                      >
                        {defaultRoomId === room.id
                          ? 'Default Room'
                          : updatingDefaultRoomId === room.id
                          ? 'Setting...'
                          : 'Set Default'}
                      </button>
                      {room.deviceId && room.profileId && (
                        <button
                          onClick={() => handleStartSync(room)}
                          className="rounded-lg border border-cyan-600/50 bg-cyan-600/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition-all hover:bg-cyan-600/20"
                          title="Re-discover and sync entity mappings"
                        >
                          🔄 Re-sync Entities
                        </button>
                      )}
                      {room.deviceId && (
                        <button
                          onClick={() => handleUnlinkDevice(room)}
                          disabled={unlinkingDeviceRoomId === room.id}
                          className="rounded-lg border border-amber-600/50 bg-amber-600/10 px-4 py-2 text-sm font-semibold text-amber-100 transition-all hover:bg-amber-600/20 disabled:opacity-50"
                          title="Remove device from room while preserving room geometry and furniture"
                        >
                          {unlinkingDeviceRoomId === room.id ? 'Unlinking...' : '🔗 Unlink Device'}
                        </button>
                      )}
                      <button
                        onClick={() => handleExportRoom(room)}
                        className="rounded-lg border border-emerald-600/50 bg-emerald-600/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition-all hover:bg-emerald-600/20"
                        title="Export room configuration to JSON file"
                      >
                        📥 Export
                      </button>
                      <button
                        onClick={() => handleDeleteRoom(room.id, room.name)}
                        disabled={deletingRoomId === room.id}
                        className="rounded-lg border border-rose-600 bg-rose-600/10 px-4 py-2 text-sm font-semibold text-rose-100 transition-all hover:bg-rose-600/20 disabled:opacity-50"
                      >
                        {deletingRoomId === room.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
              </div>

                {/* Zone Backups Section */}
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Zone Backups</h2>
                  <p className="text-sm text-slate-400">
                    Back up rectangular zones and restore them as polygons after firmware updates.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleImportBackups}
                    disabled={importingBackups}
                    className="rounded-lg border border-blue-600/50 bg-blue-600/10 px-4 py-2 text-sm font-semibold text-blue-100 transition-all hover:bg-blue-600/20 disabled:opacity-50"
                    title="Import zone backups from JSON file"
                  >
                    {importingBackups ? 'Importing...' : 'Import'}
                  </button>
                  <button
                    onClick={handleDownloadAllBackups}
                    disabled={zoneBackups.length === 0}
                    className="rounded-lg border border-emerald-600/50 bg-emerald-600/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition-all hover:bg-emerald-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Download all backups for the selected device"
                  >
                    Download All
                  </button>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-300">Device</label>
                  <select
                    value={selectedBackupDeviceId}
                    onChange={(e) => setSelectedBackupDeviceId(e.target.value)}
                    className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                  >
                    <option value="">Select a device</option>
                    {devices.map((device) => (
                      <option key={device.id} value={device.id}>
                        {device.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">Only Everything Presence devices are listed.</p>
                </div>
                <div className="rounded-lg border border-slate-700/60 bg-slate-800/40 p-3 text-xs text-slate-300">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Profile</span>
                    <span>{selectedBackupProfile?.label ?? 'Unknown'}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-slate-500">Firmware</span>
                    <span>{backupMapping?.firmwareVersion ?? selectedBackupDevice?.firmwareVersion ?? 'Unknown'}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-slate-500">Entity mappings</span>
                    <span className={backupMapping ? 'text-emerald-300' : 'text-amber-300'}>
                      {backupMapping ? 'Synced' : 'Missing'}
                    </span>
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500">
                    Backups read rectangular zones from the device. Restores convert them to polygons.
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={handleCreateZoneBackup}
                  disabled={creatingBackup || !selectedBackupDeviceId}
                  className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {creatingBackup ? 'Backing up...' : 'Create Backup'}
                </button>
                <button
                  onClick={() => selectedBackupDeviceId && reloadZoneBackups(selectedBackupDeviceId)}
                  disabled={!selectedBackupDeviceId || loadingBackups}
                  className="rounded-lg border border-slate-600/70 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 transition-all hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loadingBackups ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {!selectedBackupDeviceId && (
                  <div className="rounded-lg border border-slate-700/60 bg-slate-800/40 p-4 text-sm text-slate-400">
                    Select a device to view available backups.
                  </div>
                )}

                {selectedBackupDeviceId && loadingBackups && (
                  <div className="rounded-lg border border-slate-700/60 bg-slate-800/40 p-4 text-sm text-slate-400">
                    Loading backups...
                  </div>
                )}

                {selectedBackupDeviceId && !loadingBackups && zoneBackups.length === 0 && (
                  <div className="rounded-lg border border-slate-700/60 bg-slate-800/40 p-4 text-sm text-slate-400">
                    No backups yet. Create one before updating firmware.
                  </div>
                )}

                {selectedBackupDeviceId && !loadingBackups && zoneBackups.length > 0 && (
                  <div className="space-y-3">
                    {zoneBackups.map((backup) => {
                      const counts = summarizeZones(backup.zones);
                      const labelCount = Object.keys(backup.zoneLabels ?? {}).length;
                      return (
                        <div
                          key={backup.id}
                          className="rounded-lg border border-slate-700/50 bg-slate-800/50 p-4"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-sm font-semibold text-slate-100">
                                {new Date(backup.createdAt).toLocaleString()}
                              </div>
                              <div className="text-xs text-slate-400">
                                Source: {backup.source}{backup.firmwareVersion ? ` · v${backup.firmwareVersion}` : ''}
                              </div>
                            </div>
                            {labelCount > 0 && (
                              <span className="rounded-full border border-slate-600/60 bg-slate-700/50 px-2 py-0.5 text-[10px] text-slate-200">
                                {labelCount} label{labelCount === 1 ? '' : 's'}
                              </span>
                            )}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
                            <span>{counts.regular} zone{counts.regular === 1 ? '' : 's'}</span>
                            <span>· {counts.exclusion} exclusion</span>
                            <span>· {counts.entry} entry</span>
                            <span>· {backup.zones.length} total</span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              onClick={() => handleRestoreZoneBackup(backup)}
                              disabled={restoringBackupId === backup.id}
                              className="rounded-lg bg-emerald-600/20 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition-all hover:bg-emerald-600/30 disabled:opacity-50"
                            >
                              {restoringBackupId === backup.id ? 'Restoring...' : 'Restore as Polygon'}
                            </button>
                            <button
                              onClick={() => handleDownloadBackup(backup)}
                              className="rounded-lg border border-slate-600/70 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-all hover:bg-slate-700"
                            >
                              Download
                            </button>
                            <button
                              onClick={() => handleDeleteZoneBackup(backup.id)}
                              disabled={deletingBackupId === backup.id}
                              className="rounded-lg border border-rose-600/50 bg-rose-600/10 px-3 py-1.5 text-xs font-semibold text-rose-100 transition-all hover:bg-rose-600/20 disabled:opacity-50"
                            >
                              {deletingBackupId === backup.id ? 'Deleting...' : 'Delete'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

                {/* Custom Floor Materials Section */}
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Custom Floor Materials</h2>
                <button
                  onClick={() => setShowFloorForm(!showFloorForm)}
                  className="rounded-lg border border-cyan-600/50 bg-cyan-600/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition-all hover:bg-cyan-600/20"
                >
                  {showFloorForm ? 'Cancel' : '+ Add Floor'}
                </button>
              </div>

              {showFloorForm && (
                <div className="mb-4 rounded-lg border border-slate-600/50 bg-slate-800/50 p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Name</label>
                      <input
                        type="text"
                        value={floorLabel}
                        onChange={(e) => setFloorLabel(e.target.value)}
                        placeholder="e.g., Marble White"
                        className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Emoji</label>
                      <input
                        type="text"
                        value={floorEmoji}
                        onChange={(e) => setFloorEmoji(e.target.value)}
                        className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Color</label>
                      <div className="flex gap-2">
                        <input
                          type="color"
                          value={floorColor}
                          onChange={(e) => setFloorColor(e.target.value)}
                          className="h-10 w-14 cursor-pointer rounded border border-slate-600"
                        />
                        <input
                          type="text"
                          value={floorColor}
                          onChange={(e) => setFloorColor(e.target.value)}
                          className="flex-1 rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Category</label>
                      <select
                        value={floorCategory}
                        onChange={(e) => setFloorCategory(e.target.value as typeof floorCategory)}
                        className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      >
                        <option value="wood">Wood</option>
                        <option value="carpet">Carpet</option>
                        <option value="hard">Hard Floor</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Pattern</label>
                      <select
                        value={floorPattern}
                        onChange={(e) => setFloorPattern(e.target.value as typeof floorPattern)}
                        className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      >
                        <option value="solid">Solid</option>
                        <option value="stripes">Stripes</option>
                        <option value="checker">Checker</option>
                        <option value="dots">Dots</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      onClick={handleCreateFloor}
                      className="rounded-lg bg-cyan-600 px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-cyan-500"
                    >
                      Create Floor
                    </button>
                  </div>
                </div>
              )}

              {customFloors.length === 0 ? (
                <div className="py-6 text-center text-slate-400">
                  No custom floor materials. Add your own to use in the Room Builder.
                </div>
              ) : (
                <div className="space-y-2">
                  {customFloors.map((floor) => (
                    <div
                      key={floor.id}
                      className="flex items-center justify-between rounded-lg border border-slate-700/50 bg-slate-800/50 p-3"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="h-8 w-8 rounded"
                          style={{ backgroundColor: floor.color }}
                        />
                        <div>
                          <div className="font-medium text-white">
                            {floor.emoji} {floor.label}
                          </div>
                          <div className="text-xs text-slate-400">
                            {floor.category} · {floor.patternType}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteFloor(floor.id, floor.label)}
                        className="rounded-lg border border-rose-600/50 bg-rose-600/10 px-3 py-1.5 text-xs font-semibold text-rose-100 transition-all hover:bg-rose-600/20"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Custom Furniture Types Section */}
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Custom Furniture Types</h2>
                <button
                  onClick={() => setShowFurnitureForm(!showFurnitureForm)}
                  className="rounded-lg border border-amber-600/50 bg-amber-600/10 px-4 py-2 text-sm font-semibold text-amber-100 transition-all hover:bg-amber-600/20"
                >
                  {showFurnitureForm ? 'Cancel' : '+ Add Furniture'}
                </button>
              </div>

              {showFurnitureForm && (
                <div className="mb-4 rounded-lg border border-slate-600/50 bg-slate-800/50 p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Name</label>
                      <input
                        type="text"
                        value={furnitureLabel}
                        onChange={(e) => setFurnitureLabel(e.target.value)}
                        placeholder="e.g., Bookshelf"
                        className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Category</label>
                      <select
                        value={furnitureCategory}
                        onChange={(e) => setFurnitureCategory(e.target.value as typeof furnitureCategory)}
                        className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      >
                        <option value="all">All Rooms</option>
                        <option value="bedroom">Bedroom</option>
                        <option value="living-room">Living Room</option>
                        <option value="office">Office</option>
                        <option value="dining">Dining</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Width (mm)</label>
                      <input
                        type="number"
                        value={furnitureWidth}
                        onChange={(e) => setFurnitureWidth(Number(e.target.value))}
                        min={100}
                        max={10000}
                        className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Depth (mm)</label>
                      <input
                        type="number"
                        value={furnitureDepth}
                        onChange={(e) => setFurnitureDepth(Number(e.target.value))}
                        min={100}
                        max={10000}
                        className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Height (mm)</label>
                      <input
                        type="number"
                        value={furnitureHeight}
                        onChange={(e) => setFurnitureHeight(Number(e.target.value))}
                        min={100}
                        max={5000}
                        className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Shape</label>
                      <select
                        value={furnitureShape}
                        onChange={(e) => setFurnitureShape(e.target.value as typeof furnitureShape)}
                        className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      >
                        <option value="rectangle">Rectangle</option>
                        <option value="rounded">Rounded</option>
                        <option value="circle">Circle</option>
                        <option value="lshaped">L-Shaped</option>
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-slate-300 mb-1">Color</label>
                      <div className="flex gap-2">
                        <input
                          type="color"
                          value={furnitureColor}
                          onChange={(e) => setFurnitureColor(e.target.value)}
                          className="h-10 w-14 cursor-pointer rounded border border-slate-600"
                        />
                        <input
                          type="text"
                          value={furnitureColor}
                          onChange={(e) => setFurnitureColor(e.target.value)}
                          className="flex-1 rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      onClick={handleCreateFurniture}
                      className="rounded-lg bg-amber-600 px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-amber-500"
                    >
                      Create Furniture
                    </button>
                  </div>
                </div>
              )}

              {customFurniture.length === 0 ? (
                <div className="py-6 text-center text-slate-400">
                  No custom furniture types. Add your own to use in the Room Builder.
                </div>
              ) : (
                <div className="space-y-2">
                  {customFurniture.map((furniture) => (
                    <div
                      key={furniture.id}
                      className="flex items-center justify-between rounded-lg border border-slate-700/50 bg-slate-800/50 p-3"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="h-8 w-8 rounded flex items-center justify-center"
                          style={{ backgroundColor: furniture.color }}
                        >
                          <span className="text-white text-xs font-bold">
                            {furniture.shape === 'circle' ? '●' : furniture.shape === 'lshaped' ? 'L' : '■'}
                          </span>
                        </div>
                        <div>
                          <div className="font-medium text-white">{furniture.label}</div>
                          <div className="text-xs text-slate-400">
                            {furniture.category} · {furniture.defaultWidth}×{furniture.defaultDepth}mm · {furniture.shape}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteFurniture(furniture.id, furniture.label)}
                        className="rounded-lg border border-rose-600/50 bg-rose-600/10 px-3 py-1.5 text-xs font-semibold text-rose-100 transition-all hover:bg-rose-600/20"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
              </div>
            )}

            {/* Firmware Tab */}
            {activeTab === 'firmware' && (
              <div className="space-y-6">
                <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-6">
                  <h2 className="mb-4 text-lg font-semibold text-white">Firmware Updates</h2>
                  <p className="mb-4 text-sm text-slate-400">
                    Update your Everything Presence devices with firmware downloaded through this local proxy.
                    This helps ESP devices that have trouble with HTTPS due to memory constraints.
                  </p>
                  <FirmwareUpdateSection
                    onError={(err) => setError(err)}
                    onSuccess={(msg) => {
                      setSuccess(msg);
                      setTimeout(() => setSuccess(null), 5000);
                    }}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Entity Re-sync Modal */}
      {isSyncing && syncingRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-2xl h-[85vh] max-h-[700px] rounded-xl shadow-2xl flex flex-col bg-slate-900 overflow-hidden">
            <EntityDiscovery
              deviceId={syncingRoom.deviceId!}
              profileId={syncingRoom.profileId!}
              deviceName={syncingRoom.entityNamePrefix || syncingRoom.name}
              onComplete={handleSyncComplete}
              onCancel={handleSyncCancel}
            />
          </div>
        </div>
      )}
    </div>
  );
};


