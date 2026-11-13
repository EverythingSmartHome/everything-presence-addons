import {
  Agent,
  fetch as undiciFetch,
  type RequestInit as UndiciRequestInit,
} from 'undici';

/**
 * Shared HTTP helpers for requests to Home Assistant.
 *
 * VERIFY_SSL=false (case-insensitive) disables TLS certificate verification for
 * every request to Home Assistant (REST and WebSocket), so self-signed
 * certificates work. It must NOT be used for internet-bound requests (e.g.
 * firmware downloads), which keep the default verifying fetch.
 */

/**
 * True when the VERIFY_SSL environment variable is set to 'false'
 * (case-insensitive). Any other value, or unset, keeps verification enabled.
 */
export function isSslVerificationDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERIFY_SSL?.toLowerCase() === 'false';
}

let insecureAgent: Agent | undefined;

function getInsecureAgent(): Agent {
  if (!insecureAgent) {
    insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });
  }
  return insecureAgent;
}

/**
 * fetch() for Home Assistant requests.
 *
 * With verification enabled this is the global fetch, unchanged. With
 * VERIFY_SSL=false it uses undici's fetch with a dispatcher that accepts
 * self-signed certificates (scoped to this call, never process-wide).
 */
export async function haFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!isSslVerificationDisabled()) {
    return fetch(url, init);
  }
  const res = await undiciFetch(url, {
    ...(init as UndiciRequestInit | undefined),
    dispatcher: getInsecureAgent(),
  });
  // undici's Response implements the same WHATWG interface as the global one.
  return res as unknown as Response;
}
