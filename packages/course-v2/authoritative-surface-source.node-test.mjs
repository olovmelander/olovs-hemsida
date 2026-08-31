import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { compileAuthoritativeSurfaceAssets } from './authoritative-surface-compiler-node.mjs';
import { evaluateAuthoritativeSurfacePreflight } from './authoritative-surface-preflight.mjs';
import {
  assertAuthoritativeSurfaceSource,
  AUTHORITATIVE_SURFACE_UNMEASURED_FIELDS,
  validateAuthoritativeSurfaceSource,
} from './authoritative-surface-source.mjs';
import { readChunk } from './chunk-node.mjs';
import { decodeSurfaceGrid } from './surface-grid.mjs';

const SOURCE_SHA = 'a'.repeat(64);
const FRAME_SHA = 'f'.repeat(64);
const TERRAIN_SHA = 'e'.repeat(64);

function clone(value) {
  return structuredClone(value);
}

function fixture() {
  const catalog = {
    schemaVersion: 1,
    products: [{
      id: 'controlled-surface-survey',
      provider: 'Synthetic test surveyor',
      product: 'Synthetic controlled surface survey',
      homepage: 'project://test/surface-survey',
      horizontalCrs: 'EPSG:3006',
      verticalCrs: 'EPSG:5613',
      licence: {
        id: 'test-only',
        attribution: 'Synthetic fixture',
        redistribution: 'Synthetic fixture only',
        derivatives: 'Synthetic fixture only',
        reviewStatus: 'approved',
        notes: 'No real course data.',
      },
    }],
  };
  const frame = {
    compoundCrs: 'EPSG:5845',
    horizontalCrs: 'EPSG:3006',
    verticalCrs: 'EPSG:5613',
    origin: { easting: 650000, northing: 6640000, heightRH2000: 20 },
    axisMapping: {
      worldX: 'easting - originEasting',
      worldY: 'heightRH2000 - originHeightRH2000',
      worldZ: 'originNorthing - northing',
    },
    fingerprint: FRAME_SHA,
  };
  const manifest = {
    schemaVersion: 1,
    groundId: 'test-ground',
    groundName: 'Synthetic test ground',
    courseSlugs: ['test-ground'],
    targetBboxWgs84: [17, 59, 17.01, 59.01],
    legacyFrame: {
      buildDirectory: 'testbuild',
      originWgs84: { latitude: 59, longitude: 17 },
      metresPerLatitude: 111320,
      metresPerLongitude: 57400,
      heightReference: 'Synthetic test only',
      frame: 'Synthetic local frame',
    },
    canonicalFrame: {
      compoundCrs: 'EPSG:5845',
      horizontalCrs: 'EPSG:3006',
      verticalCrs: 'EPSG:5613',
      originStatus: 'approved',
      origin: { ...frame.origin },
      axisMapping: { ...frame.axisMapping },
    },
    sources: [{
      id: 'surface-survey',
      productId: 'controlled-surface-survey',
      roles: ['surface'],
      lifecycle: 'approved',
      use: 'authoritative',
      sourceUri: 'project://test/source/surface-survey',
      localPath: null,
      bboxWgs84: [17, 59, 17.01, 59.01],
      acquiredAt: '2026-08-30',
      capturedAt: '2026-08-29',
      checksum: SOURCE_SHA,
      checksumReason: null,
      replacementSourceId: null,
      accuracyTier: 'B',
      horizontalAccuracyMetres: 0.25,
      verticalAccuracyMetres: 0.1,
      notes: 'Synthetic reviewed source for contract tests only.',
    }],
    artifacts: [{
      id: 'legacy-comparison',
      kind: 'surface',
      path: 'fixtures/not-a-real-file.json',
      sha256: 'b'.repeat(64),
      derivedFrom: ['surface-survey'],
      use: 'migration-only',
      notes: 'Synthetic inventory entry.',
    }],
    blockers: [],
  };
  const source = {
    schemaVersion: 1,
    kind: 'banvy-authoritative-surface-source-v1',
    groundId: 'test-ground',
    sourceId: 'surface-survey',
    sourceSha256: SOURCE_SHA,
    frame: {
      compoundCrs: 'EPSG:5845',
      horizontalCrs: 'EPSG:3006',
      verticalCrs: 'EPSG:5613',
      fingerprint: FRAME_SHA,
    },
    replaceMigration: true,
    unmeasuredFields: [...AUTHORITATIVE_SURFACE_UNMEASURED_FIELDS],
    review: {
      status: 'approved',
      reviewedAt: '2026-08-31',
      reviewerId: 'synthetic-reviewer',
      notes: 'Synthetic topology and provenance review.',
    },
    features: [{
      id: 'hole-01-fairway',
      surfaceClass: 'fairway',
      ownerFeatureId: 301,
      holeNumber: 1,
      accuracyTier: 'B',
      horizontalAccuracyMetres: 0.3,
      reviewStatus: 'approved',
      geometry: {
        type: 'MultiPolygon',
        polygons: [{
          outer: [
            [650000, 6640000], [650008, 6640000], [650008, 6640004],
            [650000, 6640004], [650000, 6640000],
          ],
          holes: [[
            [650001, 6640001], [650001, 6640002], [650002, 6640002],
            [650002, 6640001], [650001, 6640001],
          ]],
        }],
      },
    }, {
      id: 'hole-01-green',
      surfaceClass: 'green',
      ownerFeatureId: 302,
      holeNumber: 1,
      accuracyTier: 'B',
      horizontalAccuracyMetres: 0.3,
      reviewStatus: 'approved',
      geometry: {
        type: 'MultiPolygon',
        polygons: [{
          outer: [
            [650005, 6640001], [650007, 6640001], [650007, 6640003],
            [650005, 6640003], [650005, 6640001],
          ],
          holes: [],
        }],
      },
    }],
  };
  const terrainTiles = [{
    id: 'l0/0/0',
    bounds: {
      minEasting: 650000, minNorthing: 6640000, minHeightRH2000: 18,
      maxEasting: 650004, maxNorthing: 6640004, maxHeightRH2000: 24,
    },
    sampleSpacingMetres: 1,
  }, {
    id: 'l0/0/1',
    bounds: {
      minEasting: 650004, minNorthing: 6640000, minHeightRH2000: 18,
      maxEasting: 650008, maxNorthing: 6640004, maxHeightRH2000: 24,
    },
    sampleSpacingMetres: 1,
  }];
  return { catalog, frame, manifest, source, terrainTiles };
}

