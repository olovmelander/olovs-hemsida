import { describe, expect, it } from 'vitest';
import { buildExactClassSdf, despikeRing, fitFeatures, fitLine, fitRing } from './exact-class-sdf.mjs';
import { createGroundAtlas } from './atlas.js';
import { SURFACE, SURFACE_PRIORITY } from './surface.js';

const PRIORITY = SURFACE_PRIORITY.filter(id => id !== SURFACE.ROUGH);
const LIMIT = 4;
const circle = (cx, cz, r, n) => Array.from({ length: n }, (_, i) => {
  const a = i / n * Math.PI * 2;
  return [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
});
const square = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

/* what the material does with a plane: one bilinear tap between texel centres,
   then the class-sdf-v1 decode */
function bilinear(bytes, bounds, x, z) {
  const u = (x - bounds.x0) / bounds.res - 0.5, v = (z - bounds.z0) / bounds.res - 0.5;
  const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
  const at = (a, b) => bytes[Math.min(bounds.h - 1, Math.max(0, b)) * bounds.w + Math.min(bounds.w - 1, Math.max(0, a))];
  const byte = (at(i, j) * (1 - fu) + at(i + 1, j) * fu) * (1 - fv) + (at(i, j + 1) * (1 - fu) + at(i + 1, j + 1) * fu) * fv;
  return byte / 255 * 2 * LIMIT - LIMIT;
}

/* the radius at which a plane's reconstructed distance crosses zero, along a ray */
function zeroRadius(bytes, bounds, cx, cz, angle, from, to) {
  let lo = from, hi = to;
  for (let n = 0; n < 40; n++) {
    const mid = (lo + hi) / 2;
    if (bilinear(bytes, bounds, cx + Math.cos(angle) * mid, cz + Math.sin(angle) * mid) > 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

describe('the curve fit', () => {
  it('passes through every supplied vertex and adds the curve between them', () => {
    const ring = circle(0, 0, 10, 24);
    const fitted = fitRing(ring);
    expect(fitted.length).toBeGreaterThan(ring.length * 2);
    for (const p of ring) {
      const nearest = Math.min(...fitted.map(q => Math.hypot(q[0] - p[0], q[1] - p[1])));
      expect(nearest).toBeLessThan(1e-9);
    }
    /* a 24-gon of a 10 m circle cuts its chords 8.6 cm inside the arc; the
       fitted curve is the arc again */
    const worst = Math.max(...fitted.map(q => Math.abs(Math.hypot(q[0], q[1]) - 10)));
    expect(worst).toBeLessThan(0.01);
  });

  it('keeps a real corner a corner, and a rectangular tee deck straight', () => {
    expect(fitRing(square(0, 0, 12, 8))).toEqual(square(0, 0, 12, 8));
    /* a D: half a circle closed by a straight chord, two 90 degree corners */
    const half = Array.from({ length: 13 }, (_, i) => [Math.cos(i / 12 * Math.PI) * 10, Math.sin(i / 12 * Math.PI) * 10]);
    const fitted = fitRing(half);
    const onChord = fitted.filter(p => Math.abs(p[1]) < 1e-9);
    /* nothing bulges below the chord, so both ends stayed corners */
    expect(Math.min(...fitted.map(p => p[1]))).toBeGreaterThan(-1e-9);
    expect(onChord.length).toBe(2);
  });

  it('drops a duplicated closing vertex instead of fitting a zero-length span', () => {
    const ring = circle(0, 0, 10, 12);
    const closed = [...ring, [...ring[0]]];
    expect(fitRing(closed)).toEqual(fitRing(ring));
  });

  it('curves an open path between its own two ends, which stay where they were surveyed', () => {
    /* a quarter circle of radius 40 surveyed as seven points */
    const path = Array.from({ length: 7 }, (_, i) => [Math.cos(i / 6 * Math.PI / 2) * 40, Math.sin(i / 6 * Math.PI / 2) * 40]);
    const fitted = fitLine(path);
    expect(fitted[0]).toEqual(path[0]);
    expect(fitted[fitted.length - 1]).toEqual(path[6]);
    for (const p of path) expect(Math.min(...fitted.map(q => Math.hypot(q[0] - p[0], q[1] - p[1])))).toBeLessThan(1e-9);
    /* the chords cut 34 cm inside the arc. Between interior vertices the fitted
       line IS the arc; the two end spans are curvature-free at the end on
       purpose, so they sit between chord and arc -- and nothing runs past an end */
    const off = q => Math.abs(Math.hypot(q[0], q[1]) - 40);
    const angle = q => Math.atan2(q[1], q[0]) * 180 / Math.PI;
    expect(Math.max(...fitted.filter(q => angle(q) > 15 && angle(q) < 75).map(off))).toBeLessThan(0.05);
    expect(Math.max(...fitted.map(off))).toBeLessThan(0.25);
    expect(Math.min(...fitted.map(q => Math.min(q[0], q[1])))).toBeGreaterThan(-1e-9);
    expect(fitLine([[0, 0], [10, 3]])).toEqual([[0, 0], [10, 3]]);
  });

  it('fits only the lines of the surfaces it is told to', () => {
    const line = [[0, 0], [20, 4], [40, 14], [60, 30]];
    const { features } = fitFeatures([
      { surface: SURFACE.PATH, line, width: 0.65 },
      { surface: SURFACE.ASPHALT, line, width: 3.2 },
    ], { crisp: new Set([SURFACE.PATH, SURFACE.ASPHALT]), lines: new Set([SURFACE.PATH]) });
    expect(features[0].line.length).toBeGreaterThan(line.length);
    expect(features[0].width).toBe(0.65);
    expect(features[1].line).toBe(line);
  });

  it('fits one ring once, so a band stays an exact offset of its parent', () => {
    const ring = circle(30, 30, 10, 20);
    const { features } = fitFeatures([
      { surface: SURFACE.FRINGE, rings: [ring], pad: 3.2 },
      { surface: SURFACE.GREEN, rings: [ring] },
      { surface: SURFACE.FOREST, rings: [ring] },
    ], { crisp: new Set([SURFACE.FRINGE, SURFACE.GREEN]) });
    expect(features[0].rings[0]).toBe(features[1].rings[0]);
    expect(features[2].rings[0]).toBe(ring);
  });
});

describe('the digitiser\'s slips', () => {
  const has = (ring, p) => ring.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-9);
  /* a 60 x 30 m fairway with a needle out of its north side: out 5 m and straight back */
  const needle = [31, -5];
  const spiked = [[0, 0], [30, 0], needle, [32, 0], [60, 0], [60, 30], [0, 30]];

  it('removes a spike: out and straight back, on any surface', () => {
    const stats = { spikesRemoved: 0, teethRemoved: 0 };
    const out = despikeRing(spiked, { stats });
    expect(has(out, needle)).toBe(false);
    expect(stats).toEqual({ spikesRemoved: 1, teethRemoved: 0 });
    /* and nothing else moved: the four real corners are all still there */
    for (const corner of [[0, 0], [60, 0], [60, 30], [0, 30]]) expect(has(out, corner)).toBe(true);
  });

  it('spares a real neck: the same turn on twenty-metre legs is the fairway', () => {
    const neck = [[0, 0], [30, 0], [31, -22], [32, 0], [60, 0], [60, 30], [0, 30]];
    expect(despikeRing(neck)).toHaveLength(neck.length);
  });

  it('removes teeth only where it is told to, and only ones that enclose next to nothing', () => {
    /* a jog of 0.4 m on a fairway edge: two sharp vertices enclosing a fraction of a square metre */
    const jogged = [[0, 0], [20, 0], [20.2, 0.4], [20.4, 0], [60, 0], [60, 30], [0, 30]];
    expect(despikeRing(jogged, { teeth: true }).length).toBeLessThan(jogged.length);
    expect(despikeRing(jogged, { teeth: true }).some(p => p[1] === 0.4)).toBe(false);
    /* a bunker's lobe is a sharp vertex of about a square metre and a half: never asked */
    const lobed = circle(0, 0, 4, 9).map((p, i) => (i === 3 ? [p[0] * 1.35, p[1] * 1.35] : p));
    expect(despikeRing(lobed)).toHaveLength(lobed.length);
    /* and a tee deck's corners enclose twenty square metres: safe even when asked */
    expect(despikeRing([[0, 0], [12, 0], [12, 8], [6, 8.5], [0, 8]], { teeth: true })).toHaveLength(5);
  });

  it('takes the stairs out BEFORE the teeth, so a raster trace is straightened, not eaten', () => {
    const stair = [];
    const leg = (x, z, dx, dz) => { for (let k = 0; k < 28; k++) { stair.push([x, z]); x += dx; stair.push([x, z]); z += dz; } return [x, z]; };
    let p = [0, 28];
    p = leg(p[0], p[1], 1, -1); p = leg(p[0], p[1], 1, 1); p = leg(p[0], p[1], -1, 1); leg(p[0], p[1], -1, -1);
    const { features, stats } = fitFeatures([{ surface: SURFACE.FAIRWAY, rings: [stair] }],
      { crisp: new Set([SURFACE.FAIRWAY]), toothed: new Set([SURFACE.FAIRWAY]) });
    expect(stats.unstaired).toBe(1);
    const area = r => { let a = 0; for (let i = 0; i < r.length; i++) { const u = r[i], v = r[(i + 1) % r.length]; a += u[0] * v[1] - v[0] * u[1]; } return Math.abs(a / 2); };
    expect(Math.abs(area(features[0].rings[0]) - area(stair)) / area(stair)).toBeLessThan(0.03);
  });
});

describe('exact per-class distance fields', () => {
  const CORE = { x0: 0, z0: 0, x1: 60, z1: 60 };
  const ring = fitRing(circle(30.3, 29.6, 10, 24));
  const exact = buildExactClassSdf({
    CORE, res: 1, limit: LIMIT, priority: PRIORITY, ringSurfaces: [SURFACE.GREEN, SURFACE.TEE],
    features: [
      { surface: SURFACE.FRINGE, rings: [ring], pad: 3.2 },
      { surface: SURFACE.GREEN, rings: [ring] },
    ],
  });

  it('puts the reconstructed green edge on the curve, all the way round', () => {
    const green = exact.planes.get(SURFACE.GREEN);
    let worst = 0;
    for (let n = 0; n < 360; n++) {
      const r = zeroRadius(green, exact.bounds, 30.3, 29.6, n / 360 * Math.PI * 2, 6, 14);
      worst = Math.max(worst, Math.abs(r - 10));
    }
    /* the field grown from the 1 m raster measured 0.3-0.9 m here; h*h/(8R) is
       1.25 cm, and the byte's own quantum is 3.1 cm */
    expect(worst).toBeLessThan(0.06);
  });

  it('draws a collar as an exact offset of its green, with no watershed inside it', () => {
    const fringe = exact.planes.get(SURFACE.FRINGE), green = exact.planes.get(SURFACE.GREEN);
    let worst = 0;
    for (let n = 0; n < 360; n++) {
      const r = zeroRadius(fringe, exact.bounds, 30.3, 29.6, n / 360 * Math.PI * 2, 11.6, 15);
      worst = Math.max(worst, Math.abs(r - 13.2));
    }
    expect(worst).toBeLessThan(0.06);
    /* the priority step: a texel is never inside both, and the collar's inner
       edge IS the green's edge -- their bytes mirror each other across it */
    for (let k = 0; k < green.length; k++) expect(fringe[k] + green[k]).toBeLessThanOrEqual(255);
    /* mid-collar is the ridge between two ramps (1.6 m from either edge); a 1 m
       tap rounds a ridge, and what is left is still dozens of edge widths deep */
    const mid = bilinear(fringe, exact.bounds, 30.3 + 11.6, 29.6);
    expect(mid).toBeGreaterThan(0.9);
  });

  it('measures every side of a shape alike', () => {
    const sq = buildExactClassSdf({
      CORE, res: 1, limit: LIMIT, priority: PRIORITY, ringSurfaces: [SURFACE.GREEN],
      features: [{ surface: SURFACE.GREEN, rings: [square(10, 10, 50, 50)] }],
    });
    const green = sq.planes.get(SURFACE.GREEN), w = sq.bounds.w;
    const at = (i, j) => green[j * w + i];
    expect(at(10, 30)).toBe(at(49, 30));
    expect(at(30, 10)).toBe(at(30, 49));
    expect(at(10, 30)).toBe(at(30, 10));
    expect(at(9, 30)).toBe(at(50, 30));
    /* the mow-ring coordinate: equal from facing edges, and unclamped to the middle */
    const ringAt = (i, j) => sq.ringBytes[j * w + i] * sq.ringStep;
    expect(ringAt(12, 30)).toBeCloseTo(ringAt(47, 30), 5);
    expect(ringAt(30, 30)).toBeCloseTo(19.5, 0);
  });

  it('never makes rough a channel', () => {
    const withRough = buildExactClassSdf({
      CORE, res: 1, limit: LIMIT, priority: PRIORITY,
      features: [{ surface: SURFACE.ROUGH, rings: [square(10, 10, 50, 50)] }, { surface: SURFACE.GREEN, rings: [ring] }],
    });
    expect(withRough.channels).toEqual([SURFACE.GREEN]);
  });
});

describe('the waterline, for the damp bank', () => {
  const CORE = { x0: 0, z0: 0, x1: 60, z1: 60 };
  const green = { surface: SURFACE.GREEN, rings: [circle(45, 45, 6, 16)] };

  it('is the exact distance to the shore, and rides in the slot after the last class', () => {
    const pond = square(10, 10, 30, 30);
    const atlas = createGroundAtlas({ CORE, features: [green], res: 1, waterRings: [pond] });
    expect(atlas.exactEdges.bankSlot).toBe(atlas.exactEdges.channels.length);
    const slot = atlas.exactEdges.bankSlot, data = atlas.exactEdges.texSdf[slot >> 2].image.data;
    const at = (i, j) => data[(j * 60 + i) * 4 + (slot & 3)] * atlas.exactEdges.bankStepMetres;
    /* texel centres: 2.5 m and 0.5 m outside the east shore, then far away */
    expect(at(32, 20)).toBeCloseTo(2.5, 1);
    expect(at(30, 20)).toBeCloseTo(0.5, 1);
    expect(at(55, 5)).toBeCloseTo(12.75, 2);
    atlas.dispose();
  });

  it('never takes a cut edge for a shore', () => {
    /* a lake clipped by the extract: its 400 m closing edge runs across dry land */
    const clipped = [[-200, 20], [200, 20], [200, 25], [-200, 25]];
    const exact = buildExactClassSdf({ CORE, res: 1, limit: LIMIT, priority: PRIORITY, features: [green], waterRings: [clipped] });
    const k = 20 * 60 + 30;
    expect(exact.bankBytes[k]).toBe(255);
  });

  it('is absent where there is no water', () => {
    const atlas = createGroundAtlas({ CORE, features: [green], res: 1 });
    expect(atlas.exactEdges.bankSlot).toBeNull();
    atlas.dispose();
  });
});

describe('the boot atlas', () => {
  const CORE = { x0: 0, z0: 0, x1: 60, z1: 60 };
  const features = [
    { surface: SURFACE.FRINGE, rings: [circle(30, 30, 10, 24)], pad: 3.2 },
    { surface: SURFACE.GREEN, rings: [circle(30, 30, 10, 24)] },
  ];

  it('carries exact fields beside the class raster by default, in priority order', () => {
    const atlas = createGroundAtlas({ CORE, features, res: 1 });
    expect(atlas.exactEdges.channels).toEqual([SURFACE.GREEN, SURFACE.FRINGE]);
    expect(atlas.exactEdges.texSdf).toHaveLength(1);
    expect(atlas.exactEdges.limitMetres).toBe(4);
    expect(atlas.sampleAt(30, 30).surface).toBe(SURFACE.GREEN);
    expect(atlas.sampleAt(42, 30).surface).toBe(SURFACE.FRINGE);
    atlas.dispose();
  });

  it('is the atlas as it was under edges: pair, and refuses a mode it does not know', () => {
    const atlas = createGroundAtlas({ CORE, features, res: 1, edges: 'pair' });
    expect(atlas.exactEdges).toBeUndefined();
    expect(() => createGroundAtlas({ CORE, features, res: 1, edges: 'soft' })).toThrow(/unknown ground atlas edges/);
  });
});
