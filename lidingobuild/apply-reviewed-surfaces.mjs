/* Integrate the completed September 8 review without replacing the newer
 * September 9 tee, OB, water, building or stand work. Source coordinates are
 * EPSG:3006; the model retains its exact local translation and RH 2000 heights. */
import assert from 'node:assert/strict';
import { centroid, pointInPoly, polyArea } from '../geobuild/lib.mjs';

export const REVIEW_PATH = 'lidingobuild/mapping/putting-cuts-2025.json';
export const APPROACH_PATH = 'lidingobuild/mapping/approaches-2025.geojson';
export const BUNKER_PATH = 'lidingobuild/mapping/bunker-additions-2025.geojson';
export const BUNKER_ID = 'lidingo-bunker-13-green-lm2025';
const FRAME = 'local metres from EPSG:3006; east +x, north -z; origin E677700.5 N6586399.5; heights RH 2000';
const local = ([e, n]) => [e - 677700.5, 6586399.5 - n];
const round = n => Math.round(n * 1000) / 1000;
const closeRing = points => [...points, [...points[0]]];
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The older branch rounded source world coordinates to millimetres. Accept
// only that known precision difference, never a different outline or ordering.
export function sameReviewedRing(a, b) {
  return a.length === b.length && a.every((p, i) =>
    p.length === b[i].length && p.every((v, j) => Number.isFinite(v) && Math.abs(v - b[i][j]) <= 0.000501));
}

export function validateReviewSources(review, approaches, bunkers) {
  assert.equal(review.groundId, 'lidingo');
  assert.equal(review.horizontalCrs, 'EPSG:3006');
  assert.equal(review.state, 'reviewed-provisional-geometry-not-surveyed');
  assert.equal(review.sourceCapture.sha256, 'bcec0932c68497b690fe1020e3426ca2596519ebf5875eb3a65ed0c120660c2e');
  assert.equal(review.features.length, 14);
  for (const change of review.features) {
    const crop = change.sourceCrop, w = crop.worldfile;
    const points = change.pixels.map(([x, y]) => [round(w[4] + w[0] * (crop.left + x)), round(w[5] + w[3] * (crop.top + y))]);
    assert.deepEqual(change.geometry, { type: 'Polygon', coordinates: [closeRing(points)] }, 'putting trace must reproduce its source pixels');
    assert.ok(Math.abs(Math.abs(polyArea(points.map(local))) - change.afterAreaM2) < .006);
  }
  assert.equal(approaches.groundId, 'lidingo');
  assert.equal(approaches.features.length, 6);
  assert.equal(approaches.crs.properties.name, 'EPSG:3006');
  for (const f of approaches.features) {
    const p = f.properties, c = p.sourceCrop, w = c.worldfile;
    const points = p.displayPixels.map(([x, y]) => [round(w[4] + w[0] * (c.left + x * c.width / c.displayWidth)),
      round(w[5] + w[3] * (c.top + y * c.height / c.displayHeight))]);
    assert.deepEqual(f.geometry, { type: 'Polygon', coordinates: [closeRing(points)] }, 'approach trace must reproduce its source pixels');
  }
  assert.equal(bunkers.groundId, 'lidingo');
  assert.equal(bunkers.features.length, 1);
  assert.equal(bunkers.features[0].id, BUNKER_ID);
  assert.equal(bunkers.features[0].properties.hole, 13);
  assert.equal(bunkers.features[0].properties.captureDate, '2025-05-31');
  assert.equal(bunkers.features[0].properties.sourceImageSha256, review.sourceCapture.sha256);
}

export function adoptReviewedSource(collection, review, bunkers) {
  assert.equal(collection.crs?.properties?.name, 'EPSG:3006');
  const result = structuredClone(collection);
  assert.equal(new Set(result.features.map(f => f.id)).size, result.features.length);
  for (const change of review.features) {
    const f = result.features.find(f => f.id === change.id);
    assert.equal(f?.properties.kind, 'green');
    assert.equal(f.properties.hole, change.hole);
    assert.ok(sameReviewedRing(f.geometry.coordinates[0], change.beforeGeometry.coordinates[0]) || equal(f.geometry, change.geometry),
      `green ${change.hole}: source boundary changed; re-review required`);
    f.geometry = structuredClone(change.geometry);
    f.properties = { kind: 'green', hole: change.hole, sourceId: 'imagery-lm-ortho', observedYear: 2025,
      captureDate: review.sourceCapture.captureDate, sourceImageSha256: review.sourceCapture.sha256,
      sourceReview: REVIEW_PATH, reviewStatus: 'machine-visual-review', notSurveyed: true,
      method: 'manual-image-putting-cut-digitization', interpretationUncertaintyMetres: change.interpretationUncertaintyMetres,
      registrationAccuracy: 'not independently checked', areaSquareMetres: change.afterAreaM2,
      geometryReview: change.review, licence: review.sourceCapture.licence.id, attribution: review.sourceCapture.licence.attribution };
  }
  for (const f of bunkers.features) {
    const previous = result.features.find(p => p.id === f.id);
    if (previous) assert.deepEqual(previous, f, 'bunker changed; re-review required');
    else result.features.push(structuredClone(f));
  }
  return result;
}

