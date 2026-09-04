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
import { NORRFALLSVIKEN_V2_CONFIGS } from './v2-norrfallsviken-config.mjs';
import { V2_GRAPH_FRONTIER_CONFIGS as RIBBINGSFORS } from './v2-ribbingsfors-config.mjs';
import { UPSALA_V2_CONFIGS } from './v2-upsala-config.mjs';
import { VECKEFJARDEN_V2_CONFIGS } from './v2-veckefjarden-config.mjs';

export const V2_GRAPH_FRONTIER_CONFIGS = Object.freeze({
  ...ANGSO_V2_CONFIGS,
  ...JOHANNESBERG_V2_CONFIGS,
  ...NORRFALLSVIKEN_V2_CONFIGS,
  ...RIBBINGSFORS,
  ...UPSALA_V2_CONFIGS,
  ...VECKEFJARDEN_V2_CONFIGS,
});

/* A record's own slug and the key it is registered under must agree, or a
   course would be handed another course's frame and every check downstream
   would pass while the terrain sat somewhere else entirely. */
for (const [slug, config] of Object.entries(V2_GRAPH_FRONTIER_CONFIGS)) {
  if (config.slug !== slug) {
    throw new Error(`v2 frontier config registered as ${slug} declares slug ${config.slug}`);
  }
}
