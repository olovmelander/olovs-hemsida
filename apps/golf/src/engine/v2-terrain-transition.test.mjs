import { describe, expect, it } from 'vitest';
import { createLegacyTerrainTransition } from './v2-terrain-transition.mjs';
import { legacyGridBridge } from './geodetic-frame.mjs';

const bounds = { x0: -100, x1: 100, z0: -100, z1: 100 };
const bridge = legacyGridBridge({ latitude: 59.72733, longitude: 18.19202,
  metresPerLatitude: 111320, metresPerLongitude: 56118.16 });
const edgeHeight = (x, z) => 20 + x * .04 + z * .02;
const blend = createLegacyTerrainTransition({ bounds, bridge, heightAtGrid: (x, z) => ({ height: edgeHeight(x, z) }), widthMetres: 72 });
const at = (x, z, h = 50) => blend(...bridge.toLegacy(x, z), h);

describe('legacy surroundings approach the fixed terrain boundary', () => {
  it('matches all four measured edges and corners in the rotated grid', () => {
    for (const [x, z] of [[-100, 0], [100, 0], [0, -100], [0, 100], [-100, -100], [100, 100]]) {
      // Move an infinitesimal distance outside so roundoff cannot classify an
      // exactly transformed edge as strictly inside the rectangle.
      expect(at(x * (1 + 1e-9), z * (1 + 1e-9))).toBeCloseTo(edgeHeight(x, z), 7);
    }
  });
  it('leaves measured interior and distant legacy ground unchanged', () => {
    expect(at(0, 0, 8)).toBe(8);
    expect(at(99, 99, 9)).toBe(9);
    expect(at(173, 0, 70)).toBe(70);
    expect(at(-200, -200, 30)).toBe(30);
  });
  it('smoothly absorbs either sign of height difference without overshoot', () => {
    for (const h of [0, 80]) {
      let previous = edgeHeight(100, 0);
      for (let d = .1; d < 72; d += .5) {
        const height = at(100 + d, 0, h);
        expect(height).toBeGreaterThanOrEqual(Math.min(h, previous) - 1e-9);
        expect(height).toBeLessThanOrEqual(Math.max(h, previous) + 1e-9);
        previous = height;
      }
    }
  });
  it('rejects unavailable boundary samples instead of fabricating a height', () => {
    const missing = createLegacyTerrainTransition({ bounds, bridge, widthMetres: 72, heightAtGrid: () => null });
    expect(() => missing(...bridge.toLegacy(110, 0), 10)).toThrow('no height');
  });
});
