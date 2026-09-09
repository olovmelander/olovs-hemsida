/* Accepted Lantmateriet orthophoto traces override the historical OSM/plan
 * fusion. Source pixels and review decisions stay in the review ledger; only
 * their resulting geometry and provenance enter the compatibility model.
 * No coordinate-frame fitting, terrain edits or tee-marker inference occurs.
 */
import { createHash } from 'node:crypto';
import { centroid, polyArea, polyLen, pointInPoly, bearing, decodeHF } from '../lib.mjs';
import { lineBearingAt } from '../../apps/golf/src/engine/geom.js';

export const ORTHO_REVIEW_PATH = 'geobuild/mapping/lm-ortho-review.json';
const PROVENANCE = 'reviewed-lm-orthophoto';
const HASH = /^[a-f0-9]{64}$/;
const point = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const samePoint = (a, b) => point(a) && point(b) && a.every((v, i) => v === b[i]);
const round = (n, digits = 1) => Number(n.toFixed(digits));
const fail = message => { throw new Error(`Orthophoto review: ${message}`); };

/** Hash only stored coordinates, never a surface's mutable metadata. A fairway
 * hashes its complete rings array, so accepting split components is atomic. */
export function ringGeometrySha256(geometry) {
  return createHash('sha256').update(JSON.stringify(geometry)).digest('hex');
}

const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const onSegment = (a, b, p) => Math.abs(cross(a, b, p)) <= 1e-8 &&
  p[0] >= Math.min(a[0], b[0]) - 1e-8 && p[0] <= Math.max(a[0], b[0]) + 1e-8 &&
  p[1] >= Math.min(a[1], b[1]) - 1e-8 && p[1] <= Math.max(a[1], b[1]) + 1e-8;
function intersects(a, b, c, d) {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  return (abC * abD < 0 && cdA * cdB < 0) || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

/** Accept an open or closed ring, return one open ring as used by geobuild. */
export function validateOrthoRing(input, label = 'ring') {
  if (!Array.isArray(input) || input.length < 3 || !input.every(point)) fail(`${label} needs finite [x,z] vertices`);
  const ring = input.map(p => [...p]);
  if (samePoint(ring[0], ring.at(-1))) ring.pop();
  if (ring.length < 3 || new Set(ring.map(p => JSON.stringify(p))).size !== ring.length) fail(`${label} has duplicate vertices`);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (samePoint(a, b)) fail(`${label} has a zero-length edge`);
    for (let j = i + 1; j < ring.length; j++) {
      if (j === i + 1 || (i === 0 && j === ring.length - 1)) continue;
      if (intersects(a, b, ring[j], ring[(j + 1) % ring.length])) fail(`${label} self-intersects`);
    }
  }
  if (Math.abs(polyArea(ring)) < 0.01) fail(`${label} has no polygon area`);
  return ring;
}

function validateEvidence(feature) {
  const evidence = feature.evidence;
  if (!evidence || !Array.isArray(evidence.sourceFiles) || !evidence.sourceFiles.length ||
      !evidence.sourceFiles.every(f => typeof f.path === 'string' && f.path.length && HASH.test(f.sha256))) {
    fail(`${feature.id} needs source image paths and SHA-256 evidence`);
  }
  if (!Array.isArray(evidence.sourceCaptureDates) || !evidence.sourceCaptureDates.length ||
      !evidence.sourceCaptureDates.every(date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
        Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date)) {
    fail(`${feature.id} needs exact source capture dates`);
  }
  if (!Number.isFinite(evidence.uncertaintyM) || evidence.uncertaintyM <= 0) fail(`${feature.id} needs positive interpretation uncertainty`);
  if (evidence.sourcePixelRing) validateOrthoRing(evidence.sourcePixelRing, `${feature.id} source pixels`);
}

