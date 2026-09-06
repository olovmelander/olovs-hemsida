/* Reviewed additions to the shared Upsala ground. Called by reconcile.mjs.
 * Evidence, original geometry and uncertainty live in mapping/. No source rasters
 * are distributed. Geometry assertions refuse stale decisions after an OSM edit.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { compactWoodlandContext } from '../apps/golf/src/engine/woodland-context.mjs';
import { sweref99TmToLatLon } from '../packages/course-geo/chmv2/projection.mjs';
import { centroid, polyArea, pointInPoly } from './lib.mjs';
import { reviewedFairwayMetadata } from '../tools/apply-reviewed-nine-fairways.mjs';
import { applyReviewedTeeSurfaces } from '../tools/apply-reviewed-tee-surfaces.mjs';

const read = name => JSON.parse(fs.readFileSync(new URL(`mapping/${name}`, import.meta.url)));
const surfaceEvidence = p => ({ source: p.source, sourceProductYear: p.sourceProductYear ?? p.observedYear, sourceSha256: p.sourceSha256 ?? p.sourceFiles?.[0]?.sha256, sourceHorizontalAccuracyM: p.sourceHorizontalAccuracyM ?? p.sourceAbsoluteHorizontalAccuracyMetres ?? null, uncertaintyM: p.uncertaintyM ?? p.boundaryInterpretationUncertaintyMetres, acceptance: p.acceptance, note: p.note, latestVisualCrossCheckYear: p.latestVisualCrossCheckYear });
const area = ring => Math.round(Math.abs(polyArea(ring)) * 100) / 100;
export function applyGroundMapping(model) {
  assert.deepEqual(model.origin, { lat: 59.839, lon: 17.4952 }, 'mapping frame changed');
  assert.equal(model.mPerLon, 55930.68, 'mapping longitude scale changed');
  assert(!model.mappingRevision, 'apply reviewed mapping to the reconciled base only');
  const buildings = read('municipal-buildings.json');
  for (const id of buildings.removeOsmIds) assert(model.infra.buildings.some(b => b.id === id), `missing reviewed building ${id}`);
  model.infra.buildings = model.infra.buildings.filter(b => !buildings.removeOsmIds.includes(b.id));
  for (const b of buildings.records) {
    // EPSG source coordinates must stay outside the local model: the migration
    // collector would otherwise interpret them as another local ring.
    const { sourceGeometry, comparison, ...runtime } = b;
    model.infra.buildings.push(runtime);
  }
  assert.equal(new Set(model.infra.buildings.map(b => b.id)).size, model.infra.buildings.length);

  model.scenery.mappedFeatures = read('facilities.json').features.map(f => {
    const { originalPixelRings, ring, holes = [], ...runtime } = f;
    return { ...runtime, rings: [ring, ...holes], prov: 'dated-orthophoto-trace' };
  });
  const projectedRing = feature => feature.geometry.coordinates[0].slice(0, -1).map(([e, n]) => {
    const [latitude, longitude] = sweref99TmToLatLon(e, n);
    return [+( (longitude - model.origin.lon) * model.mPerLon).toFixed(3),
      +( (model.origin.lat - latitude) * model.mPerLat).toFixed(3)];
  });
  const surfaces = read('surface-corrections.epsg3006.geojson').features;
  const get = id => { const f = surfaces.find(f => f.id === id); assert(f, id); return f; };
  const g = get('upsala-stora-green17-ortho2024');
  const h17 = model.holes.find(h => h.n === 17), greenRing = projectedRing(g);
  assert(pointInPoly(...h17.green.c, greenRing), 'corrected green must contain the existing provisional pin');
  h17.green = { ...h17.green, ring: greenRing, area: area(greenRing), prov: 'dated-orthophoto-trace', sourceId: g.id, evidence: surfaceEvidence(g.properties) };
  const tee = id => {
    const f = get(id), ring = projectedRing(f), [cx, cz] = centroid(ring);
    return { ring, cx, cz, ang: 0, prov: 'dated-orthophoto-trace', sourceId: id, evidence: surfaceEvidence(f.properties), preserveTerrain: true };
  };
  model.holes.find(h => h.n === 8).tees.pads = [tee('upsala-stora-hole8-tee-complex-ne-ortho2024'), tee('upsala-stora-hole8-tee-sw-2025')];
  // The visible upper tee corrects a pad drawn on a road. Its shadowed southern
  // edge remains explicitly approximate; daily tee markers are still provisional.
  const h9 = model.holes.find(h => h.n === 9);
  h9.tees.pads = [tee('upsala-stora-hole9-tee-upper-2025')];
  // Review all eighteen tee sites against the archived post-correction model.
  // Partly obscured originals are retained only through explicit source decisions.
  model.holes = applyReviewedTeeSurfaces(model, ['01-06', '07-12', '13-18']
    .map(range => read(`stora-tees-${range}-2025.json`))).holes;
  for (const h of model.holes) {
    h.tees.inferPads = false;
    h.tees.markProvenance = 'scorecard-distance inference; daily marker positions unverified';
    h.teePadDist = Math.round(Math.min(...h.tees.pads.map(p => Math.hypot(p.cx - h.line[0][0], p.cz - h.line[0][1]))) * 10) / 10;
  }

  const bunker = read('bunker16.json'), b = model.holes.find(h => h.n === 16).bunkers[3];
  assert.deepEqual(b.ring, bunker.replacesOriginalRing, 'bunker16 source changed; re-review required');
  Object.assign(b, { ring: bunker.ring, prov: 'dated-orthophoto-trace', evidence: bunker.source });
  for (const p of read('ponds.json').ponds) {
    const w = model.water.find(w => w.id === p.id);
    assert(w && p.ringLaser?.length >= 3, `missing reviewed pond ${p.id}`);
    assert.deepEqual(w.ring, p.ringOsm, `${p.id} source changed; re-review required`);
    assert(!(p.laserIslands?.length), `${p.id}: preserve islands before adopting`);
    Object.assign(w, { ring: p.ringLaser, area: area(p.ringLaser), prov: 'dtm-plate-ortho2024-reviewed',
      evidence: { terrainYear: 2023, imageryYear: 2024, sourceAbsoluteHorizontalAccuracyM: null, boundaryInterpretationUncertaintyM: 2 } });
  }
  const fairwaySources = read('fairways-2025.epsg3006.geojson').features;
  for (const f of read('fairways-2025.json').features) {
    const h = model.holes.find(h => h.n === f.hole);
    assert.deepEqual(h.fairway, f.originalFairway, `fairway ${f.hole} changed since review`);
    const p = fairwaySources.find(x => x.id === f.id || x.properties.id === f.id)?.properties;
    assert(p, `missing fairway source ${f.id}`);
    h.fairway = { rings: [f.ring], prov: 'dated-orthophoto-trace', sourceId: f.id,
      evidence: surfaceEvidence(p) };
  }
  for (const f of read('equipment-2025.json').features) {
    const { originalPixelRing, replacesOriginalRings, ring, holes = [], ...runtime } = f;
    for (const sourceId of f.replacesSourceIds || []) {
      const owners = model.holes.filter(h => h.bunkers.some(b => b.sourceId === sourceId));
      assert.equal(owners.length, 1, `practice bunker ${sourceId} ownership changed`);
      assert.deepEqual(owners[0].bunkers.find(b => b.sourceId === sourceId).ring, replacesOriginalRings?.[sourceId], `practice bunker ${sourceId} source outline changed`);
      owners[0].bunkers = owners[0].bunkers.filter(b => b.sourceId !== sourceId);
    }
    model.scenery.mappedFeatures.push({ ...runtime, rings: [ring, ...holes], prov: 'dated-orthophoto-trace' });
  }
  applyInfrastructureMapping(model);
  applyBridgeApproachMapping(model);
  retireReviewedBunker(model);
  applySharedMellanSurfaces(model);
  model.scenery.woodlandContext = compactWoodlandContext(read('woodland-leaf-type-context.json'));
  model.infra.objectPlacement = 'mapped-only';
  model.infra.preserveMappedBoundaries = true;
  // Source-frame evidence belongs in mapping/, never among local model geometry.
  // Check the finished model after every integration, including nested metadata.
  const leaked = [];
  (function scan(value, path) {
    if (Array.isArray(value)) return value.forEach((child, i) => scan(child, `${path}[${i}]`));
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (/3006$/.test(key)) leaked.push(`${path}.${key}`);
      scan(child, `${path}.${key}`);
    }
  })(model, 'model');
  assert.deepEqual(leaked, [], 'source-frame coordinates reached the local model; the migration would convert them as local metres');
  model.mappingRevision = 'upsala-reviewed-2024-2025-v3-stora-tees';
  return model;
}

/* Physical turf belongs to the shared ground, independently of the generated
   nine-hole model. The nine inherits these records and drops its own geometry
   from scenery. Thus each footprint is rendered once in either course. */
