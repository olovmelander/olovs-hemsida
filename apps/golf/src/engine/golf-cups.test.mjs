import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { float } from 'three/tsl';
import { CUP, buildCupField, createGolfCupMask, createGolfCupGeometry, cupSurfaceHeightAt } from './golf-cups.mjs';

function isOpening(field, x, z) {
  const ix = Math.floor((x - field.x0) / field.spacing), iz = Math.floor((z - field.z0) / field.spacing);
  if (ix < 0 || iz < 0 || ix >= field.width || iz >= field.height) return false;
  const i = (iz * field.width + ix) * 4, d = field.data;
  return d[i + 2] > .5 && Math.hypot(x - field.x0 - d[i], z - field.z0 - d[i + 1]) < CUP.radius;
}

describe('exact cup openings', () => {
  it('cuts circles across cell boundaries and refines nearby cups without cutting neighbouring turf', () => {
    const pins = [[0, 0], [1, 1], [512, -704], [512.001, -700.001]];
    const field = buildCupField(pins);
    expect(field.spacing).toBeLessThan(16);
    for (const [x, z] of pins) for (let i = 0; i < 64; i++) {
      const a = i / 64 * Math.PI * 2;
      expect(isOpening(field, x + Math.cos(a) * .053, z + Math.sin(a) * .053)).toBe(true);
      expect(isOpening(field, x + Math.cos(a) * .055, z + Math.sin(a) * .055)).toBe(false);
    }
    expect(isOpening(field, 200, 200)).toBe(false);
    expect(isOpening(field, 5000, -5000)).toBe(false);
  });

  it('deduplicates shared pin positions, handles empty courses and rejects invalid positions', () => {
    expect(buildCupField([[0, 0], [0, 0]]).data).toEqual(buildCupField([[0, 0]]).data);
    expect(isOpening(buildCupField([]), 0, 0)).toBe(false);
    expect(() => buildCupField([[NaN, 0]])).toThrow('Invalid cup position');
    expect(() => buildCupField([[0, 0], [.05, 0]])).toThrow('overlap');
  });

  it('preserves existing terrain masks and surface authority without applying twice', () => {
    const mask = createGolfCupMask([[0, 0]]), material = new THREE.MeshStandardNodeMaterial();
    const prior = float(1).greaterThan(0);
    material.maskNode = prior;
    const authority = {}, decorate = m => { m.userData.ground = true; return m; };
    Object.defineProperty(decorate, 'v2SurfaceAuthority', { value: authority });
    const wrapped = mask.wrap(decorate);
    expect(wrapped.v2SurfaceAuthority).toBe(authority);
    expect(wrapped(material)).toBe(material);
    expect(material.userData.ground).toBe(true);
    expect(material.maskNode).not.toBe(prior);
    expect(material.maskNode.node.aNode).toBe(prior);
    const combined = material.maskNode;
    expect(mask.apply(material).maskNode).toBe(combined);
    expect(mask.map.minFilter).toBe(THREE.NearestFilter);
    expect(mask.map.generateMipmaps).toBe(false);
    mask.map.dispose(); material.dispose();
  });
});

describe('recessed cup geometry', () => {
  it('follows a sloped rim, keeps the liner below the lowest turf, and closes the bottom', () => {
    const heightAt = (x, z) => 27 + .08 * x - .04 * z;
    const geometry = createGolfCupGeometry(10, -20, heightAt), p = geometry.attributes.position;
    const row = CUP.segments + 1, base = heightAt(10, -20);
    let low = Infinity;
    for (let i = 0; i < row; i++) {
      const t = i / CUP.segments * Math.PI * 2;
      const h = heightAt(10 + Math.cos(t) * CUP.radius, -20 + Math.sin(t) * CUP.radius) - base;
      expect(p.getY(i)).toBeCloseTo(h + .0003, 6);
      low = Math.min(low, h);
    }
    expect(p.getY(3 * row)).toBeCloseTo(low - CUP.linerInset, 6);
    expect(p.getY(7 * row)).toBeCloseTo(low - CUP.depth, 6);
    expect(p.getX(7 * row)).toBe(0);
    expect([...p.array, ...geometry.attributes.normal.array]).toSatisfy(a => a.every(Number.isFinite));
    const cup = new THREE.Mesh(geometry, new THREE.MeshBasicNodeMaterial());
    const ray = new THREE.Raycaster(new THREE.Vector3(.025, 1, 0), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(cup)[0];
    expect(hit.point.y).toBeLessThan(-.1);
    geometry.dispose(); cup.material.dispose();
  });

  it('samples the drawn overlay triangles, including a crease and transformed mesh', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -1,.1,-1, 0,.2,1, 0,.2,-1,
      0,.2,-1, 0,.2,1, 1,.08,-1,
    ], 3));
    const mesh = new THREE.Mesh(geometry); mesh.position.set(20, 30, -40);
    const sample = cupSurfaceHeightAt(20, -40, () => 30, [mesh]);
    expect(sample(20, -40)).toBeCloseTo(30.2, 6);
    expect(sample(19.95, -40)).toBeCloseTo(30.195, 6);
    expect(sample(20.05, -40)).toBeCloseTo(30.194, 6);
    expect(cupSurfaceHeightAt(0, 0, () => 7)(0, 0)).toBe(7);
    geometry.dispose(); mesh.material.dispose();
  });
});
