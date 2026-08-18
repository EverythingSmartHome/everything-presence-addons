import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let server;
let HeatmapOverlay;

before(async () => {
  server = await createServer({
    logLevel: 'silent',
    server: { middlewareMode: true },
  });
  ({ HeatmapOverlay } = await server.ssrLoadModule('/src/components/HeatmapOverlay.tsx'));
});

after(async () => {
  await server?.close();
});

test('transforms the room clip path into the heatmap canvas coordinate system', () => {
  const toCanvas = ({ x, y }) => ({
    x: x * 2 + 10,
    y: y * 3 - 5,
  });
  const data = {
    resolution: 20,
    bounds: { minX: 0, maxX: 20, minY: 0, maxY: 20 },
    cells: [{ x: 0, y: 0, count: 1, intensity: 1 }],
    stats: {
      totalSamples: 1,
      maxCount: 1,
      timeRange: { start: '2026-01-01', end: '2026-01-02' },
      dataAvailable: true,
    },
  };

  const markup = renderToStaticMarkup(
    React.createElement(HeatmapOverlay, {
      data,
      visible: true,
      toCanvas,
      roomShellPoints: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      showAveragePosition: false,
    }),
  );

  assert.match(markup, /<path d="M 10,-5 L 210,-5 L 210,295 Z"><\/path>/);
  assert.match(markup, /<circle cx="30" cy="25"/);
});
