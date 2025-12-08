import { RoomConfig } from '../types';
import { ingressAware } from './client';

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

export const updateRoom = async (id: string, payload: Partial<RoomConfig>) => {
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