test('authoritative surface source requires approved provenance and strict canonical geometry', () => {
  const value = fixture();
  assert.equal(assertAuthoritativeSurfaceSource(value.source, {
    manifest: value.manifest,
    catalog: value.catalog,
    expectedGroundId: 'test-ground',
    expectedFrameFingerprint: FRAME_SHA,
  }), value.source);

  const schema = JSON.parse(readFileSync(new URL('./schemas/authoritative-surface-source-v1.schema.json', import.meta.url)));
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  assert.equal(validate(value.source), true, JSON.stringify(validate.errors));
});

test('authoritative surface compilation is deterministic, seam-identical and leaves unmeasured mow fields at zero', () => {
  const value = fixture();
  const options = {
    source: value.source,
    manifest: value.manifest,
    catalog: value.catalog,
    frame: value.frame,
    terrainDescriptorSha256: TERRAIN_SHA,
    terrainTiles: value.terrainTiles,
    codec: 'raw',
  };
  const first = compileAuthoritativeSurfaceAssets(options);
  const second = compileAuthoritativeSurfaceAssets(options);
  assert.equal(first.provenance.replaceMigration, true);
  assert.deepEqual(first.provenance.unmeasuredFields, AUTHORITATIVE_SURFACE_UNMEASURED_FIELDS);
  assert.equal(first.stats.mowCoordinateMode, 'unmeasured-zero');
  assert.deepEqual([...first.resources], [...second.resources]);

  const decoded = first.tiles.map(tile => {
    const chunk = readChunk(first.resources.get(tile.reference.url));
    return decodeSurfaceGrid(chunk.payload, chunk.header.surfaceGrid);
  });
  assert.deepEqual(decoded.map(tile => [...tile.mowCoordinatesMetres]), decoded.map(tile =>
    Array(tile.mowCoordinatesMetres.length).fill(0)));
  assert.ok(decoded.some(tile => tile.primarySurfaceIds.includes(4)));
  assert.ok(decoded.some(tile => tile.ownerFeatureIds.includes(301)));
  assert.ok(decoded.some(tile => tile.ownerFeatureIds.includes(302)));
  for (let row = 0; row < 5; row++) {
    const left = row * 5 + 4;
    const right = row * 5;
    assert.equal(decoded[0].primarySurfaceIds[left], decoded[1].primarySurfaceIds[right]);
    assert.equal(decoded[0].secondarySurfaceIds[left], decoded[1].secondarySurfaceIds[right]);
    assert.equal(decoded[0].ownerFeatureIds[left], decoded[1].ownerFeatureIds[right]);
  }
});

test('the current Puttom inventory cannot be promoted before origin, source and licence approval', () => {
  const value = fixture();
  const manifest = JSON.parse(readFileSync(new URL('../../geo_data/course-v2/puttom/source-manifest.json', import.meta.url)));
  const catalog = JSON.parse(readFileSync(new URL('../../geo_data/course-v2/source-catalog.json', import.meta.url)));
  value.source.groundId = 'puttom';
  value.source.sourceId = 'survey-control';
  const errors = validateAuthoritativeSurfaceSource(value.source, { manifest, catalog, expectedGroundId: 'puttom' });
  assert.ok(errors.some(error => /originStatus.*approved/.test(error)));
  assert.ok(errors.some(error => /source.lifecycle.*approved/.test(error)));
  assert.ok(errors.some(error => /source.use.*authoritative/.test(error)));
});

