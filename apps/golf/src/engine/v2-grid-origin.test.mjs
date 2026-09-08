/* Every live v2 ground must be able to say where its local metres have their
   zero in EPSG:3006, because that single number is what turns a published
   tile's grid bounds into the coordinates the engine draws in.

   This test exists because the app could NOT say it for Visby, and said so
   only at a visitor's boot. The frontier loader had the rule inline; main.js,
   handing the RING adapter its origin, read `legacyOriginEpsg3006` straight
   off the config and Visby -- the first grid-authored ground with a ring
   graph -- has none, because for such a ground the grid origin IS the legacy
   origin. The boot threw `legacyOriginEpsg3006.easting must be finite`, the
   v2 source failed, and the default visit fell back to GPK1 in silence, which
   is exactly what the fallback is designed to do. Ribbingsfors and Lidingö
   carry the same shape and were saved only by not having a ring graph yet.

   So the rule has one home now, and this asserts the property that matters
   rather than the shape of the fix: every registered config resolves, and a
   ground whose legacy frame really is separate keeps ITS number and not its
   canonical one. */
import { describe, it, expect } from 'vitest';
import { V2_GRAPH_FRONTIER_CONFIGS, gridOriginEpsg3006 } from './v2-frontier-configs.mjs';
import { PUTTOM_PREVIEW_CONFIG } from './v2-puttom-preview.mjs';

describe('the EPSG:3006 origin of a v2 ground\'s local metres', () => {
  it('resolves for every registered course, and for the retained pilot', () => {
    for (const [slug, config] of Object.entries(V2_GRAPH_FRONTIER_CONFIGS)) {
      const origin = gridOriginEpsg3006(config);
      expect(Number.isFinite(origin.easting), slug).toBe(true);
      expect(Number.isFinite(origin.northing), slug).toBe(true);
    }
    const pilot = gridOriginEpsg3006(PUTTOM_PREVIEW_CONFIG);
    expect(pilot).toBe(PUTTOM_PREVIEW_CONFIG.legacyOriginEpsg3006);
  });

  /* A flat-earth pack's legacy origin is NOT its canonical grid origin -- 6 m
     apart at Norrfällsviken, 313 m at Upsala, 460 m at Veckefjärden -- so
     taking the canonical one would put the whole world that far out. */
  it('keeps a separate legacy origin where the pack has one', () => {
    for (const [slug, config] of Object.entries(V2_GRAPH_FRONTIER_CONFIGS)) {
      if (config.bridgeMode !== 'wgs84-legacy-frame') continue;
      expect(gridOriginEpsg3006(config), slug).toBe(config.legacyOriginEpsg3006);
      expect(config.legacyOriginEpsg3006.easting, slug).not.toBe(config.canonicalOrigin.easting);
    }
  });

  /* A grid-authored pack has no separate legacy frame: its local metres ARE
     the grid minus its canonical origin, and writing that pair down twice is
     the duplication this function exists to avoid. */
  it('uses the canonical origin where the pack is authored in the grid', () => {
    const gridAuthored = Object.entries(V2_GRAPH_FRONTIER_CONFIGS)
      .filter(([, c]) => c.bridgeMode === 'epsg3006-local-rh2000');
    expect(gridAuthored.map(([slug]) => slug)).toEqual(['lidingo', 'ribbingsfors', 'visby']);
    for (const [slug, config] of gridAuthored) {
      expect(config.legacyOriginEpsg3006, slug).toBeUndefined();
      const origin = gridOriginEpsg3006(config);
      expect(origin.easting, slug).toBe(config.canonicalOrigin.easting);
      expect(origin.northing, slug).toBe(config.canonicalOrigin.northing);
    }
  });

  it('refuses a config that declares neither, rather than returning nothing', () => {
    expect(() => gridOriginEpsg3006({ slug: 'nowhere' })).toThrow(/no EPSG:3006 origin/);
    expect(() => gridOriginEpsg3006({ slug: 'half', canonicalOrigin: { easting: 1 } })).toThrow(/no EPSG:3006 origin/);
  });
});
