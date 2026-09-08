import { facilityPoint } from './reviewed-facilities.mjs';
import { pointInPoly } from '../../geobuild/lib.mjs';

/* Source pixels, physical turf and virtual cameras are separate records.
 * Never assign a numbered daily marker merely from an image rectangle. */
export function applyReviewedTeePlatforms(input, review) {
  if (review?.schemaVersion !== 1 || review.groundId !== 'visby' ||
      input?.groundId !== 'visby' || input.horizontalCrs !== 'EPSG:3006') {
    throw new Error('Tee review requires Visby EPSG:3006 authoring geometry');
  }
  const geometry = structuredClone(input), holes = new Set(), ids = new Set();
  for (const entry of review.holes) {
    const hole = geometry.holes.find(h => h.n === entry.n);
    const source = review.sources[entry.sourceKey];
    if (!hole?.tees?.pads?.length || holes.has(entry.n) || !source?.id) {
      throw new Error('Tee review needs a unique hole, retained back platform and image source');
    }
    holes.add(entry.n);
    const convert = pixel => facilityPoint({ source }, pixel);
    for (const pad of entry.additionalPads) {
      if (!pad.id || ids.has(pad.id) || pad.ringPixels.length < 4 ||
          JSON.stringify(pad.ringPixels[0]) !== JSON.stringify(pad.ringPixels.at(-1))) {
        throw new Error('Reviewed tee polygon needs a unique identity and closed ring');
      }
      ids.add(pad.id);
      const value = { ring: pad.ringPixels.map(convert), sourceIds: [source.id], reviewId: pad.id };
      const index = hole.tees.pads.findIndex(previous => previous.reviewId === pad.id);
      if (index < 0) hole.tees.pads.push(value); else hole.tees.pads[index] = value;
    }
    for (const [tee, pixel] of Object.entries(entry.cameraReferencesPixels)) {
      if (!['tee-59', 'tee-55', 'tee-51', 'tee-46', 'tee-41'].includes(tee)) {
        throw new Error('Tee review must retain back references and use the official shorter tee IDs');
      }
      const point = convert(pixel);
      if (!hole.tees.pads.some(pad => pointInPoly(...point, pad.ring))) {
        throw new Error('Reviewed camera must be inside an observed tee platform');
      }
      (hole.tees.references ??= {})[tee] = point;
    }
    hole.tees.referenceMethod = review.method.camera;
  }
  return geometry;
}
