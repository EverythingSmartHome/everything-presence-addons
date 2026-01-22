import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../logger';
import { EntityRegistryEntry, HaWsMessage } from './types';
import {
  IHaReadTransport,
  ReadTransportConfig,
  EntityState,
  DeviceRegistryEntry,
  AreaRegistryEntry,
  StateChangeCallback,
  HaTarget,
} from './readTransport';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

interface Subscription {
  id: string;
  entityIds: Set<string>; // Empty = all entities
  callback: StateChangeCallback;
}

/**
 * WebSocket-based read transport for Home Assistant.
 *
 * Provides real-time state updates and efficient bulk queries
 * via the Home Assistant WebSocket API.
 */
export class WsReadTransport implements IHaReadTransport {
  readonly activeTransport = 'websocket' as const;

  private readonly config: ReadTransportConfig;
  private socket?: WebSocket;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private subscriptions = new Map<string, Subscription>();
  private readyPromise: Promise<void>;
  private setReady!: () => void;
  private rejectReady!: (reason?: unknown) => void;
  private _isConnected = false;
  private stateSubscriptionActive = false;
  private reconnectTimeout?: NodeJS.Timeout;

  constructor(config: ReadTransportConfig) {
    this.config = config;
    this.readyPromise = this.createReadyPromise();
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  private createReadyPromise(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.setReady = resolve;
      this.rejectReady = reject;
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Connection Management
  // ─────────────────────────────────────────────────────────────────

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Build WebSocket URL from base URL
      // HA WebSocket is at /api/websocket, so we keep /api in the path
      const base = this.config.baseUrl.replace(/\/api\/?$/, '');
      const wsBase = base.replace(/^http/, 'ws');
      const url = `${wsBase}/api/websocket`;

      logger.info({ url }, 'WsReadTransport: Connecting to HA WebSocket');

      this.socket = new WebSocket(url);

      const connectionTimeout = setTimeout(() => {
        if (!this._isConnected) {
          logger.error('WsReadTransport: Connection timeout');
          this.socket?.close();
          reject(new Error('WebSocket connection timeout'));
        }
      }, 10000);

      this.socket.on('open', () => {
        logger.info('WsReadTransport: WebSocket opened, awaiting auth_required');
      });

      this.socket.on('message', (raw: WebSocket.Data) => {
        let parsed: HaWsMessage;
        try {
          parsed = JSON.parse(raw.toString());
        } catch (err) {
          logger.warn({ err, raw: raw.toString() }, 'WsReadTransport: Failed to parse message');
          return;
        }

        if (parsed.type === 'auth_required') {
          logger.debug('WsReadTransport: Sending auth token');
          this.sendRaw({ type: 'auth', access_token: this.config.token });
          return;
        }

        if (parsed.type === 'auth_invalid') {
          const msg = (parsed as any).message || 'Unknown auth error';
          logger.error({ reason: msg }, 'WsReadTransport: Auth invalid');
          clearTimeout(connectionTimeout);
          this.socket?.close();
          this.rejectReady(new Error(`Auth invalid: ${msg}`));
          reject(new Error(`Auth invalid: ${msg}`));
          return;
        }

        if (parsed.type === 'auth_ok') {
          logger.info('WsReadTransport: Authenticated successfully');
          clearTimeout(connectionTimeout);
          this._isConnected = true;
          this.setReady();
          resolve();
          if (this.subscriptions.size > 0) {
            void this.activateStateSubscription();
          }
          return;
        }

        // Handle pending request responses
        if ('id' in parsed && this.pending.has(parsed.id)) {
          const pending = this.pending.get(parsed.id);
          if (pending) {
            pending.resolve(parsed);
            this.pending.delete(parsed.id);
          }
          return;
        }

        // Handle state_changed events for subscriptions
        if (parsed.type === 'event' && (parsed as any).event?.event_type === 'state_changed') {
          this.handleStateChanged((parsed as any).event.data);
        }
      });

      this.socket.on('error', (err) => {
        logger.error({ err }, 'WsReadTransport: WebSocket error');
        if (!this._isConnected) {
          clearTimeout(connectionTimeout);
          reject(err);
        }
      });

      this.socket.on('close', (code, reason) => {
        logger.warn({ code, reason: reason.toString() }, 'WsReadTransport: WebSocket closed');
        this._isConnected = false;
        this.stateSubscriptionActive = false;
        this.pending.forEach((p) => p.reject(new Error('WebSocket connection closed')));
        this.pending.clear();

        // Reset ready promise for reconnect
        this.readyPromise = this.createReadyPromise();

        // Auto-reconnect after 5 seconds
        this.reconnectTimeout = setTimeout(() => {
          logger.info('WsReadTransport: Attempting reconnect');
          this.connect().catch((err) => {
            logger.error({ err }, 'WsReadTransport: Reconnect failed');
          });
        }, 5000);
      });
    });
  }

  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = undefined;
    }
    this._isConnected = false;
    this.stateSubscriptionActive = false;
  }

  async waitUntilReady(): Promise<void> {
    return this.readyPromise;
  }

  // ─────────────────────────────────────────────────────────────────
  // Discovery
  // ─────────────────────────────────────────────────────────────────

  async listDevices(): Promise<DeviceRegistryEntry[]> {
    const response = (await this.call({
      type: 'config/device_registry/list',
    })) as HaWsMessage & { result?: DeviceRegistryEntry[] };

    if (response.type === 'result' && (response as any).success) {
      return (response as any).result ?? [];
    }

    logger.warn({ response }, 'WsReadTransport: Unexpected response when listing devices');
    return [];
  }

  async listEntityRegistry(): Promise<EntityRegistryEntry[]> {
    const response = (await this.call({
      type: 'config/entity_registry/list',
    })) as HaWsMessage & { result?: EntityRegistryEntry[] };

    if (response.type === 'result' && (response as any).success) {
      return (response as any).result ?? [];
    }

    logger.warn({ response }, 'WsReadTransport: Unexpected response when listing entities');
    return [];
  }

  async listAreaRegistry(): Promise<AreaRegistryEntry[]> {
    const response = (await this.call({
      type: 'config/area_registry/list',
    })) as HaWsMessage & { result?: AreaRegistryEntry[] };

    if (response.type === 'result' && (response as any).success) {
      return (response as any).result ?? [];
    }

    logger.warn({ response }, 'WsReadTransport: Unexpected response when listing areas');
    return [];
  }

  async getServicesForTarget(target: HaTarget, expandGroup: boolean = true): Promise<string[]> {
    const response = (await this.call({
      type: 'get_services_for_target',
      target,
      expand_group: expandGroup,
    })) as HaWsMessage & { result?: string[] };

    if (response.type === 'result' && (response as any).success) {
      return (response as any).result ?? [];
    }

    logger.warn({ response }, 'WsReadTransport: Unexpected response when listing services for target');
    return [];
  }

  async getServicesByDomain(domain: string): Promise<string[]> {
    const response = (await this.call({
      type: 'get_services',
    })) as HaWsMessage & { result?: Record<string, Record<string, unknown>> };

    if (response.type === 'result' && (response as any).success) {
      const allServices = (response as any).result ?? {};
      const domainServices: string[] = [];

      if (allServices[domain]) {
        for (const serviceName of Object.keys(allServices[domain])) {
          domainServices.push(`${domain}.${serviceName}`);
        }
      }

      return domainServices.sort();
    }

    logger.warn({ response, domain }, 'WsReadTransport: Unexpected response when listing services');
    return [];
  }

  // ─────────────────────────────────────────────────────────────────
  // State Queries
  // ─────────────────────────────────────────────────────────────────

  async getState(entityId: string): Promise<EntityState | null> {
    const states = await this.getStates([entityId]);
    return states.get(entityId) ?? null;
  }

  async getStates(entityIds: string[]): Promise<Map<string, EntityState>> {
    const allStates = await this.getAllStates();
    const result = new Map<string, EntityState>();

    const entityIdSet = new Set(entityIds);
    for (const state of allStates) {
      if (entityIdSet.has(state.entity_id)) {
        result.set(state.entity_id, state);
      }
    }

    return result;
  }

  async getAllStates(): Promise<EntityState[]> {
    const response = (await this.call({
      type: 'get_states',
    })) as HaWsMessage & { result?: EntityState[] };

    if (response.type === 'result' && (response as any).success) {
      return (response as any).result ?? [];
    }

    logger.warn({ response }, 'WsReadTransport: Unexpected response when getting states');
    return [];
  }

  // ─────────────────────────────────────────────────────────────────
  // Real-time Subscriptions
  // ─────────────────────────────────────────────────────────────────

  subscribeToStateChanges(entityIds: string[], callback: StateChangeCallback): string {
    const subscriptionId = uuidv4();

    this.subscriptions.set(subscriptionId, {
      id: subscriptionId,
      entityIds: new Set(entityIds),
      callback,
    });

    // Ensure we're subscribed to state_changed events
    if (!this.stateSubscriptionActive) {
      this.activateStateSubscription();
    }

    logger.debug(
      { subscriptionId, entityCount: entityIds.length },
      'WsReadTransport: Created state subscription'
    );

    return subscriptionId;
  }

  unsubscribe(subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId);
    logger.debug({ subscriptionId }, 'WsReadTransport: Removed state subscription');
  }

  unsubscribeAll(): void {
    this.subscriptions.clear();
    logger.debug('WsReadTransport: Removed all state subscriptions');
  }

  private async activateStateSubscription(): Promise<void> {
    if (this.stateSubscriptionActive) return;

    try {
      await this.waitUntilReady();
      await this.call({
        type: 'subscribe_events',
        event_type: 'state_changed',
      });
      this.stateSubscriptionActive = true;
      logger.info('WsReadTransport: Subscribed to state_changed events');
    } catch (err) {
      logger.error({ err }, 'WsReadTransport: Failed to subscribe to state_changed');
    }
  }

  private handleStateChanged(data: {
    entity_id: string;
    old_state: EntityState | null;
    new_state: EntityState | null;
  }): void {
    const { entity_id, old_state, new_state } = data;

    for (const subscription of this.subscriptions.values()) {
      // If entityIds is empty, subscribe to all; otherwise check if entity is in set
      if (subscription.entityIds.size === 0 || subscription.entityIds.has(entity_id)) {
        try {
          subscription.callback(entity_id, new_state, old_state);
        } catch (err) {
          logger.error({ err, subscriptionId: subscription.id }, 'WsReadTransport: Subscription callback error');
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Internal Helpers
  // ─────────────────────────────────────────────────────────────────

  private sendRaw(payload: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      logger.warn('WsReadTransport: Socket not open, dropping message');
      return;
    }
    this.socket.send(JSON.stringify(payload));
  }

  private async call(command: Record<string, unknown>): Promise<unknown> {
    await this.waitUntilReady();
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.sendRaw({ id, ...command });

      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('WS request timed out'));
        }
      }, 10000);
    });
  }
}
