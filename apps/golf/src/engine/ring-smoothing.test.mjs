import { describe, expect, it } from 'vitest';
import { smoothMownEdges, smoothShore } from './ring-smoothing.mjs';
import { withInferredTeePads } from './tee-pads.mjs';

const square = (cx, cz, r) => [[cx - r, cz - r], [cx + r, cz - r], [cx + r, cz + r], [cx - r, cz + r]];
/* a twelve-sided green, the shape a survey typically leaves */
const dodecagon = (cx, cz, r) => Array.from({ length: 12 }, (_, i) =>
  [cx + Math.cos(i / 12 * Math.PI * 2) * r, cz + Math.sin(i / 12 * Math.PI * 2) * r]);

describe('mown-edge smoothing shared by boot and compiler', () => {
  it('rounds a polygon without touching the caller', () => {
    const ring = dodecagon(0, 0, 10);
    const frozen = JSON.stringify(ring);
    const out = smoothShore(ring, () => true, 2.0, 2, 6);
    expect(JSON.stringify(ring)).toBe(frozen);
    expect(out.length).toBeGreaterThan(ring.length);
    /* a rounded corner lies inside the original vertex radius */
    for (const p of out) expect(Math.hypot(p[0], p[1])).toBeLessThanOrEqual(10 + 1e-9);
  });

  it('preserves adopted DTM shoreline vertices instead of averaging their steps', () => {
    const shore = [[0, 0], [12, 0], [12, 2], [10, 2], [10, 10], [6, 10], [6, 8], [0, 8]];
    const before = JSON.stringify(shore);
    expect(smoothShore(shore, () => true, 3, 3, 8, { preserveMappedBoundaries: true })).toEqual(shore);
    expect(JSON.stringify(shore)).toBe(before);
    expect(smoothShore(shore, () => true)).not.toEqual(shore);
  });

  it('keeps every adopted green, fairway and tee vertex, including shared scenery and polygon holes', () => {
    const green = dodecagon(0, 0, 10), fairway = dodecagon(0, 100, 30), tee = dodecagon(0, 200, 12);
    const holes = [{ n: 1, green: { ring: green }, fairway: { rings: [fairway] }, tees: { pads: [{ ring: tee }] } }];
    const scenery = { greens: [green], fairways: [fairway], tees: [tee],
      mappedFeatures: [{ kind: 'practice_green', rings: [green, square(0, 0, 2)] }] };
    const before = JSON.stringify({ holes, scenery });
    const out = smoothMownEdges({ holes, scenery, preserveMappedBoundaries: true });
    expect(JSON.stringify(out)).toBe(before);
    expect(JSON.stringify({ holes, scenery })).toBe(before);
    const legacy = smoothMownEdges({ holes, scenery });
    expect(legacy.holes[0].green.ring).not.toEqual(green);
    expect(legacy.holes[0].fairway.rings[0]).not.toEqual(fairway);
    expect(legacy.holes[0].tees.pads[0].ring).not.toEqual(tee);
  });

  it('smooths greens, fairways and mapped tee pads, leaves synthesised pads and the input alone', () => {
    const holes = [{
      n: 1,
      green: { ring: dodecagon(0, 0, 10), c: [0, 0] },
      fairway: { rings: [dodecagon(0, 100, 30)] },
      tees: { pads: [
        /* 12 m radius: a 6.3 m segment splits at the 2.5 m tee step; a
           small pad's 3 m segments are already finer than the step and stay */
        { ring: dodecagon(0, 200, 12) },
        { ring: square(0, 220, 5), prov: 'synth' },
      ] },
    }];
    const scenery = { fairways: [dodecagon(50, 50, 20)], greens: [dodecagon(60, 60, 8)] };
    const before = JSON.stringify({ holes, scenery });
    const out = smoothMownEdges({ holes, scenery });
    expect(JSON.stringify({ holes, scenery })).toBe(before);
    expect(out.holes[0].green.ring.length).toBeGreaterThan(12);
    expect(out.holes[0].fairway.rings[0].length).toBeGreaterThan(12);
    expect(out.holes[0].tees.pads[0].ring.length).toBeGreaterThan(12);
    expect(out.holes[0].tees.pads[1].ring).toEqual(square(0, 220, 5));
    expect(out.scenery.fairways[0].length).toBeGreaterThan(12);
    expect(out.scenery.greens[0].length).toBeGreaterThan(12);
  });
});

describe('tee pad inference shared by boot and compiler', () => {
  it('adds a deck under an uncovered mark, squared to the hole line, and none under a covered one', () => {
    const holes = [{
      n: 2,
      line: [[0, 0], [0, -300]],
      tees: {
        marks: [{ c: [0, 0], teeIdx: 0 }, { c: [0, -40], teeIdx: 1 }],
        pads: [{ ring: square(0, 0, 6) }],
      },
    }];
    const before = JSON.stringify(holes);
    const out = withInferredTeePads(holes);
    expect(JSON.stringify(holes)).toBe(before);
    expect(out[0].tees.pads).toHaveLength(2);
    const synth = out[0].tees.pads[1];
    expect(synth.prov).toBe('synth');
    expect(synth.teeIdx).toBe(1);
    /* the hole runs due north (-z): 10.4 m across the line, 8.8 m along it */
    const xs = synth.ring.map(p => p[0]), zs = synth.ring.map(p => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(10.4, 6);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(8.8, 6);
    expect(out[0].tees.marks[1].b).toBeCloseTo(180, 6);
  });
});
