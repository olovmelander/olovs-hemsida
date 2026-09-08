/* An idempotent authoring overlay. Source pixels are retained in the review;
 * this conversion is shared by adoption, regeneration and regression checks. */
import { pointInPoly } from '../../geobuild/lib.mjs';

export function validateNumberedPlatforms(hole, review) {
  if (!review) return;
  const tees = ['tee-63', 'tee-59', 'tee-55', 'tee-51', 'tee-46', 'tee-41'];
  if (!review.sourceAssetId || !review.sourceUrl || !/^[a-f0-9]{64}$/.test(review.sourceSha256) ||
      JSON.stringify(Object.keys(review.padIndicesByTee)) !== JSON.stringify(tees)) {
    throw new Error('Numbered platform review requires source identity and all six tee associations');
  }
  for (const tee of tees) {
    const index = review.padIndicesByTee[tee], pixel = review.planLabelPixelsByTee?.[tee];
    if (!Number.isInteger(index) || !hole.tees.pads[index] || !Array.isArray(pixel) ||
        pixel.length !== 2 || !pixel.every(Number.isFinite)) throw new Error('Invalid numbered platform association');
    const reference = hole.tees.references?.[tee];
    if (reference && !pointInPoly(...reference, hole.tees.pads[index].ring)) {
      throw new Error(`Hole ${hole.n} ${tee} camera is outside its numbered platform`);
    }
  }
}

export function facilityPoint(review, pixel) {
  const source = review.source;
  const [xmin, ymin, xmax, ymax] = source.extentEpsg3006;
  const [width, height] = source.imageSize;
  if (![xmin, ymin, xmax, ymax, width, height].every(Number.isFinite) ||
      xmax <= xmin || ymax <= ymin || width <= 0 || height <= 0 ||
      !Array.isArray(pixel) || pixel.length !== 2 || !pixel.every(Number.isFinite) ||
      pixel[0] < 0 || pixel[0] > width || pixel[1] < 0 || pixel[1] > height) throw new Error('Invalid facility image coordinates');
  return [xmin + pixel[0] * (xmax - xmin) / width, ymax - pixel[1] * (ymax - ymin) / height];
}

export function applyReviewedFacilities(input, review) {
  if (review.schemaVersion !== 1 || review.groundId !== 'visby' || input.groundId !== 'visby' || input.horizontalCrs !== 'EPSG:3006') throw new Error('Facility review requires Visby EPSG:3006 authoring geometry');
  const geometry = structuredClone(input);
  const ring = pixels => {
    if (pixels.length < 4 || JSON.stringify(pixels[0]) !== JSON.stringify(pixels.at(-1))) throw new Error('Facility polygon must be closed');
    return pixels.map(pixel => facilityPoint(review, pixel));
  };
  const h1 = geometry.holes.find(hole => hole.n === 1);
  if (!h1?.tees?.pads?.length) throw new Error('Retained first-hole back platform is required');
  for (const pad of review.hole1.additionalPads) {
    const value = { ring: ring(pad.ringPixels), sourceIds: [review.source.id], reviewId: pad.id };
    const index = h1.tees.pads.findIndex(previous => previous.reviewId === pad.id);
    if (index < 0) h1.tees.pads.push(value); else h1.tees.pads[index] = value;
  }
  h1.tees.references = { ...h1.tees.references, ...Object.fromEntries(Object.entries(review.hole1.cameraReferencesPixels).map(([tee, pixel]) => [tee, facilityPoint(review, pixel)])) };
  h1.tees.referenceMethod = review.hole1.cameraReferenceMethod;
  validateNumberedPlatforms(h1, review.hole1.numberedPlatformReview);
  const practice = ring(review.practiceGreen.ringPixels);
  const scenery = geometry.scenery ??= {};
  const greens = scenery.greens ??= [];
  // Retain an index so a later reviewed boundary replaces this same surface.
  const slot = scenery.reviewedPracticeGreenIndex;
  if (slot === undefined) { scenery.reviewedPracticeGreenIndex = greens.length; greens.push(practice); }
  else {
    if (!Number.isInteger(slot) || slot < 0 || slot >= greens.length) throw new Error('Practice green review index is stale');
    greens[slot] = practice;
  }
  return geometry;
}
