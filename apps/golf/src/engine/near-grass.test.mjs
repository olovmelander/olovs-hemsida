/* The grass round the ball (near-grass.mjs; docs/visual-near-grass-2026-09-26.md):
   its rings round the eye and how they hand over, its fade, what grows on each
   class, the ground grid it stands on, the colour it takes from the ground, and
   how main.js draws it. The pictures are the isolated check's
   (docs/graphics/near-grass-2026-09-26/check-isolated.mjs). */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createGroundAtlas } from './atlas.js';
import { classStyle, groundClassColour, groundStandsMillimetres, isGroundTintClass } from './ground-material-core.mjs';
import { PAINTED_SHADING } from './material.js';
import { createNearGrass, createNearGrassClip, nearGrassFade, nearGrassKeep, nearGrassLayout, NEAR_GRASS } from './near-grass.mjs';
import { SURFACE } from './surface.js';

const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('./near-grass.mjs', import.meta.url), 'utf8');

const C = {
  rough: [0.10, 0.20, 0.05], forest: [0.08, 0.15, 0.05], heath: [0.2, 0.2, 0.1],
  semi: [0.15, 0.30, 0.08], fair: [0.18, 0.36, 0.09], fringe: [0.16, 0.33, 0.08],
  green: [0.14, 0.38, 0.10], tee: [0.16, 0.34, 0.09], sand: [0.8, 0.75, 0.6],
  path: [0.5, 0.5, 0.5], aspL: [0.3, 0.3, 0.3], hard: [0.45, 0.42, 0.38], soil: [0.3, 0.25, 0.2],
  wet: [0.2, 0.25, 0.15], rock: [0.4, 0.4, 0.4], shore: [0.5, 0.45, 0.35],
};
const SHADE = Array.from({ length: 32 }, () => [1.5, 0.4, 0.3, 0.6]);
const square = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

describe('the rings round the eye', () => {
  it('lay out as the qualities say: one draw of every blade, a cell doubling a ring', () => {
    const hi = nearGrassLayout('hi'), lo = nearGrassLayout('lo');
    expect([hi.instances, hi.bladesTotal, hi.rings.length, hi.clipTexels]).toEqual([16384, 65536, 4, 94]);
    expect([lo.instances, lo.bladesTotal, lo.rings.length, lo.clipTexels]).toEqual([4800, 14400, 3, 54]);
    expect(hi.reach).toBeCloseTo(38.91, 2);
    expect(lo.reach).toBeCloseTo(18.24, 2);
    for (const layout of [hi, lo]) {
      layout.rings.forEach((ring, k) => {
        expect(ring.first).toBe(k * layout.perRing);
        if (k) expect(ring.cell).toBeCloseTo(layout.rings[k - 1].cell * 2, 12);
      });
      /* the grid round the eye holds the reach and the next point out from anywhere the eye can be
         before it scrolls (four metres, and half a point of rounding): it stays drawn as it scrolls */
      expect((layout.clipTexels / 2 - 1) * NEAR_GRASS.clipMetres).toBeGreaterThanOrEqual(layout.reach + 1 + 4.5);
    }
    expect(() => nearGrassLayout('ultra')).toThrow(TypeError);
  });

  it('hand over without a seam: a ring thins to a quarter before its edge, the next ring\'s own density', () => {
    expect(nearGrassKeep(0)).toBe(1);
    expect(nearGrassKeep(NEAR_GRASS.thin[0])).toBe(1);
    expect(nearGrassKeep(NEAR_GRASS.thin[1])).toBeCloseTo(0.25, 12);
    expect(nearGrassKeep(1.2)).toBeCloseTo(0.25, 12);
    expect(nearGrassKeep(0.99, true)).toBe(1);
    /* a cell twice as wide holds the same blades over four times the ground */
    for (const quality of ['hi', 'lo']) {
      const { rings, cells } = nearGrassLayout(quality);
      for (let k = 1; k < rings.length; k++) {
        const inner = 1 / rings[k - 1].cell ** 2, outer = 1 / rings[k].cell ** 2;
        expect(inner * nearGrassKeep(1)).toBeCloseTo(outer * nearGrassKeep(0.5), 9);
      }
      /* the inner ring's square ends between 1 - 2/cells and 1 + 2/cells of its half-width from the eye
         (its centre is the eye's cell): thinned to its quarter by then */
      expect(1 - 2 / cells).toBeGreaterThanOrEqual(NEAR_GRASS.thin[1]);
      /* and where the next ring begins, that ring is still whole */
      expect(0.5 * (1 + 2 / cells)).toBeLessThanOrEqual(NEAR_GRASS.thin[0]);
    }
  });

  it('fade a blade out while it is still a few pixels tall, and never past the last ring', () => {
    const { reach } = nearGrassLayout('hi');
    const length = NEAR_GRASS.bladeMetres[SURFACE.FAIRWAY];
    const end = length * NEAR_GRASS.fadeLengths;
    expect(nearGrassFade(length, end * NEAR_GRASS.fadeFrom * 0.99, reach)).toBe(1);
    expect(nearGrassFade(length, end, reach)).toBe(0);
    expect(nearGrassFade(length, end * 0.8, reach)).toBeGreaterThan(0);
    expect(nearGrassFade(length, end * 0.8, reach)).toBeLessThan(1);
    /* the app's tee view: 48 degrees, 1080 pixels high; standing upright where it goes, about three and a half */
    const pixels = (1 / NEAR_GRASS.fadeLengths) / (2 * Math.tan(24 * Math.PI / 180)) * 1080;
    expect(pixels).toBeGreaterThan(3);
    expect(pixels).toBeLessThan(4);
    /* the tallest blade the clumps grow still ends inside the last ring */
    const tallest = NEAR_GRASS.bladeMetres[SURFACE.WETLAND] * 1.35 * NEAR_GRASS.clumpRange[1];
    expect(nearGrassFade(tallest, reach, reach)).toBe(0);
    expect(nearGrassFade(tallest, reach * 0.999, reach)).toBeLessThan(0.01);
  });
});

