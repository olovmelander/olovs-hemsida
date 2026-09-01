import { describe, expect, it } from 'vitest';
import { createGroundStyleData } from './material.js';
import { SURFACE } from './surface.js';

const rgb = value => [value, value + 0.01, value + 0.02];
const C = Object.freeze({
  rough: rgb(0.10), forest: rgb(0.13), heath: rgb(0.16), semi: rgb(0.19),
  fair: rgb(0.22), fringe: rgb(0.25), green: rgb(0.28), tee: rgb(0.31),
  sand: rgb(0.34), path: rgb(0.37), aspL: rgb(0.40), hard: rgb(0.43),
  soil: rgb(0.46), wet: rgb(0.49), rock: rgb(0.52), shore: rgb(0.55),
});
const SHADE = Array.from({ length: 256 }, (_, id) => [id + 0.1, 0.2, 0.3, 0.4]);

describe('ground style data', () => {
  it('keeps the fourth mowing component spare for every class', () => {
    const { data, width, height } = createGroundStyleData(C, SHADE, { includeNatural: true });
    expect([width, height]).toEqual([32, 4]);
    for (let surfaceId = 0; surfaceId < width; surfaceId++) {
      expect(data[(width * 3 + surfaceId) * 4 + 3]).toBe(0);
    }
  });

  it('retains the approved mowing coordinate sources without an ownership flag', () => {
    const { data, width } = createGroundStyleData(C, SHADE, { includeNatural: true });
    const mowing = surfaceId => Array.from(
      data.subarray((width * 3 + surfaceId) * 4, (width * 3 + surfaceId + 1) * 4),
    );
    expect(mowing(SURFACE.GREEN)).toEqual([4.190000057220459, 0, 0, 0]);
    expect(mowing(SURFACE.FRINGE)).toEqual([2.9000000953674316, 0, 0, 0]);
    expect(mowing(SURFACE.FAIRWAY)).toEqual([0, 0.949999988079071, 0, 0]);
    expect(mowing(SURFACE.SEMI)).toEqual([0, 1.0499999523162842, 0, 0]);
    expect(mowing(SURFACE.TEE)).toEqual([0, 0, 2.859999895095825, 0]);
    expect(mowing(SURFACE.SAND)).toEqual([0, 0, 0, 0]);
  });
});
