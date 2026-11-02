import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ATMOSPHERE_PRESETS } from './atmosphere-presets.mjs';
import { BIRDS, birdsFor, createBirdGeometry, createBirds } from './birds.mjs';

describe('birds over the course', () => {
  it('give every light a sky, none in the storm, the mist or the blue hour', () => {
    for (const name of Object.keys(ATMOSPHERE_PRESETS)) {
      const a = birdsFor(name);
      expect(a, name).toBeGreaterThanOrEqual(0); expect(a, name).toBeLessThanOrEqual(1);
    }
    for (const name of ['storm', 'mist', 'bluehour']) expect(birdsFor(name)).toBe(0);
    expect(birdsFor('golden')).toBe(1);
  });
  it('is one bird with tagged wings: the body still, the wrist and the tip on each side', () => {
    const g = createBirdGeometry();
    const wing = g.getAttribute('aWing').array, side = g.getAttribute('aSide').array, pos = g.getAttribute('position').array;
    expect(Math.max(...wing)).toBe(2);
    for (let i = 0; i < wing.length; i++) {
      if (wing[i] === 0 && side[i] === 0) expect(Math.abs(pos[i * 3 + 2])).toBeLessThan(0.1);
      if (wing[i] === 2) expect(Math.abs(pos[i * 3 + 2])).toBeCloseTo(BIRDS.span / 2, 6);
    }
    expect(g.getAttribute('position').count).toBeLessThan(60);
  });
  it('flies high, shows by the light and holds still when asked', () => {
    expect(BIRDS.height[0]).toBeGreaterThanOrEqual(30);
    const b = createBirds({ deterministic: false });
    b.setPreset('storm', {}); b.update({ dt: 0.016, groundY: 10 });
    expect(b.mesh.visible).toBe(false);
    b.setPreset('golden', {}); b.update({ dt: 0.016, groundY: 10 });
    expect(b.mesh.visible).toBe(true);
    const t = b.snapshot().time;
    b.update({ dt: 0.016, groundY: 10, still: true });
    expect(b.snapshot().time).toBe(t);
    const pinned = createBirds({ deterministic: true }), t0 = pinned.snapshot().time;
    pinned.setPreset('golden', {}); pinned.update({ dt: 0.05, groundY: 0 });
    expect(pinned.snapshot().time).toBe(t0);
  });
  it('is switched in main.js', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/const BIRDS_ON = new URLSearchParams\(location\.search\)\.get\('birds'\) !== '0'/);
  });
});
