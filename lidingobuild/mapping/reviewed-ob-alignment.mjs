/* Rule-named road boundaries observed in native orthophotos. Display posts are
 * explicit references along the edge, never observations of physical stakes. */
import { createHash } from 'node:crypto';

export const OB_REVIEW_PATH = 'lidingobuild/mapping/ob-alignment-review-2026-09-09.json';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const round = value => Math.round(value * 1000) / 1000;
const pair = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);

export function reviewedObLines(review) {
  if (review?.groundId !== 'lidingo' || review.horizontalCrs !== 'EPSG:3006' ||
      review.pixelConvention !== 'pixel-edge' || review.frame?.easting !== 677700.5 ||
      review.frame?.northing !== 6586399.5 || review.captureDate !== '2025-05-31' ||
      review.method?.physicalPostPositionsObserved !== false || review.method?.terrainModified !== false ||
      review.postPlacement?.kind !== 'illustrative-road-boundary-reference' ||
      review.postPlacement.physicalPostPositionsObserved !== false ||
      review.sources?.localRules?.sourceId !== 'club-local-rules-2026' ||
      review.sources.localRules.approvedOn !== '2026-03-16') throw new Error('Lidingö OB review identity or evidence differs');
  if (!(review.postPlacement.maximumSpacingMetres > 0 && review.postPlacement.maximumSpacingMetres <= 12)) {
    throw new Error('OB display spacing must be positive and at most 12 m');
  }
  const windowIds = new Set(), windows = new Map();
  for (const window of review.sourceWindows) {
    const [west, south, east, north] = window.boundsEpsg3006 ?? [];
    if (!window.id || windowIds.has(window.id) || ![west, south, east, north].every(Number.isFinite) ||
        window.resolutionMetres !== .16 || window.validFraction !== 1 || window.resampling !== 'nearest' ||
        !Number.isInteger(window.width) || !Number.isInteger(window.height) ||
        Math.abs(east - west - window.width * .16) > 1e-6 ||
        Math.abs(north - south - window.height * .16) > 1e-6 ||
        JSON.stringify(window.geoTransform) !== JSON.stringify([west, .16, 0, north, 0, -.16]) ||
        !/^[0-9a-f]{64}$/.test(window.sha256)) throw new Error('Invalid native OB source window');
    windowIds.add(window.id); windows.set(window.id, window);
  }
  const ids = new Set();
  return review.features.map(feature => {
    const window = windows.get(feature.sourceWindowId);
    const rule = review.rules.find(rule => rule.id === feature.ruleId);
    if (!feature.id?.startsWith('lidingo-ob-') || ids.has(feature.id) ||
        feature.status !== 'accepted-road-edge-display' || !window || !rule?.holes.includes(feature.hole) ||
        rule.road !== feature.road || !(feature.uncertaintyMetres > 0) ||
        !Array.isArray(feature.pixels) || feature.pixels.length < 2) throw new Error('Invalid OB feature or rule association');
    ids.add(feature.id);
    const line = feature.pixels.map(pixel => {
      if (!pair(pixel) || pixel[0] < 0 || pixel[1] < 0 || pixel[0] > window.width || pixel[1] > window.height) {
        throw new Error('OB observation leaves acquired pixel window');
      }
      return [round(window.boundsEpsg3006[0] + pixel[0] * .16 - review.frame.easting),
        round(review.frame.northing - window.boundsEpsg3006[3] + pixel[1] * .16)];
    });
    if (line.some((p, i) => i && Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]) < .01)) {
      throw new Error('Repeated or degenerate OB edge vertex');
    }
    return { feature, line };
  });
}

export function referencePosts(line, maximumSpacingMetres) {
  const lengths = line.slice(1).map((point, i) => Math.hypot(point[0] - line[i][0], point[1] - line[i][1]));
  const length = lengths.reduce((sum, distance) => sum + distance, 0);
  const intervals = Math.ceil(length / maximumSpacingMetres);
  const pts = []; let segment = 0, travelled = 0;
  for (let i = 0; i <= intervals; i++) {
    const along = length * i / intervals;
    while (segment < lengths.length - 1 && travelled + lengths[segment] < along) travelled += lengths[segment++];
    const t = Math.max(0, Math.min(1, (along - travelled) / lengths[segment]));
    pts.push(line[segment].map((value, axis) => round(value + (line[segment + 1][axis] - value) * t)));
  }
  return pts;
}

export function applyObAlignmentReview(input, review) {
  const lines = reviewedObLines(review);
  if (input.origin?.lat !== review.frame.origin?.lat || input.origin?.lon !== review.frame.origin?.lon ||
      lines.some(({ feature }) => !input.holes.some(hole => hole.n === feature.hole))) {
    throw new Error('OB review/model origin or hole identity differs');
  }
  const model = structuredClone(input), id = `lidingo-ob-alignment-${review.reviewedOn}`;
  const features = new Set(lines.map(({ feature }) => feature.id));
  model.marking = (model.marking ?? []).filter(row => row.reviewId !== id && !features.has(row.id));
  model.marking.push(...lines.map(({ feature, line }) => ({
    id: feature.id, c: 'w', hole: feature.hole,
    pts: referencePosts(line, review.postPlacement.maximumSpacingMetres), line,
    reviewId: id, sourceId: 'imagery-lm-ortho', sourceWindowId: feature.sourceWindowId,
    ruleSourceId: 'club-local-rules-2026', ruleId: feature.ruleId,
    captureDate: review.captureDate, road: feature.road,
    boundaryDefinition: 'course-side-asphalt-edge', boundaryStatus: 'image-observed-not-surveyed',
    interpretationUncertaintyMetres: feature.uncertaintyMetres,
    postPlacementKind: 'illustrative-road-boundary-reference', physicalPostPositionsObserved: false,
  })));
  model.obPlacementReview = { id, sourceReviewSha256: hash(review),
    scope: 'Five rule-named road boundary runs; canopy gaps on holes 2 and 15 and other white markings unresolved',
    completePhysicalStakeCensus: false, terrainModified: false };
  return model;
}