export function applySharedMellanSurfaces(model, evidence = {
  greens: read('mellan-greens-2025.json'), tees: read('mellan-tees-2025.json'), fairways: read('mellan-fairways-2025.json'),
}) {
  const scenery = model.scenery, records = [], removeIds = new Set(), removeRings = new Set();
  const key = ring => JSON.stringify(ring);
  const existing = new Map(scenery.sourceFeatures.map(f => [f.id, f]));
  for (const source of Object.values(evidence)) {
    assert.deepEqual(model.origin, source.frame.origin, 'shared Mellan surface origin changed');
    assert.equal(model.mPerLat, source.frame.mPerLat, 'shared Mellan surface latitude scale changed');
    assert.equal(model.mPerLon, source.frame.mPerLon, 'shared Mellan surface longitude scale changed');
  }
  for (const replacement of evidence.tees.supersedesSceneryTees || []) {
    const old = existing.get(replacement.id);
    assert(old?.kind === 'tee', `missing superseded scenery tee ${replacement.id}`);
    assert.deepEqual(old.ring, replacement.originalRing, `scenery tee ${replacement.id} changed since review`);
    assert.equal(scenery.tees.filter(r => key(r) === key(old.ring)).length, 1, `scenery tee ${replacement.id} render geometry changed`);
    assert(evidence.tees.features.some(f => f.id === replacement.replacementId), `missing replacement for ${replacement.id}`);
    removeIds.add(replacement.id); removeRings.add(key(old.ring));
  }
  for (const [kind, source] of Object.entries(evidence)) {
    for (const feature of source.features) {
      assert.equal(feature.status, 'accepted', `unaccepted shared surface ${feature.id}`);
      const rings = kind === 'fairways' ? feature.rings : [feature.ring];
      for (const [part, ring] of rings.entries()) {
        const id = rings.length > 1 ? `${feature.id}-part-${part + 1}` : feature.id;
        assert(!existing.has(id) && !records.some(r => r.id === id), `shared surface ${id} already exists`);
        assert(ring.length >= 3 && ring.every(p => p.length === 2 && p.every(Number.isFinite)), `invalid shared surface ${id}`);
        const metadata = kind === 'fairways' ? reviewedFairwayMetadata(feature) : {
          prov: 'dated-orthophoto-trace', sourceId: feature.id, imagerySourceId: feature.sourceId,
          observedYear: feature.observedYear, crosscheckYear: feature.crosscheckYear,
          boundaryInterpretationUncertaintyMetres: feature.boundaryInterpretationUncertaintyMetres,
          sourceAbsoluteHorizontalAccuracyMetres: null,
        };
        const replacement = evidence.tees.supersedesSceneryTees?.find(r => r.replacementId === feature.id);
        records.push({ ...metadata, id, kind: kind === 'fairways' ? 'fairway' : kind === 'greens' ? 'green' : 'tee',
          ring: structuredClone(ring), courseSlug: 'upsala-mellanbanan', hole: feature.hole,
          preserveBoundary: true, ...(replacement ? { replacesSourceId: replacement.id } : {}) });
      }
    }
  }
  // Commit after all source assertions, so a changed OSM footprint cannot leave
  // some new polygons adopted alongside stale ones.
  scenery.tees = scenery.tees.filter(r => !removeRings.has(key(r)));
  scenery.sourceFeatures = scenery.sourceFeatures.filter(f => !removeIds.has(f.id));
  for (const record of records) {
    scenery[record.kind === 'fairway' ? 'fairways' : record.kind === 'green' ? 'greens' : 'tees'].push(structuredClone(record.ring));
  }
  scenery.sourceFeatures.push(...records);
  return model;
}

