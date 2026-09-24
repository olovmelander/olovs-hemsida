import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { hemiOctahedralEncode, hemiOctahedralDecode, frameBlend, viewBasis, frameNdcOffset, frameUv, impostorViewDirection } from './tree-impostor.mjs';

let seed = 3;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const upperDirection = () => {
  const a = rnd() * Math.PI * 2, e = rnd() * Math.PI / 2;
  return [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)];
};

describe('the hemi-octahedral mapping', () => {
  it('round-trips every upper-hemisphere direction through the unit square', () => {
    for (let i = 0; i < 2000; i++) {
      const [x, y, z] = upperDirection();
      const [u, v] = hemiOctahedralEncode(x, y, z);
      expect(u).toBeGreaterThanOrEqual(-1e-9); expect(u).toBeLessThanOrEqual(1 + 1e-9);
      expect(v).toBeGreaterThanOrEqual(-1e-9); expect(v).toBeLessThanOrEqual(1 + 1e-9);
      const [dx, dy, dz] = hemiOctahedralDecode(u, v);
      expect(Math.hypot(dx - x, dy - y, dz - z)).toBeLessThan(1e-6);
    }
  });
  it('puts the zenith at the centre and the horizon on the edge', () => {
    expect(hemiOctahedralEncode(0, 1, 0)).toEqual([0.5, 0.5]);
    const [u, v] = hemiOctahedralEncode(1, 0, 0);
    expect(Math.min(u, v, 1 - u, 1 - v)).toBeLessThan(1e-9);
  });
});

describe('the frame blend', () => {
  it('weights three frames of the grid to one, all inside it', () => {
    for (const n of [4, 8, 16]) {
      for (let i = 0; i < 1000; i++) {
        const { frames, weights } = frameBlend(rnd(), rnd(), n);
        expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
        for (const w of weights) { expect(w).toBeGreaterThanOrEqual(-1e-9); expect(w).toBeLessThanOrEqual(1 + 1e-9); }
        for (const [fi, fj] of frames) { expect(fi).toBeGreaterThanOrEqual(0); expect(fi).toBeLessThan(n); expect(fj).toBeGreaterThanOrEqual(0); expect(fj).toBeLessThan(n); }
      }
    }
  });
  it('reproduces a frame exactly at its own grid point', () => {
    const n = 8;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const { frames, weights } = frameBlend(i / (n - 1), j / (n - 1), n);
      const k = weights.findIndex(w => Math.abs(w - 1) < 1e-6);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(frames[k]).toEqual([i, j]);
    }
  });
});

describe('the view basis', () => {
  it('does not rotate the image across the former polar threshold or the zenith', () => {
    for (const a of [0, 0.7, 1.8, 3, 4.6, 5.9]) {
      for (const theta of [0, Math.acos(0.999)]) {
        const basis = t => viewBasis(Math.sin(t) * Math.cos(a), Math.cos(t), Math.sin(t) * Math.sin(a));
        const before = basis(theta - 0.00002), after = basis(theta + 0.00002);
        for (const axis of ['right', 'up']) expect(Math.hypot(...before[axis].map((v, i) => v - after[axis][i]))).toBeLessThan(0.0001);
      }
    }
  });
  it('is orthonormal and right-handed, including straight down', () => {
    const dirs = [[0, 1, 0], [1, 0, 0], [0, 0, 1], [0.6, 0.8, 0], ...Array.from({ length: 50 }, upperDirection)];
    for (const [x, y, z] of dirs) {
      const { right, up } = viewBasis(x, y, z);
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      expect(Math.hypot(...right)).toBeCloseTo(1, 6);
      expect(Math.hypot(...up)).toBeCloseTo(1, 6);
      expect(dot(right, up)).toBeCloseTo(0, 6);
      expect(dot(right, [x, y, z])).toBeCloseTo(0, 6);
      expect(dot(up, [x, y, z])).toBeCloseTo(0, 6);
    }
  });
});

describe('the atlas layout', () => {
  /* a frame's cell in NDC and the uv it is read back at must be the same
     cell: NDC y runs up, texture v runs down, and the bake writes frame
     row j from the bottom while the shader reads it from the top */
  it('reads a frame back from the cell the projection put it in', () => {
    const n = 8, size = 8 * 96;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const o = frameNdcOffset(i, j, n);
      /* the cell's NDC box -> texture space (u = (x+1)/2, v = (1-y)/2) */
      const x0 = (o.x - o.scale + 1) / 2, x1 = (o.x + o.scale + 1) / 2;
      const vTop = (1 - (o.y + o.scale)) / 2, vBottom = (1 - (o.y - o.scale)) / 2;
      const [uL, vT] = frameUv(i, j, 0, 1, n, size), [uR, vB] = frameUv(i, j, 1, 0, n, size);
      const inset = 1 / size;
      expect(uL).toBeCloseTo(x0 + inset, 12); expect(uR).toBeCloseTo(x1 - inset, 12);
      expect(vT).toBeCloseTo(vTop + inset, 12); expect(vB).toBeCloseTo(vBottom - inset, 12);
    }
  });
  it('tiles the unit square with the cells, in order, without overlap', () => {
    const n = 8;
    const seen = new Set();
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const o = frameNdcOffset(i, j, n);
      const key = Math.round((o.x + 1) / (2 * o.scale) - 0.5) + ',' + Math.round((o.y + 1) / (2 * o.scale) - 0.5);
      expect(key).toBe(i + ',' + j);
      seen.add(key);
    }
    expect(seen.size).toBe(n * n);
    expect(frameNdcOffset(0, 0, n).x - frameNdcOffset(0, 0, n).scale).toBeCloseTo(-1, 12);
    expect(frameNdcOffset(n - 1, n - 1, n).y + frameNdcOffset(0, 0, n).scale).toBeCloseTo(1, 12);
  });
  it('keeps the tree the right way up: v = 1 of a frame is nearer the atlas top than v = 0', () => {
    const [, vTop] = frameUv(3, 5, 0.5, 1, 8, 768), [, vBase] = frameUv(3, 5, 0.5, 0, 8, 768);
    expect(vTop).toBeLessThan(vBase);
  });
});

