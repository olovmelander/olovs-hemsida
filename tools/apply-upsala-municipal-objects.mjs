/* Apply the reviewed 2026 municipal object observations transactionally.
 * Source geometry stays in evidence. Unknown ditch/fence dimensions must not
 * carve terrain or create inferred 3D objects. Tree observations stay separate
 * from the shipped LiDAR population and are available in the GIS evidence.
 */
import assert from 'node:assert/strict';
import { sweref99TmToLatLon } from '../packages/course-geo/chmv2/projection.mjs';

const NEW_DITCHES = new Set([18921, 145640, 145642, 145643]);
const BOUNDARY_KINDS = new Map([
  [2052, 'hedge'], [2053, 'wall'], [2054, 'screen'],
  [2056, 'fence'], [2059, 'fence'], [2060, 'retaining_wall'],
]);
const SOURCE = 'https://kartportal.uppsala.se/mapping/rest/services/nPlanBygg/Bygglov_Primarkarta_utskrift/MapServer';
const samePoint = (p, q) => p[0] === q[0] && p[1] === q[1];
const length = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

function checkLocalLine(line, id) {
  assert(Array.isArray(line) && line.length >= 2, `${id}: missing local line`);
  assert(line.every(p => Array.isArray(p) && p.length === 2 && p.every(n => Number.isFinite(n) && Math.abs(n) < 10000)),
    `${id}: invalid local coordinate`);
  assert(line.some(p => length(p, line[0]) > 0.01), `${id}: degenerate line`);
}

function checkProjection(localLines, sourceLines, frame, id) {
  assert.equal(localLines.length, sourceLines?.length, `${id}: source/local part count differs`);
  for (let i = 0; i < localLines.length; i++) {
    checkLocalLine(localLines[i], id);
    assert.equal(localLines[i].length, sourceLines[i].length, `${id}: source/local vertex count differs`);
    for (let j = 0; j < localLines[i].length; j++) {
      const p = sourceLines[i][j];
      assert(p.length >= 2 && p.slice(0, 2).every(Number.isFinite), `${id}: invalid source coordinate`);
      const [lat, lon] = sweref99TmToLatLon(p[0], p[1]);
      const projected = [(lon - frame.origin.lon) * frame.mPerLon, (frame.origin.lat - lat) * frame.mPerLat];
      assert(length(localLines[i][j], projected) < 0.005, `${id}: source/local projection differs`);
    }
  }
}

function metadata(f) {
  assert.equal(f.sourceAttributes.STATUS, 3, `${f.id}: source no longer existing`);
  assert.equal(f.sourceStatus, 'Befintligt', `${f.id}: source status differs`);
  assert(/^[a-f0-9]{64}$/.test(f.sourceQuerySha256) && /^[a-f0-9]{64}$/.test(f.sourceMetadataSha256),
    `${f.id}: source hashes missing`);
  assert.equal(f.sourceCapturedAt, null, `${f.id}: an independent capture date was not established`);
  assert.equal(f.sourceRegisteredAtIsCaptureDate, false, `${f.id}: registration is not capture`);
  assert(Number.isFinite(f.reportedPlanAccuracyM) && f.reportedPlanAccuracyM > 0, `${f.id}: source accuracy missing`);
  for (const field of ['method', 'sourceSubtype', 'scope', 'sourceRegisteredAt', 'sourceModifiedAt']) {
    assert.equal(typeof f[field], 'string', `${f.id}: ${field} must be scalar metadata`);
  }
  assert(Number.isFinite(Date.parse(f.sourceRegisteredAt)) && Number.isFinite(Date.parse(f.sourceModifiedAt)),
    `${f.id}: invalid database timestamp`);
  assert.equal(typeof f.sourceRegisteredAfterImageryYear, 'boolean', `${f.id}: invalid temporal flag`);
  // Whitelist deliberately excludes sourceAttributes, source geometry, nearby
  // source objects, original shapes, image extents and source-coordinate arrays.
  return {
    sourceId: f.id,
    prov: 'municipal-survey',
    sourceProvider: 'Uppsala kommun',
    sourceUrl: `${SOURCE}/${f.layer}`,
    sourceSha256: f.sourceQuerySha256,
    sourceMetadataSha256: f.sourceMetadataSha256,
    sourceSubtype: f.sourceSubtype,
    sourceStatus: 'existing',
    sourceMethod: f.method,
    measurementMethod: f.method,
    sourceHorizontalAccuracyM: f.reportedPlanAccuracyM,
    horizontalAccuracyMetres: f.reportedPlanAccuracyM,
    sourceAccuracyMeaning: 'Municipality-reported source precision; whole-app absolute accuracy is not certified.',
    sourceRegisteredAt: f.sourceRegisteredAt,
    sourceModifiedAt: f.sourceModifiedAt,
    sourceCapturedAt: null,
    sourceDateMeaning: 'Registration and modification are database events, not independently known measurement dates.',
    latestVisualCrossCheckYear: 2025,
    sourceRegisteredAfterImageryYear: f.sourceRegisteredAfterImageryYear,
    scope: f.scope,
    surveyReview: 'accepted position and source identity; unrecorded dimensions remain unmeasured',
  };
}

