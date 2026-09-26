/* The ground's class edges, measured ACROSS each edge (ground-material-core.mjs,
   createClassSdfDecorator; docs/visual-ground-2026-09-26.md). The widths are
   the shader's, evaluated at real pixels of the app's tee camera, as the
   mowing fade's are (mow-fade.test.mjs): the before blurred every edge by the
   pixel's whole footprint, which down a fairway grows past the fields' 4 m
   reach and lent every class's colour to all the ground beyond. Also the
   stripes' reach and the hard ground. */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { vec3 } from 'three/tsl';
import { createGroundAtlas } from './atlas.js';
import { createV2GroundMaterialDecorator, classStyle } from './material.js';
import { CUT_EDGE_FLOOR_METRES, EDGE_REACH_METRES, groundStandsMillimetres } from './ground-material-core.mjs';
import { SURFACE } from './surface.js';

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const core = fs.readFileSync(new URL('./ground-material-core.mjs', import.meta.url), 'utf8');

/* the tee view: eye 1.7 m over the tee, looking 260 m down a hole running +z (mow-fade.test.mjs) */
function teeCamera(width, height) {
  const camera = new THREE.PerspectiveCamera(48, width / height, 1, 14000);
  camera.position.set(0, 1.7, 0);
  camera.lookAt(0, 3, 260);
  camera.updateMatrixWorld(true);
  return camera;
}
function ground(camera, width, height, px, py) {
  const ndc = new THREE.Vector3((px / width) * 2 - 1, 1 - (py / height) * 2, 0.5).unproject(camera);
  const ray = ndc.sub(camera.position).normalize();
  return camera.position.clone().addScaledVector(ray, -camera.position.y / ray.y);
}
/* dFdx and dFdy of the world position at the pixel that sees ground `metres` down the hole, `side` metres off its line */
function steps(width, height, metres, side) {
  const camera = teeCamera(width, height);
  const onScreen = new THREE.Vector3(side, 0, metres).project(camera);
  const px = Math.floor((onScreen.x + 1) / 2 * width) + 0.5, py = Math.floor((1 - onScreen.y) / 2 * height) + 0.5;
  const at = ground(camera, width, height, px, py);
  const dx = ground(camera, width, height, px + 1, py).sub(at), dy = ground(camera, width, height, px, py + 1).sub(at);
  return { x: [dx.x, dx.z], y: [dy.x, dy.z] };
}
/* fwidth(wp).length(): the pixel's whole footprint */
const whole = s => Math.hypot(Math.abs(s.x[0]) + Math.abs(s.y[0]), Math.abs(s.x[1]) + Math.abs(s.y[1]));
/* fwidth of a field sloped 1 along `bearing`: the pixel measured across that field's edge */
const across = (s, [gx, gz]) => Math.abs(s.x[0] * gx + s.x[1] * gz) + Math.abs(s.y[0] * gx + s.y[1] * gz);
/* the shader's half-widths: the before, and now */
const before = s => Math.max(CUT_EDGE_FLOOR_METRES, 0.7 * whole(s));
const now = (s, bearing) => Math.min(Math.max(CUT_EDGE_FLOOR_METRES, 0.7 * across(s, bearing)), Math.min(before(s), EDGE_REACH_METRES));
/* a class's share of the ground where its field has saturated, 4 m or more outside it */
const bleed = half => smoothstep(-half, half, -4);