describe('what grows where', () => {
  it('stands over each class\'s cut, and nothing grows on a green, sand, paths, hard ground, the forest floor or the shore', () => {
    for (const [sid, metres] of Object.entries(NEAR_GRASS.bladeMetres)) {
      expect(metres * 1000).toBeGreaterThan(groundStandsMillimetres(+sid));
    }
    const lengths = NEAR_GRASS.bladeMetres;
    expect(lengths[SURFACE.TEE]).toBeLessThanOrEqual(lengths[SURFACE.FAIRWAY]);
    expect(lengths[SURFACE.FAIRWAY]).toBeLessThan(lengths[SURFACE.SEMI]);
    expect(lengths[SURFACE.SEMI]).toBeLessThan(lengths[SURFACE.ROUGH]);
    for (const sid of [SURFACE.GREEN, SURFACE.SAND, SURFACE.PATH, SURFACE.ASPHALT, SURFACE.GRAVEL, SURFACE.DIRT, SURFACE.MUD,
      SURFACE.ROCK, SURFACE.FOREST, SURFACE.SHORE]) expect(lengths[sid]).toBeUndefined();
  });

  it('takes each class\'s colour as the ground lays it: the palette lifted by the cut tone, or the tint', () => {
    const { toneExponent, cutLift } = PAINTED_SHADING;
    const fairway = groundClassColour(C, SHADE, SURFACE.FAIRWAY, { lift: cutLift, toneExponent });
    classStyle(C, SHADE, SURFACE.FAIRWAY).colour.forEach((v, i) => expect(fairway[i]).toBeCloseTo(v * 1.23 ** 2.2, 12));
    const green = groundClassColour(C, SHADE, SURFACE.GREEN, { lift: 0.5, toneExponent });
    classStyle(C, SHADE, SURFACE.GREEN).colour.forEach((v, i) => expect(green[i]).toBeCloseTo(v * 1.16 ** 2.2, 12));
    expect(groundClassColour(C, SHADE, SURFACE.SAND, { lift: 1, toneExponent })).toEqual([...classStyle(C, SHADE, SURFACE.SAND).colour]);
    for (const sid of [SURFACE.ROUGH, SURFACE.FOREST, SURFACE.HEATH, SURFACE.WETLAND, SURFACE.SHORE]) {
      expect(isGroundTintClass(sid)).toBe(true);
      expect(groundClassColour(C, SHADE, sid, { lift: 1, toneExponent })).toBeNull();
    }
    /* the ground's own material takes the same colours, from the same function */
    const core = fs.readFileSync(new URL('./ground-material-core.mjs', import.meta.url), 'utf8');
    expect(core).toMatch(/GROUND_TINT_CLASSES\.has\(sid\)\s*\n?\s*\? roughColour : vec3\(\.\.\.groundClassColour\(C, SHADE, sid, \{ lift, toneExponent, hardGround \}\)\)/);
  });
});

