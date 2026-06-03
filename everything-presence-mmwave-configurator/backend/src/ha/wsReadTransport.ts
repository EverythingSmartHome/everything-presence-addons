import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../logger';
import { EntityRegistryEntry, HaWsMessage } from './types';
import { RestReadTransport } from './restReadTransport';
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
  haSubscriptionId?: number;
  activationPromise?: Promise<void> | null;
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
  private reconnectTimeout?: NodeJS.Timeout;
  private restFallback?: RestReadTransport;

  constructor(config: ReadTransportConfig) {
    this.config = config;
    this.readyPromise = this.createReadyPromise();
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  private getRestFallback(): RestReadTransport {
    if (!this.restFallback) {
      this.restFallback = new RestReadTransport(this.config);
    }
    return this.restFallback;
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

      this.socket = new WebSocket(url, ...(
        process.env.VERIFY_SSL?.toLowerCase() === 'false'
          ? [{ rejectUnauthorized: false }]
          : []
      ));

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
          this.reactivateSubscriptions();
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

        // Handle subscription events
        if (parsed.type === 'event') {
          this.handleEventMessage(parsed as any);
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
        this.subscriptions.forEach((subscription) => {
          subscription.haSubscriptionId = undefined;
          subscription.activationPromise = null;
        });
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
    this.subscriptions.forEach((subscription) => {
      subscription.haSubscriptionId = undefined;
      subscription.activationPromise = null;
    });
  }

  async waitUntilReady(): Promise<void> {
    return this.readyPromise;
  }

  // ─────────────────────────────────────────────────────────────────
  // Discovery
  // ─────────────────────────────────────────────────────────────────

  async listDevices(): Promise<DeviceRegistryEntry[]> {
    try {
      const response = (await this.call({
        type: 'config/device_registry/list',
      })) as HaWsMessage & { result?: DeviceRegistryEntry[] };

      if (response.type === 'result' && (response as any).success) {
        return (response as any).result ?? [];
      }

      logger.warn({ response }, 'WsReadTransport: Unexpected response when listing devices');
      return [];
    } catch (err) {
      logger.warn({ err }, 'WsReadTransport: listDevices failed, falling back to REST');
      const restTransport = this.getRestFallback();
      await restTransport.waitUntilReady();
      return restTransport.listDevices();
    }
  }

  async listEntityRegistry(): Promise<EntityRegistryEntry[]> {
    try {
      const response = (await this.call({
        type: 'config/entity_registry/list',
      })) as HaWsMessage & { result?: EntityRegistryEntry[] };

      if (response.type === 'result' && (response as any).success) {
        return (response as any).result ?? [];
      }

      logger.warn({ response }, 'WsReadTransport: Unexpected response when listing entities');
      return [];
    } catch (err) {
      logger.warn({ err }, 'WsReadTransport: listEntityRegistry failed, falling back to REST');
      const restTransport = this.getRestFallback();
      await restTransport.waitUntilReady();
      return restTransport.listEntityRegistry();
    }
  }

  async listAreaRegistry(): Promise<AreaRegistryEntry[]> {
    try {
      const response = (await this.call({
        type: 'config/area_registry/list',
      })) as HaWsMessage & { result?: AreaRegistryEntry[] };

      if (response.type === 'result' && (response as any).success) {
        return (response as any).result ?? [];
      }

      logger.warn({ response }, 'WsReadTransport: Unexpected response when listing areas');
      return [];
    } catch (err) {
      logger.warn({ err }, 'WsReadTransport: listAreaRegistry failed, falling back to REST');
      const restTransport = this.getRestFallback();
      await restTransport.waitUntilReady();
      return restTransport.listAreaRegistry();
    }
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
    try {
      const states = await this.getStates([entityId]);
      return states.get(entityId) ?? null;
    } catch (err) {
      logger.warn({ err, entityId }, 'WsReadTransport: getState failed, falling back to REST');
      const restTransport = this.getRestFallback();
      await restTransport.waitUntilReady();
      return restTransport.getState(entityId);
    }
  }

  async getStates(entityIds: string[]): Promise<Map<string, EntityState>> {
    try {
      const allStates = await this.getAllStates();
      const result = new Map<string, EntityState>();

      const entityIdSet = new Set(entityIds);
      for (const state of allStates) {
        if (entityIdSet.has(state.entity_id)) {
          result.set(state.entity_id, state);
        }
      }

      return result;
    } catch (err) {
      logger.warn(
        { err, entityCount: entityIds.length },
        'WsReadTransport: getStates failed, falling back to REST'
      );
      const restTransport = this.getRestFallback();
      await restTransport.waitUntilReady();
      return restTransport.getStates(entityIds);
    }
  }

  async getAllStates(): Promise<EntityState[]> {
    try {
      const response = (await this.call({
        type: 'get_states',
      })) as HaWsMessage & { result?: EntityState[] };

      if (response.type === 'result' && (response as any).success) {
        return (response as any).result ?? [];
      }

      logger.warn({ response }, 'WsReadTransport: Unexpected response when getting states');
      return [];
    } catch (err) {
      logger.warn({ err }, 'WsReadTransport: getAllStates failed, falling back to REST');
      const restTransport = this.getRestFallback();
      await restTransport.waitUntilReady();
      return restTransport.getAllStates();
    }
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
      activationPromise: null,
    });

    const subscription = this.subscriptions.get(subscriptionId);
    if (subscription) {
      void this.activateSubscription(subscription);
    }

    logger.debug(
      { subscriptionId, entityCount: entityIds.length },
      'WsReadTransport: Created state subscription'
    );

    return subscriptionId;
  }

  unsubscribe(subscriptionId: string): void {
    const subscription = this.subscriptions.get(subscriptionId);
    if (subscription?.haSubscriptionId !== undefined) {
      void this.deactivateSubscription(subscription);
    }
    this.subscriptions.delete(subscriptionId);
    logger.debug({ subscriptionId }, 'WsReadTransport: Removed state subscription');
  }

  unsubscribeAll(): void {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.haSubscriptionId !== undefined) {
        void this.deactivateSubscription(subscription);
      }
    }
    this.subscriptions.clear();
    logger.debug('WsReadTransport: Removed all state subscriptions');
  }

  private reactivateSubscriptions(): void {
    for (const subscription of this.subscriptions.values()) {
      void this.activateSubscription(subscription);
    }
  }

  private async activateSubscription(subscription: Subscription): Promise<void> {
    if (subscription.haSubscriptionId !== undefined) return;
    if (subscription.activationPromise) return subscription.activationPromise;

    subscription.activationPromise = (async () => {
      await this.waitUntilReady();
      const response = subscription.entityIds.size === 0
        ? (await this.call({
          type: 'subscribe_events',
          event_type: 'state_changed',
        })) as HaWsMessage & { success?: boolean; id?: number }
        : (await this.call({
          type: 'subscribe_trigger',
          trigger: Array.from(subscription.entityIds).map((entityId) => ({
            platform: 'state',
            entity_id: entityId,
          })),
        })) as HaWsMessage & { success?: boolean; id?: number };

      subscription.haSubscriptionId =
        response.type === 'result' && typeof response.id === 'number'
          ? response.id
          : undefined;
      logger.info(
        {
          subscriptionId: subscription.id,
          entityCount: subscription.entityIds.size,
          mode: subscription.entityIds.size === 0 ? 'all-events' : 'targeted-triggers',
        },
        'WsReadTransport: Activated state subscription'
      );
    })()
      .catch((err) => {
        logger.error(
          { err, subscriptionId: subscription.id, entityCount: subscription.entityIds.size },
          'WsReadTransport: Failed to activate state subscription'
        );
      })
      .finally(() => {
        subscription.activationPromise = null;
      });

    return subscription.activationPromise;
  }

  private async deactivateSubscription(subscription: Subscription): Promise<void> {
    if (subscription.haSubscriptionId === undefined) {
      subscription.activationPromise = null;
      return;
    }

    try {
      await this.waitUntilReady();
      await this.call({
        type: 'unsubscribe_events',
        subscription: subscription.haSubscriptionId,
      });
      logger.info({ subscriptionId: subscription.id }, 'WsReadTransport: Deactivated state subscription');
    } catch (err) {
      logger.warn({ err, subscriptionId: subscription.id }, 'WsReadTransport: Failed to deactivate state subscription');
    } finally {
      subscription.haSubscriptionId = undefined;
      subscription.activationPromise = null;
    }
  }

  private handleEventMessage(parsed: any): void {
    const subscription = typeof parsed.id === 'number'
      ? Array.from(this.subscriptions.values()).find((candidate) => candidate.haSubscriptionId === parsed.id)
      : undefined;

    if (!subscription) {
      return;
    }

    if (parsed.event?.event_type === 'state_changed') {
      this.handleStateChanged(subscription, parsed.event.data);
      return;
    }

    const trigger = parsed.event?.variables?.trigger;
    const entityId = trigger?.entity_id;
    const oldState = trigger?.from_state ?? null;
    const newState = trigger?.to_state ?? null;

    if (typeof entityId === 'string') {
      this.dispatchStateChange(subscription, entityId, newState, oldState);
    }
  }

  private handleStateChanged(subscription: Subscription, data: {
    entity_id: string;
    old_state: EntityState | null;
    new_state: EntityState | null;
  }): void {
    const { entity_id, old_state, new_state } = data;

    this.dispatchStateChange(subscription, entity_id, new_state, old_state);
  }

  private dispatchStateChange(
    subscription: Subscription,
    entityId: string,
    newState: EntityState | null,
    oldState: EntityState | null
  ): void {
    if (subscription.entityIds.size > 0 && !subscription.entityIds.has(entityId)) {
      return;
    }

    try {
      subscription.callback(entityId, newState, oldState);
    } catch (err) {
      logger.error({ err, subscriptionId: subscription.id }, 'WsReadTransport: Subscription callback error');
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
