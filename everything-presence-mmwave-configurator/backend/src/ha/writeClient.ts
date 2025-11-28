import { logger } from '../logger';
import { HaAuthConfig } from './types';

/**
 * REST client for write operations (service calls, entity updates).
 * Always uses REST regardless of read transport.
 */
export interface IHaWriteClient {
  /**
   * Call a Home Assistant service
   */
  callService(domain: string, service: string, data: Record<string, unknown>): Promise<void>;

  /**
   * Set a number entity value
   */
  setNumberEntity(entityId: string, value: number): Promise<void>;

  /**
   * Set a select entity option
   */
  setSelectEntity(entityId: string, option: string): Promise<void>;

  /**
   * Set a switch entity state
   */
  setSwitchEntity(entityId: string, on: boolean): Promise<void>;

  /**
   * Set an input_boolean entity state
   */
  setInputBooleanEntity(entityId: string, on: boolean): Promise<void>;

  /**
   * Set a text entity value
   */
  setTextEntity(entityId: string, value: string): Promise<void>;
}

export class HaWriteClient implements IHaWriteClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(config: HaAuthConfig) {
    // Ensure baseUrl ends with /api for REST calls
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    if (!this.baseUrl.endsWith('/api')) {
      this.baseUrl = this.baseUrl + '/api';
    }
    this.token = config.token;
    logger.info('HaWriteClient initialized (REST-only for writes)');
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

  async callService(domain: string, service: string, data: Record<string, unknown>): Promise<void> {
    const url = this.buildUrl(`/services/${domain}/${service}`);

    logger.debug({ domain, service, entityId: data.entity_id }, 'Calling HA service');

    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const text = await res.text();
      const error = `HA service call failed: ${res.status} ${res.statusText} - ${text}`;
      logger.error({ domain, service, status: res.status, error: text }, 'Service call failed');
      throw new Error(error);
    }

    logger.debug({ domain, service }, 'Service call successful');
  }

  async setNumberEntity(entityId: string, value: number): Promise<void> {
    await this.callService('number', 'set_value', {
      entity_id: entityId,
      value,
    });
  }

  async setSelectEntity(entityId: string, option: string): Promise<void> {
    await this.callService('select', 'select_option', {
      entity_id: entityId,
      option,
    });
  }

  async setSwitchEntity(entityId: string, on: boolean): Promise<void> {
    await this.callService('switch', on ? 'turn_on' : 'turn_off', {
      entity_id: entityId,
    });
  }

  async setInputBooleanEntity(entityId: string, on: boolean): Promise<void> {
    await this.callService('input_boolean', on ? 'turn_on' : 'turn_off', {
      entity_id: entityId,
    });
  }

  async setTextEntity(entityId: string, value: string): Promise<void> {
    await this.callService('text', 'set_value', {
      entity_id: entityId,
      value,
    });
  }
}