export function retireReviewedBunker(model, evidence = read('retired-bunker-w438984738.json')) {
  assert.equal(evidence.decision, 'retire-exposed-sand-surface');
  const old = model.scenery.sourceFeatures.find(f => f.id === evidence.sourceId);
  assert(old?.kind === 'bunker', `missing retired source bunker ${evidence.sourceId}`);
  assert.deepEqual(old.ring, evidence.originalRing, `retired bunker ${evidence.sourceId} changed since review`);
  const matching = model.scenery.bunkers.filter(r => JSON.stringify(r) === JSON.stringify(evidence.originalRing));
  assert.equal(matching.length, 1, `retired bunker ${evidence.sourceId} render geometry changed`);
  model.scenery.bunkers = model.scenery.bunkers.filter(r => JSON.stringify(r) !== JSON.stringify(evidence.originalRing));
  model.scenery.sourceFeatures = model.scenery.sourceFeatures.filter(f => f.id !== evidence.sourceId);
  (model.scenery.retiredSourceFeatures ||= []).push({ id: evidence.sourceId, kind: 'bunker',
    status: 'no-visible-sand-in-2024-or-2025', observedYear: 2025, crosscheckYear: 2024,
    sourceEvidence: 'upsalabuild/mapping/retired-bunker-w438984738.json',
    sourceSha256: evidence.sources.find(s => s.year === 2025).sha256,
    sourceAbsoluteHorizontalAccuracyMetres: null, preserveTerrain: true });
  return model;
}

