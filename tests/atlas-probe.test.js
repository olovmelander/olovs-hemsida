import { describe, expect, it } from 'vitest';
import { createGroundAtlas, rasterizeGroundAtlas } from '../apps/golf/src/engine/atlas.js';
import { surfacePairGuardMetres, surfacePairWeight } from '../apps/golf/src/engine/material.js';
import { SURFACE } from '../apps/golf/src/engine/surface.js';

const CORE = { x0: 0, z0: 0, x1: 40, z1: 40 };
const square = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

describe('runtime ground atlas', () => {
  it('rasterizes distinct grass and sand classes rather than an empty rough map', () => {
    const atlas = createGroundAtlas({
      CORE,
      HOLES: [{ n: 1, line: [[2, 20], [38, 20]] }],
      features: [
        { surface: SURFACE.SEMI, rings: [square(6, 8, 34, 32)], pad: 3, hole: 1, mow: 'route', mowK: 1.05 },
        { surface: SURFACE.FAIRWAY, rings: [square(6, 8, 34, 32)], hole: 1, mow: 'route', mowK: 0.95 },
        { surface: SURFACE.GREEN, rings: [square(25, 14, 33, 26)], hole: 1, mow: 'green' },
        { surface: SURFACE.SAND, rings: [square(12, 15, 17, 19)], pad: 0.5, hole: 1 },
      ],
      res: 1,
    });

    expect(atlas.sampleAt(2, 2).surface).toBe(SURFACE.ROUGH);
    expect(atlas.sampleAt(4, 20).surface).toBe(SURFACE.SEMI);
    expect(atlas.sampleAt(20, 20).surface).toBe(SURFACE.FAIRWAY);
    expect(atlas.sampleAt(29, 20).surface).toBe(SURFACE.GREEN);
    expect(atlas.sampleAt(14, 17).surface).toBe(SURFACE.SAND);
    expect(atlas.classifyAt(14, 17).sand).toBe(1);
    expect(atlas.classifyAt(20, 20).fair).toBe(1);
  });

  it('uses explicit overlap priority independent of feature insertion order', () => {
    const ring = square(10, 10, 30, 30);
    const features = [
      { surface: SURFACE.GREEN, rings: [ring] },
      { surface: SURFACE.SAND, rings: [ring] },
      { surface: SURFACE.FAIRWAY, rings: [ring] },
    ];
    const a = createGroundAtlas({ CORE, features, res: 1 });
    const b = createGroundAtlas({ CORE, features: features.toReversed(), res: 1 });
    expect(a.sampleAt(20, 20).surface).toBe(SURFACE.SAND);
    expect(b.sampleAt(20, 20).surface).toBe(SURFACE.SAND);
  });

  it('encodes a signed, consistently paired boundary at the analytic edge', () => {
    const data = rasterizeGroundAtlas({
      CORE,
      features: [{ surface: SURFACE.FAIRWAY, rings: [square(10, 10, 30, 30)] }],
      res: 1,
    });
    const at = (i, j) => {
      const k = j * data.bounds.w + i;
      return {
        surface: data.classes[k],
        primary: data.idData[k * 2],
        secondary: data.idData[k * 2 + 1],
        sdf: data.signedDistance[k],
      };
    };
    const outside = at(9, 20), inside = at(10, 20);
    expect(outside.surface).toBe(SURFACE.ROUGH);
    expect(inside.surface).toBe(SURFACE.FAIRWAY);
    expect([outside.primary, outside.secondary]).toEqual([SURFACE.FAIRWAY, SURFACE.ROUGH]);
    expect([inside.primary, inside.secondary]).toEqual([SURFACE.FAIRWAY, SURFACE.ROUGH]);
    expect(outside.sdf).toBeCloseTo(-0.5, 5);
    expect(inside.sdf).toBeCloseTo(0.5, 5);
    /* The two texel centres are x=9.5 and x=10.5, so their linear SDF zero is x=10. */
    const zero = 9.5 + (0 - outside.sdf) / (inside.sdf - outside.sdf);
    expect(zero).toBeCloseTo(10, 5);
  });

  it('carries an UNCLAMPED ring distance, so a wide green keeps its mow rings', () => {
    /* The SDF is clamped to +/-8 m for edge precision. Greens run 20-30 m
       across, so taking the ring coordinate from it left the whole middle of
       every green saturated at 8 -- a flat disc with a banded rim. */
    const BIG = { x0: 0, z0: 0, x1: 60, z1: 60 };
    const data = rasterizeGroundAtlas({
      CORE: BIG,
      features: [{ surface: SURFACE.GREEN, rings: [square(10, 10, 50, 50)] }],
      res: 1,
    });
    const at = (x, z) => {
      const k = Math.floor(z) * data.bounds.w + Math.floor(x);
      return { sdf: data.signedDistance[k], ring: data.fieldData[k * 4 + 3] * 0.16 };
    };
    const middle = at(30, 30);
    expect(middle.sdf).toBeCloseTo(8, 5);         /* the SDF does saturate */
    expect(middle.ring).toBeGreaterThan(18);       /* the ring channel does not */
    /* and it still tracks the edge where the SDF has not saturated */
    expect(at(13, 30).ring).toBeGreaterThan(2);
    expect(at(13, 30).ring).toBeLessThan(5);
  });

  it('builds nearest-hole distance once for all CPU consumers', () => {
    const atlas = createGroundAtlas({
      CORE,
      HOLES: [{ n: 7, line: [[2, 20], [38, 20]] }],
      features: [{ surface: SURFACE.FAIRWAY, rings: [square(5, 8, 35, 32)], hole: 7, mow: 'route', mowK: 0.95 }],
      res: 1,
    });
    const centre = atlas.sampleAt(20, 20);
    const offset = atlas.sampleAt(20, 27);
    expect(centre.hole).toBe(7);
    expect(centre.dLine).toBeLessThan(1);
    expect(offset.dLine).toBeGreaterThan(6);
    expect(offset.dLine).toBeLessThan(8.5);
    /* the shader rebuilds mow phase per fragment from the route-distance byte,
       stored at 0.25 m steps -- never from a wrapped phase */
    const k = 27 * atlas.data.bounds.w + 20;
    expect(atlas.data.fieldData[k * 4 + 1]).toBe(Math.round(offset.dLine * 4));
  });
});

