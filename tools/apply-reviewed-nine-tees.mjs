/* Apply reviewed physical tee surfaces after a nine's green/route reconciliation.
   The archived review baseline is checked against unchanged source routes, card
   and frame. Generated markers may have moved with a newly reviewed green; they
   are not controls for the physical deck and are preserved verbatim.

   Pure API: applyReviewedNineTees(model, { evidence, sourceRoutes, card }).
   createNineTeeReference archives the original review context when authoring the
   evidence file. Pixel coordinates and archived geometry never enter the model. */
import { createHash } from 'node:crypto';

const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const frameOf = model => ({ origin: model.origin, mPerLat: model.mPerLat, mPerLon: model.mPerLon });
const cardOf = card => card.holes.map(h => ({ n: h.n, par: h.par, hcp: h.hcp, t: h.t })).sort((a, b) => a.n - b.n);
const routesOf = source => source.features.filter(f => f.properties?.role === 'published_hole_route')
  .map(f => ({ hole: f.properties.hole, geometry: f.geometry })).sort((a, b) => a.hole - b.hole);
const same = (a, b) => hash(a) === hash(b);
const fail = message => { throw new Error(`reviewed nine tees: ${message}`); };

/** Freeze the source geometry/card and the model used during imagery review. */
export function createNineTeeReference({ sourceRoutes, card, archivedModel }) {
  const archive = {
    frame: frameOf(archivedModel),
    card: archivedModel.card,
    holes: archivedModel.holes.map(h => ({ n: h.n, greenC: h.green.c, routeStart: h.line[0], pads: h.tees.pads, marks: h.tees.marks })),
  };
  return { schemaVersion: 1, sourceRoutesSha256: hash(routesOf(sourceRoutes)), cardSha256: hash(cardOf(card)), archiveSha256: hash(archive), archive: structuredClone(archive) };
}

const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const onSegment = (a, b, p) => Math.abs(cross(a, b, p)) < 1e-9
  && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
function intersects(a, b, c, d) {
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0
    || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}
function contains(ring, point) {
  const [x, z] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if (onSegment(a, b, point)) return true;
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function validateSurface(feature) {
  const { ring, c } = feature;
  const point = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
  if (!Array.isArray(ring) || ring.length < 3 || !ring.every(point) || !point(c)) fail(`${feature.id}: invalid coordinates`);
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (same(a, b)) fail(`${feature.id}: repeated vertex`);
    area += a[0] * b[1] - b[0] * a[1];
    for (let j = i + 2; j < ring.length; j++) {
      if (i === 0 && j === ring.length - 1) continue;
      if (intersects(a, b, ring[j], ring[(j + 1) % ring.length])) fail(`${feature.id}: self-intersecting ring`);
    }
  }
  if (Math.abs(area / 2) < 1 || !contains(ring, c)) fail(`${feature.id}: invalid area or derived centre`);
  if (!Number.isFinite(feature.area) || Math.abs(Math.abs(area / 2) - feature.area) > 0.05) fail(`${feature.id}: recorded area does not match ring`);
}

/** Return a new model; retain the current route, card and marker arrays unchanged. */
export function applyReviewedNineTees(model, { evidence, sourceRoutes, card }) {
  const ref = evidence.reference;
  if (ref?.schemaVersion !== 1 || hash(ref.archive) !== ref.archiveSha256) fail('missing or changed archived review baseline');
  if (hash(routesOf(sourceRoutes)) !== ref.sourceRoutesSha256) fail('published source routes changed; review tee association again');
  if (hash(cardOf(card)) !== ref.cardSha256) fail('source card changed; review tee association again');
  if (!same(frameOf(model), ref.archive.frame) || !same(frameOf(model), evidence.frame)) fail('local frame changed');
  if (!same(ref.archive.card, cardOf(card))) fail('archived card disagrees with source card');
  const numbers = model.holes.map(h => h.n).sort((a, b) => a - b);
  if (!same(numbers, ref.archive.holes.map(h => h.n).sort((a, b) => a - b))
    || !same(numbers, cardOf(card).map(h => h.n))
    || !same(numbers, evidence.coverage.map(h => h.hole).sort((a, b) => a - b))) fail('review must cover every source hole exactly once');
  const seen = new Set(), byHole = new Map(numbers.map(n => [n, []]));
  for (const feature of evidence.features) {
    const old = ref.archive.holes.find(h => h.n === feature.hole);
    if (!old || feature.status !== 'accepted' || feature.kind !== 'tee' || seen.has(feature.id)) fail(`invalid or duplicate accepted surface ${feature.id}`);
    if (!same(feature.originalPads, old.pads) || !same(feature.originalMarks, old.marks) || !same(feature.originalRouteStart, old.routeStart)) fail(`${feature.id}: archived geometry assertion changed`);
    if (feature.teeColour != null || feature.dailyMarkerPosition != null || feature.teeIdx != null) fail(`${feature.id}: physical deck must not assign a marker or colour`);
    validateSurface(feature);
    seen.add(feature.id);
    byHole.get(feature.hole).push({
      ring: structuredClone(feature.ring), c: feature.c.slice(), area: feature.area,
      prov: feature.prov, sourceId: feature.id, imagerySourceId: feature.sourceId,
      observedYear: feature.observedYear, crosscheckYear: feature.crosscheckYear,
      boundaryInterpretationUncertaintyMetres: feature.boundaryInterpretationUncertaintyMetres,
      sourceAbsoluteHorizontalAccuracyMetres: feature.sourceAbsoluteHorizontalAccuracyMetres,
      centreProvenance: 'polygon area centroid; not a tee marker', preserveTerrain: true,
    });
  }
  for (const [n, surfaces] of byHole) if (!surfaces.length) fail(`hole ${n} has no accepted physical platform`);
  return { ...model, holes: model.holes.map(h => ({ ...h, tees: {
    ...h.tees, pads: byHole.get(h.n), inferPads: false,
    markProvenance: 'card-distance inference; deck colour association and daily marker positions unverified',
    mappingCoverage: evidence.coverage.find(c => c.hole === h.n).status,
  } })) };
}
