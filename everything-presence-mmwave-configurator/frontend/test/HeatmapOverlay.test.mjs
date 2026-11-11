import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let server;
let HeatmapOverlay;
let RoomCanvas;
let ThemeProvider;

before(async () => {
  server = await createServer({ logLevel: 'silent', server: { middlewareMode: true } });
  ({ HeatmapOverlay } = await server.ssrLoadModule('/src/components/HeatmapOverlay.tsx'));
  ({ RoomCanvas } = await server.ssrLoadModule('/src/components/RoomCanvas.tsx'));
  ({ ThemeProvider } = await server.ssrLoadModule('/src/contexts/ThemeContext.tsx'));
});

after(async () => { await server?.close(); });

const data = {
  resolution: 20,
  bounds: { minX: 0, maxX: 20, minY: 0, maxY: 20 },
  cells: [{ x: 0, y: 0, count: 1, intensity: 1 }],
  stats: {
    totalSamples: 1, maxCount: 1, dataAvailable: true,
    timeRange: { start: '2026-01-01', end: '2026-01-02' },
  },
};
const roomShellPoints = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
const props = { data, visible: true, roomShellPoints, showAveragePosition: false };

// Regression fixture from PR #390, commit 1e0ef70e32e44990bb20be99ee17080a7617d605.
test('transforms the room clip path into the heatmap canvas coordinate system', () => {
  const markup = renderToStaticMarkup(React.createElement(HeatmapOverlay, {
    ...props, toCanvas: ({ x, y }) => ({ x: x * 2 + 10, y: y * 3 - 5 }),
  }));
  assert.match(markup, /<path d="M 10,-5 L 210,-5 L 210,295 Z"><\/path>/);
  assert.match(markup, /<circle cx="30" cy="25"/);
  assert.match(markup, /clip-path="url\(#heatmap-room-clip\)"/);
});

test('uses the actual RoomCanvas pan and scale for both boundary and cells', () => {
  const markup = renderToStaticMarkup(React.createElement(ThemeProvider, null, React.createElement(RoomCanvas, {
    points: roomShellPoints, onChange() {}, rangeMm: 700, panOffsetMm: { x: 50, y: 25 },
    showDevice: false, showRadar: false,
    renderOverlay: ({ toCanvas, roomShellPoints }) => React.createElement(HeatmapOverlay, {
      ...props, toCanvas, roomShellPoints,
    }),
  })));
  assert.match(markup, /<path d="M 300,325 L 400,325 L 400,425 Z"><\/path>/);
  assert.match(markup, /<circle cx="310" cy="335"/);
  assert.match(markup, /clip-path="url\(#heatmap-room-clip\)"/);
});

test('preserves explicit clipping opt-out and skips clipping without a valid boundary', () => {
  for (const options of [{ clipToRoom: false }, { roomShellPoints: [] }]) {
    const markup = renderToStaticMarkup(React.createElement(HeatmapOverlay, {
      ...props, ...options, toCanvas: point => point,
    }));
    assert.doesNotMatch(markup, /<clipPath|clip-path=/);
    assert.match(markup, /<circle cx="10" cy="10"/);
  }
});