describe('the ground round the eye', () => {
  /* a world whose every point says which it is */
  const probe = () => {
    const calls = [];
    const groundAt = (x, z) => { calls.push([x, z]); return { h: x * 1000 + z, grass: (x + z) % 2 === 0 }; };
    return { calls, groundAt };
  };
  const heldAt = (clip, i, j) => {
    const W = clip.texels, mod = (a, n) => ((a % n) + n) % n, slot = mod(j, W) * W + mod(i, W);
    return clip.texture.image.data.slice(slot * 4, slot * 4 + 2);
  };

  it('holds every point of its window in the slot the shader reads, one read a point', () => {
    const { calls, groundAt } = probe();
    const clip = createNearGrassClip({ texels: 12, groundAt, budget: 50 });
    expect(clip.ready(0, 0, 3)).toBe(false);
    let frames = 0;
    while (!clip.complete) { clip.update(0.4, -0.3); frames++; }
    expect(frames).toBe(Math.ceil(144 / 50));
    expect(calls.length).toBe(144);
    for (let i = -6; i < 6; i++) for (let j = -6; j < 6; j++) {
      const [h, grass] = heldAt(clip, i, j);
      expect(h).toBe(i * 1000 + j);
      expect(grass).toBe((i + j) % 2 === 0 ? 1 : 0);
    }
    expect(clip.ready(0, 0, 3)).toBe(true);
    /* the reach and the next point out must lie inside the window */
    expect(clip.ready(0, 0, 5)).toBe(false);
  });

  it('reads only the rows it moves into, and stays drawn while it does', () => {
    const { calls, groundAt } = probe();
    const clip = createNearGrassClip({ texels: 20, groundAt, budget: 30, scrollMetres: 4 });
    while (!clip.complete) clip.update(0, 0);
    calls.length = 0;
    /* under the scroll distance: nothing to read */
    clip.update(3.4, 0);
    expect(calls.length).toBe(0);
    /* four metres on: four new columns of twenty, over three frames, drawn throughout */
    clip.update(4, 0);
    expect(clip.complete).toBe(false);
    expect(clip.ready(4, 0, 3)).toBe(true);
    while (!clip.complete) { clip.update(4, 0); expect(clip.ready(4, 0, 3)).toBe(true); }
    expect(calls.length).toBe(4 * 20);
    expect(calls.every(([x]) => x >= 10 && x <= 13)).toBe(true);
    for (let i = -6; i < 14; i++) for (let j = -10; j < 10; j++) expect(heldAt(clip, i, j)[0]).toBe(i * 1000 + j);
  });

  it('is not drawn over points it no longer holds: a jump, or a turn back before a pass is done', () => {
    const { groundAt } = probe();
    const clip = createNearGrassClip({ texels: 20, groundAt, budget: 10, scrollMetres: 4 });
    while (!clip.complete) clip.update(0, 0);
    /* a jump: nothing of the old window is near */
    clip.update(100, 0);
    expect(clip.ready(100, 0, 5)).toBe(false);
    while (!clip.complete) clip.update(100, 0);
    expect(clip.ready(100, 0, 5)).toBe(true);
    /* a scroll forward, part read, then back past where it began: the columns it
       gave up behind are not held until they are read again */
    clip.update(104, 0);
    clip.update(104, 0);
    clip.update(96, 0);
    expect(clip.ready(96, 0, 5)).toBe(false);
    while (!clip.complete) clip.update(96, 0);
    expect(clip.ready(96, 0, 5)).toBe(true);
    for (let i = 86; i < 106; i++) for (let j = -10; j < 10; j++) expect(heldAt(clip, i, j)[0]).toBe(i * 1000 + j);
  });

  it('keeps no grass where the ground is unknown, and stands it at the last height it read', () => {
    const clip = createNearGrassClip({ texels: 8, groundAt: (x) => (x < 0 ? { h: NaN, grass: true } : null) });
    clip.update(0, 0, { force: true });
    while (!clip.complete) clip.update(0, 0);
    for (let k = 0; k < 64; k++) expect([...clip.texture.image.data.slice(k * 4, k * 4 + 2)]).toEqual([0, 0]);
    /* (the rows fill in order: the unknown row is read after known ones) */
    const hill = createNearGrassClip({ texels: 8, groundAt: (x, z) => (z === 2 ? null : { h: 30, grass: true }) });
    while (!hill.complete) hill.update(0, 0);
    for (let i = -4; i < 4; i++) {
      const [h, grass] = heldAt(hill, i, 2);
      expect(grass).toBe(0);
      expect(h).toBe(30);
    }
  });

  it('roots no blade in water: blades stop within a quarter of a grid point of the last that grows, inside main.js\'s shore margin', () => {
    /* across an edge of the grid, bilinear: the weight that says grass falls from 1 to 0 over a point's width */
    const reach = (1 - NEAR_GRASS.growsFrom[0]) * NEAR_GRASS.clipMetres;
    expect(reach).toBeLessThanOrEqual(0.25);
    const margin = +main.match(/const sd = ringSD\(x, z, w\.ring, 6\);\s*if \(sd < ([\d.]+)/)[1];
    expect(margin).toBeGreaterThan(reach);
  });
});

describe('the grass', () => {
  const atlas = createGroundAtlas({ CORE: { x0: 0, z0: 0, x1: 60, z1: 60 }, res: 1,
    features: [{ surface: SURFACE.FAIRWAY, rings: [square(5, 5, 35, 35)] }, { surface: SURFACE.GREEN, rings: [square(10, 40, 25, 55)] },
      { surface: SURFACE.TEE, rings: [square(40, 40, 50, 50)] }] });
  const exact = atlas.exactEdges;
  const build = (options = {}) => createNearGrass({ atlas: { bounds: atlas.bounds, texSdf: exact.texSdf, channels: exact.channels },
    DETAIL: new THREE.DataTexture(new Uint8Array(16), 2, 2), C, SHADE, cutTone: 1, uSun: uniform(new THREE.Vector3(0, 1, 0)),
    groundAt: () => ({ h: 2, grass: true }), ...options });

  it('is one instanced draw over the whole patch: never culled whole, lit and shadowed like the ground, casting nothing', () => {
    const grass = build();
    const { mesh, layout } = grass;
    expect(mesh.geometry.isInstancedBufferGeometry).toBe(true);
    expect(mesh.geometry.instanceCount).toBe(layout.instances);
    expect(mesh.geometry.attributes.position.count).toBe(layout.blades * 3);
    expect([mesh.frustumCulled, mesh.receiveShadow, mesh.castShadow, mesh.visible]).toEqual([false, true, false, false]);
    expect(mesh.material.positionNode && mesh.material.colorNode && mesh.material.normalNode && mesh.material.roughnessNode).toBeTruthy();
    expect(build({ quality: 'lo' }).mesh.geometry.instanceCount).toBe(nearGrassLayout('lo').instances);
  });

  it('needs the exact class fields and the visible ground', () => {
    expect(() => createNearGrass({ atlas: { bounds: atlas.bounds, texSdf: [], channels: [] }, groundAt: () => null })).toThrow(TypeError);
    expect(() => build({ groundAt: null })).toThrow(TypeError);
  });

  it('follows the eye near the ground, and hides over it', () => {
    const grass = build();
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1000);
    camera.position.set(20.3, 3.7, 20.9);
    expect(grass.prime(camera, 1080)).toBe(true);
    expect(grass.settled).toBe(true);
    expect(grass.stats()).toMatchObject({ visible: true, altitude: 1.7, instances: 16384 });
    camera.position.set(20.3, 2 + NEAR_GRASS.hideAboveMetres + 1, 20.9);
    grass.update(camera, 1080);
    expect(grass.mesh.visible).toBe(false);
    expect(grass.settled).toBe(true);
    /* straight back down to a new place: drawn once its ground is read */
    camera.position.set(200, 3.7, 200);
    grass.update(camera, 1080);
    expect(grass.mesh.visible).toBe(false);
    expect(grass.settled).toBe(false);
    for (let k = 0; k < 40 && !grass.settled; k++) grass.update(camera, 1080);
    expect(grass.settled).toBe(true);
    expect(grass.mesh.visible).toBe(true);
  });

  it('takes the ground\'s own terms, each behind the ground\'s switch', () => {
    for (const name of ['applyGroundRelief(colour, tintAtRoot.a, seasonal)', 'GROUND_DETAIL.ROUGH_CLUMP_AMPLITUDE', 'GROUND_DETAIL.TURF_GRAIN',
      'GROUND_DETAIL.DAMP_SHADE', 'GROUND_DETAIL.TURF_BROAD_LIFT', 'swayOnWind(']) expect(source).toContain(name);
    expect(source).toMatch(/if \(terms\.relief\)/);
    expect(source).toMatch(/if \(terms\.wear\)/);
    expect(source).toMatch(/if \(terms\.grain\)/);
    expect(source).toMatch(/terms\.gloss \?/);
  });
});

