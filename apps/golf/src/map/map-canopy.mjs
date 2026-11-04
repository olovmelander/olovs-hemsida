/* Where a tile's canopy lies, as alpha, from the laser's stand field. Pure, and on
   its own so the land bake reads the raster exactly as the map does. */
import { STAND_FLAG_EXCLUDED, STAND_FLAG_MEASURED } from '../../../../packages/course-v2/stand-field.mjs';

/* A cell the laser did not measure is not an empty cell: `unmeasured(column, row)`
   says what else is known of it, so a wood does not stop at the edge of a survey. */
export function canopyAlpha({ payload, width, height, unmeasured = null }) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let k = 0; k < width * height; k++) {
    const flags = payload[k * 4 + 3];
    if (flags & STAND_FLAG_EXCLUDED) continue;
    if (!(flags & STAND_FLAG_MEASURED)) {
      if (unmeasured) out[k * 4 + 3] = unmeasured(k % width, Math.floor(k / width));
      continue;
    }
    /* Thin canopy is ground with a few trees on it, not forest. */
    out[k * 4 + 3] = Math.min(255, Math.max(0, payload[k * 4] - 26) * 1.5);
  }
  return out;
}
