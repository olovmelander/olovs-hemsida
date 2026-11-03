import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { RAIN, rainFor, createRain } from './rain.mjs';

const camera = y => { const c = new THREE.PerspectiveCamera(); c.position.set(0, y, 0); return c; };

describe('rain in the storm', () => {
  it('falls in the storm only', () => {
    expect(rainFor('storm')).toBe(1);
    for (const name of ['golden', 'noon', 'summer', 'dawn', 'midnight', 'bluehour', 'mist', 'host']) expect(rainFor(name)).toBe(0);
  });
  it('is faint, thin and bounded', () => {
    expect(RAIN.light).toBeLessThanOrEqual(0.35);
    expect(RAIN.width).toBeLessThan(0.02);
    expect(RAIN.count.hi).toBeLessThanOrEqual(3000);
    expect(RAIN.near).toBeGreaterThanOrEqual(1);
  });
  it('shows in the storm low down, hides high up and in fair weather, and freezes when asked', () => {
    const r = createRain({});
    r.setPreset('storm', {}); r.update({ dt: 0.016, air: { x: 9, z: -3 }, camera: camera(1.7), groundY: 0 });
    expect(r.mesh.visible).toBe(true);
    r.update({ dt: 0.016, air: { x: 9, z: -3 }, camera: camera(200), groundY: 0 });
    expect(r.mesh.visible).toBe(false);
    r.setPreset('noon', {}); r.update({ dt: 0.016, camera: camera(1.7), groundY: 0 });
    expect(r.mesh.visible).toBe(false);
    r.setPreset('storm', {});
    const t = r.snapshot().time; r.update({ dt: 0.016, camera: camera(1.7), groundY: 0, still: true });
    expect(r.snapshot().time).toBe(t);
  });
  it('is an overlay after the sky, switched in main.js', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/const RAIN_ON = new URLSearchParams\(location\.search\)\.get\('rain'\) !== '0'/);
    expect(main).toMatch(/rain\.mesh\.renderOrder = 3/);
  });
});
