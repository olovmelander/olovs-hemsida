import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { followTerrain, spanSag } from './power-route.mjs';

/* the lowest the wire comes over the ground along each span */
const lowestClearance = (pts, ground, lift) => {
  let lowest = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ha = ground(...a) + lift, hb = ground(...b) + lift;
    for (let k = 1; k < 64; k++) {
      const t = k / 64, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      lowest = Math.min(lowest, ha + (hb - ha) * t - Math.sin(t * Math.PI) * spanSag(span) - ground(x, z));
    }
  }
  return lowest;
};

describe('power lines over the ground', () => {
  it('stands a support on the ridge a long span crosses, so the wire clears it', () => {
    /* a 40 m ridge half-way along a 400 m span, the supports at its feet */
    const ground = x => 40 * Math.exp(-(((x - 200) / 60) ** 2));
    const line = [[0, 0], [400, 0]];
    expect(lowestClearance(line, ground, 8.2)).toBeLessThan(0);
    const routed = followTerrain(line, { ground, lift: 8.2, maxSpan: 70, clearance: 3 });
    expect(lowestClearance(routed, ground, 8.2)).toBeGreaterThan(2.5);
    /* the mapped ends kept, the spans no longer than allowed */
    expect(routed[0]).toEqual([0, 0]);
    expect(routed[routed.length - 1]).toEqual([400, 0]);
    for (let i = 0; i < routed.length - 1; i++) expect(routed[i + 1][0] - routed[i][0]).toBeLessThanOrEqual(70 + 1e-9);
  });
  it("keeps a tower line's long spans over flat ground, only cut to its longest span", () => {
    const routed = followTerrain([[0, 0], [700, 0]], { ground: () => 10, lift: 19.2, maxSpan: 350, clearance: 6 });
    expect(routed).toEqual([[0, 0], [350, 0], [700, 0]]);
  });
  it('splits a span at the crest, not at its middle', () => {
    const ground = x => (x > 250 && x < 290 ? 30 : 0);
    const routed = followTerrain([[0, 0], [340, 0]], { ground, lift: 19.2, maxSpan: 350, clearance: 6, samples: 32 });
    expect(routed.length).toBeGreaterThan(2);
    expect(routed.some(([x]) => x > 240 && x < 300)).toBe(true);
  });
  it('is used for the inferred lines in main.js, never the mapped supports', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toContain('followTerrain(L0, {');
    expect(main).toContain('mappedOnly || POWER_BEFORE ? L0');
  });
});
