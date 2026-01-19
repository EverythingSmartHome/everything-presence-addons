export type HaAuthMode = 'supervisor' | 'standalone';

export interface HaAuthConfig {
  baseUrl: string;
  token: string;
  mode: HaAuthMode;
}

export interface HaStateChangedEvent {
  event_type: 'state_changed';
  data: {
    entity_id: string;
    old_state: unknown;
    new_state: unknown;
  };
}

export type HaWsMessage =
  | { type: 'auth_required' }
  | { type: 'auth_ok' }
  | { type: 'auth_invalid'; message: string }
  | { id: number; type: 'result'; success: boolean; result?: unknown }
  | { id: number; type: 'event'; event: HaStateChangedEvent };

export interface EntityRegistryEntry {
  entity_id: string;
  name: string | null;
  platform: string;
  device_id: string | null;
  disabled_by: 'user' | 'integration' | 'config_entry' | null;
  hidden_by: string | null;
  original_object_id?: string | null;
  original_name?: string | null;
  unique_id?: string | null;
}
