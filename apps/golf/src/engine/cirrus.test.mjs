import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ATMOSPHERE_PRESETS } from './atmosphere-presets.mjs';
import { CIRRUS, cirrusFor } from './painted-sky.mjs';

describe('high cirrus', () => {
  it('belongs to the clear lights: none in the storm, the mist or the cloudless summer day', () => {
    for (const name of Object.keys(ATMOSPHERE_PRESETS)) {
      const share = cirrusFor(name);
      expect(share, name).toBeGreaterThanOrEqual(0); expect(share, name).toBeLessThanOrEqual(1);
    }
    for (const name of ['storm', 'mist', 'summer']) expect(cirrusFor(name)).toBe(0);
    expect(cirrusFor('unknown')).toBe(0);
  });
  it('is a veil, never a deck: at most a third of the sky\'s colour, streaks longer than wide', () => {
    expect(CIRRUS.opacity).toBeLessThanOrEqual(0.35);
    expect(CIRRUS.stretch[1] / CIRRUS.stretch[0]).toBeGreaterThan(4);
  });
  it('is switched in main.js and set per light through the sky preset', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/cirrus: new URLSearchParams\(location\.search\)\.get\('cirrus'\) !== '0'/);
    expect(main).toMatch(/skyCirrus: cirrusFor\(name\)/);
    const sky = fs.readFileSync(new URL('./atmospheric-sky.mjs', import.meta.url), 'utf8');
    expect(sky).toMatch(/c\.cirrusShare\.value=preset\.skyCirrus\?\?0/);
  });
});
