import { describe, expect, it } from 'vitest';
import { buildSeaShoreField, SEA_SHORE } from './coastal-water.mjs';

/* A window 200 m square whose west half is sea, cut by the window's own west edge,
   with a 20 m island in it: the shore is the coast at x = 0 and the island's rim. */
const window = { x0: -100, x1: 100, z0: -100, z1: 100 };
const sea = { isSea: true, ring: [[-100, -100], [0, -100], [0, 100], [-100, 100]] };
const island = { isSea: true, ring: [[-60, -10], [-40, -10], [-40, 10], [-60, 10]] };
/* the island is partitioned out: two sea rings round it, as the pack's pieces are */
const north = { isSea: true, ring: [[-100, -100], [0, -100], [0, -10], [-100, -10]] };
const south = { isSea: true, ring: [[-100, 10], [0, 10], [0, 100], [-100, 100]] };
const westStrip = { isSea: true, ring: [[-100, -10], [-60, -10], [-60, 10], [-100, 10]] };
const eastStrip = { isSea: true, ring: [[-40, -10], [0, -10], [0, 10], [-40, 10]] };

describe('the sea\'s own shore (SEA_SHORE)', () => {
  it('measures metres into the sea and onto the land from the mapped coast', () => {
    const f = buildSeaShoreField({ sourceBounds: window, bodies: [sea] });
    expect(f.width).toBe(Math.ceil(200 / SEA_SHORE.spacing));
    /* exact within a few texels of the coast, where the fade and the mask read it; the raster's beyond, within half a texel */
    expect(Math.abs(f.distanceAt(-12, 50) - 12)).toBeLessThanOrEqual(SEA_SHORE.spacing / 2);
    expect(f.distanceAt(-4.5, 50)).toBeCloseTo(4.5, 1);
    expect(f.distanceAt(-3, 50)).toBeCloseTo(3, 0);
    expect(f.distanceAt(5, 50)).toBeCloseTo(-5, 0);
    expect(Math.abs(f.distanceAt(0, 50))).toBeLessThan(1);
    /* far out it saturates at the field's range, and the land beyond its reach at minus it */
    expect(f.distanceAt(-80, 0)).toBeCloseTo(SEA_SHORE.rangeMetres, 0);
    expect(f.distanceAt(80, 0)).toBeCloseTo(-SEA_SHORE.rangeMetres, 0);
  });

  it('never counts the window\'s own edge as a shore', () => {
    const f = buildSeaShoreField({ sourceBounds: window, bodies: [sea] });
    /* a metre from the west edge, sixty from the coast */
    expect(f.distanceAt(-99, 0)).toBeGreaterThan(SEA_SHORE.plateMargin + 20);
  });

  it('finds an island\'s rim in partitioned sea pieces, and no seam between the pieces', () => {
    const f = buildSeaShoreField({ sourceBounds: window, bodies: [north, south, westStrip, eastStrip] });
    expect(f.distanceAt(-50, 0)).toBeLessThan(-5);          /* on the island */
    expect(f.distanceAt(-50, -20)).toBeCloseTo(10, 0);       /* ten metres off its north rim */
    /* the cut between two pieces is no shore: open water across it */
    expect(f.distanceAt(-80, -10)).toBeGreaterThan(SEA_SHORE.plateMargin + 10);
  });

  it('keeps the plate under the faded edge: the mask lies wholly past the fade', () => {
    expect(SEA_SHORE.plateMargin).toBeGreaterThan(SEA_SHORE.fadeMetres);
    const f = buildSeaShoreField({ sourceBounds: window, bodies: [sea] });
    /* every texel the mask takes is that far into the sea; none on land or at the edge */
    for (const x of [-1, -2, -3]) expect(f.distanceAt(x, 30)).toBeLessThan(SEA_SHORE.plateMargin);
  });

  it('is null without a sea, and refuses a window it cannot draw', () => {
    expect(buildSeaShoreField({ sourceBounds: window, bodies: [{ ring: sea.ring }] })).toBe(null);
    expect(() => buildSeaShoreField({ sourceBounds: { x0: 0, x1: 0, z0: 0, z1: 1 }, bodies: [sea] })).toThrow();
  });
});