describe('the direction an impostor faces', () => {
  const d = new THREE.Vector3(-0.42, 0.46, 0.78).normalize();
  /* the sun's shadow camera as placeSun and LightShadow.updateMatrices build it */
  const sunCamera = (target, R, lightDistance) => {
    const light = new THREE.DirectionalLight();
    light.position.copy(target).addScaledVector(d, lightDistance);
    light.target.position.copy(target);
    light.updateMatrixWorld(); light.target.updateMatrixWorld();
    const cam = light.shadow.camera;
    cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R;
    cam.near = lightDistance / 6; cam.far = lightDistance * 2;
    cam.updateProjectionMatrix();
    light.shadow.updateMatrices(light);
    return cam;
  };
  const toward = (cam, centre) => impostorViewDirection(cam.projectionMatrix.elements, cam.matrixWorld.elements, centre);
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  it('tells the renderer\'s cameras apart by the projection\'s last row, in both coordinate systems and depth conventions', () => {
    for (const system of [THREE.WebGLCoordinateSystem, THREE.WebGPUCoordinateSystem]) for (const reversed of [false, true]) {
      const perspective = new THREE.PerspectiveCamera(48, 16 / 9, 1, 14000);
      const orthographic = new THREE.OrthographicCamera(-400, 400, 400, -400, 200, 2400);
      for (const cam of [perspective, orthographic]) {
        cam.coordinateSystem = system;
        cam._reversedDepth = reversed;
        cam.updateProjectionMatrix();
        expect(cam.reversedDepth).toBe(reversed);
      }
      expect(perspective.projectionMatrix.elements[15]).toBe(0);
      expect(orthographic.projectionMatrix.elements[15]).toBe(1);
    }
  });

  it('keeps the colour pass on the ray to the player\'s camera', () => {
    const cam = new THREE.PerspectiveCamera(48, 16 / 9, 1, 14000);
    cam.position.set(10, 50, 300); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
    for (let i = 0; i < 50; i++) {
      const centre = [(rnd() - 0.5) * 2000, rnd() * 80, (rnd() - 0.5) * 2000];
      const ray = new THREE.Vector3(10 - centre[0], 50 - centre[1], 300 - centre[2]).normalize();
      expect(distance(toward(cam, centre), ray.toArray())).toBeLessThan(1e-12);
    }
  });

  it('turns every impostor to the sun in the shadow pass, wherever it stands in the box', () => {
    for (const [R, L] of [[260, 1200], [1150, 1200], [3000, 1200 * 3000 / 1150]]) {
      const target = new THREE.Vector3(123.4, 40, -77.7), cam = sunCamera(target, R, L);
      for (let i = 0; i < 100; i++) {
        const centre = [target.x + (rnd() * 2 - 1) * R, target.y + rnd() * 60, target.z + (rnd() * 2 - 1) * R];
        expect(distance(toward(cam, centre), d.toArray())).toBeLessThan(1e-9);
      }
    }
  });

  it('lays the billboard flat in the shadow map, where the ray to the light tilted it', () => {
    const target = new THREE.Vector3(0, 30, 0), cam = sunCamera(target, 1150, 1200);
    /* the four corners of a 16 m billboard, in the shadow camera's view space */
    const depthSpread = (centre, view) => {
      const { right, up } = viewBasis(...view);
      const z = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(
        centre[0] + (right[0] * a + up[0] * b) * 8, centre[1] + (right[1] * a + up[1] * b) * 8,
        centre[2] + (right[2] * a + up[2] * b) * 8).applyMatrix4(cam.matrixWorldInverse).z);
      return Math.max(...z) - Math.min(...z);
    };
    const light = cam.position.toArray();
    for (const centre of [[0, 36, 0], [700, 36, -300], [-900, 50, 800]]) {
      expect(depthSpread(centre, toward(cam, centre))).toBeLessThan(1e-6);
      const ray = new THREE.Vector3(light[0] - centre[0], light[1] - centre[1], light[2] - centre[2]).normalize().toArray();
      /* the ray to the light's position, which is what the billboard followed before: flat at the target only;
         these two trees, 550 and 650 m off it in the light's plane, it tilted by 18 and 74 degrees --
         5.5 and 21.7 m deep across their sixteen, a squashed and misdrawn shadow */
      if (centre[0] !== 0) expect(depthSpread(centre, ray)).toBeGreaterThan(5);
    }
  });
});
