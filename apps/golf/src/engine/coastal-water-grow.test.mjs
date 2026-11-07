import { describe, expect, it } from 'vitest';
import { buildCoastalWater } from './coastal-water.mjs';

/* a coast running north-south at x = 75 beyond a 256 m mapped window, sea to the west */
const sourceBounds = { x0: -128, x1: 128, z0: -128, z1: 128 };
const bounds = { x0: -512, x1: 512, z0: -512, z1: 512 };
const bodies = [{ isSea: true, ring: [[-128, -128], [75, -128], [75, 128], [-128, 128]] }];
const heightAt = x => (x < 75 ? 0 : 0 + (x - 75) * 0.05);
const build = growCoast => buildCoastalWater({ bounds, sourceBounds, bodies, heightAt, seaLevel: 0, tolerance: 0.05, spacing: 32, growCoast });

describe('the sea beyond the mapped window, to its coast', () => {
  it('takes one cell more along the coast, and masks the ground there by height', () => {
    const before = build(false), after = build(true);
    expect(before.grownCells).toBe(0);
    expect(after.grownCells).toBeGreaterThan(0);
    /* the cell the coast crosses (x 64-96) was left out, and is drawn now, outside the window */
    const col = Math.floor((80 - bounds.x0) / 32), row = Math.floor((-300 - bounds.z0) / 32);
    expect(before.terrainCoverage[row * before.width + col]).toBe(0);
    expect(after.terrainCoverage[row * after.width + col]).toBe(1);
    /* the ground there above the sea's tolerance still stands: the mask only takes the low surface */
    expect(after.maximumCoveredTerrainHeight).toBe(0.05);
    /* never a cell inside the mapped window, and the tints keep their conservative cells */
    const inside = Math.floor((100 - bounds.x0) / 32) + Math.floor((0 - bounds.z0) / 32) * after.width;
    expect(after.terrainCoverage[inside]).toBe(before.terrainCoverage[inside]);
    expect(after.isSeaAt(80, -300)).toBe(before.isSeaAt(80, -300));
    expect(after.positions.length).toBeGreaterThan(before.positions.length - 1);
  });

  it('calls the low ground of a coastal cell water, so nothing is planted in the sea', () => {
    const before = build(false), after = build(true);
    /* x = 70: the laser's sea surface in the cell the coast crosses, outside the window */
    expect(before.isSeaAt(70, -300)).toBe(false);
    expect(after.isWaterAt(70, -300, heightAt(70))).toBe(true);
    /* the before keeps its planting: that cell was never drawn there */
    expect(before.isWaterAt(70, -300, heightAt(70))).toBe(false);
    /* ground clear of the waterline is land, and so is anything inside the mapped window */
    expect(after.isWaterAt(90, -300, heightAt(90))).toBe(false);
    expect(after.isWaterAt(100, 0, 0)).toBe(false);
  });

  it('carries each vertex\'s distance to the coast, so the shallows run on past the window', () => {
    const before = build(false), after = build(true);
    expect(before.shoreDistances).toBeNull();
    expect(after.shoreDistances.length).toBe(after.positions.length / 3);
    const near = [], far = [];
    for (let v = 0; v < after.shoreDistances.length; v++) {
      const x = after.positions[v * 3];
      (x > 0 ? near : far).push(after.shoreDistances[v]);
      if (x <= -400) expect(after.shoreDistances[v]).toBe(60);
    }
    expect(Math.min(...near)).toBeLessThan(20);
    expect(Math.max(...after.shoreDistances)).toBeLessThanOrEqual(60);
  });
});
