import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { FALLING_LEAVES, fallingLeavesFor, createFallingLeaves } from './falling-leaves.mjs';

const camera = y => { const c = new THREE.PerspectiveCamera(); c.position.set(0, y, 0); return c; };

describe('falling leaves in autumn', () => {
  it('fall in Höst only', () => {
    expect(fallingLeavesFor('host')).toBe(1);
    for (const name of ['golden', 'noon', 'summer', 'dawn', 'midnight', 'bluehour', 'storm', 'mist']) expect(fallingLeavesFor(name)).toBe(0);
  });
  it('are a modest, bounded draw that never blots the lens', () => {
    expect(FALLING_LEAVES.count.hi).toBeLessThanOrEqual(500);
    expect(FALLING_LEAVES.fadePixels[1]).toBeLessThanOrEqual(32);
    expect(FALLING_LEAVES.fall[0]).toBeGreaterThan(0.3);
  });
  it('show low in autumn, hide high up and in other lights, and hold still when asked', () => {
    const f = createFallingLeaves({});
    f.setPreset('host', {}); f.update({ dt: 0.016, air: { x: 2, z: 1 }, camera: camera(1.7), groundY: 0 });
    expect(f.mesh.visible).toBe(true);
    f.update({ dt: 0.016, air: { x: 2, z: 1 }, camera: camera(60), groundY: 0 });
    expect(f.mesh.visible).toBe(false);
    f.setPreset('noon', {}); f.update({ dt: 0.016, camera: camera(1.7), groundY: 0 });
    expect(f.mesh.visible).toBe(false);
    f.setPreset('host', {});
    const t = f.snapshot().time; f.update({ dt: 0.016, camera: camera(1.7), groundY: 0, still: true });
    expect(f.snapshot().time).toBe(t);
  });
  it('is switched in main.js', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/const FALLING_LEAVES_ON = new URLSearchParams\(location\.search\)\.get\('leaves'\) !== '0'/);
  });
});
