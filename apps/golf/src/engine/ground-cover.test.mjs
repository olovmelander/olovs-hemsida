/* The ground cover's own rules (ground-cover.mjs, docs/visual-ground-2026-09-26.md):
   the blades lit from the side that is seen, the colours where they were tuned,
   stones and bushes seated on the lowest ground under them, reeds at every lake
   and pond at its own level; and main.js keeps each before behind its switch. */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { vec3 } from 'three/tsl';
import { tussockBlades, reedBlades, clumpBlades, bladeNormalsFront, seenBladeNormal, COVER_TUNED_SHARE, grassCover,
  seatHeight, SEAT_RIM, reedWaterAt, REED_LAKE_REACH, REED_ABOVE_METRES } from './ground-cover.mjs';
import { fillGroundDetailPixels } from './ground-detail-texture.mjs';
import { ringSD } from './geom.js';

const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');

/* each triangle's front-face normal (counter-clockwise) and the normals given to its corners */
const triangles = ({ positions, normals }) => {
  const out = [];
  for (let t = 0; t < positions.length; t += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = positions.slice(t, t + 9);
    const e1 = [bx - ax, by - ay, bz - az], e2 = [cx - ax, cy - ay, cz - az];
    const face = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    out.push({ face, corners: [0, 1, 2].map(k => normals.slice(t + k * 3, t + k * 3 + 3)) });
  }
  return out;
};
/* the horizontal facing, the part of a normal the blade's side decides */
const facing = (a, b) => a[0] * b[0] + a[2] * b[2];
const turned = v => v.map(x => -x);

describe('the blade\'s light', () => {
  it('before: on both faces a tussock\'s or reed\'s normal pointed away from the eye', () => {
    for (const make of [tussockBlades, reedBlades]) {
      for (const { face, corners } of triangles(make())) for (const n of corners) {
        /* seen from the front, the normal as given; from behind, three turns it round */
        expect(facing(n, face)).toBeLessThan(0);
        expect(facing(turned(n), turned(face))).toBeLessThan(0);
      }
    }
    /* and seen from behind, every blade's tilt went down: lit as ground facing away from the sky */
    for (const make of [tussockBlades, reedBlades, clumpBlades]) for (const { corners } of triangles(make())) for (const n of corners) expect(-n[1]).toBeLessThan(0);
  });

  it('turns the tussocks\' and reeds\' normals to their front faces, and finds the clumps\' there already', () => {
    for (const make of [tussockBlades, reedBlades]) {
      const shape = make();
      for (const { face, corners } of triangles({ ...shape, normals: bladeNormalsFront(shape.normals) })) {
        for (const n of corners) { expect(facing(n, face)).toBeGreaterThan(0); expect(n[1]).toBeGreaterThan(0); }
      }
    }
    for (const { face, corners } of triangles(clumpBlades())) for (const n of corners) expect(facing(n, face)).toBeGreaterThan(0);
  });

  it('lights each blade from the side that is seen, its tilt toward the sky, from the front and from behind', () => {
    /* the shader's rule on the CPU (seenBladeNormal): the facing times the face direction, the tilt kept up */
    const lit = (n, faceDirection) => [n[0] * faceDirection, Math.abs(n[1]), n[2] * faceDirection];
    for (const [make, turn] of [[tussockBlades, true], [reedBlades, true], [clumpBlades, false]]) {
      const shape = make(), drawn = turn ? { ...shape, normals: bladeNormalsFront(shape.normals) } : shape;
      for (const { face, corners } of triangles(drawn)) for (const n of corners) {
        for (const [eye, faceDirection] of [[face, 1], [turned(face), -1]]) {
          const m = lit(n, faceDirection);
          expect(facing(m, eye)).toBeGreaterThan(0);
          expect(m[1]).toBeGreaterThan(0);
        }
      }
    }
    const source = fs.readFileSync(new URL('./ground-cover.mjs', import.meta.url), 'utf8');
    expect(source).toMatch(/const side = vec2\(n\.x, n\.z\)\.mul\(faceDirection\);/);
    expect(source).toMatch(/transformNormalByViewMatrix\(normalize\(vec3\(side\.x, n\.y\.abs\(\), side\.y\)\), cameraViewMatrix\)/);
    expect(seenBladeNormal()).toBeTruthy();
  });

  it('is wired for tussocks, clumps and reeds behind ?coverlight=0', () => {
    expect(main).toMatch(/const COVER_LIGHT_ON = new URLSearchParams\(location\.search\)\.get\('coverlight'\) !== '0';/);
    expect(main.match(/COVER_LIGHT_ON \? bladeNormalsFront\(normals\) : normals/g)).toHaveLength(2);
    expect(main.match(/if \(COVER_LIGHT_ON\) \w+\.normalNode = seenBladeNormal\(\);/g)).toHaveLength(3);
  });
});

