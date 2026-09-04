/* The Lantmäteriet ground under Upsala GK, and the frame it is read on.

   Two different rectangles are cut from the same Markhöjdmodell items, for two
   different consumers, and they must not be confused:

   - the V2 WINDOW is the ground graph's own 2,048 m lattice, declared in
     packages/course-v2/upsala-ground-graph.mjs and acquired by the generic
     packages/course-geo/acquisition/build-terrain-window.mjs. It is square,
     axis-aligned in EPSG:3006, and it is what the published tiles are;
   - the LEGACY FIELD footprint, below, is the ground the GPK1 pack's own
     heightfields need. HF0 and HF1 are addressed in the pack's flat-earth
     frame, which is the grid rotated by 2.16 degrees, so their footprint is a
     ROTATED rectangle in EPSG:3006 and the raster read for them has to be the
     axis-aligned box that contains it.

   Both come from the same items at the same 1 m spacing, so where they overlap
   they are the same measurements.

   THE PACK IS RE-GROUNDED, NOT VERTICALLY BRIDGED. Every other legacy course
   here keeps its AWS Terrarium heights and carries a measured offset into
   RH 2000. That works where the offset is a datum step: Veckefjärden's is
   20.9924 m with a 0.24 m median absolute deviation. Upsala's measured 6.7514 m
   carries a 1.92 m MAD and a 0-15 m range, because Terrarium's shape over this
   parkland is wrong as well as its datum -- and a single offset then puts the
   course's ponds anywhere from 2.8 m below their bed to 5.3 m above their
   surface. So the heightfields are rebuilt from the laser DTM instead, in
   RH 2000, sampled THROUGH the same derived bridge the runtime uses. The
   vertical bridge is then exactly zero, and tools/measure-vertical-datum.mjs
   re-run is what proves it. Nothing moves horizontally: this is a change of
   heights only.                                                              */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const CACHE = path.join(HERE, 'cache');

/* The pack's own frame constants, as geobuild's lib and the GPK1 header state
   them, and the origin projected through PROJ (the committed migration's
   candidateOrigin). Both are inputs to the derived horizontal bridge. */
export const LEGACY_FRAME = Object.freeze({
  latitude: 59.839,
  longitude: 17.4952,
  metresPerLatitude: 111320,
  metresPerLongitude: 55930.68,
});
export const LEGACY_ORIGIN_EPSG3006 = Object.freeze({
  easting: 639830.271,
  northing: 6636114.391,
});

/* The v2 lattice's centre, which is also the published frame origin. The
   legacy-field rasters are addressed from it so a sample can be compared with
   the published tiles without a second frame in between. */
export const GRID_CENTRE = Object.freeze({ easting: 640143.5, northing: 6636145.5 });

/* The axis-aligned EPSG:3006 boxes that contain the rotated HF0 and HF1
   footprints. HF0's rotated corners land at x -1882.9..1745.9, z
   -1826.3..2951.5 and HF1's at x -10766.6..10140.1, z -9820.7..9882.9
   (measured with the derived bridge); each box clears its own by at least a
   sample so bilinear reads never run off the edge. */
const BLOCK_WEST = 1888;
const BLOCK_EAST = 1752;
const BLOCK_NORTH = 1832;
const BLOCK_SOUTH = 2952;
const VISTA_HALF_SPAN = 10784;

export const UPSALA_LEGACY_FIELD = Object.freeze({
  /* 1 m, under HF0 */
  block: Object.freeze({
    file: 'terrain-block.f32',
    spacing: 1,
    originEasting: GRID_CENTRE.easting - BLOCK_WEST,
    originNorthing: GRID_CENTRE.northing + BLOCK_NORTH,
    columns: BLOCK_WEST + BLOCK_EAST + 1,
    rows: BLOCK_NORTH + BLOCK_SOUTH + 1,
    factor: 1,
  }),
  /* 32 m, under HF1. The 10 km item origins are not congruent modulo 32
     (630000 is, 640000 is not), so no single 32 m lattice lands on every
     item's overview pixel centres: these samples are read bilinearly from the
     items' own 32x overviews and the evidence says so. */
  vista: Object.freeze({
    file: 'terrain-vista.f32',
    spacing: 32,
    originEasting: GRID_CENTRE.easting - VISTA_HALF_SPAN,
    originNorthing: GRID_CENTRE.northing + VISTA_HALF_SPAN,
    columns: 2 * VISTA_HALF_SPAN / 32 + 1,
    rows: 2 * VISTA_HALF_SPAN / 32 + 1,
    factor: 32,
  }),
});