function storedGeometry(hole, feature) {
  if (feature.kind === 'green') return hole.green?.ring;
  if (feature.kind === 'fairway') return hole.fairway?.rings;
  if (feature.kind === 'tee-set') return hole.tees?.pads?.map(pad => pad.ring);
  if (!Number.isSafeInteger(feature.index) || feature.index < 0) fail(`${feature.id} needs a stable surface index`);
  return (feature.kind === 'bunker' ? hole.bunkers : hole.tees?.pads)?.[feature.index]?.ring;
}

function refreshTeePadDistances(hole) {
  const nearest = p => Math.min(...hole.tees.pads.map(pad => Math.hypot(pad.c[0] - p[0], pad.c[1] - p[1])));
  for (const marker of hole.tees.marks) marker.padDist = round(nearest(marker.c));
  hole.teePadDist = round(nearest(hole.line[0]));
}

// A platform association does not identify today's marker position. Move an
// outside virtual reference only as far as needed to enter its nominated deck.
function platformReference(current, ring, label) {
  if (pointInPoly(...current, ring)) return [...current];
  const centre = centroid(ring);
  if (!pointInPoly(...centre, ring)) fail(`${label} needs an interior platform reference`);
  let nearest = null, distance = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((current[0] - a[0]) * dx + (current[1] - a[1]) * dz) / (dx * dx + dz * dz)));
    const edge = [a[0] + dx * t, a[1] + dz * t], d = Math.hypot(current[0] - edge[0], current[1] - edge[1]);
    if (d < distance) { nearest = edge; distance = d; }
  }
  const length = Math.hypot(centre[0] - nearest[0], centre[1] - nearest[1]);
  if (length < 1e-8) return [...centre];
  const fraction = Math.min(0.75 / length, 0.5);
  const inset = nearest.map((value, i) => value + (centre[i] - value) * fraction);
  return pointInPoly(...inset, ring) ? inset : [...centre];
}

function validateFrame(model, review) {
  const actual = review?.frame;
  if (review?.schemaVersion !== 1 || review.groundId !== 'veckefjarden' || !Array.isArray(review.features)) fail('requires a Veckefjarden schemaVersion 1 feature ledger');
  if (model.origin?.lat !== 63.2845 || model.origin?.lon !== 18.6735 ||
      actual?.origin?.lat !== model.origin.lat || actual?.origin?.lon !== model.origin.lon ||
      actual?.mPerLat !== model.mPerLat || actual?.mPerLon !== model.mPerLon) fail('source and model frames disagree');
}

/** Pure and atomic: validate every feature before cloning or changing geometry.
 * heightAt samples the EXISTING compatibility heightfield, never a new datum.
 * A changed green target needs this callback to refresh legacy elevation labels;
 * the routing rebinder separately samples authoritative RH 2000 terrain.
 */
