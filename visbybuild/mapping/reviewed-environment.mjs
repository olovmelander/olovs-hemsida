import { facilityPoint } from './reviewed-facilities.mjs';

export function applyReviewedEnvironment(input, review) {
  if (review?.schemaVersion !== 1 || review.groundId !== 'visby' || input?.groundId !== 'visby' || input.horizontalCrs !== 'EPSG:3006') {
    throw new Error('Environment review requires Visby EPSG:3006 authoring geometry');
  }
  const geometry = structuredClone(input);
  const scenery = geometry.scenery ??= {}, greens = scenery.greens ??= [];
  const indices = scenery.reviewedEnvironmentGreenIndices ??= {};
  const seen = new Set();
  for (const entry of review.greens) {
    if (!entry.id || seen.has(entry.id) || entry.ringPixels.length < 4 ||
        JSON.stringify(entry.ringPixels[0]) !== JSON.stringify(entry.ringPixels.at(-1))) {
      throw new Error('Environment green needs a unique identity and closed source ring');
    }
    seen.add(entry.id);
    const ring = entry.ringPixels.map(pixel => facilityPoint(review, pixel));
    const slot = indices[entry.id];
    if (slot === undefined) { indices[entry.id] = greens.length; greens.push(ring); }
    else {
      if (!Number.isInteger(slot) || slot < 0 || slot >= greens.length) throw new Error('Environment review index is stale');
      greens[slot] = ring;
    }
  }
  return geometry;
}
