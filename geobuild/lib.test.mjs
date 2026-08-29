/* Unit tests for the shared geometry/codec in geobuild/lib.mjs.

   These encode the hard-won invariants CLAUDE.md records, so a refactor that
   re-derives any of them re-fights old battles against a failing test instead
   of against a mirrored golf course:

   - the frame: north is -z, east is +x, a compass bearing is atan2(dx, -dz);
   - alongLine's angle b has forward = (sin b, cos b) and the player's RIGHT
     hand at (-Fz, Fx) = (-cos b, sin b) — the (cos b, -sin b) reflection is
     the exact bug that once mirrored 51 bunkers and every sided OB run;
   - the heightfield codec round-trips within its 10 cm quantum (the small
     reproduction of what check3d gates on) and is byte-deterministic.       */
import { describe, it, expect } from 'vitest';
import {
  bearing, forward, right, alongLine,
  polyLen, polyArea, centroid, pointInPoly, polySD,
  quantizeHF, decodeHF, deflateB64, inflateB64, lcg,
} from './lib.mjs';

const PI = Math.PI;
const close = (a, b, eps = 1e-12) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

describe('the frame: bearing / forward / right', () => {
  it('compass bearing is atan2(dx, -dz): north (0,-1) is 0, east (1,0) is 90°', () => {
    close(bearing(0, -1), 0);            // due north = -z
    close(bearing(1, 0), PI / 2);        // due east = +x
    close(Math.abs(bearing(0, 1)), PI);  // due south = +z
    close(bearing(-1, 0), -PI / 2);      // due west
    close(bearing(1, -1), PI / 4);       // north-east
  });

  it('forward(b) inverts alongLine’s angle: a segment’s own b maps back to its direction', () => {
    // a hole line due north: alongLine's b must satisfy forward(b) = (0, -1)
    const north = alongLine([[0, 0], [0, -100]], 0.5);
    const [fx, fz] = forward(north.b);
    close(fx, 0, 1e-12); close(fz, -1, 1e-12);
    // and due east: forward(b) = (1, 0)
    const east = alongLine([[0, 0], [100, 0]], 0.5);
    const [ex, ez] = forward(east.b);
    close(ex, 1, 1e-12); close(ez, 0, 1e-12);
  });

  it('right(b) is the player’s right hand, (-Fz, Fx)', () => {
    for (const b of [0, 0.3, PI / 2, 2.1, PI, -0.7, -2.5]) {
      const [Fx, Fz] = forward(b);
      const [Rx, Rz] = right(b);
      close(Rx, -Fz); close(Rz, Fx);
      close(Fx * Rx + Fz * Rz, 0);                 // perpendicular
      close(Math.hypot(Rx, Rz), 1);                // unit
    }
    // concretely: walking east (forward (1,0)), the right hand points south (+z)
    const bEast = alongLine([[0, 0], [100, 0]], 0).b;
    const [rx, rz] = right(bEast);
    close(rx, 0, 1e-12); close(rz, 1, 1e-12);
  });

  it('right() is NOT the (cos b, -sin b) reflection that mirrored the course', () => {
    for (const b of [0, PI / 2, 1.1, -2.0]) {
      const [Rx, Rz] = right(b);
      const buggy = [Math.cos(b), -Math.sin(b)];   // the historical left vector
      // the two are exact negatives, so they must differ everywhere
      expect(Math.hypot(Rx - buggy[0], Rz - buggy[1])).toBeGreaterThan(1.9);
    }
    // walking north (forward (0,-1)): right() says east; the bug said west
    const bNorth = alongLine([[0, 0], [0, -100]], 0).b;
    const [rx, rz] = right(bNorth);
    close(rx, 1, 1e-12); close(rz, 0, 1e-12);
    expect(Math.cos(bNorth)).toBeLessThan(-0.999); // buggy x-component: west
  });
});

describe('alongLine', () => {
  const L = [[0, 0], [6, 0], [6, 2]];              // two unequal segments, length 8

  it('f=0 is the first point, carrying the first segment’s angle', () => {
    const p = alongLine(L, 0);
    close(p.x, 0); close(p.z, 0);
    close(p.b, Math.atan2(6, 0));                  // heading +x
  });

  it('f=1 is the last point', () => {
    const p = alongLine(L, 1);
    close(p.x, 6); close(p.z, 2);
  });

  it('interpolates by arc length, not per segment', () => {
    const q = alongLine(L, 0.25);                  // 2 m of 8 -> still on segment 1
    close(q.x, 2); close(q.z, 0);
    const r = alongLine(L, 0.875);                 // 7 m -> 1 m into segment 2
    close(r.x, 6); close(r.z, 1);
    close(r.b, Math.atan2(0, 2));                  // heading +z now
  });

  it('clamps f to [-0.2, 1.25] and extrapolates along the end segment', () => {
    const p = alongLine(L, 99);                    // clamp -> 1.25 * 8 = 10 m
    close(p.x, 6); close(p.z, 4);                  // 2 m past the end, straight on
  });
});

