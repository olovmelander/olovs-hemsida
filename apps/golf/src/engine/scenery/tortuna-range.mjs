/* Tortuna's driving range, measured off the retained 2026 native orthophoto.
 *
 * WHAT THE PACK CARRIES AND WHY THIS EXISTS. The source model holds seventeen
 * range_tee_pad rings from an earlier reading of the same tile. Drawn over the
 * imagery they drift progressively off the mats -- the mats run at 2.88 m and
 * those rings at 3.57 m, so the trace loses one mat in every six and ends a
 * full mat to the side. This module is a DISPLAY revision of that reading by
 * the same method the rest of the engine uses for reviewed facilities: the
 * source rings stay in the pack, ?buildingGeometry=source returns them
 * untouched, and applying this twice re-derives rather than accumulates.
 *
 * WHAT IS MEASURED. tortuna-range-site.json carries the method per field.
 * Briefly: the mats separate on LOCAL green contrast, never on an absolute
 * colour cut (their excess green sits at the strip's own 75th percentile), and
 * the ball-stop net's posts separate by WIDTH inside the broad shadow band the
 * mesh casts, with heights from their own shadow lengths against the solar
 * position at the source item's own capture instant.
 *
 * WHAT IS NOT MODELLED. No distance sign, flag or bay divider is invented:
 * none is resolved in the imagery, and the two club photographs that show
 * range furniture are from 2022 or earlier, before the rebuild. The three
 * target areas keep the pack's own outlines and the generic surface pass
 * draws them.
 *
 * THE LANDING FIELD IS GRASS. The May 2026 capture shows most of it as bare
 * scraped fill, the club's 2025 report called the range an unfinished
 * project ("ytan på rangen inte gräsbetäckt"), and the first version of this
 * module drew that: a terrain-following skin in the field's own photographed
 * colour, which on screen was a pink-white sheet as bright as the bunker sand
 * beside it -- a noon orthophoto pixel is an exposure, not an albedo, and the
 * buildings batch this draws in renders its colour unsquared. The owner's
 * word (2026-09-10) is that the range is grass, and by the repo's own rule the
 * owner's word beats a photograph that is four months older than it. Nothing
 * is drawn over the field: the ground it stands on is turf, mown range where
 * the pack's range ring runs and rough beyond it. The traced extent stays in
 * the site file as the reading it is, with the decision recorded beside it.
 */
import { ShapeUtils, Vector2 } from 'three/webgpu';
import site from './tortuna-range-site.json' with { type: 'json' };

/* The seventeen source rings this revision supersedes for display. */
const RETAINED = new Set(Array.from({ length: 17 },
  (_, i) => `tortuna-range-hitting-mat-${String(i + 1).padStart(2, '0')}`));
export const isReviewedRangeFeature = feature => RETAINED.has(feature?.id) || String(feature?.id || '').startsWith('tortuna-range-mat-');
export const rangeSite = site;

const matFeature = mat => ({
  id: mat.id,
  kind: 'range_mat',
  rings: [mat.ringLocal],
  material: site.mats.material,
  materialStatus: site.mats.materialStatus,
  geometryStatus: site.mats.geometryStatus,
  sourceId: site.source.id,
  observedYear: 2026,
  notSurveyed: true,
  reviewStatus: site.state,
  displayGeometrySource: 'apps/golf/src/engine/scenery/tortuna-range-site.json',
});

/** A display revision of the source outlines; the retained intake is untouched. */
export function prepareRangeScenery(scenery) {
  const kept = (scenery.mappedFeatures || []).filter(f => !isReviewedRangeFeature(f));
  return {
    ...scenery,
    mappedFeatures: [...kept, ...site.mats.items.map(matFeature)],
    /* The net reaches the engine through the field built for it, so the
       existing translucent net mesh draws it. The pack is not modified: this
       course has no mapped bay line, which is why main.js no longer requires
       one before a net is drawn. */
    rangeFacilities: {
      nets: [site.net.lineLocal],
      netHeight: site.net.heightMetres,
      netPostPitch: site.net.spacingMetres,
      prov: 'lm-orthophoto-2026',
      evidence: site.method.net,
      limitations: site.net.geometryStatus,
    },
  };
}

/* The mats are objects, not paint. They are laid straight on the strip -- no
   platform, no kerb and no dividers appear in the imagery or in the club's own
   photograph -- so each is a thin slab standing on the ground it sits on, and
   nothing is built under it. */
export function renderRangeDetails({ terrainH, tri, L }) {
  const colours = new Map();
  const colour = hex => { if (!colours.has(hex)) colours.set(hex, L(hex)); return colours.get(hex); };
  let triangles = 0;
  const emit = (a, b, c, col) => { tri(a, b, c, col); triangles++; };
  const quad = (a, b, c, d, col) => { emit(a, b, c, col); emit(a, c, d, col); };
  const TOP = colour(0x3d7a49), EDGE = colour(0x24422b);   /* artificial turf, and its shaded edge */
  let mats = 0;
  for (const mat of site.mats.items) {
    const ring = mat.ringLocal;
    /* A mat is 1.75 m across on ground sampled at 1 m, so each corner takes
       its own height and the top is drawn as two triangles across them. */
    /* A mat LIES on the ground; it does not stand on a plinth. Levelling the
       top to the highest corner turned the strip's own cross-fall into a
       visible skirt, so each corner takes its own ground height and the mat is
       only its own thickness thick. */
    const ground = ring.map(([x, z]) => terrainH(x, z));
    const top = ring.map(([x, z], i) => [x, ground[i] + 0.05, z]);
    emit(top[0], top[1], top[2], TOP);
    emit(top[0], top[2], top[3], TOP);
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      const base = k => [ring[k][0], ground[k] - 0.01, ring[k][1]];
      quad(base(i), base(j), top[j], top[i], EDGE);
    }
    mats++;
  }
  return {
    triangles,
    counts: { range_mat: mats },
    /* the traced scraped extent is a reading, not a surface: see the header */
    earthworks: { drawn: false, areaSquareMetres: site.earthworks.areaSquareMetres, status: site.earthworks.renderStatus },
    evidence: `${site.source.collection} ${site.source.capturedAt} at ${site.source.readAtResolutionMetres} m`,
    limitations: site.mats.geometryStatus,
    net: { posts: site.net.postCount, heightMetres: site.net.heightMetres,
      heightMadMetres: site.net.heightMadMetres, spanMetres: site.net.spanMetres },
  };
}

