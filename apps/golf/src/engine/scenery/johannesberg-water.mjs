import review from '../../../../../johannesbergbuild/mapping/water-source-review.json' with { type: 'json' };
import { MEASURED_WATER_CLEARANCE_METRES } from '../water-render-policy.mjs';

export const JOHANNESBERG_WATER_REVIEW = review;
// Both course entries use the verified world graph. Keep the 1 m source
// sampler raw: pre-carving its fixed frontier would bias the later water
// measurement and leave the CPU's dry banks dented by an obsolete coarse bed.
export const deferWaterBedToWorld = true;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const byId = new Map(review.bodies.map(body => [body.id, body]));

/** The historical GPK1 stream omits water IDs. Match its complete, pinned
 * geometry before adding source identities; never identify a pond by height
 * or proximity alone. This runs before water, tint and vegetation consumers. */
export function applyWaterSourceReview(model, geo) {
  if (!same(geo?.origin, review.frame.origin) || !Number.isFinite(geo?.mPerLon)
    || Math.abs(geo.mPerLon - review.frame.metresPerLongitude) > .02) {
    throw new Error('Johannesberg water review: coordinate frame mismatch');
  }
  const matches = review.bodies.map(source => {
    const water = model.water?.[source.packIndex];
    if (!water || !same(water.ring, source.baseline.ring)
      || (water.waterReviewId !== review.id && water.level !== source.baseline.level)
      || (water.id !== undefined && water.id !== source.id)) {
      throw new Error(`Johannesberg water review: changed pond baseline ${source.id}`);
    }
    return { source, water };
  });
  for (const { source, water } of matches) Object.assign(water, {
    id: source.id, waterReviewId: review.id, vegetatedBank: true,
  });
  return { id: review.id, ponds: matches.length };
}

/** Read the uncarved terrain at dispersed, imagery-contained interior controls.
 * Boundary vertices can be reeds, a raised bank or a culvert. A bank percentile
 * plus 25 cm must not replace this independently checked flat surface.
 * Return null on partial coverage or changed terrain; the normal measurement
 * remains the fallback. These are source-era estimates, not live water levels. */
export function reviewedWaterLevel(water, groundProbe, datum) {
  const source = byId.get(water.id);
  if (water.waterReviewId !== review.id || !source || !Number.isFinite(datum)) return null;
  const heights = source.controls.map(({ point }) => {
    const result = groundProbe(...point);
    return Number.isFinite(result) ? result : result?.height;
  });
  if (!heights.every(Number.isFinite)
    || Math.max(...heights) - Math.min(...heights) > .08
    || heights.some(h => Math.abs(h - datum - source.levelRH2000Metres) > .08)) return null;
  heights.sort((a, b) => a - b);
  const measured = heights[heights.length >> 1];
  return {
    level: measured + MEASURED_WATER_CLEARANCE_METRES,
    sourceLevelRH2000Metres: measured - datum,
    displayClearanceMetres: MEASURED_WATER_CLEARANCE_METRES,
    method: 'reviewed-interior-terrain-controls',
  };
}
