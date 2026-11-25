import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

test('display preferences normalize storage, save, and reload the handle size', async () => {
  const server = await createServer({ logLevel: 'silent', server: { middlewareMode: true } });
  const originalStorage = globalThis.localStorage;
  let stored = JSON.stringify({ showWalls: false, zoneHandleSize: 'invalid' });
  globalThis.localStorage = { getItem: () => stored, setItem: (_key, value) => { stored = value; } };
  try {
    const { loadSettings, saveSettings, normalizeDisplaySettings } = await server.ssrLoadModule('/src/hooks/useDisplaySettings.ts');
    assert.equal(loadSettings().zoneHandleSize, 8);
    assert.equal(loadSettings().showWalls, false);
    saveSettings(normalizeDisplaySettings({ zoneHandleSize: 12 }));
    assert.equal(loadSettings().zoneHandleSize, 12);
    saveSettings(normalizeDisplaySettings({ zoneHandleSize: 999 }));
    assert.equal(loadSettings().zoneHandleSize, 14);
    stored = '{}';
    assert.equal(loadSettings().zoneHandleSize, 8);
  } finally {
    globalThis.localStorage = originalStorage;
    await server.close();
  }
});
