/* Dated source-image decisions, applied after the historical 2022 overlays.
 * Retain native source pixels and never derive positions from a diagram scale.
 */
import { facilityPoint } from './reviewed-facilities.mjs';
import { pointInPoly } from '../../geobuild/lib.mjs';

const sameRing = (a, b) => a.length === b.length && a.every((p, i) => p.every((v, k) => Math.abs(v - b[i][k]) < 1e-7));

export function orthophotoRing(review, entry) {
  const source = review.sources[entry.sourceKey];
  if (!source?.sourceIds?.length || !/^[a-f0-9]{64}$/.test(source.sha256) ||
      !entry.id || !entry.ringPixels || entry.ringPixels.length < 4 ||
      !sameRing([entry.ringPixels[0]], [entry.ringPixels.at(-1)])) throw new Error('Orthophoto trace needs a checked source and closed pixel ring');
  return { ring: entry.ringPixels.map(p => facilityPoint({ source }, p)),
    sourceIds: source.sourceIds, reviewId: entry.id };
}

export function applyReviewedOrthophoto(input, review) {
  if (review?.schemaVersion !== 1 || review.groundId !== 'visby' || input.groundId !== 'visby' ||
      input.horizontalCrs !== 'EPSG:3006') throw new Error('Orthophoto review requires Visby EPSG:3006 geometry');
  const geometry = structuredClone(input), ids = new Set();
  const convert = entry => {
    if (ids.has(entry.id)) throw new Error('Duplicate orthophoto feature');
    ids.add(entry.id); return orthophotoRing(review, entry);
  };
  for (const entry of review.holes) {
    const hole = geometry.holes.find(h => h.n === entry.n);
    if (!hole) throw new Error('Reviewed hole does not exist');
    if (entry.green) {
      const green = convert(entry.green), source = review.sources[entry.green.sourceKey];
      const reference = entry.green.referencePixels ? facilityPoint({ source }, entry.green.referencePixels) : hole.green.reference;
      if (!pointInPoly(...reference, green.ring)) throw new Error('Virtual green target leaves the reviewed putting surface');
      hole.green = { ...green, reference };
      if (entry.green.updateRouteTarget) hole.line[hole.line.length - 1] = [...reference];
    }
    for (const tee of entry.tees ?? []) {
      const pad = convert(tee);
      const existing = hole.tees.pads.findIndex(p => p.reviewId === tee.id);
      const slot = existing >= 0 ? existing : tee.replaceIndex;
      if (slot === undefined) hole.tees.pads.push(pad);
      else {
        if (!hole.tees.pads[slot]) throw new Error('Reviewed tee replacement is stale');
        hole.tees.pads[slot] = pad;
      }
      for (const [key, pixel] of Object.entries(tee.cameraReferencesPixels ?? {})) {
        if (!['tee-63','tee-59','tee-55','tee-51','tee-46','tee-41'].includes(key) || !tee.numberedSourceAssetId) throw new Error('Numbered camera requires separate platform identity evidence');
        const reference = facilityPoint({ source: review.sources[tee.sourceKey] }, pixel);
        if (!pointInPoly(...reference, pad.ring)) throw new Error('Reviewed tee camera leaves its own platform');
        (hole.tees.references ??= {})[key] = reference;
        if (key === 'tee-63' && tee.updateRouteStart) hole.line[0] = [...reference];
      }
    }
    for (const fairway of entry.fairways ?? []) {
      const surface = convert(fairway);
      if (!hole.fairway.rings[fairway.replaceIndex]) throw new Error('Reviewed fairway replacement is stale');
      hole.fairway.rings[fairway.replaceIndex] = surface.ring;
    }
    if (entry.bunkers) {
      const accepted = entry.bunkers.accepted.map(convert);
      hole.bunkers = hole.bunkers.filter(p => !accepted.some(a => a.reviewId === p.reviewId) &&
        !entry.bunkers.previousRings.some(old => sameRing(old, p.ring))).concat(accepted);
    }
  }
  if (review.sceneryBunkers) {
    const accepted = review.sceneryBunkers.accepted.map(convert).map(p => p.ring);
    geometry.scenery.bunkers = geometry.scenery.bunkers.filter(p =>
      !review.sceneryBunkers.previousRings.some(old => sameRing(old, p)) && !accepted.some(ring => sameRing(ring, p))).concat(accepted);
  }
  return geometry;
}