export function applyOrthoReview(model, review, { heightAt } = {}) {
  validateFrame(model, review);
  const reviewedTeeHoles = review.reviewedTeeHoles ?? [];
  const suppressInferredTeeHoles = review.suppressInferredTeeHoles ?? [];
  for (const [name, holes] of [['reviewedTeeHoles', reviewedTeeHoles], ['suppressInferredTeeHoles', suppressInferredTeeHoles]]) {
    if (!Array.isArray(holes) || new Set(holes).size !== holes.length ||
        !holes.every(n => Number.isSafeInteger(n) && model.holes.some(h => h.n === n) &&
          review.features.some(f => f.hole === n && ['tee','tee-set'].includes(f.kind) && f.status === 'accepted'))) {
      fail(`${name} must uniquely identify holes with an explicit accepted physical tee review`);
    }
  }
  const ids = new Set(), slots = new Set();
  const planned = review.features.map(feature => {
    if (!feature || typeof feature.id !== 'string' || !feature.id || ids.has(feature.id)) fail('feature ids must be unique');
    ids.add(feature.id);
    if (feature.status !== 'accepted' || !['green', 'bunker', 'tee', 'tee-set', 'fairway'].includes(feature.kind) ||
        !Number.isSafeInteger(feature.hole) || !HASH.test(feature.originalRingSha256)) fail(`${feature.id} is not an accepted, pinned playing surface`);
    if (feature.action !== undefined && feature.action !== 'replace' && feature.action !== 'add') fail(`${feature.id} has an unsupported action`);
    if (feature.action === 'add' && feature.kind !== 'bunker') fail(`${feature.id} only supports explicit bunker additions`);
    if (feature.referencePads !== undefined && feature.kind !== 'tee-set') fail(`${feature.id} reference associations require a complete tee-set`);
    validateEvidence(feature);
    const hole = model.holes.find(h => h.n === feature.hole);
    if (!hole) fail(`${feature.id} has no matching hole`);
    if (['tee','tee-set'].includes(feature.kind) && review.features.some(other => other.hole === feature.hole &&
        other.kind === (feature.kind === 'tee' ? 'tee-set' : 'tee'))) fail(`${feature.id} mixes complete and individual tee reviews for one hole`);
    const slot = `${feature.hole}/${feature.kind}/${['tee', 'bunker'].includes(feature.kind) ? feature.index : ''}`;
    if (slots.has(slot)) fail(`${feature.id} duplicates a surface slot`);
    slots.add(slot);
    let geometry;
    if (feature.kind === 'tee-set') {
      if (feature.ring !== undefined || feature.rings !== undefined || !Array.isArray(feature.pads) || !feature.pads.length ||
          !feature.pads.every(pad => pad && typeof pad.id === 'string' && pad.id.length && (pad.note === undefined || typeof pad.note === 'string')) ||
          new Set(feature.pads.map(pad => pad.id)).size !== feature.pads.length) fail(`${feature.id} needs a nonempty pad inventory with unique stable ids`);
      geometry = feature.pads.map(pad => validateOrthoRing(pad.ring, `${feature.id}/${pad.id}`));
      for (let i = 0; i < feature.pads.length; i++) {
        const pad = feature.pads[i];
        if (pad.retainedHistorical !== undefined && typeof pad.retainedHistorical !== 'boolean') fail(`${feature.id}/${pad.id} historical retention must be explicit`);
        if (!pad.retainedHistorical) continue;
        const original = hole.tees.pads.find(prior => (prior.sourceId ?? prior.id) === pad.sourceId &&
          prior.prov === pad.prov && ringGeometrySha256(prior.ring) === ringGeometrySha256(geometry[i]));
        if (!original || !pad.sourceId || pad.prov === PROVENANCE || typeof pad.note !== 'string' || !pad.note.trim() ||
            !Number.isFinite(pad.boundaryInterpretationUncertaintyMetres) || pad.boundaryInterpretationUncertaintyMetres < feature.evidence.uncertaintyM) {
          fail(`${feature.id}/${pad.id} historical retention needs an unchanged source ring, original provenance, note and conservative uncertainty`);
        }
      }
    } else if (feature.kind === 'fairway') {
      if (!Array.isArray(feature.rings) || !feature.rings.length || feature.ring !== undefined) fail(`${feature.id} needs a nonempty fairway rings array`);
      geometry = feature.rings.map((ring, i) => validateOrthoRing(ring, `${feature.id} ring ${i}`));
    } else {
      if (feature.rings !== undefined) fail(`${feature.id} needs one surface ring`);
      geometry = validateOrthoRing(feature.ring, feature.id);
    }
    const stored = storedGeometry(hole, feature);
    if (feature.action === 'add') {
      if (feature.originalRingSha256 !== ringGeometrySha256(null)) fail(`${feature.id} addition must pin an empty original slot`);
      const alreadyApplied = stored && hole.bunkers[feature.index].reviewId === feature.id && ringGeometrySha256(stored) === ringGeometrySha256(geometry);
      if (!alreadyApplied && (stored || feature.index !== hole.bunkers.length)) fail(`${feature.id} addition no longer addresses the original empty append slot`);
    } else {
      if (!stored) fail(`${feature.id} references a missing original surface`);
      const digest = ringGeometrySha256(stored);
      if (digest !== feature.originalRingSha256 && digest !== ringGeometrySha256(geometry)) fail(`${feature.id} original geometry changed since review`);
    }
    let target = null, referenceTargets = null;
    if (feature.kind === 'green') {
      target = feature.target ?? (point(hole.green.c) && pointInPoly(...hole.green.c, geometry) ? hole.green.c : centroid(geometry));
      if (!point(target) || !pointInPoly(...target, geometry)) fail(`${feature.id} green target must lie inside its reviewed ring`);
      if (!Array.isArray(hole.line) || hole.line.length < 2 || !hole.line.every(point)) fail(`${feature.id} routing is invalid`);
    }
    if (feature.referencePads !== undefined) {
      if (!Array.isArray(feature.referencePads) || feature.referencePads.length !== hole.tees.marks.length ||
          !feature.referencePads.every(index => index === null || (Number.isSafeInteger(index) && index >= 0 && index < geometry.length))) {
        fail(`${feature.id} referencePads must associate every marker with a reviewed pad index or null`);
      }
      referenceTargets = feature.referencePads.map((index, k) => {
        const marker = hole.tees.marks[k];
        if (!point(marker.c)) fail(`${feature.id} has an invalid existing virtual reference`);
        if (index === null) return [...marker.c];
        return platformReference(marker.c, geometry[index], `${feature.id}/${feature.pads[index].id}`);
      });
    }
    return { feature, geometry, target, referenceTargets };
  });
  // Resolve both ends before sampling: a tee-set and a green review for the
  // same hole must give the same route/elevation whichever is listed first.
  const routes = new Map();
  const routeFor = n => {
    if (!routes.has(n)) {
      const h = model.holes.find(h => h.n === n);
      if (!Array.isArray(h.line) || h.line.length < 2 || !h.line.every(point)) fail(`hole ${n} routing is invalid`);
      routes.set(n, { start: [...h.line[0]], end: [...h.line.at(-1)] });
    }
    return routes.get(n);
  };
  for (const { feature, target, referenceTargets } of planned) {
    const h = model.holes.find(h => h.n === feature.hole);
    if (feature.kind === 'green' && (!samePoint(h.line.at(-1), target) || !samePoint(h.green.c, target))) {
      Object.assign(routeFor(h.n), { end: target, greenReviewId: feature.id });
    }
    if (referenceTargets && feature.referencePads[0] !== null && !samePoint(referenceTargets[0], h.line[0])) {
      Object.assign(routeFor(h.n), { start: referenceTargets[0], teeReviewId: feature.id });
    }
  }
  for (const [n, route] of routes) {
    if (typeof heightAt !== 'function') fail(`hole ${n} moved reference requires an existing-heightfield sampler`);
    route.heights = [heightAt(...route.start), heightAt(...route.end)];
    if (!route.heights.every(Number.isFinite)) fail(`hole ${n} reference is outside the existing heightfield`);
  }
  const out = structuredClone(model);
  // The existing renderer/atlas policy preserves the exact accepted vertices
  // instead of smoothing turf edges and expanding sand beyond its source ring.
  if (review.features.length) out.infra = { ...out.infra, preserveMappedBoundaries: true };
  // Complete inventory review and a decision against inventing pads are
  // separate claims. Partial/obscured inventories may still forbid inferred
  // rectangles under unresolved virtual references, without becoming complete.
  for (const n of new Set([...reviewedTeeHoles, ...suppressInferredTeeHoles])) out.holes.find(h => h.n === n).tees.inferPads = false;
  for (const { feature, geometry, target, referenceTargets } of planned) {
    const hole = out.holes.find(h => h.n === feature.hole);
    const provenance = { prov: PROVENANCE, reviewId: feature.id, boundaryInterpretationUncertaintyMetres: feature.evidence.uncertaintyM };
    if (feature.kind === 'tee-set') {
      hole.tees.pads = feature.pads.map((pad, index) => ({ id: pad.id, ring: geometry[index], c: [...centroid(geometry[index])],
        area: Math.round(Math.abs(polyArea(geometry[index]))), ...provenance, reviewId: pad.id, teeSetReviewId: feature.id,
        preserveTerrain: true, ...(pad.note === undefined ? {} : { note: pad.note }),
        ...(pad.retainedHistorical ? { retainedHistorical: true, prov: pad.prov, sourceId: pad.sourceId,
          boundaryInterpretationUncertaintyMetres: pad.boundaryInterpretationUncertaintyMetres } : {}) }));
      if (referenceTargets) {
        hole.tees.marks = hole.tees.marks.map((marker, index) => {
          const padIndex = feature.referencePads[index];
          if (padIndex === null) {
            const unresolved = { ...marker, associationConfidence: 'unresolved' };
            delete unresolved.sourceReviewId; delete unresolved.sourcePadId;
            if (unresolved.prov === 'orthophoto-platform-reference') unresolved.prov = 'legacy-virtual-reference';
            return unresolved;
          }
          return { ...marker, c: referenceTargets[index], prov: 'orthophoto-platform-reference', associationConfidence: 'provisional',
            sourceReviewId: feature.id, sourcePadId: feature.pads[padIndex].id };
        });
      }
      refreshTeePadDistances(hole);
      continue;
    }
    if (feature.kind === 'fairway') {
      hole.fairway = { ...hole.fairway, ...provenance, rings: geometry, area: Math.round(geometry.reduce((sum, ring) => sum + Math.abs(polyArea(ring)), 0)) };
      continue;
    }
    const replacement = { ring: geometry, c: [...centroid(geometry)], area: Math.round(Math.abs(polyArea(geometry))), ...provenance };
    if (feature.kind === 'bunker') hole.bunkers[feature.index] = { ...hole.bunkers[feature.index], ...replacement };
    else if (feature.kind === 'tee') hole.tees.pads[feature.index] = { ...hole.tees.pads[feature.index], ...replacement, preserveTerrain: true };
    else {
      hole.green = { ...hole.green, ...replacement, c: [...target] };
      hole.pin = [...target];
    }
    if (feature.kind === 'tee') refreshTeePadDistances(hole);
  }
  for (const [n, route] of routes) {
    const hole = out.holes.find(h => h.n === n), [teeHeight, greenHeight] = route.heights;
    hole.line[0] = [...route.start]; hole.line[hole.line.length - 1] = [...route.end];
    if (route.greenReviewId) hole.routingReviewId = route.greenReviewId;
    if (route.teeReviewId) { hole.teeRoutingReviewId = route.teeReviewId; hole.teeSlide = null; }
    hole.lineSrc = 'legacy-route-with-reviewed-orthophoto-endpoints';
    hole.lineLen = round(polyLen(hole.line));
    hole.lenDev = round((polyLen(hole.line) - hole.t[0]) / hole.t[0] * 100, 2);
    hole.elev = { ...hole.elev, tee: round(teeHeight), green: round(greenHeight), rise: round(greenHeight - teeHeight) };
    if (Number.isFinite(hole.guideElevM)) hole.elevErr = round(hole.elev.rise - hole.guideElevM);
    if (Number.isFinite(hole.guideBearingDeg)) {
      const deg = bearing(route.end[0] - route.start[0], route.end[1] - route.start[1]) * 180 / Math.PI;
      hole.bearingErr = round(((deg - hole.guideBearingDeg) % 360 + 540) % 360 - 180);
    }
    refreshTeePadDistances(hole);
  }
  // Match the runtime's bearing convention for explicitly associated camera
  // references, preserving unrelated unresolved legacy metadata verbatim.
  for (const { feature } of planned) if (feature.referencePads) {
    const hole = out.holes.find(h => h.n === feature.hole);
    for (let k = 0; k < feature.referencePads.length; k++) if (feature.referencePads[k] !== null) {
      hole.tees.marks[k].b = round(lineBearingAt(hole.line, hole.tees.marks[k].c) * 180 / Math.PI);
    }
  }
  return out;
}