export function applyBridgeApproachMapping(model, evidence = read('bridge-approach-2025.json')) {
  assert.deepEqual(model.origin, evidence.frame.origin, 'bridge approach origin changed');
  assert.equal(model.mPerLat, evidence.frame.mPerLat, 'bridge approach latitude scale changed');
  assert.equal(model.mPerLon, evidence.frame.mPerLon, 'bridge approach longitude scale changed');
  for (const f of evidence.features) {
    const path = model.infra.paths.find(p => p.id === f.osmId), deck = model.infra.bridges.find(b => b.id === f.bridgeId);
    assert.equal(f.status, 'accepted', `unaccepted bridge approach ${f.id}`);
    assert(path && deck, `missing bridge approach sources ${f.id}`);
    assert.deepEqual(path.line, f.assertOriginalLine, `${f.osmId} approach changed since review`);
    assert.deepEqual(f.line.slice(0, -1), path.line.slice(0, -1), `${f.osmId}: only the terminal vertex was reviewed`);
    assert.equal(f.line.length, path.line.length, `${f.osmId}: approach vertex count changed`);
    assert(deck.line.some(p => JSON.stringify(p) === JSON.stringify(f.line.at(-1))), `${f.osmId}: approach must meet a reviewed deck endpoint`);
    Object.assign(path, { line: structuredClone(f.line), prov: f.prov, sourceId: f.sourceId,
      sourceSha256: f.sourceSha256, sourceUrl: f.sourceUrl, observedYear: f.observedYear,
      boundaryInterpretationUncertaintyM: f.boundaryInterpretationUncertaintyM,
      absoluteHorizontalAccuracyRMSEM: null, notSurveyed: true });
  }
  return model;
}

