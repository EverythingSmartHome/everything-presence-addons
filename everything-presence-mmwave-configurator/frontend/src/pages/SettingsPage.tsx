import React, { useState, useEffect } from 'react';
import { fetchRooms, deleteRoom, updateRoom } from '../api/rooms';
import {
  fetchCustomFloors,
  createCustomFloor,
  deleteCustomFloor,
  fetchCustomFurniture,
  createCustomFurniture,
  deleteCustomFurniture,
} from '../api/client';
import { RoomConfig, CustomFloorMaterial, CustomFurnitureType, EntityMappings } from '../api/types';
import { EntityDiscovery } from '../components/EntityDiscovery';

interface SettingsPageProps {
  onBack?: () => void;
  onRoomDeleted?: (roomId: string) => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ onBack, onRoomDeleted }) => {
  const [rooms, setRooms] = useState<RoomConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deletingRoomId, setDeletingRoomId] = useState<string | null>(null);
  const [syncingRoom, setSyncingRoom] = useState<RoomConfig | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

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
        const [roomsRes, floorsRes, furnitureRes] = await Promise.all([
          fetchRooms(),
          fetchCustomFloors(),
          fetchCustomFurniture(),
        ]);
        setRooms(roomsRes.rooms);
        setCustomFloors(floorsRes.floors);
        setCustomFurniture(furnitureRes.furniture);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleDeleteRoom = async (roomId: string, roomName: string) => {
    if (!confirm(`Are you sure you want to delete the room "${roomName}"? This action cannot be undone.`)) {
      return;
    }

    setDeletingRoomId(roomId);
    try {
      await deleteRoom(roomId);
      setRooms((prev) => prev.filter((r) => r.id !== roomId));
      onRoomDeleted?.(roomId);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete room');
    } finally {
      setDeletingRoomId(null);
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
            fetch('/api/rooms', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(newRoom),
            }).then((response) => {
              if (!response.ok) {
                throw new Error(`Failed to import room: ${newRoom.name}`);
              }
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
          <div className="flex items-center justify-center py-12">
            <div className="text-slate-400">Loading...</div>
          </div>
        ) : (
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
                      <div className="font-semibold text-white">{room.name}</div>
                      <div className="text-sm text-slate-400">
                        {room.zones?.length || 0} zones configured
                        {room.deviceId && <span className="ml-2">· Device linked</span>}
                        {room.furniture && room.furniture.length > 0 && (
                          <span className="ml-2">· {room.furniture.length} furniture items</span>
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
                      {room.deviceId && room.profileId && (
                        <button
                          onClick={() => handleStartSync(room)}
                          className="rounded-lg border border-cyan-600/50 bg-cyan-600/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition-all hover:bg-cyan-600/20"
                          title="Re-discover and sync entity mappings"
                        >
                          🔄 Re-sync Entities
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
