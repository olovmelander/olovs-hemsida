import { describe, expect, it } from 'vitest';
import { ringSD, withinRing } from './geom.js';

describe('withinRing', () => {
  it('answers exactly as ringSD does, for any ring, point and margin', () => {
    let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let n = 0; n < 200; n++) {
      const cx = r() * 200 - 100, cz = r() * 200 - 100, spokes = 3 + Math.floor(r() * 9), ring = [];
      for (let k = 0; k < spokes; k++) { const a = (k + r() * .8) / spokes * Math.PI * 2, d = 4 + r() * 40; ring.push([cx + Math.cos(a) * d, cz + Math.sin(a) * d]); }
      for (let q = 0; q < 300; q++) {
        const x = cx + (r() - .5) * 120, z = cz + (r() - .5) * 120, margin = (r() - .35) * 12;
        expect(withinRing(x, z, ring, margin)).toBe(ringSD(x, z, ring) <= margin);
      }
    }
  });
});
