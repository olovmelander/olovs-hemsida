/* Boundary geometry and individual physical markers have separate evidence.
 * A traced asphalt edge is a rule boundary, never a generator for white stakes. */
export const OB_REVIEW_PATH = 'lidingobuild/mapping/ob-placement-review.json';
const FRAME = { easting: 677700.5, northing: 6586399.5 };
const finitePoint = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const fail = message => { throw new Error(`Lidingo OB review: ${message}`); };
const local = ([e, n]) => [e - FRAME.easting, FRAME.northing - n];

function sourceEvidence(record, sources) {
  const image = sources.get(record.imageSourceId), rule = sources.get(record.ruleSourceId);
  if (image?.kind !== 'orthophoto' || !/^[a-f0-9]{64}$/.test(image.sha256 || '') ||
      image.capturedAt !== '2025-05-31' || !image.path) fail(`${record.id}: missing reviewed orthophoto evidence`);
  if (rule?.kind !== 'club-rule' || !/^https:\/\/www\.lidingogk\.se\//.test(rule.url || '')) {
    fail(`${record.id}: missing club boundary-rule evidence`);
  }
  if (!Number.isFinite(record.uncertaintyMetres) || record.uncertaintyMetres <= 0) fail(`${record.id}: missing uncertainty`);
  if (!Array.isArray(record.holes) || !record.holes.length || record.holes.some(n => !Number.isInteger(n) || n < 1 || n > 18)) {
    fail(`${record.id}: invalid affected holes`);
  }
  const coordinates = record.lineEpsg3006 || [record.pointEpsg3006];
  const pixels = record.sourcePixelLine || [record.sourcePixelPoint];
  const bounds = image.boundsEpsg3006, resolution = image.resolutionMetres;
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite) ||
      !Number.isFinite(resolution) || resolution <= 0 || !Array.isArray(coordinates) ||
      coordinates.length !== pixels.length || !coordinates.every(finitePoint) || !pixels.every(finitePoint)) {
    fail(`${record.id}: missing source pixel transform`);
  }
  for (let i = 0; i < coordinates.length; i++) {
    const [e, n] = coordinates[i], [x, y] = pixels[i];
    if (e < bounds[0] || e > bounds[2] || n < bounds[1] || n > bounds[3] ||
        Math.abs(e - bounds[0] - x * resolution) > .001 || Math.abs(bounds[3] - n - y * resolution) > .001) {
      fail(`${record.id}: coordinates disagree with observed source pixels`);
    }
  }
  return { imageSourceId: image.id, imageSha256: image.sha256, capturedAt: image.capturedAt,
    ruleSourceId: rule.id, ruleUrl: rule.url, uncertaintyMetres: record.uncertaintyMetres,
    status: 'manually-interpreted-not-surveyed' };
}

export function applyObPlacementReview(model, review) {
  if (review?.schemaVersion !== 1 || review.groundId !== 'lidingo' || review.horizontalCrs !== 'EPSG:3006') {
    fail('wrong review identity or coordinate system');
  }
  const sources = new Map((review.sources || []).map(source => [source.id, source]));
  if (sources.size !== (review.sources || []).length) fail('duplicate source IDs');
  const ids = new Set(), lines = [], markings = [];
  for (const record of [...(review.boundaries || []), ...(review.stakes || [])]) {
    if (!record.id || ids.has(record.id)) fail('missing or duplicate feature ID');
    ids.add(record.id);
  }
  for (const boundary of review.boundaries || []) {
    if (boundary.state !== 'accepted') continue;
    const evidence = sourceEvidence(boundary, sources);
    if (!['asphalt-edge', 'fence', 'observed-marker-line'].includes(boundary.kind)) fail(`${boundary.id}: unsupported boundary kind`);
    const coordinates = boundary.lineEpsg3006;
    if (!Array.isArray(coordinates) || coordinates.length < 2 || !coordinates.every(finitePoint)) fail(`${boundary.id}: invalid boundary line`);
    for (let i = 1; i < coordinates.length; i++) {
      if (Math.hypot(coordinates[i][0] - coordinates[i - 1][0], coordinates[i][1] - coordinates[i - 1][1]) < .01) {
        fail(`${boundary.id}: repeated boundary vertex`);
      }
    }
    if (boundary.completeBoundary !== false) fail(`${boundary.id}: visible segments must not claim a complete OB survey`);
    lines.push({ id: boundary.id, holes: [...boundary.holes], kind: boundary.kind,
      line: coordinates.map(local), virtual: true, completeBoundary: false, evidence });
  }
  for (const stake of review.stakes || []) {
    if (stake.state !== 'accepted') continue;
    const evidence = sourceEvidence(stake, sources);
    if (stake.kind !== 'white-stake' || stake.observation !== 'individual-visible-stake' || !finitePoint(stake.pointEpsg3006)) {
      fail(`${stake.id}: physical stake requires one individually observed point`);
    }
    markings.push({ id: stake.id, color: 'w', pts: [local(stake.pointEpsg3006)], holes: [...stake.holes],
      placement: 'individual-observed-marker', evidence });
  }
  // Validate the entire input before changing the model. Reapplication replaces
  // only this review's records, retaining other mapped marking sources.
  model.outOfBounds = { sourceReview: OB_REVIEW_PATH, lines,
    completeness: 'visible-segments-only; unresolved stakes and obscured edges retained in review' };
  model.marking = (model.marking || []).filter(record => record.sourceReview !== OB_REVIEW_PATH)
    .concat(markings.map(record => ({ ...record, sourceReview: OB_REVIEW_PATH })));
  return { boundarySegments: lines.length, observedWhiteStakes: markings.length };
}
