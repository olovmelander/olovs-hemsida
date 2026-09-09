import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { treeTemplateBounds, includeTreeBounds } from './tree-bounds.mjs';
import { viewBasis } from './tree-impostor.mjs';

describe('tree cell visibility bounds', () => {
  it('contains tall/wide mesh tiers, scaled wind and billboard corners at every tested angle', () => {
    const crown = new THREE.BoxGeometry(30, 52, 24).translate(3, 26, -2);
    const trunk = new THREE.CylinderGeometry(0.3, 0.5, 25).translate(0, 12.5, 0);
    const template = treeTemplateBounds([crown, trunk]);
    const atlas = { radius: 32, centreY: 26 };
    const pos = new THREE.Vector3(127, 8, -128);
    for (const [sx, sy] of [[1, 1], [2.4, 0.7], [0.65, 2.2]]) for (const yaw of [0, 0.7, 2.1, 4.3]) {
      const matrix = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(sx, sy, sx));
      const box = includeTreeBounds(new THREE.Box3(), template, atlas, matrix, pos, sx, sy);
      const vertices = crown.getAttribute('position');
      for (let i = 0; i < vertices.count; i++) for (const sign of [-1, 1]) {
        const vertex = new THREE.Vector3().fromBufferAttribute(vertices, i).add(new THREE.Vector3(0.096 * sign, 0, 0.0736 * sign)).applyMatrix4(matrix);
        expect(box.containsPoint(vertex)).toBe(true);
      }
      for (const theta of [0, 0.0447, 0.5, Math.PI / 2]) for (const azimuth of [0, 1.7, 3.9]) {
        const { right, up } = viewBasis(Math.sin(theta) * Math.cos(azimuth), Math.cos(theta), Math.sin(theta) * Math.sin(azimuth));
        const r = new THREE.Vector3(...right), u = new THREE.Vector3(...up), scale = new THREE.Vector3(sx, sy, sx);
        const w = r.clone().multiply(scale).length() * atlas.radius, h = u.clone().multiply(scale).length() * atlas.radius;
        for (const x of [-1, 1]) for (const y of [-1, 1]) {
          const corner = pos.clone().add(new THREE.Vector3(0, atlas.centreY * sy, 0)).addScaledVector(r, x * w).addScaledVector(u, y * h);
          expect(box.containsPoint(corner)).toBe(true);
        }
      }
    }
  });
  it('keeps a visible crown whose base and old fixed height are outside the frustum', () => {
    const geometry = new THREE.BoxGeometry(16, 52, 16).translate(0, 26, 0);
    const box = includeTreeBounds(new THREE.Box3(), treeTemplateBounds([geometry]), { radius: 28, centreY: 26 }, new THREE.Matrix4(), new THREE.Vector3(), 1, 1);
    const old = new THREE.Box3(new THREE.Vector3(-8, -2, -8), new THREE.Vector3(136, 16, 136));
    for (const coordinateSystem of [THREE.WebGLCoordinateSystem, THREE.WebGPUCoordinateSystem]) {
      const camera = new THREE.PerspectiveCamera(12, 1, 1, 200);
      camera.coordinateSystem = coordinateSystem;
      camera.position.set(0, 45, 60); camera.lookAt(0, 45, 0);
      camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
      const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), coordinateSystem);
      expect(frustum.intersectsBox(old)).toBe(false);
      expect(frustum.intersectsBox(box)).toBe(true);
    }
  });
});
