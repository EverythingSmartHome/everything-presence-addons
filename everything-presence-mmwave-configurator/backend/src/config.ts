import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export type HaMode = 'supervisor' | 'standalone';

export interface HaConfig {
  mode: HaMode;
  baseUrl: string;
  token: string;
  supervisorApiUrl?: string;
}

export interface AppConfig {
  port: number;
  ha: HaConfig;
  frontendDist: string | null;
}

const DEFAULT_PORT = 3000;
const DEFAULT_FRONTEND_DIST = path.resolve(__dirname, '../../frontend/dist');

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

/**
 * Normalize the base URL to ensure it ends with /api
 * Accepts: http://host:8123, http://host:8123/, http://host:8123/api, http://host:8123/api/
 * Returns: http://host:8123/api
 */
const normalizeBaseUrl = (url: string): string => {
  let normalized = trimTrailingSlash(url);
  if (!normalized.endsWith('/api')) {
    normalized = `${normalized}/api`;
  }
  return normalized;
};

const parsePort = (value: string | undefined): number => {
  if (!value) {
    return DEFAULT_PORT;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return DEFAULT_PORT;
  }
  return parsed;
};

const detectHaConfig = (): HaConfig => {
  const supervisorToken = process.env.SUPERVISOR_TOKEN;
  const supervisorApiUrl = process.env.SUPERVISOR_API ?? 'http://supervisor';

  if (supervisorToken) {
    return {
      mode: 'supervisor',
      baseUrl: normalizeBaseUrl(process.env.HA_BASE_URL ?? 'http://supervisor/core/api'),
      token: supervisorToken,
      supervisorApiUrl: trimTrailingSlash(supervisorApiUrl),
    };
  }

  const standaloneUrl = process.env.HA_BASE_URL;
  const standaloneToken = process.env.HA_LONG_LIVED_TOKEN;

  if (standaloneUrl && standaloneToken) {
    return {
      mode: 'standalone',
      baseUrl: normalizeBaseUrl(standaloneUrl),
      token: standaloneToken,
    };
  }

  throw new Error(
    'Home Assistant credentials are not configured. Provide SUPERVISOR_TOKEN (add-on) or HA_BASE_URL and HA_LONG_LIVED_TOKEN (standalone).',
  );
};

export const loadConfig = (): AppConfig => {
  const ha = detectHaConfig();

  return {
    port: parsePort(process.env.PORT),
    ha,
    frontendDist: process.env.FRONTEND_DIST
      ? path.resolve(process.env.FRONTEND_DIST)
      : DEFAULT_FRONTEND_DIST,
  };
};

export const redactedHaConfig = (ha: HaConfig): Omit<HaConfig, 'token'> & { token: string } => ({
  ...ha,
  token: '***redacted***',
});