/* THE RING ROUND EVERY BUNKER.

   The pair field is signed by which of a texel's two classes has priority, so
   two texels deep inside ONE fairway read -8 (the nearest other class is the
   bunker, which outranks fairway) and +8 (it is the semi, which does not).
   Both render fairway on their own; linear filtering between them sweeps the
   whole way through zero, the transition smoothstep sees a crossing, and the
   shader paints the pair's higher-priority class at full strength. That was the
   pale stair-stepped ring about eight metres out from every bunker.

   These tests run the material's OWN sampling on the CPU -- ids nearest, the
   field bilinear over the 2x2 neighbourhood -- so the fixture measures what a
   fragment is actually handed, not a one-dimensional idea of it. */
describe('the pair field across a watershed', () => {
  const BOX = { x0: 0, z0: 0, x1: 120, z1: 120 };
  const disc = (cx, cz, r, n = 24) => Array.from({ length: n }, (_, i) => {
    const a = i / n * Math.PI * 2;
    return [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
  });
  const bunkerInAFairway = () => rasterizeGroundAtlas({
    CORE: BOX,
    HOLES: [{ n: 1, line: [[10, 60], [110, 60]] }],
    features: [
      { surface: SURFACE.SEMI, rings: [square(15, 35, 105, 85)], pad: 4, hole: 1 },
      { surface: SURFACE.FAIRWAY, rings: [square(15, 35, 105, 85)], hole: 1 },
      { surface: SURFACE.SAND, rings: [disc(60, 60, 8)], hole: 1 },
    ],
    res: 1,
  });

  /* A fragment paints a class that is not there when it gives real weight to a
     class whose own edge, at the texel its ids came from, is metres away. */
  const FAR_METRES = 2.5, ALIEN_SHARE = 0.08;
  const absentClassFragments = (data, weightOf, halfWidth = 0.7) => {
    const { w, h, res } = data.bounds;
    const sd = data.signedDistance;
    const at = (i, j) => sd[Math.min(h - 1, Math.max(0, j)) * w + Math.min(w - 1, Math.max(0, i))];
    const bilinear = (fi, fj) => {
      const i = Math.floor(fi - 0.5), j = Math.floor(fj - 0.5);
      const u = fi - 0.5 - i, v = fj - 0.5 - j;
      return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v)
        + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
    };
    const byClass = new Map();
    for (let fj = 0.5; fj < h - 0.5; fj += 0.2) for (let fi = 0.5; fi < w - 0.5; fi += 0.2) {
      const k = Math.floor(fj) * w + Math.floor(fi);
      const own = sd[k];
      if (Math.abs(own) < FAR_METRES) continue;          /* genuinely near an edge */
      const mine = data.classes[k];
      const primary = data.idData[k * 2], secondary = data.idData[k * 2 + 1];
      const weight = weightOf({ filtered: bilinear(fi, fj), nearest: own, halfWidth, res });
      const alien = (primary === mine ? 0 : weight) + (secondary === mine ? 0 : 1 - weight);
      if (alien < ALIEN_SHARE) continue;
      const other = primary === mine ? secondary : primary;
      byClass.set(other, (byClass.get(other) || 0) + 1);
    }
    return byClass;
  };

  const unguarded = ({ filtered, halfWidth }) => {
    const t = Math.min(1, Math.max(0, (filtered + halfWidth) / (2 * halfWidth)));
    return t * t * (3 - 2 * t);
  };

  it('an unguarded blend paints sand into grass that is eight metres from a bunker', () => {
    const painted = absentClassFragments(bunkerInAFairway(), unguarded);
    expect(painted.get(SURFACE.SAND)).toBeGreaterThan(10);
  });

  it('the guard leaves every fragment showing a class that is actually there', () => {
    expect([...absentClassFragments(bunkerInAFairway(), surfacePairWeight)]).toEqual([]);
  });

  it('and still hands a real cut to the filtered blend', () => {
    /* At a genuine edge the nearest texel reads half a texel, well inside the
       guard's start, so the weight must sweep from secondary to primary. */
    const at = x => surfacePairWeight({ filtered: x, nearest: x < 0 ? -0.5 : 0.5, halfWidth: 0.55, res: 1 });
    expect(at(-0.5)).toBeLessThan(0.06);
    expect(at(0)).toBeCloseTo(0.5, 2);
    expect(at(0.5)).toBeGreaterThan(0.94);
  });

  it('never guards tighter than the pixel footprint, so a distant edge keeps its ramp', () => {
    /* Three metres of ground per pixel: the wide screen-space ramp IS the
       antialiasing, and clipping it at 2.5 m would put the staircase back. */
    const { start, end } = surfacePairGuardMetres(1, 3);
    expect(start).toBe(6);
    expect(end).toBe(12);
    const far = surfacePairWeight({ filtered: 3, nearest: 4, halfWidth: 6, res: 1, footprintMetres: 3 });
    expect(far).toBeGreaterThan(0.6);
    expect(far).toBeLessThan(0.9);
  });
});
