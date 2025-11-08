// Live IO helpers: WS/REST plumbing (initial scaffold)

export async function notifySelectedEntities(entityIds) {
  try {
    const response = await fetch('api/selected-entities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_ids: entityIds })
    });
    return response.ok;
  } catch (e) {
    console.warn('Error notifying backend of selected entities:', e);
    return false;
  }
}

// Lightweight ticker used by REST polling
export function createTicker({ onTick, getIntervalMs }) {
  let id = null;
  return {
    start() {
      if (id) clearInterval(id);
      // immediate tick then schedule
      try { onTick(); } catch (e) { /* no-op */ }
      id = setInterval(() => {
        try { onTick(); } catch (e) { /* swallow */ }
      }, getIntervalMs());
    },
    stop() {
      if (id) {
        clearInterval(id);
        id = null;
      }
    },
    isRunning() { return id !== null; }
  };
}
