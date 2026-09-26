/* The ground's grain, wear and bare ground (ground-material-core.mjs,
   createClassSdfDecorator; docs/visual-turf-2026-09-26.md): four reads of the
   detail texture a pixel where there were seven, the mown classes' near grain
   and broad blotch, a tee's divots, the walk round greens and tees, damp
   hollows in the storm and the mist, and the bare ground's mottle and ragged
   edges. The amplitudes are the detail texture's own statistics
   (ground-detail-texture.mjs), measured here as the shader samples it. */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { vec3 } from 'three/tsl';
import { createGroundAtlas } from './atlas.js';
import { createV2GroundMaterialDecorator, DETAIL_BROAD_MEAN } from './material.js';
import { GROUND_DETAIL, DETAIL_CLUMP_MEAN } from './ground-material-core.mjs';
import { fillGroundDetailPixels } from './ground-detail-texture.mjs';
import { GROUND_WETNESS, paintedWet, setPaintedWorldLighting } from './painted-world-lighting.mjs';
import { ATMOSPHERE_PRESETS } from './atmosphere-presets.mjs';
import { paintedAtmosphere } from './painted-world-palette.mjs';
import { SURFACE } from './surface.js';

const core = fs.readFileSync(new URL('./ground-material-core.mjs', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const stats = values => {
  let mean = 0; for (const v of values) mean += v; mean /= values.length;
  let sq = 0; for (const v of values) sq += (v - mean) ** 2;
  return { mean, sd: Math.sqrt(sq / values.length) };
};

const C = {
  rough: [0.10, 0.20, 0.05], forest: [0.08, 0.15, 0.05], heath: [0.2, 0.2, 0.1],
  semi: [0.15, 0.30, 0.08], fair: [0.18, 0.36, 0.09], fringe: [0.16, 0.33, 0.08],
  green: [0.14, 0.38, 0.10], tee: [0.16, 0.34, 0.09], sand: [0.8, 0.75, 0.6],
  path: [0.5, 0.5, 0.5], aspL: [0.3, 0.3, 0.3], hard: [0.45, 0.42, 0.38], soil: [0.3, 0.25, 0.2],
  wet: [0.2, 0.25, 0.15], rock: [0.4, 0.4, 0.4], shore: [0.5, 0.45, 0.35],
};
const SHADE = Array.from({ length: 32 }, () => [1.5, 0.4, 0.3, 0.6]);
const square = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
/* a fairway, its tee and green, and rock and soil beside them: every class the batch draws */
const atlas = createGroundAtlas({ CORE: { x0: 0, z0: 0, x1: 60, z1: 60 }, res: 1,
  features: [{ surface: SURFACE.FAIRWAY, rings: [square(5, 5, 35, 35)] }, { surface: SURFACE.TEE, rings: [square(40, 40, 50, 50)] },
    { surface: SURFACE.GREEN, rings: [square(10, 40, 25, 55)] }, { surface: SURFACE.ROCK, rings: [square(1, 1, 4, 4)] },
    { surface: SURFACE.DIRT, rings: [square(52, 2, 58, 8)] }] });

function build(options, DETAIL = new THREE.DataTexture(new Uint8Array(16), 2, 2, THREE.RGBAFormat, THREE.UnsignedByteType)) {
  const material = createV2GroundMaterialDecorator({ atlas, DETAIL, C, SHADE, uSun: vec3(0, 1, 0), cutTone: 1, mowStrength: 1,
    surfaceEdges: true, ...options })(new THREE.MeshStandardNodeMaterial());
  /* every distinct read of the detail texture in what the ground draws */
  const seen = new Set(), reads = new Set();
  const walk = node => {
    if (!node || typeof node !== 'object' || !node.isNode || seen.has(node.id)) return;
    seen.add(node.id);
    if (node.isTextureNode && node.value === DETAIL) reads.add(node.id);
    for (const child of node.getChildren()) walk(child);
  };
  walk(material.colorNode); walk(material.roughnessNode);
  return { material, reads: reads.size };
}

/* the detail texture's channels, and a bilinear, repeating sample of one, as the shader takes it */
const N = 512;
const pixels = new Uint8ClampedArray(N * N * 4);
fillGroundDetailPixels(pixels, N, { seamless: true });
const channel = c => Float64Array.from({ length: N * N }, (_, i) => pixels[i * 4 + c] / 255);
const [R, G, B] = [channel(0), channel(1), channel(2)];
const at = (A, u, v) => {
  const x = ((u * N) % N + N) % N - 0.5, y = ((v * N) % N + N) % N - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const g = (i, j) => A[(((j % N) + N) % N) * N + (((i % N) + N) % N)];
  return (g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy;
};
/* the clumps (near minus far, the near tap turned), the near tap alone and the far tap alone, over 200 m of ground */
const [cos, sin] = GROUND_DETAIL.NEAR_TAP_TURN;
const clumps = [], crests = [], fars = [];
for (let z = 0; z < 200; z += 0.137) for (let x = 0; x < 200; x += 0.137) {
  const near = at(G, (x * cos - z * sin) * 0.09, (x * sin + z * cos) * 0.09), far = at(G, x * 0.031 + 0.37, z * 0.031 + 0.61);
  clumps.push(near - far);
  crests.push(near);
  fars.push(far);
}
const clump = stats(clumps), far = stats(fars);

describe('the detail taps', () => {
  it('are four a pixel with the turf\'s grain, seven without it', () => {
    expect(build({}).reads).toBe(7);
    expect(build({ turfGrain: true }).reads).toBe(4);
    expect(build({ turfGrain: true, groundWear: true, bareGround: true }).reads).toBe(4);
    /* the wear and the bare ground add no read of their own */
    expect(build({ groundWear: true, bareGround: true }).reads).toBe(7);
  });
  it('turn the near tap off the world\'s axes, by a rotation', () => {
    expect(Math.hypot(cos, sin)).toBe(1);
    expect(Math.atan2(sin, cos) * 180 / Math.PI).toBeCloseTo(36.87, 2);
  });
  it('report what the ground was built with', () => {
    for (const [turfGrain, groundWear, bareGround] of [[false, false, false], [true, false, false], [false, true, false], [false, false, true], [true, true, true]]) {
      const { material } = build({ turfGrain, groundWear, bareGround });
      expect(material.userData.groundDetail).toEqual({ turfGrain, groundWear, bareGround });
      expect(material.colorNode).toBeTruthy();
    }
    /* none of it without cut tones: the befores' own switch */
    expect(build({ turfGrain: true, groundWear: true, bareGround: true, cutTone: 0 }).material.userData.groundDetail)
      .toEqual({ turfGrain: true, groundWear: false, bareGround: true });
  });
});

describe('the amplitudes, from the detail texture itself', () => {
  it('centre the mown turf\'s extra broad blotch on its channel\'s own mean, so the turf keeps its tone', () => {
    expect(stats(B).mean).toBeCloseTo(DETAIL_BROAD_MEAN, 3);
    const plain = new Uint8ClampedArray(N * N * 4);
    fillGroundDetailPixels(plain, N, { seamless: false });
    let mean = 0; for (let i = 0; i < N * N; i++) mean += plain[i * 4 + 2] / 255;
    expect(mean / (N * N)).toBeCloseTo(DETAIL_BROAD_MEAN, 3);
  });
  it('give the clumps a zero mean, and a fairway about 2.5% of display luminance either side, a green under 1%', () => {
    expect(Math.abs(clump.mean)).toBeLessThan(0.003);
    expect(clump.sd).toBeGreaterThan(0.19);
    expect(clump.sd).toBeLessThan(0.21);
    const grain = bump => clump.sd * GROUND_DETAIL.TURF_GRAIN * bump;
    expect(grain(0.44)).toBeGreaterThan(0.022);
    expect(grain(0.44)).toBeLessThan(0.028);
    expect(grain(0.13)).toBeLessThan(0.01);
    /* the rough's own clumps (4%) stay stronger than any cut's grain: the semi's bump, 0.62, is the most */
    expect(clump.sd * GROUND_DETAIL.ROUGH_CLUMP_AMPLITUDE).toBeGreaterThan(grain(0.62));
    /* the broad blotch on a fairway: about 3% where it was 1.2% (the finish adds it to linear colour, 2.2 times display) */
    const broad = stats(B).sd * 0.18 / 2.2;
    expect(broad).toBeLessThan(0.014);
    expect(broad * (1 + GROUND_DETAIL.TURF_BROAD_LIFT)).toBeGreaterThan(0.028);
    expect(broad * (1 + GROUND_DETAIL.TURF_BROAD_LIFT)).toBeLessThan(0.034);
  });
  it('mottle rock, soil and mud from the far tap about its own mean, at about 8, 7 and 5%, their edges wandering about 12 cm', () => {
    /* the far tap alone averages the clump channel's mean, in both texture variants */
    expect(Math.abs(far.mean - DETAIL_CLUMP_MEAN)).toBeLessThan(0.003);
    expect(Math.abs(stats(G).mean - DETAIL_CLUMP_MEAN)).toBeLessThan(0.001);
    const plain = new Uint8ClampedArray(N * N * 4);
    fillGroundDetailPixels(plain, N, { seamless: false });
    let mean = 0; for (let i = 0; i < N * N; i++) mean += plain[i * 4 + 1] / 255;
    expect(Math.abs(mean / (N * N) - DETAIL_CLUMP_MEAN)).toBeLessThan(0.001);
    const { ROCK, DIRT, MUD } = SURFACE, mottle = GROUND_DETAIL.BARE_MOTTLE;
    expect(far.sd * mottle[ROCK]).toBeCloseTo(0.08, 2);
    expect(far.sd * mottle[DIRT]).toBeCloseTo(0.07, 2);
    expect(far.sd * mottle[MUD]).toBeCloseTo(0.05, 2);
    expect(clump.sd * GROUND_DETAIL.BARE_RAGGED_METRES).toBeCloseTo(0.12, 2);
  });
  it('scar about 1% of a tee\'s middle, and none once a texel of the near tap outgrows 35 cm', () => {
    const [low, high] = GROUND_DETAIL.DIVOT_CREST;
    const share = values => values.reduce((sum, v) => sum + smoothstep(low, high, v), 0) / values.length;
    expect(share(crests)).toBeGreaterThan(0.005);
    expect(share(crests)).toBeLessThan(0.02);
    /* the mip chain: each level the mean of four */
    let level = G, n = N;
    const shares = [];
    while (n > 1) {
      shares.push(share(level));
      const m = n >> 1, next = new Float64Array(m * m);
      for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
        next[j * m + i] = (level[2 * j * n + 2 * i] + level[2 * j * n + 2 * i + 1] + level[(2 * j + 1) * n + 2 * i] + level[(2 * j + 1) * n + 2 * i + 1]) / 4;
      }
      level = next; n = m;
    }
    /* level 3 is 17 cm a texel at the tap's scale, level 4 35 cm */
    expect(shares[3]).toBeLessThan(0.01);
    for (const s of shares.slice(4)) expect(s).toBe(0);
  });
  it('band the walk a metre to four out from a green\'s and a tee\'s edge, in patches where the clumps are thinnest', () => {
    const [a, b, c, d] = GROUND_DETAIL.WEAR_BAND_METRES;
    const band = ring => smoothstep(a, b, ring) * (1 - smoothstep(c, d, ring));
    expect(band(0.3)).toBe(0);
    for (const ring of [1.2, 2, 2.6]) expect(band(ring)).toBe(1);
    expect(band(4.6)).toBe(0);
    const [t0, t1] = GROUND_DETAIL.WEAR_THIN;
    const thin = clumps.reduce((sum, v) => sum + smoothstep(t0, t1, -v), 0) / clumps.length;
    const full = clumps.filter(v => -v >= t1).length / clumps.length;
    expect(thin).toBeGreaterThan(0.2);
    expect(thin).toBeLessThan(0.35);
    /* the worn patches' hearts: about a seventh of the band, about 7% brighter at display */
    expect(full).toBeGreaterThan(0.1);
    expect(full).toBeLessThan(0.2);
    const heart = (0.2126 * GROUND_DETAIL.WEAR_TINT[0] + 0.7152 * GROUND_DETAIL.WEAR_TINT[1] + 0.0722 * GROUND_DETAIL.WEAR_TINT[2]) * 2.2 / 2.2;
    expect(heart).toBeGreaterThan(0.06);
    expect(heart).toBeLessThan(0.08);
    /* paler and yellower: red and green up, blue down */
    const [r, g, bl] = GROUND_DETAIL.WEAR_TINT;
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(0);
    expect(bl).toBeLessThan(0);
  });
});

describe('the damp', () => {
  it('lies in the storm and the mist, and in no other light', () => {
    expect(GROUND_WETNESS).toEqual({ storm: 1, mist: 0.6 });
    try {
      for (const name of Object.keys(ATMOSPHERE_PRESETS)) {
        setPaintedWorldLighting(paintedAtmosphere(name, ATMOSPHERE_PRESETS[name]), name);
        expect(paintedWet.value).toBe(GROUND_WETNESS[name] ?? 0);
      }
      expect(Object.keys(ATMOSPHERE_PRESETS)).toEqual(expect.arrayContaining(['storm', 'mist']));
    } finally {
      setPaintedWorldLighting(paintedAtmosphere('golden', ATMOSPHERE_PRESETS.golden), 'golden');
    }
    expect(paintedWet.value).toBe(0);
  });
  it('darkens only sheltered ground, from the baked relief\'s alpha', () => {
    const shelter = alpha => Math.max(0, -Math.min(1, Math.max(-1, (alpha * 255 - 128) / 127)));
    const [a, b] = GROUND_DETAIL.DAMP_SHELTER;
    /* open ground, a crest and the tint's own fallback (128) take none */
    for (const byte of [128, 200, 255]) expect(smoothstep(a, b, shelter(byte / 255))).toBe(0);
    /* the fully sheltered take all of it: at most 12% of display luminance, a little cooler */
    expect(smoothstep(a, b, shelter(0))).toBe(1);
    expect(GROUND_DETAIL.DAMP_SHADE).toBe(0.12);
    expect(GROUND_DETAIL.DAMP_COOL[0]).toBeLessThan(0);
    expect(GROUND_DETAIL.DAMP_COOL[2]).toBeGreaterThan(0);
  });
});

describe('the shader', () => {
  it('shares the taps with the finish, and keeps the befores\' own reads', () => {
    expect(core).toMatch(/const taps = exactEdges && turfGrain \? \{/);
    expect(core).toMatch(/const finishTaps = taps \? \{ taps: \{ a: taps\.broad\.b, b: taps\.far\.g, c: taps\.near\.r \},/);
    expect(core).toMatch(/const wobble = \(taps \? taps\.broad\.b : texture\(DETAIL, wp\.mul\(0\.006\)\)\.b\)/);
    expect(core).toMatch(/const wander = \(taps \? taps\.wander\.g : texture\(DETAIL, wp\.mul\(0\.017\)\)\.g\)/);
    expect(core).toMatch(/const nearTap = \(\) => \(nearNode \?\?= taps \? taps\.near : texture\(DETAIL, wp\.mul\(0\.09\)\)\);/);
  });
  it('grains every class but the rough\'s own paint by its SHADE bump, and mottles and frays the bare ground', () => {
    expect(core).toMatch(/clump\.mul\(TURF_GRAIN \* display \* cutTone\)\.mul\(shade\.y\)\.mul\(oneMinus\(meta\.a\)\)/);
    expect(core).toMatch(/bareIndices\.includes\(index\) \? sdf\.add\(clumpAt\(\)\.mul\(BARE_RAGGED_METRES\)\) : sdf/);
    expect(core).toMatch(/litBase = litBase\.mul\(float\(1\)\.add\(farTap\(\)\.g\.sub\(DETAIL_CLUMP_MEAN\)\.mul\(display \* cutTone\)\.mul\(bare\)\)\);/);
  });
  it('is wired in main.js behind its befores', () => {
    expect(main).toMatch(/turfGrain: TURF_GRAIN_ON, groundWear: GROUND_WEAR_ON, bareGround: BARE_GROUND_ON,/);
    for (const [name, key] of [['TURF_GRAIN_ON', 'turfgrain'], ['GROUND_WEAR_ON', 'groundwear'], ['BARE_GROUND_ON', 'bareground']]) {
      expect(main).toContain(`const ${name} = new URLSearchParams(location.search).get('${key}') !== '0';`);
    }
    expect(main).toMatch(/groundDetail: \(\(\) => \{ let found = null;/);
  });
});
