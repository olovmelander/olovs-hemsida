/* Frame and shared utilities for the johannesberg3d pipeline.

   Johannesberg Golf & Country Club at Gottröra, west of Rimbo — a Donald Steel
   course on the Johannesberg estate north-east of Stockholm. ORIGIN is the centre
   of the club's own OSM property polygon, which is the only golf geometry OSM has
   here beyond two greens. Same
   conventions as the other pipelines (local metres about ORIGIN, north -z,
   east +x, bearing atan2(dx,-dz), right (-cos b, sin b)), its own ORIGIN, and
   geobuild's generic geometry/codec imported so nothing drifts.               */
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
export const ORIGIN = { lat: 59.72733, lon: 18.19202 };
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
