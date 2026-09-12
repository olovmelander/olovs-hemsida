import { describe, expect, it } from 'vitest';
import { FAR_RING_BANDS, calibrateFarRing, farRingSpacing, farRingTree } from './far-ring-calibration.mjs';
import { STAND_PLANTING, crownRadiusForHeight } from './v2-vegetation.mjs';

const heights = Array.from({ length: 2000 }, (_, i) => 3 + (i % 100) * 0.15);   /* 3 .. 17.85 m */
const cal = calibrateFarRing({ standHeights: heights, planting: STAND_PLANTING, crownRadiusAt: crownRadiusForHeight });
const closedStemArea = h => (Math.PI * crownRadiusForHeight(h) ** 2) / STAND_PLANTING.overlapFactor;

describe('the far ring calibrated on the measured stands', () => {
  it('is null where there are too few stand trees, so the old rule stands', () => {
    expect(calibrateFarRing({ standHeights: heights.slice(0, 100), planting: STAND_PLANTING, crownRadiusAt: crownRadiusForHeight })).toBeNull();
    expect(calibrateFarRing({ standHeights: null })).toBeNull();
    /* the allometry is a parameter, never an import: see the module's header */
    expect(() => calibrateFarRing({ standHeights: heights })).toThrow(/crownRadiusAt/);
  });
  it('carries monotone height quantiles, the median and the planter\'s closed-stand stem area', () => {
    expect(cal.samples).toBe(2000);
    for (let i = 1; i < cal.quantiles.length; i++) expect(cal.quantiles[i]).toBeGreaterThanOrEqual(cal.quantiles[i - 1]);
    expect(cal.quantiles[0]).toBeCloseTo(3, 5);
    expect(cal.medianHeight).toBeGreaterThan(9);
    expect(cal.medianHeight).toBeLessThan(12);
    /* one stem per crown area at the median height, over the planter's overlap */
    expect(cal.m2PerMedianStem).toBeCloseTo(closedStemArea(cal.medianHeight), 6);
    expect(cal.m2PerStem).toBeGreaterThan(30);
    expect(cal.m2PerStem).toBeLessThan(50);
  });
  it('takes its density from the whole height distribution, never from the median tree', () => {
    /* crown area grows with height, so a stand of mixed sizes is DENSER than one
       of median trees: the mean of the trees' densities, not the median tree's.
       A stand that really is one height reproduces the old rule exactly. */
    expect(cal.m2PerStem).toBeLessThan(cal.m2PerMedianStem);
    const flat = calibrateFarRing({ standHeights: heights.map(() => 10), planting: STAND_PLANTING, crownRadiusAt: crownRadiusForHeight });
    expect(flat.m2PerStem).toBeCloseTo(closedStemArea(10), 6);
    expect(flat.m2PerStem).toBeCloseTo(flat.m2PerMedianStem, 6);
  });
  it('thins with distance in three bands, and a phone plants sparser', () => {
    const near = Math.sqrt(cal.m2PerStem);
    expect(farRingSpacing(0, cal)).toBeCloseTo(near, 6);
    expect(farRingSpacing(FAR_RING_BANDS.nearMetres - 1, cal)).toBeCloseTo(near, 6);
    expect(farRingSpacing(FAR_RING_BANDS.nearMetres, cal)).toBe(FAR_RING_BANDS.middleSpacing);
    expect(farRingSpacing(FAR_RING_BANDS.middleMetres, cal)).toBe(FAR_RING_BANDS.farSpacing);
    expect(farRingSpacing(100, cal, true)).toBeCloseTo(near * FAR_RING_BANDS.lowQualitySpacingFactor, 6);
    /* uncalibrated: the dressing ring's own spacing, unchanged */
    expect(farRingSpacing(100, null)).toBe(30);
    expect(farRingSpacing(100, null, true)).toBe(42);
  });
  it('never spaces stems tighter than 4 m however small the stands', () => {
    const scrub = calibrateFarRing({ standHeights: heights.map(() => 0.5), planting: STAND_PLANTING, crownRadiusAt: crownRadiusForHeight });
    expect(farRingSpacing(0, scrub)).toBeGreaterThanOrEqual(4);
  });
  it('draws a tree inside the measured height range with the stand allometry\'s crown', () => {
    const lo = farRingTree(cal, 0, 0), hi = farRingTree(cal, 0.999999, 1), mid = farRingTree(cal, 0.5, 0.5);
    expect(lo.height).toBeCloseTo(3, 5);
    expect(hi.height).toBeCloseTo(17.85, 2);
    expect(mid.height).toBeCloseTo(cal.medianHeight, 2);
    expect(lo.radius).toBeCloseTo(crownRadiusForHeight(3) * 0.85, 6);
    expect(hi.radius).toBeCloseTo(crownRadiusForHeight(17.85) * 1.15, 4);
    const light = farRingTree(cal, 0.5, 0.5, true);
    expect(light.height).toBeCloseTo(mid.height * FAR_RING_BANDS.lightHeightFactor, 6);
  });
  it('grows a thinned band quad to cover the stems it stands in for', () => {
    const near = Math.sqrt(cal.m2PerStem);
    const mid = farRingTree(cal, 0.5, 0.5);
    /* at the measured spacing a quad is one tree, so nothing grows */
    const alone = farRingTree(cal, 0.5, 0.5, false, FAR_RING_BANDS, near);
    expect(alone.height).toBeCloseTo(mid.height, 6);
    expect(alone.radius).toBeCloseTo(mid.radius, 6);
    /* four stems to a cell doubles the quad in both axes, so it draws the
       canopy area of the four it replaced rather than a quarter of it */
    const four = farRingTree(cal, 0.2, 0.5, false, FAR_RING_BANDS, near * 2);
    const single = farRingTree(cal, 0.2, 0.5);
    expect(four.height / single.height).toBeCloseTo(2, 6);
    expect(four.radius / single.radius).toBeCloseTo(2, 6);
    /* capped twice: by maximumClumpScale, and by the tallest tree this
       population carries -- a measured ceiling on the skyline */
    const many = farRingTree(cal, 0.5, 0.5, false, FAR_RING_BANDS, near * 20);
    expect(many.height / mid.height).toBeLessThanOrEqual(FAR_RING_BANDS.maximumClumpScale + 1e-9);
    const tallest = farRingTree(cal, 0.999999, 0.5, false, FAR_RING_BANDS, near * 20);
    expect(tallest.height).toBeCloseTo(cal.quantiles[cal.quantiles.length - 1], 4);
  });
});
