/* Bounded geometry refresh over the already acquired ground. The same adapter
 * is called after a full build so reacquisition cannot undo reviewed cuts. */
import assert from 'node:assert/strict';
import { centroid, pointInPoly } from '../geobuild/lib.mjs';

export function applyReviewedSurfaces(model, collection, review, heightAt) {
  assert.equal(model.frame, 'local metres from EPSG:3006; east +x, north -z; origin E677700.5 N6586399.5; heights RH 2000');
  assert.equal(collection.crs?.properties?.name, 'EPSG:3006');
  assert.equal(review.groundId, 'lidingo');
  assert.equal(review.state, 'reviewed-provisional-geometry-not-surveyed');
  const result = structuredClone(model);
  const localRing = geometry => geometry.coordinates[0].map(([e,n]) => [e-677700.5,6586399.5-n]);
  const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  for (const change of review.features) {
    const hole = result.holes.find(h => h.n === change.hole);
    const source = collection.features.find(f => f.id === change.id);
    assert.equal(hole?.green.sourceFeatureId, change.id, 'green identity changed; re-review required');
    assert.deepEqual(source?.geometry, change.geometry, 'source collection has not adopted this review');
    const ring = localRing(change.geometry);
    assert(equal(hole.green.ring, localRing(change.beforeGeometry)) || equal(hole.green.ring, ring),
      'model boundary changed; re-review required');
    const centre = centroid(ring);
    assert(pointInPoly(...centre, ring), 'a concave cut needs an explicit interior target');
    hole.green = { ...hole.green, ring, c: centre };
    hole.pin = centre;
    const greenHeight = heightAt(...centre);
    assert(Number.isFinite(greenHeight));
    hole.elev.green = Math.round(greenHeight * 10) / 10;
    hole.elev.rise = Math.round((greenHeight - heightAt(...hole.tees.marks[1].c)) * 10) / 10;
    hole.note = 'Puttingytans kant är granskad mot flygbild från maj 2025. Tee-färger och flagga är visningsreferenser; dagens placering kan skilja sig.';
  }
  // The old builder rounded a valid point after its inside test. Two nominal
  // camera starts ended 2 cm outside. Find the nearest valid decimetre point;
  // observed tee polygons and the published card remain unchanged.
  for (const hole of result.holes) for (const mark of hole.tees.marks) {
    const inside = p => hole.tees.pads.some(pad => pointInPoly(...p, pad.ring));
    if (inside(mark.c)) continue;
    const choices = [];
    for (let dx=-3;dx<=3;dx++) for (let dz=-3;dz<=3;dz++) {
      const c = [Math.round((mark.c[0]+dx*.1)*10)/10, Math.round((mark.c[1]+dz*.1)*10)/10];
      if (inside(c)) choices.push({c,d:Math.hypot(c[0]-mark.c[0],c[1]-mark.c[1])});
    }
    choices.sort((a,b)=>a.d-b.d);
    assert(choices.length, `tee ${hole.n} is not a rounding-only repair`);
    mark.c = choices[0].c;
  }
  result.evidence.puttingCutReview = 'lidingobuild/mapping/putting-cuts-2025.json';
  result.evidence.reviewedTargetHeights = 'published finest Lantmäteriet terrain; 0.01 m quantization; RH 2000';
  return result;
}

/** Observed approach footprints; semi-rough is a display class, not a cut-height measurement. */
export function applyReviewedApproaches(model, collection) {
  assert.equal(collection.groundId, 'lidingo');
  assert.equal(collection.crs?.properties?.name, 'EPSG:3006');
  assert.equal(collection.state, 'reviewed-provisional-geometry-not-surveyed');
  const result = structuredClone(model);
  const ids = new Set();
  for (const source of collection.features) {
    assert.equal(source.properties.kind, 'mown_approach');
    assert.equal(source.geometry.type, 'Polygon');
    assert.equal(result.holes.find(h => h.n === source.properties.hole)?.par, 3);
    assert(!ids.has(source.id), 'duplicate approach'); ids.add(source.id);
    const feature = { id: source.id, kind: 'mown_approach', hole: source.properties.hole,
      rings: source.geometry.coordinates.map(r => r.map(([e,n]) => [e-677700.5,6586399.5-n])),
      material: source.properties.material, sourceId: 'imagery-lm-ortho', sourceEpoch: '2025-05-31',
      sourceReview: 'lidingobuild/mapping/approaches-2025.geojson', notSurveyed: true };
    const previous = result.scenery.mappedFeatures.find(f => f.id === feature.id);
    if (previous) assert.deepEqual(previous, feature, 'approach changed; re-review required');
    else result.scenery.mappedFeatures.push(feature);
  }
  result.evidence.approachCutReview = 'lidingobuild/mapping/approaches-2025.geojson';
  return result;
}
