// WebSocket manager for HA events via backend proxy

export function createWSManager({ getSelectedEntities, onStatesUpdated, onStatusChange }) {
  let ws = null;
  let connected = false;
  let authenticated = false; // backend proxy authenticates; we treat open as auth-ok
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;
  const reconnectDelay = 2000;
  let messageId = 1;
  let subscriptionId = null;
  let updateTimeout = null;
  const entityStates = new Map();

  function wsUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const basePath = window.location.pathname.replace(/\/[^\/]*$/, '/');
    return `${protocol}//${window.location.host}${basePath}ws`;
  }

  function isRelevantEntity(entityId) {
    const selected = getSelectedEntities() || [];
    return selected.includes(entityId);
  }

  function emitStatus() {
    try { onStatusChange && onStatusChange(connected, authenticated); } catch (_) {}
  }

  function sendMessage(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      if (message.type !== 'auth') {
        message.id = messageId++;
      }
      ws.send(JSON.stringify(message));
      return message.id;
    }
    return null;
  }

  function subscribeToEntityUpdates() {
    if (!authenticated) return;
    subscriptionId = sendMessage({ type: 'subscribe_events', event_type: 'state_changed' });
    requestInitialStates();
  }

  function requestInitialStates() {
    if (!authenticated) return;
    sendMessage({ type: 'get_states' });
  }

  function handleResult(message) {
    if (message.success && Array.isArray(message.result)) {
      entityStates.clear();
      const relevant = new Set(getSelectedEntities() || []);
      message.result
        .filter((e) => relevant.has(e.entity_id))
        .forEach((e) => entityStates.set(e.entity_id, e));

      const arr = Array.from(entityStates.entries()).map(([entity_id, data]) => ({
        entity_id,
        state: data.state,
        attributes: data.attributes,
        last_changed: data.last_changed,
        last_updated: data.last_updated,
      }));
      try { onStatesUpdated && onStatesUpdated(arr); } catch (_) {}
    } else if (!message.success) {
      console.error('HA operation failed:', message.error);
    }
  }

  function handleEventWrapper(message) {
    if (message.type !== 'event') return;
    const event = message.event || {};
    if (event.event_type !== 'state_changed') return;
    const entityId = event.data?.entity_id;
    const newState = event.data?.new_state;
    if (!entityId || !newState) return;
    if (!isRelevantEntity(entityId)) return;

    entityStates.set(entityId, newState);

    if (updateTimeout) clearTimeout(updateTimeout);
    updateTimeout = setTimeout(() => {
      const arr = Array.from(entityStates.entries()).map(([entity_id, data]) => ({
        entity_id,
        state: data.state,
        attributes: data.attributes,
        last_changed: data.last_changed,
        last_updated: data.last_updated,
      }));
      try { onStatesUpdated && onStatesUpdated(arr); } catch (_) {}
    }, 50);
  }

  function connect() {
    try {
      ws = new WebSocket(wsUrl());
    } catch (e) {
      console.error('Failed to create backend proxy WebSocket:', e);
      connected = false; authenticated = false; emitStatus();
      return;
    }

    ws.onopen = () => {
      connected = true;
      authenticated = true; // backend proxy handles auth
      reconnectAttempts = 0;
      emitStatus();
      setTimeout(() => subscribeToEntityUpdates(), 200);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'event') handleEventWrapper(msg);
        else if (msg.type === 'result') handleResult(msg);
        else { /* ignore other types */ }
      } catch (e) {
        console.error('Error parsing backend proxy message:', e);
      }
    };

    ws.onclose = (event) => {
      connected = false;
      authenticated = false;
      emitStatus();
      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        setTimeout(() => {
          // Only reconnect if still enabled by caller
          if (api.useWebSocket) connect();
        }, reconnectDelay);
      }
    };

    ws.onerror = (error) => {
      console.error('Backend WebSocket proxy error:', error);
      emitStatus();
    };
  }

  function disconnect() {
    if (ws) {
      try { ws.close(); } catch (_) {}
      ws = null;
    }
    connected = false;
    authenticated = false;
    emitStatus();
  }

  const api = {
    useWebSocket: true,
    connect,
    disconnect,
    isConnected() { return connected && authenticated; },
    onDeviceSelected() { if (connected && authenticated && (getSelectedEntities()?.length)) requestInitialStates(); },
  };
  return api;
}

