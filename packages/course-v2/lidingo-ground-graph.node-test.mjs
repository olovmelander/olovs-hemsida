import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { LIDINGO_GROUND_GRAPH_CONFIG as config, assertLidingoAcquisition,
  assertLidingoReferenceExtent, assertLidingoCompilation } from './lidingo-ground-graph.mjs';
import { TERRAIN_WINDOW_SPECS } from '../course-geo/acquisition/terrain-window-specs.mjs';

const acquisition = () => JSON.parse(readFileSync(new URL('../../geo_data/course-v2/lidingo/acquisition/terrain-window.json', import.meta.url), 'utf8'));
const reference = () => JSON.parse(readFileSync(new URL('../../geo_data/course-v2/lidingo/reference/osm-golf-epsg3006.geojson', import.meta.url), 'utf8'));

test('Lidingö retains the independently stated acquisition lattice and source identity', () => {
  const evidence = acquisition();
  assert.equal(assertLidingoAcquisition(evidence, evidence.raster.sha256), evidence);
  const acquiredSpec = TERRAIN_WINDOW_SPECS.lidingo;
  for (const field of ['width', 'height', 'sampleSpacingMetres', 'originEasting', 'originNorthing']) {
    assert.equal(acquiredSpec[field], config[field], `acquisition/compiler drift at ${field}`);
  }
  assert.deepEqual(acquiredSpec.pixelEdgeWindow, config.pixelEdgeWindow);
  assert.deepEqual(acquiredSpec.sourceItemIds, config.sourceItemIds);
  assert.equal(config.originEasting, config.pixelEdgeWindow.west + 0.5);
  assert.equal(config.originNorthing, config.pixelEdgeWindow.north - 0.5);
});

test('changing both raster and evidence checksum cannot silently adopt another terrain source', () => {
  const changed = acquisition();
  changed.raster.sha256 = 'a'.repeat(64);
  assert.throws(() => assertLidingoAcquisition(changed, changed.raster.sha256), /pinned acquired raster/);
});

test('half-sample shifts, wrong CRS, wrong source item and overview substitution fail acquisition gates', () => {
  const mutations = [
    evidence => { evidence.lattice.originEasting += 0.5; },
    evidence => { evidence.lattice.verticalCrs = 'EPSG:4979'; },
    evidence => { evidence.lattice.pixelEdgeWindow.north -= 1; },
    evidence => { evidence.sourceItems[0].id = '663_64'; },
    evidence => { evidence.sourceItems[0].overviewFactorUsed = 2; },
    evidence => { evidence.samples.finite -= 1; },
  ];
  for (const mutate of mutations) {
    const changed = acquisition();
    mutate(changed);
    assert.throws(() => assertLidingoAcquisition(changed, config.sourceFloat32Sha256));
  }
});

test('retained route and surface reference clears the terrain window and has every hole', () => {
  const extent = assertLidingoReferenceExtent(reference());
  assert.equal(extent.routeCount, 18);
  assert.ok(Math.min(...Object.values(extent.marginMetres)) > 400);
  const changed = reference();
  const route = changed.features.find(feature => feature.properties.tags.golf === 'hole');
  route.geometry.coordinates[0][0] = config.expectedBounds.minEasting - 1;
  assert.throws(() => assertLidingoReferenceExtent(changed), /minimum margin/);
});

test('duplicate or missing routes and implicit coordinate systems cannot pass reference gates', () => {
  const missing = reference();
  missing.features = missing.features.filter(feature => feature.properties.tags.golf !== 'hole' || feature.properties.tags.ref !== '18');
  assert.throws(() => assertLidingoReferenceExtent(missing), /every hole/);
  const duplicated = reference();
  duplicated.features.push(duplicated.features.find(feature => feature.properties.tags.golf === 'hole'));
  assert.throws(() => assertLidingoReferenceExtent(duplicated), /every hole/);
  const wrongFrame = reference();
  delete wrongFrame.crs;
  assert.throws(() => assertLidingoReferenceExtent(wrongFrame), /EPSG:3006/);
});

test('staged compiled evidence is complete and remains behind the course release gates', () => {
  const report = JSON.parse(readFileSync(new URL('../../geo_data/course-v2/lidingo/acquisition/terrain-compile.json', import.meta.url), 'utf8'));
  const compiled = {
    groundId: report.groundId, courseSlugs: ['lidingo'], bounds: report.bounds, stats: report.compile,
    pyramid: { sourceMinimumHeightRH2000: report.bounds.minHeightRH2000, sourceMaximumHeightRH2000: report.bounds.maxHeightRH2000 },
  };
  assert.equal(assertLidingoCompilation(compiled), compiled);
  assert.equal(report.state, 'staged-terrain-only');
  assert.ok(Object.values(report.releaseGates).every(value => value === false));
  const missing = structuredClone(compiled);
  missing.stats.finiteSamples -= 1;
  assert.throws(() => assertLidingoCompilation(missing), /missing source samples/);
});
