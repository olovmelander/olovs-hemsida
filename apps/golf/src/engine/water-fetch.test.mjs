/* A lake's chop and wash only where the wind has room (engine/water-fetch.mjs). */
import { describe, expect, it } from 'vitest';
import { LAKE_FETCH_METRES, waterFetch, waterFetchRadius, waterMeshStep } from './water-fetch.mjs';

const circle = (r, n = 64) => Array.from({ length: n }, (_, i) => [r * Math.cos(i / n * Math.PI * 2), r * Math.sin(i / n * Math.PI * 2)]);
const strip = (length, width) => [[0, 0], [length, 0], [length, width], [0, width]];

describe('how much water the wind has', () => {
  it('is a round pond\'s radius and about half a stream\'s width, either winding', () => {
    expect(waterFetchRadius(circle(40))).toBeCloseTo(40, 0);
    expect(waterFetchRadius(strip(400, 12))).toBeCloseTo(2 * 400 * 12 / (2 * 412), 5);
    expect(waterFetchRadius(strip(400, 12).reverse())).toBeCloseTo(waterFetchRadius(strip(400, 12)), 9);
    expect(waterFetchRadius([])).toBe(0);
  });

  it('gives a flagged lake its chop only when it is wide enough', () => {
    expect(waterFetch({ isLake: true, ring: circle(LAKE_FETCH_METRES + 5) })).toBe(1);
    /* a 50 x 50 m field pond flagged a lake: a pond; 60 x 60 m is the first with fetch */
    expect(waterFetch({ isLake: true, ring: strip(50, 50) })).toBe(0);
    expect(waterFetch({ isLake: true, ring: strip(60, 60) })).toBe(1);
    /* a long stream flagged a lake has no fetch across it */
    expect(waterFetch({ isLake: true, ring: strip(2000, 20) })).toBe(0);
    /* unflagged water stays a pond however large */
    expect(waterFetch({ isLake: false, ring: circle(500) })).toBe(0);
  });

  it('keeps the before: every flagged lake a lake', () => {
    expect(waterFetch({ isLake: true, ring: strip(50, 50) }, { legacy: true })).toBe(1);
    expect(waterFetch({ isLake: false, ring: circle(500) }, { legacy: true })).toBe(0);
  });

  it('meshes a pond for its shore distance and a lake for its normals', () => {
    const pond = { isLake: true, ring: strip(30, 30) }, lake = { isLake: true, ring: circle(300) };
    expect(waterMeshStep(pond, waterFetch(pond))).toBe(9);
    expect(waterMeshStep(lake, waterFetch(lake))).toBe(34);
    expect(waterMeshStep({ isLake: false, surr: true, ring: circle(300) }, 0)).toBe(30);
    expect(waterMeshStep({ isLake: false, ring: circle(10) }, 0)).toBe(9);
    /* the before's steps, exactly: a flagged lake 34 m, the surroundings 30 m, the rest 9 m */
    for (const w of [pond, lake, { isLake: false, surr: true }, { isLake: false }]) {
      expect(waterMeshStep(w, waterFetch({ ring: [], ...w }, { legacy: true }))).toBe(w.isLake ? 34 : w.surr ? 30 : 9);
    }
  });
});
