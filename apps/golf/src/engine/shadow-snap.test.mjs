/* The shadow map's texel snap, checked outside the browser: a target moved to a
   whole-texel position in the light's view space projects into the shadow camera
   three builds (position along the light, lookAt the target, y up) at a texel
   boundary, whatever the target was -- and a target that moves by a whole texel
   lands on the same grid. main.js keeps the same arithmetic in placeSun. */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';

function snapTarget(t, d, texel) {
  const m = new THREE.Matrix4().lookAt(d, new THREE.Vector3(), THREE.Object3D.DEFAULT_UP);
  const right = new THREE.Vector3().setFromMatrixColumn(m, 0), up = new THREE.Vector3().setFromMatrixColumn(m, 1);
  const u = t.dot(right), v = t.dot(up);
  const ox = Math.round(u / texel) * texel - u, oy = Math.round(v / texel) * texel - v;
  return t.clone().addScaledVector(right, ox).addScaledVector(up, oy);
}

/* the shadow camera as LightShadow.updateMatrices builds it */
function shadowCameraFor(target, d, R) {
  const cam = new THREE.OrthographicCamera(-R, R, R, -R, 200, 2400);
  cam.position.copy(target).addScaledVector(d, 1200);
  cam.lookAt(target);
  cam.updateMatrixWorld();
  return cam;
}

const d = new THREE.Vector3(-0.42, 0.46, 0.78).normalize();

describe('shadow texel snap', () => {
  it('puts the snapped target on a whole texel in the shadow camera view space, for many targets', () => {
    const R = 400, texel = 2 * R / 2048;
    for (let i = 0; i < 200; i++) {
      const t = new THREE.Vector3(Math.sin(i * 12.9898) * 900, 40 + Math.cos(i * 4.1) * 30, Math.cos(i * 78.233) * 900);
      const s = snapTarget(t, d, texel);
      const cam = shadowCameraFor(s, d, R);
      /* the camera sits at the snapped target: its own view-space origin, so the box's centre in the world-anchored
         light frame is the projection of the snapped target, which is a multiple of the texel */
      const m = new THREE.Matrix4().lookAt(d, new THREE.Vector3(), THREE.Object3D.DEFAULT_UP);
      const right = new THREE.Vector3().setFromMatrixColumn(m, 0), up = new THREE.Vector3().setFromMatrixColumn(m, 1);
      const u = s.dot(right) / texel, v = s.dot(up) / texel;
      expect(Math.abs(u - Math.round(u))).toBeLessThan(1e-6);
      expect(Math.abs(v - Math.round(v))).toBeLessThan(1e-6);
      /* the snap never moves the target more than half a texel in the light plane, and not at all along the light */
      const moved = s.clone().sub(t);
      expect(Math.abs(moved.dot(d))).toBeLessThan(1e-9);
      expect(moved.length()).toBeLessThanOrEqual(texel * Math.SQRT1_2 + 1e-9);
      /* and three's camera agrees with the basis: the world right axis of the camera equals the basis right */
      const camRight = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
      expect(camRight.distanceTo(right)).toBeLessThan(1e-9);
    }
  });
  it('a pan of one whole texel leaves the grid where it was', () => {
    const R = 260, texel = 2 * R / 2048;
    const m = new THREE.Matrix4().lookAt(d, new THREE.Vector3(), THREE.Object3D.DEFAULT_UP);
    const right = new THREE.Vector3().setFromMatrixColumn(m, 0);
    const t0 = new THREE.Vector3(123.4, 61.2, -77.7), t1 = t0.clone().addScaledVector(right, texel);
    const s0 = snapTarget(t0, d, texel), s1 = snapTarget(t1, d, texel);
    expect(s1.clone().sub(s0).distanceTo(right.clone().multiplyScalar(texel))).toBeLessThan(1e-9);
  });
});
