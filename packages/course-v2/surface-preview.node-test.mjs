import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SURFACE } from '../../apps/golf/src/engine/surface.js';
import { verifyChunkAsset } from './chunk-node.mjs';
import {
  compileSurfacePreviewAssets,
  createSurfacePreviewDescriptor,
  writeSurfacePreviewBundle,
} from './surface-compiler-node.mjs';
import { decodeSurfaceGrid } from './surface-grid.mjs';
import { validateSurfacePreview } from './surface-preview.mjs';

const FRAME = Object.freeze({
  compoundCrs: 'EPSG:5845', horizontalCrs: 'EPSG:3006', verticalCrs: 'EPSG:5613',
  origin: Object.freeze({ easting: 650004, northing: 6640004, heightRH2000: 21 }),
  axisMapping: Object.freeze({
    worldX: 'easting - originEasting',
    worldY: 'heightRH2000 - originHeightRH2000',
    worldZ: 'originNorthing - northing',
  }),
  fingerprint: 'a'.repeat(64),
});
const BRIDGE = Object.freeze({ translateX: 0, translateZ: 0 });

function bounds(minEasting, minNorthing, maxEasting, maxNorthing) {
  return { minEasting, minNorthing, minHeightRH2000: 20, maxEasting, maxNorthing, maxHeightRH2000: 23 };
}

function fixture() {
  const terrainTiles = [
    { id: 'l0/0/0', bounds: bounds(650000, 6640004, 650004, 6640008), sampleSpacingMetres: 1 },
    { id: 'l0/0/1', bounds: bounds(650000, 6640000, 650004, 6640004), sampleSpacingMetres: 1 },
    { id: 'l0/1/0', bounds: bounds(650004, 6640004, 650008, 6640008), sampleSpacingMetres: 1 },
    { id: 'l0/1/1', bounds: bounds(650004, 6640000, 650008, 6640004), sampleSpacingMetres: 1 },
  ];
  const ring = [[-2, -2], [2, -2], [2, 2], [-2, 2]];
  return compileSurfacePreviewAssets({
    groundId: 'surface-test', frame: FRAME, legacyBridge: BRIDGE, terrainTiles,
    holes: [{ n: 1, line: [[-4, -4], [4, 4]] }],
    features: [
      { surface: SURFACE.FAIRWAY, rings: [[[-4, -4], [4, -4], [4, 4], [-4, 4]]], hole: 1 },
      { surface: SURFACE.GREEN, rings: [ring], hole: 1 },
    ],
    codec: 'raw',
  });
}

test('surface compiler produces deterministic, seam-identical BVCH tiles', () => {
  const first = fixture();
  const second = fixture();
  assert.deepEqual([...first.resources.keys()], [...second.resources.keys()]);
  for (const [url, bytes] of first.resources) {
    assert.deepEqual(bytes, second.resources.get(url));
  }
  assert.equal(first.stats.tileChunks, 4);
  assert.equal(first.stats.previewWidth, 9);
  assert.equal(first.stats.previewHeight, 9);
  assert.ok(first.stats.decodedBytes > 0);

  for (const tile of first.tiles) {
    const decoded = verifyChunkAsset(tile.reference, first.resources.get(tile.reference.url));
    assert.equal(decoded.header.kind, 'surface');
    assert.equal(decoded.header.id, tile.id);
    const values = decodeSurfaceGrid(decoded.payload, decoded.header.surfaceGrid);
    assert.equal(values.primarySurfaceIds.length, 25);
    assert.ok(values.primarySurfaceIds.includes(SURFACE.GREEN));
    assert.ok(values.secondarySurfaceIds.every((id, index) =>
      id === 255 || id !== values.primarySurfaceIds[index]));
  }
  const payload = id => verifyChunkAsset(
    first.tiles.find(tile => tile.id === id).reference,
    first.resources.get(first.tiles.find(tile => tile.id === id).reference.url),
  ).payload;
  const west = payload('l0/0/0'), east = payload('l0/1/0');
  for (let row = 0; row < 5; row++) {
    assert.deepEqual(west.subarray((row * 5 + 4) * 14, (row * 5 + 5) * 14), east.subarray(row * 5 * 14, (row * 5 + 1) * 14));
  }
  const north = payload('l0/0/0'), south = payload('l0/0/1');
  for (let column = 0; column < 5; column++) {
    assert.deepEqual(north.subarray((4 * 5 + column) * 14, (4 * 5 + column + 1) * 14), south.subarray(column * 14, (column + 1) * 14));
  }
});

test('surface preview descriptor locks migration provenance and immutable output', async () => {
  const compiled = fixture();
  const descriptor = createSurfacePreviewDescriptor(compiled, {
    label: 'Migration fixture', terrainDescriptorSha256: 'b'.repeat(64), packSha256: 'c'.repeat(64),
  });
  assert.deepEqual(validateSurfacePreview(descriptor), []);
  assert.equal(descriptor.provisional, true);
  assert.equal(descriptor.source.packSha256, 'c'.repeat(64));
  const root = await mkdtemp(join(tmpdir(), 'banvy-surface-preview-'));
  try {
    const first = await writeSurfacePreviewBundle(root, compiled, {
      label: 'Migration fixture', terrainDescriptorSha256: 'b'.repeat(64), packSha256: 'c'.repeat(64),
    });
    const persisted = JSON.parse(await readFile(first.descriptorPath, 'utf8'));
    assert.deepEqual(validateSurfacePreview(persisted), []);
    assert.equal(first.writtenAssets.length, compiled.resources.size);
    await writeSurfacePreviewBundle(root, compiled, {
      label: 'Migration fixture', terrainDescriptorSha256: 'b'.repeat(64), packSha256: 'c'.repeat(64),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('surface preview rejects claims of production approval', () => {
  const descriptor = structuredClone(createSurfacePreviewDescriptor(fixture(), {
    terrainDescriptorSha256: 'b'.repeat(64), packSha256: 'c'.repeat(64),
  }));
  descriptor.provisional = false;
  assert.match(validateSurfacePreview(descriptor).join('\n'), /must remain true/);
  descriptor.provisional = true;
  descriptor.source.kind = 'survey-approved';
  assert.match(validateSurfacePreview(descriptor).join('\n'), /gpk1-vector-migration/);
});
