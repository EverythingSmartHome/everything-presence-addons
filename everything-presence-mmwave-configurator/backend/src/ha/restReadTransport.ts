import { v4 as uuidv4 } from 'uuid';
import { logger } from '../logger';
import { EntityRegistryEntry } from './types';
import {
  IHaReadTransport,
  ReadTransportConfig,
  EntityState,
  DeviceRegistryEntry,
  AreaRegistryEntry,
  StateChangeCallback,
  HaTarget,
} from './readTransport';

interface Subscription {
  id: string;
  entityIds: Set<string>;
  callback: StateChangeCallback;
  lastStates: Map<string, EntityState>;
}

/**
 * REST-based read transport for Home Assistant.
 *
 * Provides polling-based state updates as a fallback when
 * WebSocket is unavailable. Less efficient than WS but works
 * in more environments.
 */
export class RestReadTransport implements IHaReadTransport {
  readonly activeTransport = 'rest' as const;

  private readonly config: ReadTransportConfig;
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly pollingInterval: number;

  private subscriptions = new Map<string, Subscription>();
  private pollingTimer?: NodeJS.Timeout;
  private _isConnected = false;

  constructor(config: ReadTransportConfig, pollingInterval: number = 1000) {
    this.config = config;
    this.pollingInterval = pollingInterval;

    // Ensure baseUrl ends with /api for REST calls
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    if (!this.baseUrl.endsWith('/api')) {
      this.baseUrl = this.baseUrl + '/api';
    }
    this.token = config.token;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
    };
  }

  private buildUrl(path: string): string {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return `${this.baseUrl}${normalized}`;
  }

  // ─────────────────────────────────────────────────────────────────
  // Connection Management
  // ─────────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    logger.info('RestReadTransport: Testing connection to HA REST API');

    try {
      // Test connection by fetching API status
      const url = this.buildUrl('/');
      const res = await fetch(url, { headers: this.headers });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`REST API health check failed: ${res.status} - ${text}`);
      }

      this._isConnected = true;
      logger.info('RestReadTransport: Connected to HA REST API');
    } catch (err) {
      logger.error({ err }, 'RestReadTransport: Failed to connect');
      throw err;
    }
  }

  disconnect(): void {
    this.stopPolling();
    this._isConnected = false;
    logger.info('RestReadTransport: Disconnected');
  }

  async waitUntilReady(): Promise<void> {
    if (!this._isConnected) {
      await this.connect();
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Discovery
  // ─────────────────────────────────────────────────────────────────

  async listDevices(): Promise<DeviceRegistryEntry[]> {
    try {
      // Try the direct device registry endpoint (Supervisor proxy)
      const url = this.buildUrl('/config/device_registry');
      const res = await fetch(url, { headers: this.headers });

      if (res.ok) {
        return (await res.json()) as DeviceRegistryEntry[];
      }

      // Fallback: Use template API to query device registry
      logger.info('RestReadTransport: Using template fallback for device discovery');
      return await this.listDevicesViaTemplate();
    } catch (err) {
      logger.error({ err }, 'RestReadTransport: Failed to list devices');
      return [];
    }
  }

  /**
   * Fallback: Query device registry via HA template API.
   * This works when the device_registry endpoint isn't directly accessible.
   */
  private async listDevicesViaTemplate(): Promise<DeviceRegistryEntry[]> {
    // Jinja2 template that iterates through all states and collects unique device info
    const template = `
{% set devices = namespace(list=[]) %}
{% set seen = namespace(ids=[]) %}
{% for state in states %}
  {% set dev_id = device_id(state.entity_id) %}
  {% if dev_id and dev_id not in seen.ids %}
    {% set seen.ids = seen.ids + [dev_id] %}
    {% set dev_identifiers = device_attr(dev_id, 'identifiers') %}
    {% set dev_connections = device_attr(dev_id, 'connections') %}
    {% set dev_config_entries = device_attr(dev_id, 'config_entries') %}
    {% set devices.list = devices.list + [{
      'id': dev_id,
      'name': device_attr(dev_id, 'name'),
      'manufacturer': device_attr(dev_id, 'manufacturer'),
      'model': device_attr(dev_id, 'model'),
      'sw_version': device_attr(dev_id, 'sw_version'),
      'hw_version': device_attr(dev_id, 'hw_version'),
      'identifiers': dev_identifiers | list if dev_identifiers else [],
      'config_entries': dev_config_entries | list if dev_config_entries else [],
      'connections': dev_connections | list if dev_connections else [],
      'area_id': device_attr(dev_id, 'area_id'),
      'name_by_user': device_attr(dev_id, 'name_by_user')
    }] %}
  {% endif %}
{% endfor %}
{{ devices.list | tojson }}`.trim();

    try {
      const url = this.buildUrl('/template');
      const res = await fetch(url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ template }),
      });

      if (!res.ok) {
        const text = await res.text();
        logger.warn({ status: res.status, text }, 'RestReadTransport: Template API failed');
        return [];
      }

      const resultText = await res.text();
      const devices = JSON.parse(resultText) as DeviceRegistryEntry[];
      logger.info({ count: devices.length }, 'RestReadTransport: Discovered devices via template');
      return devices;
    } catch (err) {
      logger.error({ err }, 'RestReadTransport: Template-based device discovery failed');
      return [];
    }
  }

  async listEntityRegistry(): Promise<EntityRegistryEntry[]> {
    try {
      const url = this.buildUrl('/config/entity_registry');
      const res = await fetch(url, { headers: this.headers });

      if (res.ok) {
        return (await res.json()) as EntityRegistryEntry[];
      }

      // Fallback: Use template API to query entity registry
      logger.info('RestReadTransport: Using template fallback for entity registry');
      return await this.listEntityRegistryViaTemplate();
    } catch (err) {
      logger.error({ err }, 'RestReadTransport: Failed to list entity registry');
      return [];
    }
  }

  /**
   * Fallback: Query entity registry via HA template API.
   * Note: This provides limited info compared to the full registry endpoint.
   * It focuses on the fields needed for zone availability checking.
   */
  private async listEntityRegistryViaTemplate(): Promise<EntityRegistryEntry[]> {
    // Jinja2 template that collects entity info from states
    // Note: disabled_by isn't directly available via template, but we can infer
    // unavailable entities from state
    const template = `
{% set entities = namespace(list=[]) %}
{% for state in states %}
  {% set entities.list = entities.list + [{
    'entity_id': state.entity_id,
    'disabled_by': none,
    'hidden_by': none,
    'platform': state.attributes.get('platform', ''),
    'device_id': device_id(state.entity_id)
  }] %}
{% endfor %}
{{ entities.list | tojson }}`.trim();

    try {
      const url = this.buildUrl('/template');
      const res = await fetch(url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ template }),
      });

      if (!res.ok) {
        const text = await res.text();
        logger.warn({ status: res.status, text }, 'RestReadTransport: Template API failed for entity registry');
        return [];
      }

      const resultText = await res.text();
      const entities = JSON.parse(resultText) as EntityRegistryEntry[];
      logger.info({ count: entities.length }, 'RestReadTransport: Got entity registry via template');
      return entities;
    } catch (err) {
      logger.error({ err }, 'RestReadTransport: Template-based entity registry failed');
      return [];
    }
  }

  async listAreaRegistry(): Promise<AreaRegistryEntry[]> {
    try {
      const url = this.buildUrl('/config/area_registry');
      const res = await fetch(url, { headers: this.headers });

      if (res.ok) {
        return (await res.json()) as AreaRegistryEntry[];
      }

      // Fallback: Use template API to query area registry
      logger.info('RestReadTransport: Using template fallback for area registry');
      return await this.listAreaRegistryViaTemplate();
    } catch (err) {
      logger.error({ err }, 'RestReadTransport: Failed to list area registry');
      return [];
    }
  }

  async getServicesForTarget(_target: HaTarget, _expandGroup: boolean = true): Promise<string[]> {
    logger.debug('RestReadTransport: getServicesForTarget not supported, returning empty list');
    return [];
  }

  /**
   * Fallback: Query area registry via HA template API.
   */
  private async listAreaRegistryViaTemplate(): Promise<AreaRegistryEntry[]> {
    const template = `
{% set areas = namespace(list=[]) %}
{% for area in areas() %}
  {% set areas.list = areas.list + [{
    'area_id': area,
    'name': area_name(area),
    'picture': none,
    'aliases': [],
    'floor_id': none,
    'icon': none,
    'labels': []
  }] %}
{% endfor %}
{{ areas.list | tojson }}`.trim();

    try {
      const url = this.buildUrl('/template');
      const res = await fetch(url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ template }),
      });

      if (!res.ok) {
        const text = await res.text();
        logger.warn({ status: res.status, text }, 'RestReadTransport: Template API failed for area registry');
        return [];
      }

      const resultText = await res.text();
      const areas = JSON.parse(resultText) as AreaRegistryEntry[];
      logger.info({ count: areas.length }, 'RestReadTransport: Got area registry via template');
      return areas;
    } catch (err) {
      logger.error({ err }, 'RestReadTransport: Template-based area registry failed');
      return [];
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // State Queries
  // ─────────────────────────────────────────────────────────────────

  async getState(entityId: string): Promise<EntityState | null> {
    try {
      const url = this.buildUrl(`/states/${entityId}`);
      const res = await fetch(url, { headers: this.headers });

      if (!res.ok) {
        if (res.status === 404) {
          return null;
        }
        const text = await res.text();
        throw new Error(`Failed to get state: ${res.status} - ${text}`);
      }

      return (await res.json()) as EntityState;
    } catch (err) {
      logger.warn({ err, entityId }, 'RestReadTransport: Failed to get entity state');
      return null;
    }
  }

  async getStates(entityIds: string[]): Promise<Map<string, EntityState>> {
    const result = new Map<string, EntityState>();

    // Fetch all states and filter (more efficient than individual calls)
    const allStates = await this.getAllStates();
    const entityIdSet = new Set(entityIds);

    for (const state of allStates) {
      if (entityIdSet.has(state.entity_id)) {
        result.set(state.entity_id, state);
      }
    }

    return result;
  }

  async getAllStates(): Promise<EntityState[]> {
    try {
      const url = this.buildUrl('/states');
      const res = await fetch(url, { headers: this.headers });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to get all states: ${res.status} - ${text}`);
      }

      return (await res.json()) as EntityState[];
    } catch (err) {
      logger.error({ err }, 'RestReadTransport: Failed to get all states');
      return [];
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Real-time Subscriptions (via Polling)
  // ─────────────────────────────────────────────────────────────────

  subscribeToStateChanges(entityIds: string[], callback: StateChangeCallback): string {
    const subscriptionId = uuidv4();

    this.subscriptions.set(subscriptionId, {
      id: subscriptionId,
      entityIds: new Set(entityIds),
      callback,
      lastStates: new Map(),
    });

    // Start polling if not already running
    this.startPolling();

    logger.debug(
      { subscriptionId, entityCount: entityIds.length },
      'RestReadTransport: Created state subscription (polling)'
    );

    return subscriptionId;
  }

  unsubscribe(subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId);

    // Stop polling if no more subscriptions
    if (this.subscriptions.size === 0) {
      this.stopPolling();
    }

    logger.debug({ subscriptionId }, 'RestReadTransport: Removed state subscription');
  }

  unsubscribeAll(): void {
    this.subscriptions.clear();
    this.stopPolling();
    logger.debug('RestReadTransport: Removed all state subscriptions');
  }

  private startPolling(): void {
    if (this.pollingTimer) return;

    logger.info({ interval: this.pollingInterval }, 'RestReadTransport: Starting polling');

    this.pollingTimer = setInterval(() => {
      this.pollStates().catch((err) => {
        logger.error({ err }, 'RestReadTransport: Polling error');
      });
    }, this.pollingInterval);

    // Do an immediate poll
    this.pollStates().catch((err) => {
      logger.error({ err }, 'RestReadTransport: Initial poll error');
    });
  }

  private stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
      logger.info('RestReadTransport: Stopped polling');
    }
  }

  private async pollStates(): Promise<void> {
    if (this.subscriptions.size === 0) return;

    // Collect all entity IDs we need to poll
    const allEntityIds = new Set<string>();
    for (const sub of this.subscriptions.values()) {
      if (sub.entityIds.size === 0) {
        // Subscription wants all entities - we'll fetch all states
        allEntityIds.clear();
        break;
      }
      sub.entityIds.forEach((id) => allEntityIds.add(id));
    }

    // Fetch states
    let states: EntityState[];
    if (allEntityIds.size === 0) {
      // At least one subscription wants all entities
      states = await this.getAllStates();
    } else {
      // Fetch specific entities
      const stateMap = await this.getStates(Array.from(allEntityIds));
      states = Array.from(stateMap.values());
    }

    // Build a map for quick lookup
    const stateMap = new Map<string, EntityState>();
    for (const state of states) {
      stateMap.set(state.entity_id, state);
    }

    // Check each subscription for changes
    for (const subscription of this.subscriptions.values()) {
      const relevantStates =
        subscription.entityIds.size === 0
          ? states
          : states.filter((s) => subscription.entityIds.has(s.entity_id));

      for (const newState of relevantStates) {
        const oldState = subscription.lastStates.get(newState.entity_id);

        // Check if state changed
        if (!oldState || this.stateChanged(oldState, newState)) {
          try {
            subscription.callback(newState.entity_id, newState, oldState ?? null);
          } catch (err) {
            logger.error(
              { err, subscriptionId: subscription.id },
              'RestReadTransport: Subscription callback error'
            );
          }
        }

        // Update last known state
        subscription.lastStates.set(newState.entity_id, newState);
      }
    }
  }

  private stateChanged(oldState: EntityState, newState: EntityState): boolean {
    // Compare state value
    if (oldState.state !== newState.state) return true;

    // Compare last_updated timestamp
    if (oldState.last_updated !== newState.last_updated) return true;

    return false;
  }
}
