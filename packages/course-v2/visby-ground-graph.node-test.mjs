import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VISBY_GROUND_GRAPH_CONFIG as config, assertVisbyAcquisition, assertVisbyReferenceExtent, assertVisbyCompilation } from './visby-ground-graph.mjs';
const read = relative => JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));
const acquisition = () => read('../../geo_data/course-v2/visby/acquisition/terrain-window.json');
const discovery = () => read('../../geo_data/course-v2/visby/acquisition/d2-discovery.json');

test('Visby acquired source identity, actual coastal bounds and two-item seam reconcile', () => {
  assertVisbyAcquisition(acquisition(), config.sourceFloat32Sha256, discovery());
  for (const mutate of [
    a => { a.raster.sha256 = '0'.repeat(64); },
    a => { a.lattice.verticalCrs = 'EPSG:4979'; },
    a => { a.lattice.originNorthing += 0.5; },
    a => { a.sourceItems.reverse(); },
    a => { a.sourceItems[0].sourceExtent.west = 680000; },
    a => { a.sourceItems[1].overviewFactorUsed = 2; },
    a => { a.sourceItems[1].sourceRaster.pixelScaleY = 2; },
    a => { a.sourceItems[1].windowPixels.row0--; },
    a => { a.sourceItems[0].noData = null; },
    a => { a.samples.finite--; },
  ]) {
    const changed = acquisition(); mutate(changed);
    assert.throws(() => assertVisbyAcquisition(changed, config.sourceFloat32Sha256, discovery()));
  }
  const changedDiscovery = discovery(); changedDiscovery.terrain.items[0].assets.data.projCode = 'EPSG:3006';
  assert.throws(() => assertVisbyAcquisition(acquisition(), config.sourceFloat32Sha256, changedDiscovery), /provenance/);
});

test('identified Visby property has broad terrain coverage without claiming unrelated OSM holes', () => {
  const reference = read('../../geo_data/course-v2/visby/reference/osm-golf-epsg3006.geojson');
  const result = assertVisbyReferenceExtent(reference);
  assert.equal(result.propertyFeatureId, 'way/199830330');
  assert.ok(result.marginMetres.north > 1009 && result.marginMetres.north < 1011);
  const changed = structuredClone(reference);
  const property = changed.features.find(f => f.id === config.propertyFeatureId);
  property.geometry.coordinates[0][0][0] = config.expectedBounds.maxEasting;
  assert.throws(() => assertVisbyReferenceExtent(changed), /minimum reference margin/);
  reference.features = reference.features.filter(f => f.id !== config.propertyFeatureId);
  assert.throws(() => assertVisbyReferenceExtent(reference), /identified property/);
});

test('retained terrain compilation accounts for every finest sample and keeps all release gates closed', () => {
  const report = read('../../geo_data/course-v2/visby/acquisition/terrain-compile.json');
  const compiled = { groundId: report.groundId, courseSlugs: report.courseSlugs, bounds: report.bounds, stats: report.compile,
    pyramid: { sourceMinimumHeightRH2000: acquisition().samples.minimumHeightRH2000, sourceMaximumHeightRH2000: acquisition().samples.maximumHeightRH2000 } };
  assertVisbyCompilation(compiled);
  assert.deepEqual(report.compile.levels.map(level => level.tiles), [256, 64, 16, 4, 1]);
  assert.equal(report.compile.sourceSamples, 16785409);
  assert.equal(report.validation.allChunksDecoded, 342);
  assert.equal(report.preview.sampleSpacingMetres, 2);
  assert.ok(Object.values(report.releaseGates).every(value => value === false));
  const changed = structuredClone(compiled); changed.stats.finiteSamples--;
  assert.throws(() => assertVisbyCompilation(changed), /missing source samples/);
  const wrongScope = structuredClone(compiled); wrongScope.courseSlugs.push('visby-9');
  assert.throws(() => assertVisbyCompilation(wrongScope), /identity/);
});

test('terrain staging CLI refuses the public runtime tree before any file write', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./compile-visby-terrain.mjs', import.meta.url)), '--out', 'apps/golf/public'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must stay beneath visbybuild\/cache/);
});
