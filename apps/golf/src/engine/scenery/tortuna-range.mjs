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
 * WHAT IS NOT MODELLED. The club's own 2025 report calls the range an
 * unfinished project -- "slutföra arbetet på rangen med jordmassorna och göra
 * klart målområdena", with "ytan på rangen inte gräsbetäckt" -- and the capture
 * shows exactly that: a largely bare landing field with three constructed
 * target areas. Nothing here grasses it over, and no distance sign, flag or
 * bay divider is invented: none is resolved in the imagery, and the two club
 * photographs that show range furniture are from 2022 or earlier, before the
 * rebuild. The targets keep the pack's own outlines and the generic surface
 * pass draws them.
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
  const emit = (a, b, c, hex) => { tri(a, b, c, colour(hex)); triangles++; };
  const quad = (a, b, c, d, hex) => { emit(a, b, c, hex); emit(a, c, d, hex); };
  const TOP = 0x3d7a49, EDGE = 0x24422b;          /* artificial turf, and its shaded edge */
  const EARTH = 0xa29c93;                          /* measured: the scraped field's own median colour */
  const LIFT = 0.09;                               /* clears the heightfield's own bilinear bulge */

  /* The unfinished landing field, drawn as the capture shows it rather than
     grassed over. It is not a bunker and not sand: the engine has no surface
     class for a working earthworks, so this module draws its own terrain-
     following skin instead of borrowing a class that would say something
     untrue about the ground. Subdivision targets 12 m: the surface is scraped
     flat, so it needs enough triangles to follow the fall of the field and no
     more -- a hectare at 4 m is tens of thousands of triangles for a plane. */
  let earthworks = 0;
  {
    /* 4 m, the spacing of the compatibility heightfield this ground ships, so
       the skin samples the terrain where the terrain is actually defined. */
    for (const piece of gridSkin(site.earthworks.ringLocal, 4)) {
      /* Fan from the cell's OWN centre, sampled like every other vertex, not
         from a corner. terrainH is bilinear across a cell, so a quad split into
         two planar triangles sits under the ground in the middle of a saddle
         cell and the terrain came through as a grid of small square holes. */
      const points = piece.map(([x, z]) => [x, terrainH(x, z) + LIFT, z]);
      const cx = piece.reduce((t, q) => t + q[0], 0) / piece.length;
      const cz = piece.reduce((t, q) => t + q[1], 0) / piece.length;
      const centre = [cx, terrainH(cx, cz) + LIFT, cz];
      for (let i = 0; i < points.length; i++) {
        const b = points[i], c = points[(i + 1) % points.length];
        const up = (b[2] - centre[2]) * (c[0] - centre[0]) - (b[0] - centre[0]) * (c[2] - centre[2]);
        if (up < 0) emit(centre, c, b, EARTH); else emit(centre, b, c, EARTH);
        earthworks++;
      }
    }
  }

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
    counts: { range_mat: mats, range_earthworks: earthworks },
    evidence: `${site.source.collection} ${site.source.capturedAt} at ${site.source.readAtResolutionMetres} m`,
    limitations: site.mats.geometryStatus,
    net: { posts: site.net.postCount, heightMetres: site.net.heightMetres,
      heightMadMetres: site.net.heightMadMetres, spanMetres: site.net.spanMetres },
  };
}

/* A terrain-following skin for one ring, built on a grid aligned to the world
   rather than by subdividing a triangulation.

   Two earlier attempts are worth recording because both failed for the same
   reason. Adaptive subdivision -- split long edges, fan the face round a new
   centroid -- is right for a 1.75 m mat and wrong for a hectare: the fan makes
   skinny triangles that themselves need splitting, and it threw past 60,000
   faces. Uniform subdivision is bounded but wasteful, because it splits the
   tiny boundary triangles as hard as the huge interior ones; at 30,464 faces
   the interior triangles were still ~9 m across, and a FLAT triangle spanning
   9 m of falling ground dips under the terrain in its middle, so the ground
   poked through the skin in dozens of holes.

   A grid fixes both. Cell corners land on the ground at a fixed spacing, so
   the skin follows the terrain by construction wherever it is sampled, and
   only the cells the boundary crosses are clipped -- which keeps the traced
   outline exact instead of stair-stepping it. */
function polygonClip(subject, clip) {
  let output = subject;
  for (let i = 0; i < clip.length && output.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const side = p => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const input = output; output = [];
    for (let k = 0; k < input.length; k++) {
      const cur = input[k], prev = input[(k + input.length - 1) % input.length];
      const dc = side(cur), dp = side(prev);
      if (dc >= 0) {
        if (dp < 0) output.push(intersect(prev, cur, a, b));
        output.push(cur);
      } else if (dp >= 0) output.push(intersect(prev, cur, a, b));
    }
  }
  return output;
}
function intersect(p, q, a, b) {
  const r = [q[0] - p[0], q[1] - p[1]], sdir = [b[0] - a[0], b[1] - a[1]];
  const denom = r[0] * sdir[1] - r[1] * sdir[0];
  if (!denom) return [...q];
  const t = ((a[0] - p[0]) * sdir[1] - (a[1] - p[1]) * sdir[0]) / denom;
  return [p[0] + r[0] * t, p[1] + r[1] * t];
}
const ringArea = ring => Math.abs(ring.reduce((sum, p, i) => {
  const q = ring[(i + 1) % ring.length]; return sum + p[0] * q[1] - q[0] * p[1];
}, 0)) / 2;
function gridSkin(ring, cell) {
  /* the clip needs a counter-clockwise window, and the traced ring may be either way */
  const signed = ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length]; return sum + p[0] * q[1] - q[0] * p[1];
  }, 0);
  const poly = signed < 0 ? [...ring].reverse() : ring;
  const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
  const x0 = Math.floor(Math.min(...xs) / cell) * cell, x1 = Math.ceil(Math.max(...xs) / cell) * cell;
  const z0 = Math.floor(Math.min(...zs) / cell) * cell, z1 = Math.ceil(Math.max(...zs) / cell) * cell;
  const pieces = [];
  for (let z = z0; z < z1; z += cell) for (let x = x0; x < x1; x += cell) {
    const square = [[x, z], [x + cell, z], [x + cell, z + cell], [x, z + cell]];
    /* Sutherland-Hodgman clips a subject against a CONVEX window, so the cell
       is the window and the traced ring is the subject -- the ring is concave
       where it wraps the target area and the works yard, and using it as the
       window silently returned nothing at all. */
    const clipped = polygonClip(poly, square);
    if (clipped.length >= 3 && ringArea(clipped) > 0.05) pieces.push(clipped);
  }
  return pieces;
}