describe('class edges seen from the tee', () => {
  for (const [label, width, height] of [['phone portrait', 412, 915], ['1080p', 1920, 1080]]) {
    it(`no longer lend every class's colour to the far ground (${label})`, () => {
      /* a fairway's side 15 m off the line, its green's front edge across the view */
      for (const [metres, lent] of [[150, 0.1], [200, 0.25], [300, 0.35]]) {
        const s = steps(width, height, metres, 15);
        expect(bleed(before(s))).toBeGreaterThan(lent);
        for (const bearing of [[1, 0], [0, 1], [0.6, 0.8]]) expect(bleed(now(s, bearing))).toBe(0);
      }
      /* short of about 120 m the before stayed inside the reach */
      expect(bleed(before(steps(width, height, 90, 15)))).toBe(0);
    });
    it(`keep an edge running down the view a pixel wide, where the before spread it over many (${label})`, () => {
      for (const [metres, pixels] of [[60, 2.5], [150, 6], [250, 10]]) {
        const s = steps(width, height, metres, 15), pixel = across(s, [1, 0]);
        expect(before(s) / pixel).toBeGreaterThan(pixels);
        expect(now(s, [1, 0]) / pixel).toBeLessThanOrEqual(0.71);
      }
    });
    it(`never draw an edge wider than the before, nor past the reach (${label})`, () => {
      for (const metres of [5, 20, 60, 120, 250, 600]) for (const side of [0, 15, 40]) {
        const s = steps(width, height, metres, side);
        for (const bearing of [[1, 0], [0, 1], [0.6, 0.8]]) {
          expect(now(s, bearing)).toBeLessThanOrEqual(before(s) + 1e-12);
          expect(now(s, bearing)).toBeLessThanOrEqual(EDGE_REACH_METRES);
          expect(now(s, bearing)).toBeGreaterThanOrEqual(CUT_EDGE_FLOOR_METRES);
        }
      }
    });
  }

  it('is the shader\'s rule: each field\'s own change over the pixel, and the edge details fade by it', () => {
    expect(core).toMatch(/const pixelAcross = exactEdges && acrossEdges \? sdfs\.map\(sdf => fwidth\(sdf\)\) : null;/);
    expect(core).toMatch(/pixelAcross\.map\(slope => slope\.mul\(0\.7\)\.max\(CUT_EDGE_FLOOR_METRES\)\.min\(pixelHalf\.min\(EDGE_REACH_METRES\)\)\)/);
    expect(core).toMatch(/const width = isCut\(index\) \? half : mix\(max\(float\(softRamp\), half\), half, meetsCut\);/);
    /* the contact line, the bank, the rake and lip, and the paths */
    expect(core).toMatch(/const pixel = pixelAcross\[index\]\.min\(footprint\);/);
    expect(core).toMatch(/const pixel = pixelAcross \? fwidth\(shore\)\.min\(footprint\) : footprint;/);
    expect(core).toMatch(/const sandPixel = sandIndex >= 0 && pixelAcross \? pixelAcross\[sandIndex\]\.min\(footprint\) : footprint;/);
    expect(core).toMatch(/const near = pixelAcross \? oneMinus\(smoothstep\(0\.3, 1\.2, pixelAcross\[index\]\.min\(footprint\)\)\)\.mul\(cutTone\) : nearAll;/);
    /* the before is main's graph: one shared soft width, the whole footprint */
    expect(core).toMatch(/const softWidth = mix\(max\(float\(softRamp\), pixelHalf\), pixelHalf, meetsCut\);\n\s+classRaws = sdfs\.map\(\(sdf, index\) => \{\n\s+const width = isCut\(index\) \? pixelHalf : softWidth;/);
  });
});

describe('the stripes\' reach', () => {
  /* the shader's pass (MOW_BAND_METRES.fairway, near the camera, where the edge is the overlap) */
  const k = Math.PI / 3.2, edge = 0.22 * k;
  const pass = lateral => Math.max(-1, Math.min(1, Math.sin(lateral * k) / edge));
  const limit = 127 * 0.25;
  const reach = lateral => 1 - smoothstep(limit - 4, limit - 0.25, Math.abs(lateral));
  it('held a whole stripe\'s light or dark past the byte\'s 31.75 m, and fades to the turf\'s own tone before it', () => {
    expect(Math.abs(pass(limit))).toBe(1);
    expect(Math.abs(pass(-limit))).toBe(1);
    expect(Math.abs(pass(limit) * reach(limit))).toBe(0);
    expect(Math.abs(pass(-limit) * reach(-limit))).toBe(0);
    /* the passes within 27 m of the line are untouched */
    for (let lateral = -27; lateral <= 27; lateral += 0.37) expect(reach(lateral)).toBe(1);
    expect(core).toMatch(/const lateralLimit = 127 \* atlas\.data\.lateralStepMetres;/);
    expect(core).toMatch(/oneMinus\(smoothstep\(lateralLimit - 4, lateralLimit - 0\.25, lateral\.abs\(\)\)\)/);
    expect(core).toMatch(/\[SURFACE\.FAIRWAY\]: mix\(lateralPass\(Math\.PI \/ MOW_BAND_METRES\.fairway\), rangePass, ranged\)/);
    expect(core).toMatch(/\[SURFACE\.SEMI\]: mix\(lateralPass\(Math\.PI \/ MOW_BAND_METRES\.semi\), rangePass, ranged\)/);
  });
});

describe('the hard ground', () => {
  const C = {
    rough: [0.10, 0.20, 0.05], forest: [0.08, 0.15, 0.05], heath: [0.2, 0.2, 0.1],
    semi: [0.15, 0.30, 0.08], fair: [0.18, 0.36, 0.09], fringe: [0.16, 0.33, 0.08],
    green: [0.14, 0.38, 0.10], tee: [0.16, 0.34, 0.09], sand: [0.8, 0.75, 0.6],
    path: [0.5, 0.5, 0.5], aspL: [0.3, 0.3, 0.3], hard: [0.45, 0.42, 0.38], soil: [0.3, 0.25, 0.2],
    wet: [0.2, 0.25, 0.15], rock: [0.4, 0.4, 0.4], shore: [0.5, 0.45, 0.35],
  };
  const SHADE = Array.from({ length: 32 }, () => [1.5, 0.4, 0.3, 0.6]);
  const HARD = [SURFACE.PATH, SURFACE.ASPHALT, SURFACE.GRAVEL, SURFACE.DIRT, SURFACE.ROCK];
  it('lies at ground level under the contact line, where it stood 30 mm', () => {
    for (const sid of [...HARD, SURFACE.MUD]) {
      expect(groundStandsMillimetres(sid)).toBe(30);
      expect(groundStandsMillimetres(sid, { hardGround: true })).toBe(0);
    }
    /* the grass, the sand and the natural ground keep their heights */
    for (const sid of [SURFACE.GREEN, SURFACE.FAIRWAY, SURFACE.ROUGH, SURFACE.SAND, SURFACE.FOREST]) {
      expect(groundStandsMillimetres(sid, { hardGround: true })).toBe(groundStandsMillimetres(sid));
    }
  });
  it('counts mud as hard ground, not turf', () => {
    expect(classStyle(C, SHADE, SURFACE.MUD).meta[2]).toBe(0);
    expect(classStyle(C, SHADE, SURFACE.MUD, { hardGround: true }).meta[2]).toBe(1);
    for (const sid of HARD) expect(classStyle(C, SHADE, sid, { hardGround: true }).meta[2]).toBe(1);
    for (const sid of [SURFACE.GREEN, SURFACE.ROUGH, SURFACE.WETLAND]) {
      expect(classStyle(C, SHADE, sid, { hardGround: true })).toEqual(classStyle(C, SHADE, sid));
    }
  });

  it('builds the ground either way, and reports what it drew', () => {
    const square = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    const DETAIL = new THREE.DataTexture(new Uint8Array(16), 2, 2, THREE.RGBAFormat, THREE.UnsignedByteType);
    const atlas = createGroundAtlas({ CORE: { x0: 0, z0: 0, x1: 40, z1: 40 }, res: 1,
      features: [{ surface: SURFACE.FAIRWAY, rings: [square(5, 5, 35, 35)] }, { surface: SURFACE.MUD, rings: [square(1, 1, 4, 4)] }] });
    const options = { atlas, DETAIL, C, SHADE, uSun: vec3(0, 1, 0), cutTone: 1, mowStrength: 1, surfaceEdges: true };
    for (const on of [false, true]) {
      const material = createV2GroundMaterialDecorator({ ...options, acrossEdges: on, stripeReach: on, hardGround: on })(new THREE.MeshStandardNodeMaterial());
      expect(material.colorNode).toBeTruthy();
      expect(material.userData.groundEdges).toEqual({ across: on, stripeReach: on, hardGround: on });
    }
  });

  it('is wired in main.js behind its befores, and they are drawn, not prepared', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/acrossEdges: GROUND_EDGES_ON, stripeReach: STRIPE_REACH_ON, hardGround: HARD_GROUND_ON,/);
    for (const [name, key] of [['GROUND_EDGES_ON', 'groundedges'], ['STRIPE_REACH_ON', 'stripereach'], ['HARD_GROUND_ON', 'hardground']]) {
      expect(main).toContain(`const ${name} = new URLSearchParams(location.search).get('${key}') !== '0';`);
    }
  });
});
