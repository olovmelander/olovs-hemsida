import { describe, expect, it } from 'vitest';
import { GRID_SHADOW_TAPS, VOGEL_MEAN_SQUARED_RADIUS, createSunShadowFilter, gridShadowOffsets } from './sun-shadow.mjs';
import { preparedTintAllowed } from './prepared-ground-tint.mjs';

const meanSquaredRadius = offsets => offsets.reduce((sum, [x, y]) => sum + x * x + y * y, 0) / offsets.length;
const mean = (offsets, axis) => offsets.reduce((sum, o) => sum + o[axis], 0) / offsets.length;

describe('the grid shadow filter', () => {
  it('blurs as wide as three\'s five-sample Vogel disc, at nine taps and at four', () => {
    expect(VOGEL_MEAN_SQUARED_RADIUS).toBeCloseTo(0.5, 12);
    for (const taps of [GRID_SHADOW_TAPS.high, GRID_SHADOW_TAPS.low]) {
      const offsets = gridShadowOffsets(taps);
      expect(offsets).toHaveLength(taps);
      expect(meanSquaredRadius(offsets)).toBeCloseTo(VOGEL_MEAN_SQUARED_RADIUS, 12);
      // centred, so the shadow does not shift
      expect(mean(offsets, 0)).toBeCloseTo(0, 12);
      expect(mean(offsets, 1)).toBeCloseTo(0, 12);
      // and every tap within the disc's own reach of one radius
      for (const [x, y] of offsets) expect(Math.hypot(x, y)).toBeLessThanOrEqual(1);
    }
  });

  it('is the same pattern at every pixel: no noise term to leave grain without TAA', () => {
    expect(gridShadowOffsets(9)).toEqual(gridShadowOffsets(9));
    expect(new Set(gridShadowOffsets(9).map(o => o.join(','))).size).toBe(9);
  });

  it('keeps three\'s PCF as the before, and builds a filter node either way', () => {
    const grid = createSunShadowFilter(), low = createSunShadowFilter({ taps: GRID_SHADOW_TAPS.low });
    const before = createSunShadowFilter({ grid: false });
    expect(grid).toMatchObject({ grid: true, taps: 9 });
    expect(low).toMatchObject({ grid: true, taps: 4 });
    expect(before).toMatchObject({ grid: false, taps: 5 });
    for (const filter of [grid, low, before]) {
      expect(typeof filter.filterNode).toBe('function');
      expect(filter.enabled.value).toBe(1);
    }
  });

  it('leaves prepared startup eligible for the before, so an A/B differs only in the filter', () => {
    expect(preparedTintAllowed('?bana=test&shadowgrid=0')).toBe(true);
  });
});