/** The scorecard is a separate measurement. This exception is tied to an
 * accepted ring, its evidence and an endpoint inside it, never just a flag. */
export function hasReviewedRouteEndpoint(hole, review) {
  if (review?.schemaVersion !== 1 || review.groundId !== 'veckefjarden') return false;
  const claims = [[hole.routingReviewId, 'green'], [hole.teeRoutingReviewId, 'tee-set']].filter(([id]) => id);
  if (!claims.length) return false;
  try {
    return claims.every(([id, kind]) => {
      const feature = review.features.find(f => f.id === id && f.hole === hole.n && f.kind === kind);
      if (!feature || feature.status !== 'accepted' || !HASH.test(feature.originalRingSha256)) return false;
      validateEvidence(feature);
      if (kind === 'green') {
        const ring = validateOrthoRing(feature.ring);
        return hole.green?.prov === PROVENANCE && hole.green.reviewId === feature.id &&
          ringGeometrySha256(ring) === ringGeometrySha256(hole.green.ring) &&
          samePoint(hole.line?.at(-1), hole.green.c) && samePoint(hole.pin, hole.green.c) &&
          (!feature.target || samePoint(feature.target, hole.green.c)) && pointInPoly(...hole.green.c, ring);
      }
      const index = feature.referencePads?.[0], marker = hole.tees?.marks?.[0];
      if (!Number.isSafeInteger(index) || index < 0 || !feature.pads?.[index] || !marker ||
          marker.prov !== 'orthophoto-platform-reference' || marker.associationConfidence !== 'provisional' ||
          marker.sourceReviewId !== feature.id || marker.sourcePadId !== feature.pads[index].id) return false;
      const rings = feature.pads.map(pad => validateOrthoRing(pad.ring));
      return ringGeometrySha256(rings) === ringGeometrySha256(hole.tees.pads.map(pad => pad.ring)) &&
        samePoint(hole.line?.[0], marker.c) && pointInPoly(...marker.c, rings[index]);
    });
  } catch { return false; }
}