function bridgeFrom(f, frame) {
  assert.equal(f.objectId, 64915, 'unreviewed municipal bridge');
  assert.equal(f.layer, 571, 'duplicate line representation must not add another bridge');
  const rings = f.geometryLocal.rings;
  assert.equal(rings?.length, 1, `${f.id}: expected a single surveyed deck polygon`);
  checkProjection(rings, f.sourceGeometryEPSG3006.rings, frame, f.id);
  const ring = structuredClone(rings[0]);
  if (samePoint(ring[0], ring.at(-1))) ring.pop();
  assert.equal(ring.length, 4, `${f.id}: the reviewed bridge quadrilateral changed`);
  const cross = ring.map((p, i) => {
    const q = ring[(i + 1) % 4], r = ring[(i + 2) % 4];
    return (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]);
  });
  assert(cross.every(n => n > 0) || cross.every(n => n < 0), `${f.id}: invalid deck polygon`);
  // Axis joins opposite shorter-edge midpoints. It is a derived horizontal
  // orientation for the existing footprint renderer, not a height measurement.
  const edges = ring.map((p, i) => length(p, ring[(i + 1) % 4]));
  const start = edges[0] + edges[2] <= edges[1] + edges[3] ? 0 : 1;
  const line = [midpoint(ring[start], ring[(start + 1) % 4]), midpoint(ring[(start + 2) % 4], ring[(start + 3) % 4])];
  const area = Math.abs(ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % 4]; return sum + p[0] * q[1] - q[0] * p[1];
  }, 0) / 2);
  return {
    id: f.id, kind: 'bridge', ...metadata(f), ring, line,
    equivalentSourceId: 'uppsala-primary-568-111560',
    axisMethod: 'midpoints of opposite shorter edges of the surveyed quadrilateral',
    areaM2: Math.round(area * 1000) / 1000,
    deckHeightM: null, railHeightM: null, deckMaterial: null, railsObserved: null,
    preserveTerrain: true,
    elevationProvenance: 'unmeasured; existing footprint renderer samples terrain at deck ends and approaches',
    renderStatus: 'exact horizontal footprint; vertical dimensions and neutral material are rendering estimates',
  };
}

