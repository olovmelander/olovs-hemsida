import { describe, expect, it } from 'vitest';
import { shoreLevel, WATER_LEVEL } from './water-level.mjs';

const square = (half, cx = 0, cz = 0) => [[cx - half, cz - half], [cx + half, cz - half], [cx + half, cz + half], [cx - half, cz + half]];
/* a dug pond: a flat laser surface (the day it was flown) inside a basin whose sides rise
   0.1 m a metre from the edge of that surface */
const basin = (flatHalf, surface = 10) => (x, z) => {
  const d = Math.max(Math.abs(x), Math.abs(z)) - flatHalf;
  return d <= 0 ? surface : surface + d * 0.1;
};

describe('one way to stand the water at its level', () => {
  it('fills a pond to its traced outline where the laser caught its water low', () => {
    /* the laser's surface reaches 20 m out; the aerial's outline is the 0.3 m contour, 23 m */
    const level = shoreLevel({ ring: square(23), heightAt: basin(20) });
    expect(level.method).toBe('shore-fit');
    expect(level.surfaceMetres).toBe(10);
    expect(level.shoreMetres).toBeGreaterThan(10.25);
    expect(level.shoreMetres).toBeLessThan(10.35);
    expect(level.level).toBeCloseTo(level.shoreMetres + 0.06, 1);
    expect(level.overlap).toBeGreaterThan(0.9);
  });

  it('keeps a large flat lake the laser measured within a decimetre of that surface', () => {
    /* an outline drawn loosely 8 m up the banks of a 200 m lake */
    const level = shoreLevel({ ring: square(108), heightAt: basin(100) });
    expect(level.large).toBe(true);
    expect(level.shoreMetres - 10).toBeLessThanOrEqual(WATER_LEVEL.largeLakeRiseMetres + 1e-9);
    expect(level.shoreMetres).toBeGreaterThanOrEqual(10);
  });

  it('stands an outline that misses the basin at its own ground, never below the measured water', () => {
    /* the outline is traced 30 m off the hollow the laser saw: it lies on the bank */
    const level = shoreLevel({ ring: square(12, 30, 0), heightAt: basin(10) });
    expect(level.method).toBe('outline-ground');
    expect(level.shoreMetres).toBeGreaterThanOrEqual(10);
    expect(level.level).toBeCloseTo(level.shoreMetres + 0.06, 2);
  });

  it('never stands a pond below the laser\'s own water', () => {
    const level = shoreLevel({ ring: square(15), heightAt: basin(20, 31.4) });
    expect(level.shoreMetres).toBeGreaterThanOrEqual(31.4);
  });
});