export function applyReviewedSurfaces(model, collection, review, approaches, bunkers, heightAt) {
  assert.equal(model.frame, FRAME);
  const result = structuredClone(model);
  for (const change of review.features) {
    const hole = result.holes.find(h => h.n === change.hole);
    const source = collection.features.find(f => f.id === change.id);
    assert.equal(hole?.green.sourceFeatureId, change.id);
    assert.deepEqual(source?.geometry, change.geometry, 'source collection must first adopt review');
    const ring = change.geometry.coordinates[0].map(local);
    assert.ok(sameReviewedRing(hole.green.ring, change.beforeGeometry.coordinates[0].map(local)) || equal(hole.green.ring, ring),
      `green ${change.hole}: model boundary changed; re-review required`);
    const centre = centroid(ring);
    assert.ok(pointInPoly(...centre, ring), 'reviewed green needs an interior target');
    hole.green = { ...hole.green, ring, c: centre };
    hole.pin = centre;
    const greenHeight = heightAt(...centre), teeHeight = heightAt(...hole.tees.marks[1].c);
    assert.ok(Number.isFinite(greenHeight) && Number.isFinite(teeHeight));
    hole.elev.green = Math.round(greenHeight * 10) / 10;
    hole.elev.rise = Math.round((greenHeight - teeHeight) * 10) / 10;
    hole.note = 'Putting- och teeytor granskade mot flygbild från maj 2025. Färgmarkörer och flagga är visningsreferenser; dagens placeringar är inte inmätta.';
  }
  for (const source of bunkers.features) {
    const hole = result.holes.find(h => h.n === source.properties.hole);
    const bunker = { ring: source.geometry.coordinates[0].map(local), sourceFeatureId: source.id };
    const previous = hole.bunkers.find(b => b.sourceFeatureId === source.id);
    if (previous) assert.deepEqual(previous, bunker, 'bunker changed; re-review required');
    else hole.bunkers.push(bunker);
  }
  for (const source of approaches.features) {
    assert.equal(result.holes.find(h => h.n === source.properties.hole)?.par, 3);
    const feature = { id: source.id, kind: 'mown_approach', hole: source.properties.hole,
      rings: source.geometry.coordinates.map(r => r.map(local)), material: source.properties.material,
      sourceId: 'imagery-lm-ortho', sourceEpoch: '2025-05-31', sourceReview: APPROACH_PATH, notSurveyed: true };
    const previous = result.scenery.mappedFeatures.find(f => f.id === source.id);
    if (previous) assert.deepEqual(previous, feature, 'approach changed; re-review required');
    else result.scenery.mappedFeatures.push(feature);
  }
  result.evidence.puttingCutReview = REVIEW_PATH;
  result.evidence.approachCutReview = APPROACH_PATH;
  result.evidence.newBunkerReview = BUNKER_PATH;
  result.evidence.reviewedTargetHeights = 'published finest Lantmäteriet terrain; RH 2000; unchanged terrain';
  return result;
}

export function preservedModel(model, review) {
  const result = structuredClone(model), holes = new Set(review.features.map(f => f.hole));
  for (const hole of result.holes) {
    if (holes.has(hole.n)) {
      delete hole.green.ring; delete hole.green.c; delete hole.pin; delete hole.note;
      delete hole.elev.green; delete hole.elev.rise;
    }
    hole.bunkers = hole.bunkers.filter(b => b.sourceFeatureId !== BUNKER_ID);
  }
  result.scenery.mappedFeatures = result.scenery.mappedFeatures.filter(f => f.kind !== 'mown_approach');
  for (const key of ['puttingCutReview', 'approachCutReview', 'newBunkerReview', 'reviewedTargetHeights']) delete result.evidence[key];
  return result;
}

export function preservedSource(collection, review) {
  const result = structuredClone(collection), ids = new Set([...review.features.map(f => f.id), BUNKER_ID]);
  result.features = result.features.filter(f => !ids.has(f.id));
  return result;
}

export function preservedGround(ground) {
  const result = structuredClone(ground);
  delete result.sourceManifestSha256;
  for (const tile of result.tiles) if (tile.lod === 0) delete tile.layers.stands;
  return result;
}
