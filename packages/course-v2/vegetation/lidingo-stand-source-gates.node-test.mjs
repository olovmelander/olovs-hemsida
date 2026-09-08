import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { assertLidingoStandSourceHashes } from './compile-lidingo-stands.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const paths = ['lidingobuild/mapping/playing-surfaces.geojson',
    'lidingobuild/mapping/facilities.geojson',
    'lidingobuild/mapping/infrastructure.geojson',
    'geo_data/course-v2/lidingo/reference/osm-golf-epsg3006.geojson',
    'geo_data/course-v2/lidingo/reference/osm-context-epsg3006.geojson',
    'geo_data/course-v2/lidingo/mapping/water-breakgeometry-epsg3006.geojson'];
  const files = new Map([...paths, 'canopy.f32', 'ground.f32'].map(path => [path, Buffer.from(`retained:${path}`)]));
  return { files, index: { inputs: paths.map(path => ({ path, sha256: sha256(files.get(path)) })),
    canopySource: { data: 'canopy.f32', sha256: sha256(files.get('canopy.f32')) },
    groundSource: { data: 'ground.f32', sha256: sha256(files.get('ground.f32')) } } };
}

test('stand graph attachment rejects stale playing surfaces, context, canopy and ground', () => {
  const clean = fixture();
  assert.doesNotThrow(() => assertLidingoStandSourceHashes(clean.index, path => clean.files.get(path)));
  for (const target of clean.files.keys()) {
    const changed = fixture();
    changed.files.set(target, Buffer.from('new source generation'));
    assert.throws(() => assertLidingoStandSourceHashes(changed.index, path => changed.files.get(path)), /changed/);
  }
});

test('dropping or duplicating source registration cannot bypass the stale-exclusion gate', () => {
  const missing = fixture();
  missing.index.inputs.pop();
  assert.throws(() => assertLidingoStandSourceHashes(missing.index, path => missing.files.get(path)), /inventory is incomplete/);
  const duplicated = fixture();
  duplicated.index.inputs[0] = duplicated.index.inputs[1];
  assert.throws(() => assertLidingoStandSourceHashes(duplicated.index, path => duplicated.files.get(path)), /inventory is incomplete/);
});
