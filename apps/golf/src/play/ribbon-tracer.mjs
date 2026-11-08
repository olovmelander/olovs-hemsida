/* The ball's trace as a broadcast draws it: a ribbon a few pixels wide at any
   distance, turned to face the eye every frame, soft at its edges and fading
   toward the tee. A one-pixel line vanished against the sky and the trees.

   The strip is rebuilt on the CPU from its points each frame (a few hundred
   vertices). Its opacity is two attributes (along and across) read by the
   material's opacityNode, so no vertex colour is needed. Overlay order 3,
   depth tested (the trees still hide it) and never written. */
import * as THREE from 'three/webgpu';
import { attribute, float } from 'three/tsl';

export function createRibbonTracer({ scene, camera, max = 600, color = '#fff2c4', widthPx = 5 }) {
  const positions = new Float32Array(max * 2 * 3), along = new Float32Array(max * 2), across = new Float32Array(max * 2);
  for (let i = 0; i < max; i++) { across[i * 2] = -1; across[i * 2 + 1] = 1; }
  const index = new Uint32Array((max - 1) * 6);
  for (let i = 0; i < max - 1; i++) {
    const a = i * 2, o = i * 6;
    index[o] = a; index[o + 1] = a + 1; index[o + 2] = a + 2;
    index[o + 3] = a + 1; index[o + 4] = a + 3; index[o + 5] = a + 2;
  }
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(positions, 3), alpha = new THREE.BufferAttribute(along, 1);
  geometry.setAttribute('position', position);
  geometry.setAttribute('aAlong', alpha);
  geometry.setAttribute('aAcross', new THREE.BufferAttribute(across, 1));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.setDrawRange(0, 0);
  const material = new THREE.MeshBasicNodeMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  // Full in the middle of the ribbon, nothing at its edges.
  material.opacityNode = attribute('aAlong', 'float').mul(float(1).sub(attribute('aAcross', 'float').abs()));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 3; mesh.frustumCulled = false;
  scene.add(mesh);

  const points = [];
  const tangent = new THREE.Vector3(), toEye = new THREE.Vector3(), side = new THREE.Vector3(), lastSide = new THREE.Vector3(1, 0, 0);
  return {
    mesh,
    get count() { return points.length; },
    reset() { points.length = 0; geometry.setDrawRange(0, 0); },
    push(x, y, z) {
      if (points.length >= max) return;
      const last = points.at(-1);
      if (last && Math.hypot(x - last[0], y - last[1], z - last[2]) < .05) return;
      points.push([x, y, z]);
    },
    /** Rebuild the strip toward the camera. heightPx is the drawing buffer's height in CSS pixels. */
    update(heightPx) {
      const n = points.length;
      if (n < 2) { geometry.setDrawRange(0, 0); return; }
      const fov = THREE.MathUtils.degToRad(camera.fov || 50);
      const perPixel = 2 * Math.tan(fov / 2) / Math.max(200, heightPx);
      for (let i = 0; i < n; i++) {
        const p = points[i], a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
        tangent.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        toEye.set(camera.position.x - p[0], camera.position.y - p[1], camera.position.z - p[2]);
        const distance = toEye.length();
        side.crossVectors(tangent, toEye);
        if (side.lengthSq() < 1e-10) side.copy(lastSide); else side.normalize();
        lastSide.copy(side);
        const half = Math.max(.012, widthPx * .5 * perPixel * distance);
        const o = i * 6;
        positions[o] = p[0] - side.x * half; positions[o + 1] = p[1] - side.y * half; positions[o + 2] = p[2] - side.z * half;
        positions[o + 3] = p[0] + side.x * half; positions[o + 4] = p[1] + side.y * half; positions[o + 5] = p[2] + side.z * half;
        // Fading toward the tee, brightest at the ball.
        const k = .3 + .62 * Math.sqrt(i / (n - 1));
        along[i * 2] = k; along[i * 2 + 1] = k;
      }
      position.needsUpdate = true; alpha.needsUpdate = true;
      position.addUpdateRange(0, n * 6); alpha.addUpdateRange(0, n * 2);
      geometry.setDrawRange(0, (n - 1) * 6);
    },
    set visible(v) { mesh.visible = v; },
    dispose() { scene.remove(mesh); geometry.dispose(); material.dispose(); },
  };
}
