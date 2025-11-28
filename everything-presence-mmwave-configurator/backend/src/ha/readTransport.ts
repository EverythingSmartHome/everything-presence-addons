import { EntityRegistryEntry } from './types';

/**
 * Entity state as returned by Home Assistant
 */
export interface EntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

/**
 * Device registry entry from Home Assistant
 */
export interface DeviceRegistryEntry {
  id: string;
  name: string | null;
  name_by_user: string | null;
  manufacturer: string | null;
  model: string | null;
  sw_version: string | null;
  hw_version: string | null;
  serial_number: string | null;
  area_id: string | null;
  disabled_by: string | null;
  config_entries: string[];
  identifiers: Array<[string, string]>;
}

/**
 * Callback for state change events
 */
export type StateChangeCallback = (
  entityId: string,
  newState: EntityState | null,
  oldState: EntityState | null
) => void;

/**
 * Interface for reading from Home Assistant.
 * Implementations: WebSocket (real-time) or REST (polling fallback).
 */
export interface IHaReadTransport {
  /**
   * The currently active transport type
   */
  readonly activeTransport: 'websocket' | 'rest';

  /**
   * Whether the transport is currently connected
   */
  readonly isConnected: boolean;

  // ─────────────────────────────────────────────────────────────────
  // Discovery
  // ─────────────────────────────────────────────────────────────────

  /**
   * List all devices from the device registry
   */
  listDevices(): Promise<DeviceRegistryEntry[]>;

  /**
   * List all entities from the entity registry
   */
  listEntityRegistry(): Promise<EntityRegistryEntry[]>;

  // ─────────────────────────────────────────────────────────────────
  // State Queries
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get the current state of a single entity
   */
  getState(entityId: string): Promise<EntityState | null>;

  /**
   * Get the current states of multiple entities (bulk query)
   */
  getStates(entityIds: string[]): Promise<Map<string, EntityState>>;

  /**
   * Get all states (use with caution - can be large)
   */
  getAllStates(): Promise<EntityState[]>;

  // ─────────────────────────────────────────────────────────────────
  // Real-time Subscriptions
  // ─────────────────────────────────────────────────────────────────

  /**
   * Subscribe to state changes for specific entities.
   * For WebSocket: Uses HA's state_changed events
   * For REST: Uses polling
   *
   * @param entityIds - Entity IDs to subscribe to (empty = all)
   * @param callback - Called when state changes
   * @returns Subscription ID for unsubscribing
   */
  subscribeToStateChanges(
    entityIds: string[],
    callback: StateChangeCallback
  ): string;

  /**
   * Unsubscribe from state changes
   */
  unsubscribe(subscriptionId: string): void;

  /**
   * Unsubscribe all subscriptions
   */
  unsubscribeAll(): void;

  // ─────────────────────────────────────────────────────────────────
  // Connection Management
  // ─────────────────────────────────────────────────────────────────

  /**
   * Connect to Home Assistant
   */
  connect(): Promise<void>;

  /**
   * Disconnect from Home Assistant
   */
  disconnect(): void;

  /**
   * Wait until the transport is ready
   */
  waitUntilReady(): Promise<void>;
}

/**
 * Configuration for creating a read transport
 */
export interface ReadTransportConfig {
  baseUrl: string;
  token: string;
  mode: 'supervisor' | 'standalone';
}

/**
 * Options for the transport factory
 */
export interface TransportFactoryOptions {
  /**
   * Timeout for WebSocket connection test (ms)
   * @default 5000
   */
  wsConnectionTimeout?: number;

  /**
   * Whether to prefer WebSocket even if REST is available
   * @default true
   */
  preferWebSocket?: boolean;

  /**
   * Polling interval for REST transport (ms)
   * @default 1000
   */
  restPollingInterval?: number;
}
