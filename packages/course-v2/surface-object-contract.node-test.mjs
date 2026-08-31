import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  inspectObjectRegistryPayload,
  validateObjectRegistry,
} from './object-registry.mjs';
import {
  decodeSurfaceGrid,
  encodeSurfaceGrid,
  inspectSurfacePayload,
} from './surface-grid.mjs';

function bounds() {
  return {
    minEasting: 650000,
    minNorthing: 6640000,
    minHeightRH2000: 20,
    maxEasting: 650001,
    maxNorthing: 6640001,
    maxHeightRH2000: 22,
  };
}

function surfaceFixture() {
  return encodeSurfaceGrid({
    width: 2,
    height: 2,
    sampleSpacingMetres: 1,
    primarySurfaceIds: [1, 2, 255, 3],
    secondarySurfaceIds: [4, 255, 255, 1],
    boundaryDistancesMetres: [0.123, -1, 0, 3.45],
    ownerFeatureIds: [1, 2, 0, 3],
    mowCoordinatesMetres: [2.345, 0, 0, 8],
    mowDirectionsTurns: [0.25, 0.5, 0, 1],
    moisture: [0.2, 0.4, 0, 1],
    wear: [0.1, 0.3, 0, 0.5],
    exposure: [0, 0.2, 0, 0.8],
    vegetationDensity: [0.3, 0.9, 0, 0.1],
  });
}

function objectHeader() {
  return {
    schemaVersion: 2,
    id: 'l0/0/0',
    kind: 'objects',
    owner: { type: 'ground', id: 'test-ground' },
    bounds: bounds(),
    payloadFormat: 'json-canonical-v1',
    decodedBytes: 1,
    decodedSha256: '0'.repeat(64),
    requiredFeatures: ['chunk-envelope-v2', 'object-registry-json-v1'],
    records: { content: 'object-registry', count: 1 },
  };
}

function objectRegistry() {
  return {
    schemaVersion: 1,
    groundId: 'test-ground',
    tileId: 'l0/0/0',
    records: [{
      id: 'tree-001',
      groundId: 'test-ground',
      class: 'tree',
      subtype: 'deciduous-unknown',
      easting: 650000.5,
      northing: 6640000.5,
      heightRH2000: 21,
      objectHeightMetres: 14,
      radiusMetres: 4,
      headingDegrees: 90,
      sourceId: 'field-review-2025',
      capturedAt: '2025-08-14T10:30:00Z',
      accuracyTier: 'B',
      horizontalAccuracyMetres: 0.25,
      verticalAccuracyMetres: 0.1,
      confidence: 0.95,
      reviewStatus: 'approved',
      truthZone: 'A',
      placementMethod: 'derived-lidar',
    }],
  };
}

test('surface grid round-trips lossless identifiers and bounded material fields', () => {
  const encoded = surfaceFixture();
  assert.equal(encoded.payload.byteLength, 56);
  assert.equal(encoded.maximumDistanceErrorMetres, 0.005);
  assert.equal(encoded.maximumContinuousError, 1 / 510);
  const decoded = decodeSurfaceGrid(encoded.payload, encoded.surfaceGrid);
  assert.deepEqual([...decoded.primarySurfaceIds], [1, 2, 255, 3]);
  assert.deepEqual([...decoded.secondarySurfaceIds], [4, 255, 255, 1]);
  assert.deepEqual([...decoded.ownerFeatureIds], [1, 2, 0, 3]);
  assert.ok(Math.abs(decoded.boundaryDistancesMetres[0] - 0.12) < 1e-6);
  assert.ok(Math.abs(decoded.mowCoordinatesMetres[0] - 2.35) < 1e-6);
  assert.ok(Math.abs(decoded.moisture[0] - 0.2) <= 1 / 510);
});

test('surface inspection checks declared extent, no-data normalization and class inventory', () => {
  const encoded = surfaceFixture();
  const header = { bounds: bounds(), surfaceGrid: encoded.surfaceGrid };
  assert.deepEqual(inspectSurfacePayload(encoded.payload, header), {
    validCount: 3,
    noDataCount: 1,
    surfaceIds: [1, 2, 3, 4],
    minBoundaryDistanceMetres: -1,
    maxBoundaryDistanceMetres: 3.45,
  });
  const badExtent = structuredClone(header);
  badExtent.bounds.maxEasting += 1;
  assert.throws(() => inspectSurfacePayload(encoded.payload, badExtent), /do not span/);
  const contaminated = new Uint8Array(encoded.payload);
  contaminated[2 * 14 + 10] = 1;
  assert.throws(() => inspectSurfacePayload(contaminated, header), /no-data sample/);
});

test('surface encoder rejects ambiguous IDs and non-empty no-data samples', () => {
  const ambiguous = surfaceFixture();
  const decoded = decodeSurfaceGrid(ambiguous.payload, ambiguous.surfaceGrid);
  assert.throws(() => encodeSurfaceGrid({
    width: 2,
    height: 2,
    sampleSpacingMetres: 1,
    primarySurfaceIds: [1, 1, 1, 1],
    secondarySurfaceIds: [1, 255, 255, 255],
  }), /must differ/);
  assert.throws(() => encodeSurfaceGrid({
    width: 2,
    height: 2,
    sampleSpacingMetres: 1,
    primarySurfaceIds: [1, 1, 1, 255],
    moisture: [0, 0, 0, 0.1],
  }), /must be 0 for a no-data sample/);
  assert.throws(() => encodeSurfaceGrid({
    width: 4097,
    height: 4097,
    sampleSpacingMetres: 1,
  }), /64 MiB/);
  assert.equal(decoded.primarySurfaceIds.length, 4);
});

test('published object registry preserves source, review and truth-zone evidence', () => {
  const registry = objectRegistry();
  assert.deepEqual(validateObjectRegistry(registry, objectHeader()), []);
  assert.deepEqual(inspectObjectRegistryPayload(registry, objectHeader()), {
    recordCount: 1,
    byClass: { tree: 1 },
    byTruthZone: { A: 1, B: 0, C: 0 },
  });
});

test('object registry rejects procedural, unapproved or low-accuracy zone-A placement', () => {
  const procedural = objectRegistry();
  procedural.records[0].placementMethod = 'source-constrained-procedural';
  assert.ok(validateObjectRegistry(procedural, objectHeader()).some(error => /may not be procedurally/.test(error)));

  const unapproved = objectRegistry();
  unapproved.records[0].reviewStatus = 'pending';
  assert.ok(validateObjectRegistry(unapproved, objectHeader()).some(error => /must be approved/.test(error)));

  const inaccurate = objectRegistry();
  inaccurate.records[0].accuracyTier = 'D';
  assert.ok(validateObjectRegistry(inaccurate, objectHeader()).some(error => /tier A, B or C/.test(error)));
});

test('object registry rejects records outside tile bounds and unstable ordering', () => {
  const outside = objectRegistry();
  outside.records[0].easting = 650002;
  assert.ok(validateObjectRegistry(outside, objectHeader()).some(error => /outside/.test(error)));

  const unordered = objectRegistry();
  const second = structuredClone(unordered.records[0]);
  second.id = 'boulder-001';
  second.class = 'boulder';
  unordered.records.push(second);
  const header = objectHeader();
  header.records.count = 2;
  assert.ok(validateObjectRegistry(unordered, header).some(error => /sorted by id/.test(error)));

  const impossibleDate = objectRegistry();
  impossibleDate.records[0].capturedAt = '2025-02-30';
  assert.ok(validateObjectRegistry(impossibleDate, objectHeader()).some(error => /ISO 8601/.test(error)));
});