describe('the cover in the trees\' shadows', () => {
  it('takes them on every population, behind ?covershadow=0', () => {
    expect(main).toMatch(/im\.castShadow = shadow; im\.receiveShadow = COVER_SHADOW_ON;/);
    expect(main).toMatch(/im\.receiveShadow = COVER_SHADOW_ON;\n\s+scene\.add\(im\);\n\s+stats\.draws\+\+; stats\.reeds = n;/);
    /* every population goes through place() */
    for (const name of ['tufts', 'edgeTufts', 'bushes', 'stones', 'stumps']) expect(main).toContain(`place('${name}',`);
  });
});

describe('the cover\'s colours', () => {
  it('take the share of the detail texture the canvas upload left when they were tuned', () => {
    for (const seamless of [true, false]) {
      const px = new Uint8ClampedArray(512 * 512 * 4);
      fillGroundDetailPixels(px, 512, { seamless });
      /* the canvas path: stored premultiplied in 8 bits, read back un-premultiplied, cleared at A = 0 */
      const sums = { g: [0, 0], b: [0, 0] };
      let cleared = 0;
      for (let i = 0; i < px.length; i += 4) {
        const A = px[i + 3], back = v => (A ? Math.min(255, Math.round(Math.round(v * A / 255) * 255 / A)) : 0);
        sums.g[0] += px[i + 1]; sums.g[1] += back(px[i + 1]);
        sums.b[0] += px[i + 2]; sums.b[1] += back(px[i + 2]);
        if (!A) cleared++;
      }
      expect(cleared / (512 * 512)).toBeGreaterThan(0.3);
      expect(sums.g[1] / sums.g[0]).toBeCloseTo(COVER_TUNED_SHARE, 2);
      expect(sums.b[1] / sums.b[0]).toBeCloseTo(COVER_TUNED_SHARE, 1);
    }
  });

  it('are the rough\'s grass: the light\'s strength and autumn\'s ochre, on the tussocks and the clumps', () => {
    expect(grassCover(vec3(0.2, 0.3, 0.1))).toBeTruthy();
    expect(main.match(/COVER_COLOUR_ON \? grassCover\((tuftColour|clumpColour)\) : \1/g)).toHaveLength(2);
    expect(main.match(/COVER_COLOUR_ON \? (tint|leaf|tone)\.mul\(COVER_TUNED_SHARE\) : \1/g)).toHaveLength(3);
    const material = fs.readFileSync(new URL('./material.js', import.meta.url), 'utf8');
    /* the ground's own autumn is the same constant */
    expect(material).toMatch(/mix\(vec3\(1\), vec3\(\.\.\.SEASON_OCHRE\), paintedSeason\.mul\(seasonal\)\.mul\(turf\)\)/);
  });

  it('give a reviewed ground\'s stone to its stones, and the painted stone elsewhere', () => {
    expect(main).toMatch(/const stoneColour = COVER_COLOUR_ON && reviewedStone !== undefined \? reviewedStone : PAINTED_SCENERY\.stone;/);
  });
});

