import assert from 'node:assert/strict';
import test from 'node:test';
import { HeatmapService } from './heatmapService';

const service = new HeatmapService({ baseUrl: 'http://ha', token: 'test', mode: 'standalone' });
// Exercise the history boundary directly, including HA minimal-response entries
// whose entity_id is supplied only on the first state in each entity series.
const internal = service as any;
const time = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 12, 0, seconds)).toISOString();
const series = (entity: string, entries: [number, string][]) => entries.map(([t, state], i) => ({
  ...(i === 0 ? { entity_id: entity } : {}), state, last_changed: time(t),
}));
interface TestTarget {
  targetIndex: number;
  xEntity: string | null;
  yEntity: string | null;
  activeEntity?: string | null;
}
const target: TestTarget = { targetIndex: 1, xEntity: 'sensor.x', yEntity: 'sensor.y', activeEntity: 'binary_sensor.active' };
const positions = (history: unknown[], targets: TestTarget[] = [target]) => internal.correlateCoordinates(history, targets);

test('retains unchanged axes and processes movement on either axis without future pairing', () => {
  const points = positions([
    series('sensor.x', [[0, '100'], [10, '200']]),
    series('sensor.y', [[0, '1000'], [20, '1200']]),
  ]);
  assert.deepEqual(points.map(({ x, y }: any) => [x, y]), [[100, 1000], [200, 1000], [200, 1200]]);
  assert.equal(points[1].timestamp.toISOString(), time(10));
});

test('never uses future values; accepts fractional timestamps and offset initial states', () => {
  const points = positions([
    [{ entity_id: 'sensor.x', state: '0', last_changed: '2026-01-01T13:00:00.100+01:00' }],
    [{ entity_id: 'sensor.y', state: '500', last_changed: '2026-01-01T12:00:00.900Z' }],
  ]);
  assert.equal(points.length, 1);
  assert.equal(points[0].timestamp.toISOString(), '2026-01-01T12:00:00.900Z');
  assert.equal(points[0].x, 0);
});

test('unavailable clears both axes while numeric inactive resets support recovery', () => {
  const points = positions([
    series('sensor.x', [[0, '100'], [10, 'unavailable'], [20, '200'], [40, '0'], [60, '300']]),
    series('sensor.y', [[0, '500'], [30, '600'], [41, '0'], [61, '700']]),
    series('binary_sensor.active', [[0, 'on'], [39, 'off'], [59, 'on']]),
  ]);
  assert.deepEqual(points.map(({ x, y }: any) => [x, y]), [[100, 500], [200, 600], [300, 0], [300, 700]]);
});

test('unknown activity blocks samples and recovery cannot reuse pre-invalidation axes', () => {
  assert.deepEqual(positions([
    series('sensor.x', [[0, '100'], [2, 'Infinity'], [3, '20oops'], [5, '200'], [8, '300']]),
    series('sensor.y', [[0, '500'], [4, '600'], [9, '700']]),
    series('binary_sensor.active', [[0, 'unknown'], [1, 'on'], [6, 'unavailable'], [7, 'on']]),
  ]).map(({ x, y }: any) => [x, y]), [[200, 600], [300, 700]]);
});

test('Pro simultaneous updates count once, repeated values do not count, origin resets vanish', () => {
  const points = positions([
    series('sensor.x', [[0, '100'], [1, '100'], [2, '200'], [3, '0'], [4, '0']]),
    series('sensor.y', [[0, '500'], [1, '500'], [2, '600'], [3, '0'], [4, '700']]),
  ]);
  assert.deepEqual(points.map(({ x, y }: any) => [x, y]), [[100, 500], [200, 600], [0, 700]]);
});

test('equal timestamps apply both axes before sampling and last duplicate wins', () => {
  const points = positions([
    series('sensor.y', [[0, '500'], [10, '600']]),
    series('sensor.x', [[0, '100'], [10, '200'], [10, '300']]),
  ]);
  assert.deepEqual(points.map(({ x, y }: any) => [x, y]), [[100, 500], [300, 600]]);
});

test('targets remain independent and invalid timestamps cannot introduce state', () => {
  const points = positions([
    series('sensor.x', [[0, '100']]), series('sensor.y', [[0, '500']]),
    [{ entity_id: 'sensor.x2', state: '999', last_changed: 'invalid' },
      { state: '-200', last_changed: time(2) }],
    series('sensor.y2', [[1, '900']]),
  ], [target, { targetIndex: 2, xEntity: 'sensor.x2', yEntity: 'sensor.y2', activeEntity: null }]);
  assert.deepEqual(points.map(({ x, y, targetIndex }: any) => [x, y, targetIndex]), [[100, 500, 1], [-200, 900, 2]]);
});

