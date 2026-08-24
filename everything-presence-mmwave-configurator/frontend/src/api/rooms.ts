import { RoomConfig } from './types';
import { ingressAware } from './client';

/**
 * Payload accepted by the rooms PUT endpoint. The backend never removes a stored
 * room outline implicitly: omit `roomShell` (or send one that has no points) to
 * leave the saved outline untouched, and send `roomShell: null` to clear it on
 * purpose.
 */
export type RoomUpdatePayload = Partial<Omit<RoomConfig, 'roomShell'>> & {
  roomShell?: RoomConfig['roomShell'] | null;
};

const handle = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T;
};

export const fetchRooms = async () => {
  const res = await fetch(ingressAware('api/rooms'));
  return handle<{ rooms: RoomConfig[] }>(res);
};

export const createRoom = async (payload: Partial<RoomConfig>) => {
  const res = await fetch(ingressAware('api/rooms'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handle<{ room: RoomConfig }>(res);
};

export const updateRoom = async (id: string, payload: RoomUpdatePayload) => {
  const res = await fetch(ingressAware(`api/rooms/${id}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handle<{ room: RoomConfig }>(res);
};

export const deleteRoom = async (id: string) => {
  const res = await fetch(ingressAware(`api/rooms/${id}`), {
    method: 'DELETE',
  });
  return handle<{ ok: boolean }>(res);
};
