import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { puffyBushGeometry, roundedStoneGeometry } from './cover-shapes.mjs';
import { SEAT_RIM } from './ground-cover.mjs';

const box = g => { g.computeBoundingBox(); return g.boundingBox; };

describe('the ground cover\'s shapes', () => {
  it('keep the old extents, so the seating and the prepared places still fit', () => {
    const bush = box(puffyBushGeometry()), stone = box(roundedStoneGeometry());
    expect(bush.max.x - bush.min.x).toBeGreaterThan(1.0); expect(bush.max.x - bush.min.x).toBeLessThan(1.45);
    expect(bush.min.y).toBeGreaterThan(-0.1); expect(bush.max.y).toBeLessThan(0.85);
    expect(stone.max.x - stone.min.x).toBeGreaterThan(0.8); expect(stone.max.x - stone.min.x).toBeLessThan(1.2);
    expect(stone.max.y).toBeLessThan(0.5);
    expect(SEAT_RIM.bush).toBeGreaterThan(0); expect(SEAT_RIM.stone).toBeGreaterThan(0);
  });
  it('are soft: welded corners, unit normals, a bush\'s normals leaned toward its centre', () => {
    for (const g of [puffyBushGeometry(), roundedStoneGeometry()]) {
      expect(g.index).toBeTruthy();
      const n = g.attributes.normal;
      for (let i = 0; i < n.count; i++) expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 5);
      expect(g.index.count / 3).toBe(80);
    }
    const g = puffyBushGeometry(), p = g.attributes.position, n = g.attributes.normal, c = new THREE.Vector3(0, 0.34, 0);
    let outward = 0;
    for (let i = 0; i < p.count; i++) outward += new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).sub(c).normalize().dot(new THREE.Vector3(n.getX(i), n.getY(i), n.getZ(i)));
    expect(outward / p.count).toBeGreaterThan(0.8);
  });
});
