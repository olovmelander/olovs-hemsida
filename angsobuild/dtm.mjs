/* Ängsö's laser terrain and orthoimagery, in the pack's own frame.

   geobuild/dtm-lib.mjs holds the readers (the published 1 m ring graph through
   the derived bridge; Esri z18 tiles, live or one Wayback release); this binds
   them to THIS course's frame -- lib.mjs's ORIGIN and metres-per-degree, the
   PROJ-projected origin lib-v2.mjs carries -- so a caller never restates a
   constant. BOX is the tracing frame: the eighteen holes, the practice ground
   and the clubhouse hub with a margin, in local metres (north is -z).         */
import { ORIGIN, M_PER_LAT, M_PER_LON, CACHE } from './lib.mjs';
import { LEGACY_ORIGIN_EPSG3006 } from './lib-v2.mjs';
import { loadTerrain as loadPublishedTerrain, createImagery } from '../geobuild/dtm-lib.mjs';

export const ANGSO_FRAME = Object.freeze({
  slug: 'angso', origin: ORIGIN, mPerLat: M_PER_LAT, mPerLon: M_PER_LON,
  origin3006: LEGACY_ORIGIN_EPSG3006, cache: CACHE,
});
/* the played ground spans x -434..406, z -1368..810 (every line, green, pad and
   bunker of the model); 120 m of margin takes in the practice ground, the
   clubhouse hub and the rough a bunker or a ditch can stand in */
export const BOX = Object.freeze({ x0: -560, z0: -1490, x1: 530, z1: 930 });
export const loadTerrain = () => loadPublishedTerrain('angso', ANGSO_FRAME);
export const imagery = (release = null) => createImagery({ cache: CACHE, origin: ORIGIN, mPerLat: M_PER_LAT, mPerLon: M_PER_LON, release });
