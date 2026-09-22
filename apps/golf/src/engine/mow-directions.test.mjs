import { describe, expect, it } from 'vitest';
import { createGroundAtlas, mowDirectionBytes, mowLateralBytes, RANGE_DIRECTION_LENGTH } from './atlas.js';
import { requestedMowing } from './surface-render-policy.mjs';
import { SURFACE } from './surface.js';
import { ringSD } from './geom.js';

const decode = (bytes, k) => [(bytes[k * 2] - 127.5) / 127, (bytes[k * 2 + 1] - 127.5) / 127];
const metres = byte => (byte - 128) * 0.25;
const bounds = { x0: 0, z0: 0, x1: 100, z1: 100, w: 100, h: 100, res: 1 };
const square = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

describe('which way the mower went', () => {
  /* a dogleg: the first leg runs east, the green lies to the south-east */
  const hole = { n: 7, line: [[10, 10], [60, 10], [90, 80]], tees: { pads: [{ ring: square(8, 8, 14, 12) }] } };
  const owner = new Uint16Array(100 * 100).fill(7);

  it('gives a hole its tee-to-green bearing, and a tee its own first leg', () => {
    const bytes = mowDirectionBytes({ bounds, owner, holes: [hole] });
    const chord = Math.hypot(80, 70);
    const [fx, fz] = decode(bytes, 50 * 100 + 50);
    expect(fx).toBeCloseTo(80 / chord, 2);
    expect(fz).toBeCloseTo(70 / chord, 2);
    expect(Math.hypot(fx, fz)).toBeCloseTo(1, 2);
    /* on the pad, and three metres round it: due east, the way the tee faces */
    for (const [i, j] of [[10, 10], [16, 10], [10, 6]]) {
      const [tx, tz] = decode(bytes, j * 100 + i);
      expect(tx).toBeCloseTo(1, 2);
      expect(tz).toBeCloseTo(0, 2);
    }
  });

  it('is unit east where no hole owns the ground, never a zero vector', () => {
    const bytes = mowDirectionBytes({ bounds, owner: new Uint16Array(100 * 100), holes: [hole] });
    expect(decode(bytes, 5050)[0]).toBeCloseTo(1, 2);
  });
});

describe('the driving range is mown too, and not by a hole', () => {
  it('matches exhaustive distance checks on concave and subdivided ranges, including 0 and 6 metre edges', () => {
    const rectangle = [];
    const corners = square(20.5, 20.5, 70.5, 70.5);
    for (let side = 0; side < 4; side++) for (let i = 0; i < 16; i++) {
      const a = corners[side], b = corners[(side + 1) % 4];
      rectangle.push([a[0] + (b[0] - a[0]) * i / 16, a[1] + (b[1] - a[1]) * i / 16]);
    }
    const concave = Array.from({ length: 64 }, (_, i) => {
      const r = i % 2 ? 25 : 35, angle = i * Math.PI / 32;
      return [50 + Math.cos(angle) * r, 50 + Math.sin(angle) * r];
    });
    for (const ring of [rectangle, concave]) for (const fairway of [false, true]) {
      const classes = new Uint8Array(10000).fill(fairway ? SURFACE.FAIRWAY : SURFACE.ROUGH);
      const bytes = mowDirectionBytes({ bounds, owner: new Uint16Array(10000), classes, ranges: [{ ring, axis: [0, 1] }] });
      for (let j = 0; j < 100; j++) for (let i = 0; i < 100; i++) {
        const sd = ringSD(i + 0.5, j + 0.5, ring);
        const range = sd <= 6 && !(sd > 0 && fairway);
        expect(bytes[(j * 100 + i) * 2]).toBe(range ? 128 : 255);
        expect(bytes[(j * 100 + i) * 2 + 1]).toBe(range ? Math.round(127.5 + 127 * RANGE_DIRECTION_LENGTH) : 128);
      }
    }
  });
  /* one hole playing east owns all the ground; the range is a field to its south,
     hit from its west end */
  const hole = { n: 2, line: [[10, 20], [90, 20]], tees: { pads: [] } };
  const owner = new Uint16Array(100 * 100).fill(2);
  const range = { ring: square(30, 50, 90, 90), axis: [0, 40] };

  it('carries the range axis at half length inside the field and its semi band', () => {
    const bytes = mowDirectionBytes({ bounds, owner, holes: [hole], ranges: [range] });
    for (const [i, j] of [[60, 70], [31, 51], [60, 93]]) {
      const [x, z] = decode(bytes, j * 100 + i);
      expect(Math.hypot(x, z)).toBeCloseTo(RANGE_DIRECTION_LENGTH, 2);
      expect(x).toBeCloseTo(0, 2);
      expect(z).toBeCloseTo(RANGE_DIRECTION_LENGTH, 2);
    }
  });

  it('leaves the hole its own unit bearing everywhere else', () => {
    const bytes = mowDirectionBytes({ bounds, owner, holes: [hole], ranges: [range] });
    for (const [i, j] of [[50, 20], [60, 40], [20, 70]]) {
      const [x, z] = decode(bytes, j * 100 + i);
      expect(x).toBeCloseTo(1, 2);
      expect(z).toBeCloseTo(0, 2);
    }
  });

  it('does not take another hole\'s fairway that lies inside its margin', () => {
    const classes = new Uint8Array(100 * 100);
    const fairwayTexel = 47 * 100 + 60;                   /* 3 m north of the range's edge */
    classes[fairwayTexel] = SURFACE.FAIRWAY;
    const bytes = mowDirectionBytes({ bounds, owner, holes: [hole], ranges: [range], classes });
    expect(Math.hypot(...decode(bytes, fairwayTexel))).toBeCloseTo(1, 2);
    /* its neighbour, not fairway, is the range's semi band */
    expect(Math.hypot(...decode(bytes, fairwayTexel + 1))).toBeCloseTo(RANGE_DIRECTION_LENGTH, 2);
  });

  it('ignores a range with no usable axis', () => {
    const plain = mowDirectionBytes({ bounds, owner, holes: [hole] });
    const bytes = mowDirectionBytes({ bounds, owner, holes: [hole], ranges: [{ ring: range.ring, axis: [0, 0] }, { ring: range.ring }] });
    expect(bytes).toEqual(plain);
  });
});

