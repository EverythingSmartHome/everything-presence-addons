import { ZoneRect } from './types';
import { ingressAware } from './client';

const handle = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T;
};

export const validateZones = async (zones: ZoneRect[]) => {
  const res = await fetch(ingressAware('api/zones/validate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ zones }),
  });
  return handle<{ ok: boolean; overlaps?: string[] }>(res);
};
