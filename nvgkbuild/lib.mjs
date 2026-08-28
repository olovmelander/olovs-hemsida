/* Frame and shared utilities for the norrfallsviken3d pipeline.

   Same conventions as geobuild/lib.mjs — local metres about ORIGIN, north is -z,
   east is +x, bearing atan2(dx,-dz), right hand (-cos b, sin b) — but its own
   ORIGIN, because Norrfällsviken is 34 km south-west of Veckefjärden and every
   baked coordinate in norrfallsviken3d.html is relative to this one.

   All the frame-independent geometry (polylines, rings, similarity fit, the
   heightfield codec, anchored patching) is geobuild's, imported so the two
   pipelines cannot drift apart.                                               */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export {
  ROOT,
  bearing, forward, right,
  hyp, d2r, clamp,
  polyLen, polyArea, centroid, bbox,
  ptSeg, ptSegD, distToLine, pointInPoly, polySD,
  simplifyDP, offsetRing, alongLine,
  fitSimilarity,
  quantizeHF, decodeHF, deflateB64, inflateB64,
  patcher,
  readJSON, writeJSON, writeJSONPretty, r1, ring1, lcg,
} from '../geobuild/lib.mjs';

export const CACHE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cache');

/* --- the frozen frame -------------------------------------------------------- */
/* Centre of the GPS survey's bbox, rounded; reconcile asserts it, nothing
   downstream may recompute it. */
export const ORIGIN = { lat: 62.98250, lon: 18.53250 };
export const M_PER_LAT = 111320;
export const M_PER_LON = 111320 * Math.cos(ORIGIN.lat * Math.PI / 180);

export const lonLatToXZ = (lon, lat) => [
  (lon - ORIGIN.lon) * M_PER_LON,
  -(lat - ORIGIN.lat) * M_PER_LAT,
];
export const xzToLonLat = (x, z) => [
  ORIGIN.lon + x / M_PER_LON,
  ORIGIN.lat - z / M_PER_LAT,
];
