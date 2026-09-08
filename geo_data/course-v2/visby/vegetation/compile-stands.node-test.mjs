import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertVisbyStandInputs, visbyExclusionFeatures } from './compile-stands.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const finalSurfaces = 'visbybuild/mapping/playing-surfaces.geojson';

function inventory() {
  const bytes = new Map([
    [finalSurfaces, Buffer.from('final surfaces')],
    ['visbybuild/mapping/practice-surfaces.geojson', Buffer.from('practice field')],
    ['geo_data/course-v2/visby/reference/osm-golf-epsg3006.geojson', Buffer.from('source OSM')],
    ['geo_data/course-v2/visby/mapping/water-breakgeometry-epsg3006.geojson', Buffer.from('canonical water with islands')],
    ['terrain-stage.json', Buffer.from('staged terrain identity')],
    ['canopy.f32', Buffer.from('canopy')],
    ['ground.f32', Buffer.from('ground')],
  ]);
  const record = path => ({ path, sha256: sha256(bytes.get(path)) });
  const index = {
    surfacePath: finalSurfaces,
    inputs: [...bytes.keys()].slice(0, 4).map(record),
    terrainStageSource: record('terrain-stage.json'),
    canopySource: { data: 'canopy.f32', sha256: sha256(bytes.get('canopy.f32')) },
    groundSource: { data: 'ground.f32', sha256: sha256(bytes.get('ground.f32')) },
  };
  return { index, bytes, read: path => bytes.get(path) };
}

test('publication rejects stale final/practice surfaces, canonical water, terrain, or canopy', () => {
  const clean = inventory();
  assert.doesNotThrow(() => assertVisbyStandInputs(clean.index, clean.read));
  for (const path of clean.bytes.keys()) {
    const current = inventory();
    current.bytes.set(path, Buffer.from('changed after compilation'));
    assert.throws(() => assertVisbyStandInputs(current.index, current.read), /changed/);
  }
});

test('publication requires the complete distinct source inventory', () => {
  const duplicate = inventory();
  duplicate.index.inputs[1] = duplicate.index.inputs[0];
  assert.throws(() => assertVisbyStandInputs(duplicate.index, duplicate.read), /inventory differs/);
  const unreviewed = inventory();
  unreviewed.index.surfacePath = 'arbitrary-surfaces.geojson';
  assert.throws(() => assertVisbyStandInputs(unreviewed.index, unreviewed.read), /Unsupported/);
});

test('Visby normalization preserves dry islands and does not invent point footprints', () => {
  const outer = [[0, 0, .23], [20, 0, .23], [20, 20, .23], [0, 20, .23], [0, 0, .23]];
  const island = [[5, 5, .23], [5, 15, .23], [15, 15, .23], [15, 5, .23], [5, 5, .23]];
  const collection = {
    type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'EPSG:3006' } },
    features: [
      { id: 'water', properties: { kind: 'flattened-water-surface' }, geometry: { type: 'Polygon', coordinates: [outer, island] } },
      { id: 'approach', properties: { kind: 'approach' }, geometry: { type: 'Polygon', coordinates: [outer] } },
      { id: 'range', properties: { kind: 'driving-range' }, geometry: { type: 'Polygon', coordinates: [outer] } },
      { id: 'point-building', properties: { tags: { building: 'yes' } }, geometry: { type: 'Point', coordinates: [10, 10] } },
    ],
  };
  const features = visbyExclusionFeatures([collection]);
  assert.deepEqual(features.map(f => f.kind), ['water', 'green', 'practice']);
  assert.deepEqual(features[0].polygons[0][1], island.map(p => p.slice(0, 2)));
  assert.equal(collection.features[1].properties.kind, 'approach');
  assert.throws(() => visbyExclusionFeatures([{ ...collection, crs: undefined }]), /EPSG:3006/);
});
