/* The Lantmäteriet ground under Ängsö GK, and the frame it is read on.

   THE PACK IS RE-GROUNDED, NOT VERTICALLY BRIDGED -- Upsala's decision, for
   Upsala's reason. tools/measure-vertical-datum.mjs put the legacy Terrarium
   field a median 9.1166 m above the laser DTM with a 1.8463 m median absolute
   deviation over 41,636 mown samples: eight times Veckefjärden's 0.2392 m, and
   not registration (the best rigid shift of the sample point, 12 m, bought
   0.17 m of it). Terrarium's SHAPE over this low-relief Mälaren shore is wrong
   as well as its datum, and the pack's own water rings disagreed with the DTM
   by -3.66 to +6.10 m -- so one number cannot carry them. HF0 and HF1 are
   therefore cut from the laser DTM in RH 2000, sampled THROUGH the same
   derived bridge the runtime uses, and the vertical bridge becomes exactly
   zero. Nothing moves horizontally.

   Where the laser comes from here: this machine holds no Lantmäteriet
   credential, but it does not need one. The published ring graph in
   apps/golf/public/grounds/angso/ IS the laser DTM -- 256 course tiles at 1 m
   reproducing the acquired window to a quantum, then 2, 4 and 8 m rings to a
   16 km root, every chunk verified through the loader's own reader -- and it
   reaches further than the legacy vista ever needs (FARR is +-5400 m). Cutting
   the pack from the graph rather than from a fresh read is also the stronger
   statement: the streamed v2 ground and the GPK1 fallback are then one field
   by construction, not by two reads of one source.                          */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const PUBLIC = path.join(ROOT, 'apps/golf/public');
export const GROUND_ID = 'angso';

/* The pack's own frame constants, as lib.mjs and the GPK1 header state them,
   and the origin projected through PROJ (the committed migration's
   candidateOrigin). Both are inputs to the derived horizontal bridge; they
   are the same values apps/golf/src/engine/v2-angso-config.mjs carries. */
export const LEGACY_FRAME = Object.freeze({
  latitude: 59.57390,
  longitude: 16.87100,
  metresPerLatitude: 111320,
  metresPerLongitude: 56375.41,
});
export const LEGACY_ORIGIN_EPSG3006 = Object.freeze({
  easting: 605689.962,
  northing: 6605447.157,
});

/* HF1's footprint in the pack frame. The legacy vista used to run +-10 km on
   Terrarium; the published root is 16,384 m about E 605665.5 / N 6605721.5,
   which leaves 7,918 m south of the pack origin before the graph ends. A
   rotated +-7,520 m square (convergence 1.61 deg, scale 0.9987) reaches 7,738 m
   at its worst corner, so every HF1 sample lands on published laser ground
   with 180 m to spare -- and the page's far ring stops at 5,400 m anyway. */
export const HF1_HALF_SPAN = 7520;
