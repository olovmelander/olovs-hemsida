/* Every course whose published v2 graph the app may actually RENDER from, in
   one place.

   Registering a slug in V2_PUBLISHED_GRAPH_SLUGS only lets the app resolve and
   verify that course's graph; it keeps rendering from GPK1 and says so. This
   registry is the second, narrower gate: a slug here has a reviewed live
   contract -- frame fingerprint, bounds, tile count, bridge mode and, where the
   pack is a legacy one, a MEASURED vertical datum offset -- so the frontier
   loader can refuse a graph that has drifted instead of drawing the terrain in
   the wrong place. A course that is published but not listed here is a course
   whose contract has not been reviewed yet, which is a state worth being able
   to be in.

   The per-course records stay in their own modules beside the evidence that
   produced them; this file only says which ones are live. */
import { ANGSO_V2_CONFIGS } from './v2-angso-config.mjs';
import { JOHANNESBERG_V2_CONFIGS } from './v2-johannesberg-config.mjs';
import { LIDINGO_V2_CONFIGS } from './v2-lidingo-config.mjs';
import { NORRFALLSVIKEN_V2_CONFIGS } from './v2-norrfallsviken-config.mjs';
import { V2_GRAPH_FRONTIER_CONFIGS as RIBBINGSFORS } from './v2-ribbingsfors-config.mjs';
import { UPSALA_V2_CONFIGS } from './v2-upsala-config.mjs';
import { VECKEFJARDEN_V2_CONFIGS } from './v2-veckefjarden-config.mjs';
import { VISBY_V2_CONFIGS } from './v2-visby-config.mjs';

export const V2_GRAPH_FRONTIER_CONFIGS = Object.freeze({
  ...ANGSO_V2_CONFIGS,
  ...JOHANNESBERG_V2_CONFIGS,
  ...LIDINGO_V2_CONFIGS,
  ...NORRFALLSVIKEN_V2_CONFIGS,
  ...RIBBINGSFORS,
  ...UPSALA_V2_CONFIGS,
  ...VECKEFJARDEN_V2_CONFIGS,
  ...VISBY_V2_CONFIGS,
});

/* A record's own slug and the key it is registered under must agree, or a
   course would be handed another course's frame and every check downstream
   would pass while the terrain sat somewhere else entirely. */
for (const [slug, config] of Object.entries(V2_GRAPH_FRONTIER_CONFIGS)) {
  if (config.slug !== slug) {
    throw new Error(`v2 frontier config registered as ${slug} declares slug ${config.slug}`);
  }
}

/* WHERE A GROUND'S LOCAL METRES HAVE THEIR ZERO, in EPSG:3006 -- the one number
   every consumer of a published tile needs, because a tile states its bounds in
   the grid and the engine draws in local metres: x = easting - origin.easting,
   z = origin.northing - northing.

   Two kinds of ground answer it differently, and conflating them is what this
   function exists to stop. A pack authored in the older flat-earth lat/lon
   frame has a legacy origin that is NOT its canonical grid origin -- they are
   6 m apart at Norrfällsviken and 313 m at Upsala -- so those configs declare
   `legacyOriginEpsg3006` and it is the answer. A pack authored DIRECTLY in the
   grid (Ribbingsfors, Visby, Lidingö) has no separate legacy frame at all: its
   local metres ARE EPSG:3006 minus its canonical origin, by construction, and
   writing that pair down a second time under another name would be the same
   duplication `const hut` was.

   It is a function and not a field so the two callers cannot disagree:
   `v2-graph-frontier.mjs` had the rule inline and `main.js`, handing the RING
   adapter its origin, had no rule at all -- it read `legacyOriginEpsg3006`
   straight off the config. That was invisible for as long as every ring-graph
   ground happened to be a flat-earth one. Visby is the first grid-authored
   ground with a ring graph, so its flagless boot threw
   `legacyOriginEpsg3006.easting must be finite`, the v2 source failed, and the
   default visit fell back to GPK1 SILENTLY -- by design, which is what made it
   a fault you could only find by looking. */
export function gridOriginEpsg3006(config) {
  const declared = config?.legacyOriginEpsg3006;
  if (Number.isFinite(declared?.easting) && Number.isFinite(declared?.northing)) return declared;
  if (config?.bridgeMode === 'epsg3006-local-rh2000') {
    const canonical = config.canonicalOrigin;
    if (Number.isFinite(canonical?.easting) && Number.isFinite(canonical?.northing)) {
      return Object.freeze({ easting: canonical.easting, northing: canonical.northing });
    }
  }
  throw new TypeError(`${config?.slug || 'a v2 config'} declares no EPSG:3006 origin for its local metres`);
}