test('corrected points drive cells, normalization, hourly counts, zones and centroid', async () => {
  const local = new HeatmapService({ baseUrl: 'http://ha', token: 'test', mode: 'standalone' }) as any;
  local.getTrackingEntities = () => ({ entities: [], targetInfo: [target] });
  local.fetchHistory = async () => [
    series('sensor.x', [[0, '100'], [10, '200'], [30, '0'], [31, '0'], [32, '0']]),
    series('sensor.y', [[0, '1000'], [20, '1200'], [30, '0'], [31, '0'], [32, '0']]),
  ];
  const result = await local.generateHeatmap('test', 24, 100, [
    { id: 'boundary', label: 'Boundary', x: 0, y: 1000, width: 200, height: 200 },
  ]);
  assert.equal(result.stats.totalSamples, 3);
  assert.equal(result.stats.maxCount, 1);
  assert.deepEqual(result.cells, [
    { x: 100, y: 1000, count: 1, intensity: 1 },
    { x: 200, y: 1000, count: 1, intensity: 1 },
    { x: 200, y: 1200, count: 1, intensity: 1 },
  ]);
  assert.deepEqual(result.bounds, { minX: 100, maxX: 300, minY: 1000, maxY: 1300 });
  assert.equal(result.hourlyBreakdown[new Date(time(0)).getHours()].count, 3);
  assert.equal(result.hourlyBreakdown.reduce((sum: number, h: any) => sum + h.count, 0), 3);
  assert.deepEqual(result.zoneStats.map((z: any) => [z.zoneId, z.sampleCount, z.percentage]), [
    ['boundary', 3, 100], ['__no_zone__', 0, 0],
  ]);
  assert.deepEqual(result.averagePosition, { x: 500 / 3, y: 3200 / 3 });
});

test('all-inactive history yields no analytics or normalization input', async () => {
  const local = new HeatmapService({ baseUrl: 'http://ha', token: 'test', mode: 'standalone' }) as any;
  local.getTrackingEntities = () => ({ entities: [], targetInfo: [target] });
  local.fetchHistory = async () => [
    series('sensor.x', [[0, '100'], [1, '0']]), series('sensor.y', [[0, '500'], [2, '0']]),
    series('binary_sensor.active', [[0, 'off']]),
  ];
  const result = await local.generateHeatmap('test', 24, 100);
  assert.equal(result.stats.totalSamples, 0);
  assert.equal(result.stats.maxCount, 0);
  assert.equal(result.stats.dataAvailable, false);
  assert.deepEqual(result.cells, []);
  assert.equal(result.averagePosition, undefined);
  assert.equal(result.hourlyBreakdown, undefined);
  assert.equal(result.zoneStats, undefined);
});

test('repeated activity events do not sample; asynchronous inactive resets cannot leak', () => {
  const points = positions([
    series('sensor.x', [[0, '100'], [3, '0'], [6, '0']]),
    series('sensor.y', [[0, '500'], [4, '0'], [7, '800'], [8, '0']]),
    series('binary_sensor.active', [[0, 'on'], [1, 'on'], [2, 'off'], [5, 'on'], [8, 'off']]),
  ]);
  assert.deepEqual(points.map(({ x, y }: any) => [x, y]), [[100, 500], [0, 800]]);
  assert.deepEqual(positions([
    series('sensor.x', [[0, '100']]), series('sensor.y', [[0, '0']]),
  ]).map(({ x, y }: any) => [x, y]), [[100, 0]]);
});

test('separate timestamps represent separate reconstructed states, without a jitter window', () => {
  const points = positions([
    series('sensor.x', [[0, '100'], [10, '200']]),
    series('sensor.y', [[0, '500'], [11, '600']]),
  ]);
  assert.deepEqual(points.map(({ x, y }: any) => [x, y]), [[100, 500], [200, 500], [200, 600]]);
});

test('multiple targets contribute independently to density and different hourly buckets', () => {
  const points = positions([
    series('sensor.x', [[0, '100'], [3600, '100']]),
    series('sensor.y', [[0, '500'], [3600, '600']]),
    series('sensor.x2', [[0, '100']]), series('sensor.y2', [[0, '500']]),
  ], [target, { targetIndex: 2, xEntity: 'sensor.x2', yEntity: 'sensor.y2', activeEntity: null }]);
  const grid = internal.bucketPoints(points, 100);
  assert.equal(grid.maxCount, 2);
  assert.deepEqual(grid.cells, [
    { x: 100, y: 500, count: 2, intensity: 1 },
    { x: 100, y: 600, count: 1, intensity: 0.5 },
  ]);
  const hourly = internal.calculateHourlyBreakdown(points);
  assert.equal(hourly[new Date(time(0)).getHours()].count, 2);
  assert.equal(hourly[new Date(time(3600)).getHours()].count, 1);
  assert.deepEqual(internal.calculateAveragePosition(points), { x: 100, y: 1600 / 3 });
});