// Decks are observations, not intersections synthesized from roads and water.
// Validate the complete evidence set before changing any infrastructure so a
// changed upstream path cannot leave half of a review applied.
export function applyInfrastructureMapping(model, evidence = read('infrastructure-2025.json')) {
  assert.deepEqual(model.origin, evidence.frame.origin, 'infrastructure frame changed');
  assert.equal(model.mPerLat, evidence.frame.mPerLat, 'infrastructure latitude scale changed');
  assert.equal(model.mPerLon, evidence.frame.mPerLon, 'infrastructure longitude scale changed');
  const infra = model.infra;
  assert(infra && Array.isArray(infra.parking), 'missing infrastructure parking source');
  assert(!infra.bridgePlacement && !(infra.bridges?.length), 'infrastructure mapping already applied or bridge source changed');
  const ids = new Set(), paths = new Map((infra.paths || []).map(p => [p.id, p]));
  const bridgeRecords = [], parkingRecords = [], correctedPaths = [];
  const coordinate = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
  for (const f of evidence.features) {
    assert(!ids.has(f.id), `duplicate infrastructure evidence ${f.id}`);
    ids.add(f.id);
    assert.equal(f.status, 'accepted', `unaccepted infrastructure ${f.id}`);
    assert(['footbridge', 'parking'].includes(f.kind), `unsupported infrastructure ${f.id}`);
    assert(Array.isArray(f.ring) && f.ring.length >= 3 && f.ring.every(coordinate), `invalid infrastructure ring ${f.id}`);
    const source = evidence.sources[f.sourceId];
    assert(source && /^[a-f0-9]{64}$/.test(source.sha256), `missing infrastructure source hash ${f.id}`);
    // Source extents, pixel traces, assertion arrays and review axes stay in
    // mapping/. Only ring/line enter the local-frame migration collector.
    const scalars = Object.fromEntries(Object.entries(f).filter(([, value]) =>
      value === null || ['string', 'number', 'boolean'].includes(typeof value)));
    const record = { ...scalars, ring: f.ring.map(p => p.slice()), prov: 'dated-orthophoto-trace',
      sourceSha256: source.sha256, sourceUrl: source.url, sourceProvider: source.provider,
      sourceNativeResolutionM: source.nativeResolutionM,
      absoluteHorizontalAccuracyRMSEM: source.absoluteHorizontalAccuracyRMSEM ?? null };
    if (f.kind === 'footbridge') {
      const original = paths.get(f.osmId);
      assert(original, `missing reviewed footbridge path ${f.osmId}`);
      assert.deepEqual(original.line, f.assertOriginalLine, `${f.osmId} path changed; re-review required`);
      assert.equal(original.bridge, 'yes', `${f.osmId} bridge meaning changed; re-review required`);
      assert(Array.isArray(f.axis) && f.axis.length === 2 && f.axis.every(coordinate), `invalid deck endpoints ${f.id}`);
      record.line = f.axis.map(p => p.slice());
      record.elevationProvenance = 'unmeasured; terrain-sampled deck elevation is a rendering estimate';
      bridgeRecords.push(record);
      if (f.pathCentrelineChangeRecommended) correctedPaths.push([original, record]);
    } else {
      for (const id of [f.id, ...(f.assertNoExistingIds || [])]) {
        assert(!infra.parking.some(p => p.id === id), `parking ${id} already exists; re-review required`);
      }
      parkingRecords.push({ ...record, area: area(record.ring) });
    }
  }
  for (const [original, deck] of correctedPaths) {
    Object.assign(original, { line: deck.line.map(p => p.slice()), prov: deck.prov,
      sourceId: deck.sourceId, sourceSha256: deck.sourceSha256, sourceUrl: deck.sourceUrl,
      observedYear: deck.observedYear, boundaryInterpretationUncertaintyM: deck.boundaryInterpretationUncertaintyM,
      absoluteHorizontalAccuracyRMSEM: deck.absoluteHorizontalAccuracyRMSEM, notSurveyed: true });
  }
  infra.parking.push(...parkingRecords);
  infra.bridges = bridgeRecords;
  infra.bridgePlacement = 'mapped-only';
  return model;
}
