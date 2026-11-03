import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { ATMOSPHERE_PRESETS } from './atmosphere-presets.mjs';
import { BUTTERFLIES, butterfliesFor, createButterflies, createButterflyGeometry } from './butterflies.mjs';

const camera = (y = 1.7) => { const c = new THREE.PerspectiveCamera(); c.position.set(0, y, 0); return c; };

describe('butterflies round the eye', () => {
  it('fly in the fair lights only', () => {
    for (const name of Object.keys(ATMOSPHERE_PRESETS)) {
      const a = butterfliesFor(name); expect(a, name).toBeGreaterThanOrEqual(0); expect(a, name).toBeLessThanOrEqual(1);
    }
    for (const name of ['storm', 'mist', 'bluehour']) expect(butterfliesFor(name)).toBe(0);
  });
  it('are two hinged wings, a small draw, and never a blot', () => {
    const g = createButterflyGeometry();
    expect(g.getAttribute('position').count).toBe(12);
    const sides = new Set(g.getAttribute('aSide').array); expect([...sides].sort()).toEqual([-1, 1]);
    expect(BUTTERFLIES.fadePixels[1]).toBeLessThanOrEqual(40);
    expect(BUTTERFLIES.count.hi).toBeLessThanOrEqual(40);
  });
  it('show in a low view in a fair light, hide high up and in the storm, hold still when asked', () => {
    const b = createButterflies({});
    b.setPreset('noon', {}); b.update({ dt: 0.016, camera: camera(1.7), groundY: 0 });
    expect(b.mesh.visible).toBe(true);
    b.update({ dt: 0.016, camera: camera(30), groundY: 0 });
    expect(b.mesh.visible).toBe(false);
    b.setPreset('storm', {}); b.update({ dt: 0.016, camera: camera(1.7), groundY: 0 });
    expect(b.mesh.visible).toBe(false);
    const t = b.snapshot().time; b.update({ dt: 0.016, camera: camera(1.7), groundY: 0, still: true });
    expect(b.snapshot().time).toBe(t);
  });
  it('is switched in main.js', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/const BUTTERFLIES_ON = new URLSearchParams\(location\.search\)\.get\('butterflies'\) !== '0'/);
  });
});