describe('how far across the hole', () => {
  /* one straight hole, playing east along z = 50 */
  const hole = { n: 3, line: [[30, 50], [70, 50]] };
  const owner = new Uint16Array(100 * 100).fill(3);
  const bytes = mowLateralBytes({ bounds, owner, holes: [hole] });
  const at = (x, z) => metres(bytes[Math.floor(z) * 100 + Math.floor(x)]);

  it('is SIGNED: the two sides of the line differ, so stripes alternate straight across', () => {
    /* texel centres stand half a metre off the integer line */
    expect(at(50, 60)).toBeCloseTo(10.5, 1);
    expect(at(50, 39)).toBeCloseTo(-10.5, 1);
    /* the unsigned distance made these two equal, and the stripes mirror images */
    expect(at(50, 60)).toBeCloseTo(-at(50, 39), 1);
  });

  it('carries the first and last legs straight on, so stripes do not wrap round the ends', () => {
    /* twelve metres beyond the green end and ten to the side: the distance to the
       line CARRIED ON is 10.5, to the end point itself it would be 16 */
    expect(at(82, 60)).toBeCloseTo(10.5, 1);
    expect(at(18, 60)).toBeCloseTo(10.5, 1);
    /* ... and it changes side across the carried-on line, passing through zero */
    expect(Math.abs(at(82, 50))).toBeLessThan(0.6);
    expect(at(82, 45)).toBeLessThan(0);
  });

  it('measures a texel against its OWN hole only', () => {
    /* a second hole whose carried-on leg runs straight through the first fairway */
    const crossing = { n: 9, line: [[50, 0], [50, 20]] };
    const both = mowLateralBytes({ bounds, owner, holes: [hole, crossing] });
    expect(both).toEqual(bytes);
  });

  it('saturates beyond its range instead of wrapping', () => {
    expect(metres(bytes[95 * 100 + 50])).toBeCloseTo(31.75, 2);
    expect(metres(bytes[5 * 100 + 50])).toBeCloseTo(-31.75, 2);
  });

  it('rides in the class field beside the direction', () => {
    const CORE = { x0: 0, z0: 0, x1: 100, z1: 100 };
    const features = [{ surface: SURFACE.FAIRWAY, rings: [square(30, 40, 70, 60)], hole: 3 }];
    const atlas = createGroundAtlas({ CORE, HOLES: [hole], features, res: 1 });
    expect(atlas.exactEdges.lateralStepMetres).toBe(0.25);
    const field = atlas.exactEdges.texF.image.data;
    const k = (55 * 100 + 50) * 4;
    expect(metres(field[k])).toBeCloseTo(5.5, 1);
    expect(Math.hypot((field[k + 2] - 127.5) / 127, (field[k + 3] - 127.5) / 127)).toBeCloseTo(1, 2);
    atlas.dispose();
  });
});

describe('the mowing knob', () => {
  it('defaults to the new stripes at their authored strength', () => {
    expect(requestedMowing('')).toEqual({ strength: 1 });
    expect(requestedMowing('?mow=0.5')).toEqual({ strength: 0.5 });
    expect(requestedMowing('?mow=9').strength).toBe(2);
    expect(requestedMowing('?mow=loud').strength).toBe(1);
  });

  it('names the way back', () => {
    expect(requestedMowing('?mow=classic')).toEqual({ strength: 0 });
  });
});
