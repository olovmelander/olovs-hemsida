/* Every live v2 ground must SAY where its local metres have their zero in
   EPSG:3006, because that single number is what turns a published tile's grid
   bounds into the coordinates the engine draws in.

   This test exists because one ground could not say it, and said so only at a
   visitor's boot. `v2-graph-frontier.mjs` inferred the answer for a
   grid-authored pack -- falling back to `canonicalOrigin`, which is right --
   while `main.js`, handing the RING adapter its origin, read the field and got
   nothing. That was invisible for as long as every ring-graph ground happened
   to be a flat-earth one; Visby is the first grid-authored ground with a ring
   graph, so its flagless boot threw `legacyOriginEpsg3006.easting must be
   finite`, the v2 source failed, and the default visit fell back to GPK1 in
   silence -- by design, which is what made it a fault only a browser gate
   could find while every data gate passed.

   The fix is that the field is DECLARED and never inferred, so this asserts
   the property rather than the shape of the fix. Deliberately no shared helper
   is imported: the app's flagless closure may not statically reach a v2
   module, and a helper both `main.js` and the frontier loader imported is
   exactly what promoted the registry into a shared chunk and turned
   check-app-build red. */
import { describe, it, expect } from 'vitest';
import { V2_GRAPH_FRONTIER_CONFIGS } from './v2-frontier-configs.mjs';
import { PUTTOM_PREVIEW_CONFIG } from './v2-puttom-preview.mjs';

const LIVE = [...Object.entries(V2_GRAPH_FRONTIER_CONFIGS), ['puttom-pilot', PUTTOM_PREVIEW_CONFIG]];

describe('the EPSG:3006 origin of a v2 ground\'s local metres', () => {
  it('is declared by every registered course, and by the retained pilot', () => {
    for (const [slug, config] of LIVE) {
      const origin = config.legacyOriginEpsg3006;
      expect(Number.isFinite(origin?.easting), slug).toBe(true);
      expect(Number.isFinite(origin?.northing), slug).toBe(true);
    }
  });

  /* A flat-earth pack's legacy origin is NOT its canonical grid origin -- 6 m
     apart at Norrfällsviken, 313 m at Upsala, 460 m at Veckefjärden -- so a
     config that quietly used the canonical one would put the whole world that
     far out, on slope and everywhere else. */
  it('is a separate point where the pack has a legacy frame', () => {
    for (const [slug, config] of Object.entries(V2_GRAPH_FRONTIER_CONFIGS)) {
      if (config.bridgeMode !== 'wgs84-legacy-frame') continue;
      expect(config.legacyOriginEpsg3006.easting, slug).not.toBe(config.canonicalOrigin.easting);
      expect(config.legacyOriginEpsg3006.northing, slug).not.toBe(config.canonicalOrigin.northing);
    }
  });

  /* A grid-authored pack has no separate legacy frame at all: its local metres
     ARE the grid minus its canonical origin, so the two must agree exactly.
     They are written once per config and this is what holds them together. */
  it('equals the canonical origin where the pack is authored in the grid', () => {
    const gridAuthored = Object.entries(V2_GRAPH_FRONTIER_CONFIGS)
      .filter(([, config]) => config.bridgeMode === 'epsg3006-local-rh2000');
    expect(gridAuthored.map(([slug]) => slug)).toEqual(['lidingo', 'ribbingsfors', 'visby', 'tortuna']);
    for (const [slug, config] of gridAuthored) {
      expect(config.legacyOriginEpsg3006.easting, slug).toBe(config.canonicalOrigin.easting);
      expect(config.legacyOriginEpsg3006.northing, slug).toBe(config.canonicalOrigin.northing);
    }
  });

  /* And it carries no height: the vertical term is the bridge's business and
     arrives measured, so a third number here could only ever disagree with it. */
  it('carries easting and northing only', () => {
    for (const [slug, config] of LIVE) {
      expect(Object.keys(config.legacyOriginEpsg3006).sort(), slug).toEqual(['easting', 'northing']);
    }
  });
});