test('migration and supplementary products can never become sole surface authority', () => {
  const value = fixture();
  value.catalog.products[0].id = 'openstreetmap';
  value.manifest.sources[0].productId = 'openstreetmap';
  const errors = validateAuthoritativeSurfaceSource(value.source, {
    manifest: value.manifest,
    catalog: value.catalog,
  });
  assert.ok(errors.some(error => /sole authority/.test(error)));
});

test('surface intake rejects promotion flags, exaggerated accuracy and invalid topology', () => {
  const value = fixture();
  value.source.replaceMigration = false;
  value.source.features[0].accuracyTier = 'A';
  value.source.features[0].horizontalAccuracyMetres = 0.05;
  value.source.features[1].geometry.polygons[0].outer = [
    [650005, 6640001], [650007, 6640003], [650005, 6640003],
    [650007, 6640001], [650005, 6640001],
  ];
  const errors = validateAuthoritativeSurfaceSource(value.source, {
    manifest: value.manifest,
    catalog: value.catalog,
  });
  assert.ok(errors.some(error => /replaceMigration.*true/.test(error)));
  assert.ok(errors.some(error => /better tier/.test(error)));
  assert.ok(errors.some(error => /better accuracy/.test(error)));
  assert.ok(errors.some(error => /self-intersects/.test(error)));
});

test('surface intake rejects unsorted or duplicate stable ids and wrong frame binding', () => {
  const value = fixture();
  value.source.features.reverse();
  value.source.features[1].ownerFeatureId = value.source.features[0].ownerFeatureId;
  const errors = validateAuthoritativeSurfaceSource(value.source, {
    manifest: value.manifest,
    catalog: value.catalog,
    expectedFrameFingerprint: '0'.repeat(64),
  });
  assert.ok(errors.some(error => /sorted by id/.test(error)));
  assert.ok(errors.some(error => /ownerFeatureId.*duplicated/.test(error)));
  assert.ok(errors.some(error => /does not match the terrain frame/.test(error)));
});

test('authoritative surface preflight becomes ready only with a bound, approved frontier and source', () => {
  const value = fixture();
  const report = evaluateAuthoritativeSurfacePreflight({
    manifest: value.manifest,
    catalog: value.catalog,
    frame: value.frame,
    terrainBounds: {
      minEasting: 650000,
      minNorthing: 6640000,
      maxEasting: 650008,
      maxNorthing: 6640004,
    },
    source: value.source,
  });
  assert.equal(report.ready, true);
  assert.equal(report.originApproved, true);
  assert.equal(report.terrainFrameBound, true);
  assert.equal(report.terrainBoundsValid, true);
  assert.equal(report.candidates[0].eligible, true);
  assert.equal(report.source.valid, true);
  assert.deepEqual(report.blockers, []);
});

test('Puttom preflight records its intentional source and origin blockers without promotion', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../geo_data/course-v2/puttom/source-manifest.json', import.meta.url)));
  const catalog = JSON.parse(readFileSync(new URL('../../geo_data/course-v2/source-catalog.json', import.meta.url)));
  const terrain = JSON.parse(readFileSync(new URL('../../apps/golf/public/v2/puttom/preview.json', import.meta.url)));
  const report = evaluateAuthoritativeSurfacePreflight({
    manifest,
    catalog,
    frame: terrain.frame,
    terrainBounds: terrain.bounds,
    terrainProvisional: terrain.provisional,
  });
  assert.equal(report.ready, false);
  assert.equal(report.originApproved, false);
  assert.equal(report.terrainFrameBound, false);
  assert.equal(report.terrainProvisional, true);
  assert.equal(report.source.present, false);
  assert.equal(report.candidates.some(candidate => candidate.eligible), false);
  assert.deepEqual(report.blockers.map(item => item.id), [
    'canonical-origin', 'terrain-frame', 'terrain-provisional', 'surface-source', 'surface-review',
  ]);
});

test('surface preflight reports malformed catalogs as blockers instead of throwing', () => {
  const report = evaluateAuthoritativeSurfacePreflight({
    catalog: { schemaVersion: 1, products: [null] },
    manifest: null,
    frame: null,
    terrainBounds: null,
  });
  assert.equal(report.ready, false);
  assert.deepEqual(report.blockers.map(item => item.id), [
    'source-catalog', 'source-manifest', 'canonical-origin', 'terrain-frame',
    'terrain-frontier', 'surface-source', 'surface-review',
  ]);
});
