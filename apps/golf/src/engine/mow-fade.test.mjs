/* Mowing stripes fade by the pixel ACROSS them (ground-material-core.mjs,
   createClassSdfDecorator). The fade rule and the footprints are the shader's,
   evaluated at real pixels of the app's tee camera: from the tee a pixel is
   tens of metres deep down the fairway but centimetres across it, so the whole
   footprint took the stripes long before the pixel could no longer hold them. */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { vec3 } from 'three/tsl';
import { createGroundAtlas } from './atlas.js';
import { createV2GroundMaterialDecorator } from './material.js';
import { SURFACE } from './surface.js';

/* the fairway's passes (MOW_BAND_METRES.fairway) and the shader's fade */
const k = Math.PI / 3.2;
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const shown = reach => 1 - smoothstep(0.55, 1.7, reach * k);

/* the tee view: eye 1.7 m over the tee, looking 260 m down a hole running +z */
function teeCamera(width, height) {
  const camera = new THREE.PerspectiveCamera(48, width / height, 1, 14000);
  camera.position.set(0, 1.7, 0);
  camera.lookAt(0, 3, 260);
  camera.updateMatrixWorld(true);
  return camera;
}
/* where a pixel centre meets the ground (y = 0), as the rasteriser samples it */
function ground(camera, width, height, px, py) {
  const ndc = new THREE.Vector3((px / width) * 2 - 1, 1 - (py / height) * 2, 0.5).unproject(camera);
  const ray = ndc.sub(camera.position).normalize();
  const t = -camera.position.y / ray.y;
  return camera.position.clone().addScaledVector(ray, t);
}
/* dFdx and dFdy of the world position at the pixel that sees ground `metres` down the hole */
function steps(width, height, metres) {
  const camera = teeCamera(width, height);
  const onScreen = new THREE.Vector3(0, 0, metres).project(camera);
  const px = Math.floor((onScreen.x + 1) / 2 * width) + 0.5, py = Math.floor((1 - onScreen.y) / 2 * height) + 0.5;
  const at = ground(camera, width, height, px, py);
  const dx = ground(camera, width, height, px + 1, py).sub(at), dy = ground(camera, width, height, px, py + 1).sub(at);
  return { x: [dx.x, dx.z], y: [dy.x, dy.z] };
}
/* fwidth(wp).length(), the before */
const whole = s => Math.hypot(Math.abs(s.x[0]) + Math.abs(s.y[0]), Math.abs(s.x[1]) + Math.abs(s.y[1]));
/* the pixel projected on the bearing the pattern changes along */
const along = (s, [gx, gz]) => Math.abs(s.x[0] * gx + s.x[1] * gz) + Math.abs(s.y[0] * gx + s.y[1] * gz);

describe('mowing stripes seen from the tee', () => {
  for (const [label, width, height] of [['phone portrait', 412, 915], ['1080p', 1920, 1080]]) {
    it(`stay down the fairway, where the whole footprint lost them (${label})`, () => {
      /* the fairway's passes run with the hole, so they change ACROSS it: bearing +x */
      for (const metres of [60, 120, 250]) {
        const s = steps(width, height, metres);
        expect(shown(along(s, [1, 0]))).toBeGreaterThan(0.95);
        expect(shown(whole(s))).toBeLessThan(0.05);
      }
    });
    it(`still fade where they change down the view, before they can moire (${label})`, () => {
      /* stripes running across the view change along +z, the pixel's depth */
      for (const metres of [60, 120, 250]) {
        const s = steps(width, height, metres);
        expect(along(s, [0, 1])).toBeGreaterThan(0.9 * whole(s));
        expect(shown(along(s, [0, 1]))).toBeLessThan(0.05);
      }
    });
  }
});

describe('the mowing fade knob', () => {
  const square = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  const C = {
    rough: [0.10, 0.20, 0.05], forest: [0.08, 0.15, 0.05], heath: [0.2, 0.2, 0.1],
    semi: [0.15, 0.30, 0.08], fair: [0.18, 0.36, 0.09], fringe: [0.16, 0.33, 0.08],
    green: [0.14, 0.38, 0.10], tee: [0.16, 0.34, 0.09], sand: [0.8, 0.75, 0.6],
    path: [0.5, 0.5, 0.5], aspL: [0.3, 0.3, 0.3], hard: [0.45, 0.42, 0.38], soil: [0.3, 0.25, 0.2],
    wet: [0.2, 0.25, 0.15], rock: [0.4, 0.4, 0.4], shore: [0.5, 0.45, 0.35],
  };
  const SHADE = Array.from({ length: 32 }, () => [1.5, 0.4, 0.3, 0.6]);
  const DETAIL = new THREE.DataTexture(new Uint8Array(16), 2, 2, THREE.RGBAFormat, THREE.UnsignedByteType);
  const atlas = createGroundAtlas({ CORE: { x0: 0, z0: 0, x1: 40, z1: 40 },
    features: [{ surface: SURFACE.FAIRWAY, rings: [square(5, 5, 35, 35)] }], res: 1 });
  const options = { atlas, DETAIL, C, SHADE, uSun: vec3(0, 1, 0), cutTone: 1, mowStrength: 1 };

  it('builds the striped ground either way', () => {
    for (const mowFade of [undefined, 'across', 'iso']) {
      const material = createV2GroundMaterialDecorator({ ...options, mowFade })(new THREE.MeshStandardNodeMaterial());
      expect(material.colorNode).toBeTruthy();
    }
  });
  it('names no other way', () => {
    expect(() => createV2GroundMaterialDecorator({ ...options, mowFade: 'pixel' })).toThrow(/mowing fade/);
  });
});
