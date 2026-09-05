/* Reviewed additions to the shared Upsala ground. Called by reconcile.mjs.
 * Evidence, original geometry and uncertainty live in mapping/. No source rasters
 * are distributed. Geometry assertions refuse stale decisions after an OSM edit.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { sweref99TmToLatLon } from '../packages/course-geo/chmv2/projection.mjs';
import { centroid, polyArea, pointInPoly } from './lib.mjs';

const read = name => JSON.parse(fs.readFileSync(new URL(`mapping/${name}`, import.meta.url)));
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
  h17.green = { ...h17.green, ring: greenRing, area: area(greenRing), prov: 'dated-orthophoto-trace', sourceId: g.id, evidence: g.properties };
  const tee = id => {
    const f = get(id), ring = projectedRing(f), [cx, cz] = centroid(ring);
    return { ring, cx, cz, ang: 0, prov: 'dated-orthophoto-trace', sourceId: id, evidence: f.properties, preserveTerrain: true };
  };
  model.holes.find(h => h.n === 8).tees.pads = [tee('upsala-stora-hole8-tee-complex-ne-ortho2024'), tee('upsala-stora-hole8-tee-sw-2025')];
  // The visible upper tee corrects a pad drawn on a road. Its shadowed southern
  // edge remains explicitly approximate; daily tee markers are still provisional.
  const h9 = model.holes.find(h => h.n === 9);
  h9.tees.pads = [tee('upsala-stora-hole9-tee-upper-2025')];
  for (const h of model.holes) {
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
  model.mappingRevision = 'upsala-reviewed-2024-2025-v1';
  return model;
}