describe('seated on the lowest ground under it', () => {
  it('stays where it stood on level ground, and drops to its downhill rim on a slope', () => {
    expect(seatHeight(() => 10, 3, 4, 1)).toBe(10);
    /* falling 0.5 m a metre toward -x: the rim point on the -x side is the lowest */
    const slope = (x, z) => 10 + 0.5 * x;
    expect(seatHeight(slope, 0, 0, 1.2)).toBeCloseTo(10 - 0.6, 9);
    /* a hollow under the centre stays the lowest */
    expect(seatHeight((x, z) => Math.hypot(x, z) * 0.3, 0, 0, 1)).toBe(0);
  });

  it('samples inside each shape\'s footprint, and only stones and bushes, behind ?coverseat=0', () => {
    expect(SEAT_RIM.stone).toBeLessThanOrEqual(0.5);
    expect(SEAT_RIM.bush).toBeLessThanOrEqual(0.62);
    expect(main).toMatch(/place\('bushes', bush, bushMat, B, true, SEAT_RIM\.bush\)/);
    expect(main).toMatch(/place\('stones', stone, stoneMat, S, true, SEAT_RIM\.stone\)/);
    expect(main).toMatch(/if \(rim && COVER_SEAT_ON\) \{/);
  });
});

describe('reeds at every lake and pond, each at its own level', () => {
  const square = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  const waters = [
    { ring: square(0, 0, 100, 100), level: 20, isLake: true },
    { ring: square(200, 0, 300, 100), level: 24.5, isLake: true },
    { ring: square(400, 0, 420, 20), level: 30 },
    { line: [[0, -50], [300, -50]], stream: true, level: 20 },
    { ring: square(500, 0, 900, 400), level: 0, isSea: true },
  ];
  const at = (x, z, h, below = 0.22, options) => reedWaterAt(waters, x, z, h, below, ringSD, options);

  it('stands where the ground lies at the level of the water beside it, each its own', () => {
    expect(at(105, 50, 20)).toBe(true);
    expect(at(105, 50, 24.5)).toBe(false);
    expect(at(195, 50, 24.5)).toBe(true);
    expect(at(195, 50, 20)).toBe(false);
    /* a pond at its own level too */
    expect(at(425, 10, 30.1)).toBe(true);
    /* in the water, down to the band below the level (a silt flat's bed takes 0.42 m) */
    expect(at(250, 50, 24.2)).toBe(false);
    expect(at(250, 50, 24.2, 0.42)).toBe(true);
    expect(at(250, 50, 24.5 + REED_ABOVE_METRES + 0.01)).toBe(false);
  });

  it('takes none beyond the reach, by a stream, or on the sea\'s shore', () => {
    expect(at(100 + REED_LAKE_REACH + 1, 50, 20)).toBe(false);
    expect(at(100 + REED_LAKE_REACH - 1, 50, 20)).toBe(true);
    expect(at(150, -48, 20)).toBe(false);
    expect(at(495, 10, 0)).toBe(false);
    expect(at(505, 10, 0)).toBe(false);
  });

  it('leaves out the water it is told to', () => {
    expect(at(105, 50, 20, 0.22, { excluded: q => q.level === 20 })).toBe(false);
  });

  it('is wired in main.js beside the first lake\'s level, which ?reedlakes=0 keeps alone', () => {
    /* the first lake's level still holds by any water, as it did: the batch only adds reeds */
    expect(main).toMatch(/const atFirstLake = \(h, below\) => h >= lake\.level - below && h <= lake\.level \+ 0\.2;/);
    expect(main).toMatch(/const reedWater = REED_LAKES_ON\n\s+\? \(px, pz, h, below\) => atFirstLake\(h, below\) \|\| reedWaterAt\(WI\.at\(px, pz\), px, pz, h, below, ringSD\)\n\s+: \(px, pz, h, below\) => atFirstLake\(h, below\);/);
    expect(main).toMatch(/if \(inShal\) \{\n\s+if \(!reedWater\(px, pz, h, 0\.42\)\) return;/);
    expect(main).toMatch(/\} else if \(!reedWater\(px, pz, h, 0\.22\)\) return;/);
    const cell = main.slice(main.indexOf('const reedCell = '), main.indexOf("await scatterGrid('reeds'"));
    expect(cell.length).toBeGreaterThan(500);
    expect(cell).not.toContain('lake.level');
  });
});