describe('main.js', () => {
  it('draws the grass round the ball behind ?neargrass=0, where the ground has exact fields and invents what it grows', () => {
    expect(main).toMatch(/import \{ createNearGrass \} from '\.\/engine\/near-grass\.mjs';/);
    expect(main).toMatch(/const NEAR_GRASS_ON = new URLSearchParams\(location\.search\)\.get\('neargrass'\) !== '0';/);
    expect(main).toMatch(/if \(NEAR_GRASS_ON && M\.infra\.vegetationPlacement !== 'measured-only' && groundAtlas\?\.exactEdges\)/);
    expect(main).toMatch(/ground: \{ relief: GROUND_RELIEF_ON, wear: GROUND_WEAR_ON, grain: TURF_GRAIN_ON, gloss: SURFACE_GLOSS \}/);
    expect(main).toMatch(/quality: LOWQ \? 'lo' : 'hi'/);
    /* the visible ground, and no grass in water */
    expect(main).toMatch(/const h = terrainH\(x, z\);\s*return \{ h, grass: Number\.isFinite\(h\) && !wetAt\(x, z, h\) \};/);
  });

  it('moves it with the camera each frame, fills its ground and compiles it at boot, and waits for it to settle', () => {
    expect(main).toMatch(/updateSky\(\);\s*nearGrass\?\.update\(camera, renderer\.domElement\.height\);/);
    expect(main).toMatch(/const grassHidden = nearGrass \? !nearGrass\.prime\(camera, renderer\.domElement\.height\) : false;/);
    expect(main).toMatch(/if \(grassHidden\) nearGrass\.mesh\.visible = true;\s*try \{\s*BOOT_PERF\.gpuPreparation = await prepareOpeningGpu/);
    expect(main).toMatch(/&& \(nearGrass\?\.settled \?\? true\)/);
    expect(main).toMatch(/nearGrass: \(\) => \(nearGrass \?/);
  });
});
