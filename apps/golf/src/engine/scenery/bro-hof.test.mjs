import { describe, expect, it } from 'vitest';
import { loadSceneryModule } from './index.js';
import * as scenery from './bro-hof.js';

describe('the scenery both Bro Hof courses share', () => {
  it('is one module for both slugs', async () => {
    const [stadium, castle] = await Promise.all(['bro-hof-stadium', 'bro-hof-castle'].map(loadSceneryModule));
    expect(stadium).toBe(castle);
    expect(stadium.houseKit).toBe(true);
  });

  it('reads the ponds off the ground as published', () => {
    expect(scenery.deferWaterBedToWorld).toBe(true); // the early carve stood every pond inside its own walls
  });

  it('mixes the park trees, and never plants a conifer on the low shore', () => {
    const count = new Map();
    for (let i = 0; i < 1000; i++) {
      const id = scenery.species({ r: i / 1000, x: 0, z: 0, h: 8, extended: true });
      count.set(id, (count.get(id) ?? 0) + 1);
      expect([2, 3]).toContain(scenery.species({ r: i / 1000, x: 0, z: 0, h: 1.2, extended: true }));
      expect([0, 1, 2]).toContain(scenery.species({ r: i / 1000, x: 0, z: 0, h: 8 }));
    }
    expect([...count.keys()].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(count.get(4)).toBeGreaterThan(count.get(2));
    const conifers = x => Array.from({ length: 1000 }, (_, i) => scenery.species({ r: i / 1000, x, z: 0, h: 8, extended: true })).filter(s => s < 2).length;
    expect(conifers(1500)).toBeGreaterThan(conifers(0) * 2);
  });
});