export function legacyHeightfieldSampler(spec) {
  const values = decodeHF(spec);
  return (x, z) => {
    const fx = (x - spec.x0) / spec.dx, fz = (z - spec.z0) / spec.dx;
    if (!Number.isFinite(fx) || !Number.isFinite(fz) || fx < 0 || fz < 0 || fx > spec.nx - 1 || fz > spec.nz - 1) return NaN;
    const i = Math.min(Math.floor(fx), spec.nx - 2), j = Math.min(Math.floor(fz), spec.nz - 2);
    const tx = fx - i, tz = fz - j, k = j * spec.nx + i;
    return (values[k] * (1 - tx) + values[k + 1] * tx) * (1 - tz) +
      (values[k + spec.nx] * (1 - tx) + values[k + spec.nx + 1] * tx) * tz;
  };
}

/** Compact authoring snapshot: ring hashes and indices are the stable addresses. */
export function orthoReviewBaseline(model) {
  return { schemaVersion: 1, groundId: 'veckefjarden', frame: { origin: model.origin, mPerLat: model.mPerLat, mPerLon: model.mPerLon },
    holes: model.holes.map(h => ({ hole: h.n, green: { originalRingSha256: ringGeometrySha256(h.green.ring), c: h.green.c },
      fairway: { originalRingSha256: ringGeometrySha256(h.fairway.rings), components: h.fairway.rings.length },
      bunkers: h.bunkers.map((b, index) => ({ index, id: b.id ?? null, c: b.c, originalRingSha256: ringGeometrySha256(b.ring) })),
      tees: h.tees.pads.map((p, index) => ({ index, id: p.id ?? null, c: p.c, originalRingSha256: ringGeometrySha256(p.ring) })) })) };
}