test('origin-only history without activity is empty, including downstream statistics', () => {
  assert.deepEqual(positions([
    series('sensor.x', [[0, '0'], [10, '0']]),
    series('sensor.y', [[0, '0'], [10, '0']]),
  ]), []);
});

for (const zeroAxis of ['x', 'y'] as const) {
  for (const withActivity of [true, false]) {
    test(`change-only recovery with ${zeroAxis}=0 (${withActivity ? 'activity' : 'coordinate-only'}) feeds analytics`, async () => {
      const history = [
        series('sensor.x', zeroAxis === 'x' ? [[0, '100'], [3, '0']] : [[0, '500'], [3, '0'], [3600, '800']]),
        series('sensor.y', zeroAxis === 'y' ? [[0, '100'], [3, '0']] : [[0, '500'], [3, '0'], [3600, '800']]),
        ...(withActivity ? [series('binary_sensor.active', [[0, 'on'], [2, 'off'], [5, 'on']])] : []),
      ];
      const recovered = zeroAxis === 'x' ? { x: 0, y: 800 } : { x: 800, y: 0 };
      const points = positions(history);
      assert.equal(points.length, 2);
      assert.deepEqual({ x: points[1].x, y: points[1].y }, recovered);
      assert.equal(points[1].timestamp.toISOString(), time(3600));
      const local = new HeatmapService({ baseUrl: 'http://ha', token: 'test', mode: 'standalone' }) as any;
      local.getTrackingEntities = () => ({ entities: [], targetInfo: [target] });
      local.fetchHistory = async () => history;
      const result = await local.generateHeatmap('test', 24, 100, [
        { id: 'return', x: recovered.x, y: recovered.y, width: 100, height: 100 },
      ]);
      assert.equal(result.stats.totalSamples, 2);
      assert.equal(result.stats.maxCount, 1);
      assert.ok(result.cells.some((cell: any) => cell.x === recovered.x && cell.y === recovered.y && cell.count === 1 && cell.intensity === 1));
      assert.equal(result.hourlyBreakdown[new Date(time(3600)).getHours()].count, 1);
      assert.equal(result.zoneStats[0].sampleCount, 1);
      assert.equal(result.zoneStats[0].percentage, 50);
      assert.deepEqual(result.averagePosition, { x: (points[0].x + recovered.x) / 2, y: (points[0].y + recovered.y) / 2 });
    });
  }
}

test('coordinates before activity seed initial and returning states only at activation', () => {
  const points = positions([
    series('sensor.x', [[0, '100'], [4, '0']]),
    series('sensor.y', [[0, '500'], [4, '0'], [6, '800']]),
    series('binary_sensor.active', [[1, 'on'], [3, 'off'], [7, 'on'], [8, 'on']]),
  ]);
  assert.deepEqual(points.map(({ x, y, timestamp }: any) => [x, y, timestamp.toISOString()]), [
    [100, 500, time(1)], [0, 800, time(7)],
  ]);
});

test('origin before off and inactive initial origin retain known axes without inactive samples', () => {
  for (const initial of [true, false]) {
    const points = positions([
      series('sensor.x', initial ? [[0, '0']] : [[0, '100'], [2, '0']]),
      series('sensor.y', initial ? [[0, '0'], [6, '800']] : [[0, '500'], [2, '0'], [6, '800']]),
      series('binary_sensor.active', initial ? [[0, 'off'], [5, 'on']] : [[0, 'on'], [3, 'off'], [5, 'on']]),
    ]);
    assert.deepEqual(points.map(({ x, y }: any) => [x, y]), initial ? [[0, 800]] : [[100, 500], [0, 800]]);
  }
});

test('unavailable coordinates or activity invalidate known reset axes in either tracking mode', () => {
  for (const withActivity of [true, false]) {
    const points = positions([
      series('sensor.x', [[0, '100'], [3, '0'], [4, 'unavailable'], [9, '0']]),
      series('sensor.y', [[0, '500'], [3, '0'], [7, '800']]),
      ...(withActivity ? [series('binary_sensor.active', [[0, 'on'], [2, 'off'], [6, 'on']])] : []),
    ]);
    assert.deepEqual(points.map(({ x, y, timestamp }: any) => [x, y, timestamp.toISOString()]), [
      [100, 500, time(0)], [0, 800, time(9)],
    ]);
  }
  assert.deepEqual(positions([
    series('sensor.x', [[0, '0'], [9, '0']]),
    series('sensor.y', [[0, '0'], [7, '800']]),
    series('binary_sensor.active', [[0, 'off'], [4, 'unavailable'], [6, 'on']]),
  ]).map(({ x, y, timestamp }: any) => [x, y, timestamp.toISOString()]), [[0, 800, time(9)]]);
});