describe('polyline and polygon measures', () => {
  const sq = [[0, 0], [1, 0], [1, 1], [0, 1]];     // unit square

  it('polyLen sums segment lengths', () => {
    close(polyLen([[0, 0], [3, 0], [3, 4]]), 7);   // 3-4-5 triangle legs
    close(polyLen([[5, 5]]), 0);
    close(polyLen(sq), 3);                          // open polyline: 3 sides
  });

  it('polyArea is signed by winding, magnitude the area', () => {
    expect(polyArea(sq)).toBe(-1);                  // this winding is negative
    expect(polyArea([...sq].reverse())).toBe(1);    // reversed flips the sign
    close(Math.abs(polyArea([[0, 0], [4, 0], [0, 3]])), 6);
  });

  it('centroid of a square is its centre, whatever the winding', () => {
    const off = [[10, 20], [14, 20], [14, 22], [10, 22]];
    expect(centroid(off)).toEqual([12, 21]);
    expect(centroid([...off].reverse())).toEqual([12, 21]);
  });

  it('centroid of a degenerate (zero-area) ring falls back to the vertex mean', () => {
    expect(centroid([[0, 0], [2, 0], [4, 0]])).toEqual([2, 0]);
  });
});

describe('pointInPoly', () => {
  const sq = [[0, 0], [1, 0], [1, 1], [0, 1]];

  it('inside and outside', () => {
    expect(pointInPoly(0.5, 0.5, sq)).toBe(true);
    expect(pointInPoly(1.5, 0.5, sq)).toBe(false);
    expect(pointInPoly(0.5, -0.5, sq)).toBe(false);
    expect(pointInPoly(-0.001, 0.5, sq)).toBe(false);
  });

  it('vertices are half-open: exactly one corner of a square counts as inside', () => {
    // measured behaviour of the > comparisons: min-corner in, the rest out —
    // so tiling squares that share corners claim each point exactly once
    const at = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, z]) => pointInPoly(x, z, sq));
    expect(at).toEqual([true, false, false, false]);
  });

  it('edges are half-open too: low-z and low-x edges in, the others out', () => {
    expect(pointInPoly(0.5, 0, sq)).toBe(true);
    expect(pointInPoly(0, 0.5, sq)).toBe(true);
    expect(pointInPoly(0.5, 1, sq)).toBe(false);
    expect(pointInPoly(1, 0.5, sq)).toBe(false);
  });

  it('polySD is negative inside, positive outside, metres to the nearest edge', () => {
    close(polySD(0.5, 0.5, sq), -0.5);
    close(polySD(2, 0.5, sq), 1);
  });
});

describe('heightfield codec: quantizeHF / decodeHF', () => {
  // synthetic terrain that slopes in both directions with deterministic noise,
  // dipping below zero so the negative-h0 path (bathymetry) is exercised
  const nx = 23, nz = 17;
  const make = () => {
    const rng = lcg(42);
    const h = new Float64Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++)
      h[j * nx + i] = -2 + 4 * Math.sin(i * 0.37) + 3 * Math.cos(j * 0.23) + (rng() - 0.5) * 0.4;
    return h;
  };

  it('round-trips within the 10 cm quantum', () => {
    const h = make();
    const spec = quantizeHF(h, nx, nz);
    expect(spec.nx).toBe(nx); expect(spec.nz).toBe(nz); expect(spec.hs).toBe(0.1);
    const min = Math.min(...h);
    expect(spec.h0).toBeLessThanOrEqual(min);      // datum sits at/below the field
    expect(min - spec.h0).toBeLessThan(0.1);
    const d = decodeHF(spec);
    expect(d.length).toBe(nx * nz);
    let worst = 0;
    for (let k = 0; k < h.length; k++) worst = Math.max(worst, Math.abs(d[k] - h[k]));
    expect(worst).toBeLessThanOrEqual(0.05 + 1e-9);  // hs / 2
  });

  it('exact multiples of the quantum survive exactly (to float32)', () => {
    const h = [0.0, 0.1, 0.2, 0.3, 1.5, 0.4];
    const d = decodeHF(quantizeHF(h, 3, 2));
    for (let k = 0; k < h.length; k++) close(d[k], h[k], 1e-6);
  });

  it('is byte-deterministic, and idempotent after one round-trip', () => {
    const spec = quantizeHF(make(), nx, nz);
    const again = quantizeHF(make(), nx, nz);
    expect(again.b64).toBe(spec.b64);              // same input, same bytes
    expect(spec.rawBytes).toBe(nx * nz * 2);
    // encoding the decoded field reproduces the identical stream: the codec
    // adds its quantization error once, never twice
    const spec2 = quantizeHF(decodeHF(spec), nx, nz);
    expect(spec2.b64).toBe(spec.b64);
    expect(spec2.h0).toBe(spec.h0);
  });

  it('refuses a field whose relief overflows uint16 quanta', () => {
    expect(() => quantizeHF([0, 7000], 2, 1)).toThrow(/out of range/);
  });
});

describe('deflateB64 / inflateB64', () => {
  it('round-trips structured data, Swedish letters included', () => {
    const o = {
      namn: 'Mästerskapsbanan — Veckefjärden',
      holes: [{ n: 1, line: [[0, 0], [312.4, -88.1]] }, { n: 2, par: 5 }],
      empty: [], nothing: null, flag: true,
    };
    expect(inflateB64(deflateB64(o))).toEqual(o);
  });

  it('is deterministic: the same object always makes the same base64', () => {
    const o = { a: [1, 2, 3], b: 'åäö' };
    expect(deflateB64(o)).toBe(deflateB64(o));
  });
});
