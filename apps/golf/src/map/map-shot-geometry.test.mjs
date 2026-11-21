import { describe, expect, it } from 'vitest';
import { createMapShotGeometry, loadMapShotGeometry } from './map-shot-geometry.mjs';
import { createMapStrategy } from './map-strategy.mjs';
import { mappedWaterShapes } from './map-hazard-geometry.mjs';
import { DEFAULT_BAG } from '../engine/caddie.js';

const rect = (left, top, right, bottom) => [[left, top], [right, top], [right, bottom], [left, bottom]];
const tile = () => ({
  x0: 0, z0: 0, size: 100, width: 2,
  heights: new Float32Array([0, 0, 10, 10]),
  crowns: new Float32Array([15, 30, 4]),
});
function layout() {
  const hole = { n: 1, par: 4, note: null, tees: [{ point: [10, 2] }], fairways: [rect(5, 10, 35, 80)],
    green: { c: [15, 90], ring: rect(5, 83, 25, 97) }, bunkers: [], line: [[10, 2], [15, 90]], tileIds: ['t'] };
  const other = { ...hole, n: 2, fairways: [rect(40, 5, 60, 80)], bunkers: [rect(25, 40, 31, 45)] };
  const features = { water: [{ ring: rect(10, 65, 20, 70) }], basins: [], streams: [{ line: [[0, 55], [35, 55]], width: 1 }],
    drains: [], parking: [], paved: [], paths: [], tracks: [], roads: [], railways: [],
    otherBunkers: [rect(24, 20, 32, 25)], buildings: [rect(55, 45, 65, 52)], farBuildings: [],
    obRuns: [{ line: [[28, 68], [28, 78]], holes: [1] }, { line: [[0, 33], [30, 33]], holes: [2] }] };
  return { hole, course: { holes: [hole, other], greensApproximate: false, features, hazards: { waters: mappedWaterShapes(features) } } };
}

describe('the physical ground used for a GPS shot', () => {
  it('distinguishes a lie outside the hole survey from a measured lie in water', async () => {
    const { course, hole } = layout();
    const data = await loadMapShotGeometry(course, hole, { shotTile: async () => tile() });
    const planner = createMapStrategy({ ...createMapShotGeometry(data), bag: DEFAULT_BAG });
    expect(planner.plan([-1, 40])).toMatchObject({ status: 'unavailable', reason: 'unmapped-origin', shots: [] });
    expect(planner.plan([15, 67])).toMatchObject({ status: 'blocked', shots: [] });
  });

  it('keeps only the played hole’s targets and the hazards from every layout', async () => {
    const { course, hole } = layout();
    const data = await loadMapShotGeometry(course, hole, { shotTile: async () => tile() });
    const result = createMapShotGeometry(structuredClone(data));
    expect(result.hole.fairway.rings).toEqual(hole.fairways);
    expect(result.heightAt(25, 50)).toBe(5);
    expect(result.environment.landingAllowed(28, 22)).toBe(false);
    expect(result.environment.landingAllowed(28, 42)).toBe(false);
    expect(result.environment.landingAllowed(15, 67)).toBe(false);
    expect(result.environment.landingAllowed(27, 55)).toBe(false);
    expect(result.environment.clearSegment([8, 30], [8, 35])).toBe(true);
    expect(result.environment.clearSegment([20, 73], [32, 73])).toBe(true);
    expect(result.environment.landingAllowed(32, 73)).toBe(false);
    expect(result.environment.originAllowed(32, 73)).toBe(false);
    expect(result.environment.landingAllowed(24, 73)).toBe(true);
    expect(result.environment.originAllowed(28, 42)).toBe(true);
    expect(result.environment.originAllowed(15, 67)).toBe(false);
    expect(result.environment.clearSegment([10, 20], [10, 40])).toBe(false);
    expect(result.environment.canStartAt([10, 30])).toBe(true);
    expect(result.environment.clearSegment([10, 30], [2, 30])).toBe(true);
    expect(result.environment.clearSegment([10, 30], [20, 30])).toBe(false);
    expect(result.environment.clearSegment([2, 30], [10, 30])).toBe(false);
    expect(result.environment.canStartAt([13, 30])).toBe(false);
    expect(result.environment.clearSegment([60, 40], [60, 56])).toBe(false);
    expect(result.environment.clearSegment([95, 0], [105, 5])).toBe(false);
    expect(result.environment.carryRequired([15, 60], [15, 80])).toBeCloseTo(12);
    expect(result.environment.carryRequired([27, 50], [27, 60])).toBeCloseTo(7.5);
    expect(result.environment.carryRequired([40, 10], [40, 20])).toBe(0);
  });

  it('blocks roads for landing and allows a carry across a road', async () => {
    const { course, hole } = layout();
    course.features.roads = [{ line: [[45, 60], [75, 60]], width: 5 }];
    const data = await loadMapShotGeometry(course, hole, { shotTile: async () => tile() });
    const { environment } = createMapShotGeometry(data);
    expect(environment.landingAllowed(50, 62)).toBe(false);
    expect(environment.clearSegment([50, 50], [50, 68])).toBe(true);
    expect(environment.carryRequired([50, 50], [50, 68])).toBe(0);
  });

  it('keeps an uncorrected coastal footprint and an unmeasured slope out of verified routes', async () => {
    const { course, hole } = layout();
    course.features.water.push({ ring: rect(45, 10, 50, 15), overLand: true });
    const data = await loadMapShotGeometry(course, hole, { shotTile: async () => tile() });
    const { environment } = createMapShotGeometry(data);
    expect(environment.clearSegment([47, 5], [47, 20])).toBe(false);
    expect(environment.carryRequired([47, 5], [47, 20])).toBe(0);
    data.tiles[0].heights[0] = NaN;
    expect(createMapShotGeometry(data).environment.clearSegment([60, 60], [80, 80])).toBe(false);
  });

  it('checks replacement water raster and carries to its far edge', () => {
    const wet = new Uint8Array(25);
    wet[2 * 5 + 2] = 1;
    const mask = { x0: 0, z0: 0, spacing: 10, width: 5, height: 5, wet };
    const { environment } = createMapShotGeometry({ hole: {}, tiles: [tile()], water: [], bunkers: [], boundaries: [], buildings: [], mask });
    expect(environment.landingAllowed(25, 25)).toBe(false);
    expect(environment.landingAllowed(15, 25)).toBe(true);
    expect(environment.carryRequired([5, 25], [45, 25])).toBe(27);
  });

  it('waits for every hole tile and propagates an unavailable or aborted load', async () => {
    const { course, hole } = layout();
    hole.tileIds.push('t2');
    const ids = [];
    await expect(loadMapShotGeometry(course, hole, { async shotTile(id) {
      ids.push(id);
      if (id === 't2') throw new Error('offline');
      return tile();
    } })).rejects.toThrow('offline');
    expect(ids).toEqual(hole.tileIds);
    const signal = AbortSignal.abort();
    await expect(loadMapShotGeometry(course, hole, { shotTile() { throw new Error('unreachable'); } }, { signal }))
      .rejects.toHaveProperty('name', 'AbortError');
  });
});
