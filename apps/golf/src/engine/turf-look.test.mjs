import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SURFACE } from './surface.js';
import { TURF_LOOK, tourGradeOf } from './turf-look.mjs';
import { NEAR_GRASS, NEAR_GRASS_TOUR, nearGrassLayout } from './near-grass.mjs';

const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe('the tour turf', () => {
  it('gives every ground class a material channel, an amplitude and a bump', () => {
    for (const sid of [SURFACE.FAIRWAY, SURFACE.GREEN, SURFACE.TEE, SURFACE.ROUGH, SURFACE.FOREST, SURFACE.SAND, SURFACE.PATH, SURFACE.GRAVEL, SURFACE.ASPHALT]) {
      const [channel, amplitude, bump] = TURF_LOOK.classes[sid];
      expect(['r', 'g', 'b', 'a']).toContain(channel);
      expect(amplitude).toBeGreaterThan(0); expect(amplitude).toBeLessThan(0.35);
      expect(bump).toBeGreaterThan(0); expect(bump).toBeLessThan(0.01);
    }
    /* mown cuts take the laid blades, the rough the wild ones, gravel the pebbles */
    expect(TURF_LOOK.classes[SURFACE.FAIRWAY][0]).toBe('r');
    expect(TURF_LOOK.classes[SURFACE.ROUGH][0]).toBe('g');
    expect(TURF_LOOK.classes[SURFACE.GRAVEL][0]).toBe('b');
    /* a green is the smoothest turf */
    expect(TURF_LOOK.classes[SURFACE.GREEN][1]).toBeLessThan(TURF_LOOK.classes[SURFACE.FAIRWAY][1]);
  });
  it('grades the cuts warmer, keeps the green cooler than the fairway, and the rough darker', () => {
    const fairway = tourGradeOf(SURFACE.FAIRWAY), green = tourGradeOf(SURFACE.GREEN), rough = tourGradeOf(SURFACE.ROUGH);
    expect(fairway[0]).toBeGreaterThan(fairway[2]);
    expect(green[2] / green[1]).toBeGreaterThanOrEqual(fairway[2] / fairway[1] - 0.05);
    expect(luma(rough)).toBeLessThan(1);
    expect(tourGradeOf(SURFACE.SAND)).toBeNull();
  });
  it('draws stronger stripes than the painted ground, fairways most', () => {
    expect(TURF_LOOK.stripes[SURFACE.FAIRWAY]).toBeGreaterThan(0.05);
    expect(TURF_LOOK.stripes[SURFACE.FAIRWAY]).toBeGreaterThanOrEqual(Math.max(...Object.values(TURF_LOOK.stripes)));
  });
  it('grows the rough round the ball finer and denser at high quality only', () => {
    expect(nearGrassLayout('hi', { tour: true }).blades).toBe(NEAR_GRASS_TOUR.blades.hi);
    expect(nearGrassLayout('hi').blades).toBe(NEAR_GRASS.quality.hi.blades);
    expect(nearGrassLayout('lo', { tour: true }).blades).toBe(NEAR_GRASS.quality.lo.blades);
    expect(NEAR_GRASS_TOUR.widthShare).toBeLessThan(NEAR_GRASS.widthShare);
  });
  it('is on by default in main.js, ?turf=painted the before, the blades graded as the ground', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toContain("const TOUR_TURF_ON = new URLSearchParams(location.search).get('turf') !== 'painted';");
    expect(main).toContain('turf: TOUR_TURF,');
    expect(main).toContain('tourGrade: TOUR_TURF_ON,');
  });
});

describe('the tour tussock', async () => {
  const { tourTussockBlades, tussockBlades } = await import('./ground-cover.mjs');
  it('is a clump of narrow blades, not three wide ones', () => {
    const { positions, normals } = tourTussockBlades();
    expect(positions.length).toBe(14 * 9);
    expect(normals.length).toBe(positions.length);
    for (let b = 0; b < 14; b++) {
      const p = positions.slice(b * 9, b * 9 + 9);
      const rootWidth = Math.hypot(p[0] - p[3], p[2] - p[5]);
      expect(rootWidth).toBeLessThan(0.04);
      expect(p[7]).toBeGreaterThan(0.15);
    }
    expect(tussockBlades().positions.length).toBe(27);
    expect(tourTussockBlades()).toEqual(tourTussockBlades());
  });
});