export function applyMunicipalObjects20260907(model, evidence) {
  const frame = { origin: model.origin, mPerLat: model.mPerLat, mPerLon: model.mPerLon };
  assert.deepEqual(frame, evidence.frame, 'municipal object review frame changed');
  assert(Array.isArray(model.streams) && model.infra, 'missing model infrastructure');
  assert(Array.isArray(evidence.features), 'municipal observations missing');
  assert.deepEqual(model.infra.barriers, evidence.baselineAssertions['infra.barriers'], 'original boundaries changed; re-review required');
  assert(!model.infra.drainage || (Array.isArray(model.infra.drainage) && model.infra.drainage.length === 0),
    'municipal drainage already applied or original drainage changed');
  const existingBridges = model.infra.bridges || [];
  for (const original of evidence.baselineAssertions['infra.bridges']) {
    assert.deepEqual(existingBridges.find(b => b.id === original.id), original, `${original.id}: original bridge changed; re-review required`);
  }
  const ids = new Set(), drainage = [], barriers = [], bridges = [], corroborations = new Map();
  let treeCount = 0, corroborationCount = 0;
  for (const f of evidence.features) {
    assert(!ids.has(f.id), `duplicate municipal source identity ${f.id}`);
    ids.add(f.id);
    assert.equal(f.id, `uppsala-primary-${f.layer}-${f.objectId}`, 'municipal source identity differs');
    if (f.kind === 'tree-observation') {
      assert.equal(f.status, 'accepted-observation', `${f.id}: unaccepted tree observation`);
      treeCount++;
      continue; // no second tree population and no automatic crown assignment
    }
    if (f.kind === 'ditch' && !NEW_DITCHES.has(f.objectId)) {
      assert.equal(f.status, 'corroboration-only', `${f.id}: duplicate drainage must remain corroboration-only`);
      assert.equal(f.review.decision, 'retain-existing-stream', `${f.id}: existing drainage decision changed`);
      const candidate = f.nearestExisting[0];
      const original = evidence.baselineObjects[candidate.originalObjectRef];
      const target = model.streams.find(s => s.id === candidate.id);
      assert(original && target, `${f.id}: original drainage missing`);
      assert.deepEqual(target, original, `${candidate.id}: original drainage changed; re-review required`);
      const list = corroborations.get(candidate.id) || [];
      list.push({ ...metadata(f), reviewMeaning: 'corroborates the existing corridor; its continuous OSM geometry is retained' });
      corroborations.set(candidate.id, list); corroborationCount++;
      continue;
    }
    assert.equal(f.status, 'accepted', `${f.id}: unaccepted municipal geometry`);
    assert.equal(f.sourceAttributes.ORIGINPLAN, 109, `${f.id}: expected reviewed network RTK source`);
    if (f.kind === 'bridge') {
      const bridge = bridgeFrom(f, frame);
      const identities = new Set([bridge.id, bridge.equivalentSourceId]);
      assert(!existingBridges.some(b => [b.id, b.sourceId, b.equivalentSourceId].some(id => identities.has(id))),
        `${f.id}: bridge identity already exists`);
      bridges.push(bridge);
      continue;
    }
    assert(['ditch', 'barrier'].includes(f.kind), `${f.id}: unsupported municipal kind`);
    assert.equal(f.geometryLocal.lines?.length, 1, `${f.id}: expected a single reviewed line`);
    checkProjection(f.geometryLocal.lines, f.sourceGeometryEPSG3006.paths, frame, f.id);
    const line = structuredClone(f.geometryLocal.lines[0]);
    if (f.kind === 'ditch') {
      assert.equal(f.layer, 564, `${f.id}: wrong ditch source layer`);
      drainage.push({
        id: f.id, kind: 'ditch', ...metadata(f), line,
        widthM: null, depthM: null, waterPermanence: 'unknown', preserveTerrain: true,
        renderStatus: 'mapped GIS centreline; no inferred water body or channel dimensions; terrain unchanged',
      });
    } else {
      assert.equal(f.layer, 570, `${f.id}: wrong boundary source layer`);
      const kind = BOUNDARY_KINDS.get(f.sourceAttributes.STYPE);
      assert(kind, `${f.id}: unreviewed boundary subtype`);
      barriers.push({
        id: f.id, kind, ...metadata(f), line,
        heightM: null, widthM: null, material: null, species: null, preserveTerrain: true,
        renderStatus: 'mapped GIS line; 3D extrusion deferred because vertical dimensions are unmeasured',
      });
    }
  }
  assert.equal(drainage.length, 4, 'the four reviewed new ditch lines must be present');
  assert.equal(barriers.length, 19, 'the nineteen reviewed boundary lines must be present');
  assert.equal(bridges.length, 1, 'the single reviewed bridge footprint must be present');
  assert.equal(corroborationCount, 9, 'the nine existing drainage observations must be present');
  assert.equal(treeCount, 50, 'the fifty separate tree observations must be present');
  // Commit only after every geometry, source decision and original assertion
  // passed. No mutation above this point can leave a partially applied survey.
  model.streams = model.streams.map(s => corroborations.has(s.id)
    ? { ...s, municipalCorroboration: corroborations.get(s.id) } : s);
  model.infra.drainage = drainage;
  model.infra.barriers = barriers;
  model.infra.bridges = [...existingBridges, ...bridges];
  return model;
}
