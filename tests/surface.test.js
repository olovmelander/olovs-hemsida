import { describe, it, expect } from 'vitest';
import { SURFACE, SURFACE_PRIORITY, EDGE_WIDTHS, createClassifier } from '../apps/golf/src/engine/surface.js';

describe('Surface Registry & Classifier', () => {
  it('should define all distinct surface IDs', () => {
    expect(SURFACE.GREEN).toBe(4);
    expect(SURFACE.FAIRWAY).toBe(2);
    expect(SURFACE.SAND).toBe(6);
    expect(SURFACE.ROUGH).toBe(0);
  });

  it('should define explicit priority order with Sand > Green > Tee > Fairway', () => {
    const greenIdx = SURFACE_PRIORITY.indexOf(SURFACE.GREEN);
    const teeIdx = SURFACE_PRIORITY.indexOf(SURFACE.TEE);
    const sandIdx = SURFACE_PRIORITY.indexOf(SURFACE.SAND);
    const fairwayIdx = SURFACE_PRIORITY.indexOf(SURFACE.FAIRWAY);
    const roughIdx = SURFACE_PRIORITY.indexOf(SURFACE.ROUGH);

    /* sand above all mown surfaces: the overlay stack drew it that way, and a
       bunker ring that overlaps a green trace must still read as sand */
    expect(sandIdx).toBeLessThan(greenIdx);
    expect(greenIdx).toBeLessThan(fairwayIdx);
    expect(teeIdx).toBeLessThan(fairwayIdx);
    expect(fairwayIdx).toBeLessThan(roughIdx);
  });

  it('should lock bunker cut and green edge widths', () => {
    expect(EDGE_WIDTHS.BUNKER_CUT).toBe(0.25);
    expect(EDGE_WIDTHS.GREEN_CUT).toBe(0.2);
    expect(EDGE_WIDTHS.FRINGE_FALLOFF).toBe(4.2);
  });

  it('should classify test geometry accurately', () => {
    const smooth = (a, b, x) => {
      const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const ringSD = (x, z, ring) => Math.hypot(x - ring[0][0], z - ring[0][1]) - 10;
    const distToLine = (x, z, line) => Math.hypot(x - line[0][0], z - line[0][1]);

    const mockGI = { at: () => [{ ring: [[0, 0]], hole: 1 }] };
    const mockTI = { at: () => [] };
    const mockBI = { at: () => [] };
    const mockFI = { at: () => [] };
    const mockPI = { at: () => [] };
    const mockVI = { at: () => [] };
    const mockHOLES = [{ n: 1, line: [[0, 0], [0, 100]] }];

    const classify = createClassifier({
      GI: mockGI,
      TI: mockTI,
      BI: mockBI,
      FI: mockFI,
      PI: mockPI,
      VI: mockVI,
      HOLES: mockHOLES,
      ringSD,
      distToLine,
      smooth,
    });

    // Point inside the green (radius 10m -> distance 0 is inside)
    const inside = classify(0, 0);
    expect(inside.green).toBeGreaterThan(0.99);
    expect(inside.hole).toBe(1);

    // Point far outside the green (100m away)
    const outside = classify(100, 100);
    expect(outside.green).toBe(0);
  });
});
