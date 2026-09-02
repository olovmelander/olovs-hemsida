import assert from 'node:assert/strict';
import test from 'node:test';
import { SURFACE } from '../../apps/golf/src/engine/surface.js';
import { verifyChunkAsset } from './chunk-node.mjs';
import { compileSurfacePreviewAssets, createSurfacePreviewDescriptor } from './surface-compiler-node.mjs';
import {
  decodeSurfaceSdfDistance,
  decodeSurfaceSdfGrid,
  encodeSurfaceSdfDistance,
  encodeSurfaceSdfGrid,
  inspectSurfaceSdfPayload,
  SURFACE_SDF_INSIDE_BYTE,
} from './surface-sdf-grid.mjs';
import { validateSurfacePreview } from './surface-preview.mjs';

const FRAME = Object.freeze({
  compoundCrs: 'EPSG:5845', horizontalCrs: 'EPSG:3006', verticalCrs: 'EPSG:5613',
  origin: Object.freeze({ easting: 650008, northing: 6640008, heightRH2000: 21 }),
  axisMapping: Object.freeze({
    worldX: 'easting - originEasting',
    worldY: 'heightRH2000 - originHeightRH2000',
    worldZ: 'originNorthing - northing',
  }),
  fingerprint: 'b'.repeat(64),
});

function bounds(minEasting, minNorthing, maxEasting, maxNorthing) {
  return { minEasting, minNorthing, minHeightRH2000: 20, maxEasting, maxNorthing, maxHeightRH2000: 23 };
}

/* Four 9 x 9 tiles over a 16 m square; a fairway with a green in the middle
   straddling every tile border, so seams are exercised on every class. */
function compile(options = {}) {
  const terrainTiles = [
    { id: 'l0/0/0', bounds: bounds(650000, 6640008, 650008, 6640016), sampleSpacingMetres: 1 },
    { id: 'l0/0/1', bounds: bounds(650000, 6640000, 650008, 6640008), sampleSpacingMetres: 1 },
    { id: 'l0/1/0', bounds: bounds(650008, 6640008, 650016, 6640016), sampleSpacingMetres: 1 },
    { id: 'l0/1/1', bounds: bounds(650008, 6640000, 650016, 6640008), sampleSpacingMetres: 1 },
  ];
  return compileSurfacePreviewAssets({
    groundId: 'sdf-test', frame: FRAME, legacyBridge: { translateX: 0, translateZ: 0 }, terrainTiles,
    holes: [{ n: 3, line: [[-7, -7], [7, 7]] }],
    features: [
      { surface: SURFACE.FAIRWAY, rings: [[[-6, -6], [6, -6], [6, 6], [-6, 6]]], hole: 3 },
      { surface: SURFACE.GREEN, rings: [[[-2.5, -2.5], [2.5, -2.5], [2.5, 2.5], [-2.5, 2.5]]], hole: 3 },
    ],
    codec: 'raw',
    representation: 'class-sdf-v1',
    ...options,
  });
}

function decodedTiles(compilation) {
  return compilation.tiles.map(tile => {
    const decoded = verifyChunkAsset(tile.reference, compilation.resources.get(tile.reference.url));
    return {
      id: tile.id,
      header: decoded.header,
      inspection: decoded.inspection,
      values: decodeSurfaceSdfGrid(decoded.payload, decoded.header.surfaceSdf),
      bounds: tile.bounds,
    };
  });
}

test('distance byte encoding round-trips and puts zero on the inside side', () => {
  assert.equal(encodeSurfaceSdfDistance(4), 255);
  assert.equal(encodeSurfaceSdfDistance(-4), 0);
  assert.equal(encodeSurfaceSdfDistance(99), 255);
  assert.equal(encodeSurfaceSdfDistance(0.25), 135);
  assert.equal(encodeSurfaceSdfDistance(-0.25), 120);
  assert.ok(encodeSurfaceSdfDistance(0.25) >= SURFACE_SDF_INSIDE_BYTE);
  assert.ok(encodeSurfaceSdfDistance(-0.25) < SURFACE_SDF_INSIDE_BYTE);
  assert.ok(Math.abs(decodeSurfaceSdfDistance(encodeSurfaceSdfDistance(1.234)) - 1.234) < 4 / 255);
});

test('the encoder refuses a sample inside two channels', () => {
  const count = 4;
  const inside = new Float32Array(count).fill(1);
  assert.throws(() => encodeSurfaceSdfGrid({
    channels: [SURFACE.FAIRWAY, SURFACE.GREEN],
    distancesMetres: [inside, inside],
    routeDistancesMetres: new Float32Array(count),
    ringDistancesMetres: new Float32Array(count),
    ownerIds: new Uint8Array(count),
    width: 2, height: 2, sampleSpacingMetres: 1,
  }), /inside more than one class/);
});

test('per-class compilation is deterministic, seam-identical and carries the palette', () => {
  const first = compile();
  const second = compile();
  assert.equal(first.representation, 'class-sdf-v1');
  assert.equal(first.samplingFrame, 'canonical');
  assert.deepEqual(first.channels, [SURFACE.FAIRWAY, SURFACE.GREEN]);
  for (const [url, bytes] of first.resources) assert.deepEqual(bytes, second.resources.get(url));

  const tiles = decodedTiles(first);
  for (const tile of tiles) {
    assert.equal(tile.header.payloadFormat, 'surface-sdf-u8-v1');
    assert.deepEqual(tile.header.requiredFeatures, ['chunk-envelope-v2', 'surface-sdf-u8-v1']);
    assert.deepEqual(tile.header.surfaceSdf.channels, [SURFACE.FAIRWAY, SURFACE.GREEN]);
    assert.equal(tile.header.surfaceSdf.bytesPerSample, 5);
    assert.equal(tile.header.decodedBytes, 9 * 9 * 5);
  }
  /* every tile sees the green, so its inspection lists rough, fairway and green */
  const northWest = tiles.find(tile => tile.id === 'l0/0/0');
  assert.deepEqual(northWest.inspection.surfaceIds, [SURFACE.ROUGH, SURFACE.FAIRWAY, SURFACE.GREEN]);

  /* shared border: the east column of l0/0/0 is the west column of l0/1/0 */
  const northEast = tiles.find(tile => tile.id === 'l0/1/0');
  const byteAt = (tile, column, row) => {
    const grid = tile.header.surfaceSdf;
    const index = row * grid.width + column;
    return [
      ...grid.channels.map((_, channel) => tile.values.distancesMetres[channel][index]),
      tile.values.routeDistancesMetres[index],
      tile.values.ringDistancesMetres[index],
      tile.values.ownerIds[index],
    ];
  };
  for (let row = 0; row < 9; row++) {
    assert.deepEqual(byteAt(northWest, 8, row), byteAt(northEast, 0, row), `border row ${row}`);
  }
  const southWest = tiles.find(tile => tile.id === 'l0/0/1');
  for (let column = 0; column < 9; column++) {
    assert.deepEqual(byteAt(northWest, column, 8), byteAt(southWest, column, 0), `border column ${column}`);
  }

  /* the frame origin is the centre of the 16 m square, so world (0,0) is the
     south-east corner sample of l0/0/0: column 8, row 8 */
  const centre = 8 * 9 + 8;
  assert.equal(northWest.values.classIds[centre], SURFACE.GREEN);
  const green = northWest.values.distancesMetres[1];
  const fairway = northWest.values.distancesMetres[0];
  assert.ok(green[centre] > 2 && green[centre] <= 2.6, `green inside distance ${green[centre]}`);
  assert.ok(fairway[centre] < -2, `fairway is outside at the green centre: ${fairway[centre]}`);
  /* the ring byte is the green's own unclamped inside distance */
  assert.ok(Math.abs(northWest.values.ringDistancesMetres[centre] - green[centre]) <= 0.16);
  assert.equal(northWest.values.ownerIds[centre], 3);
  /* three metres north of the centre the fairway is inside and the green is
     outside by about half a metre: exactly one non-negative channel */
  const north = 5 * 9 + 8;
  assert.equal(northWest.values.classIds[north], SURFACE.FAIRWAY);
  assert.ok(fairway[north] > 0 && green[north] < 0);
  assert.ok(Math.abs(green[north] + 0.5) <= 0.25 + 4 / 255, `green outside distance ${green[north]}`);
  /* far corner is rough: every channel negative */
  const corner = 0;
  assert.equal(northWest.values.classIds[corner], SURFACE.ROUGH);
  assert.ok(fairway[corner] < 0 && green[corner] < 0);

  const descriptor = createSurfacePreviewDescriptor(first, {
    terrainDescriptorSha256: 'c'.repeat(64), packSha256: 'd'.repeat(64),
  });
  assert.equal(descriptor.representation, 'class-sdf-v1');
  assert.equal(descriptor.samplingFrame, 'canonical');
  assert.deepEqual(validateSurfacePreview(descriptor), []);
  assert.ok(validateSurfacePreview({ ...descriptor, representation: 'blur-v9' })
    .some(error => /representation/.test(error)));
});

test('a translated bridge is declared as legacy sampling', () => {
  const compilation = compile({ legacyBridge: { translateX: 12.5, translateZ: -3 } });
  assert.equal(compilation.samplingFrame, 'legacy-bridge');
});

test('inspection reports the occupying class histogram and refuses a corrupted double-inside sample', () => {
  const compilation = compile();
  const tile = compilation.tiles[0];
  const decoded = verifyChunkAsset(tile.reference, compilation.resources.get(tile.reference.url));
  const inspection = inspectSurfaceSdfPayload(decoded.payload, decoded.header);
  assert.equal(inspection.validCount, 81);
  assert.equal(inspection.classCounts.reduce((sum, count) => sum + count, 0), 81);
  const corrupted = new Uint8Array(decoded.payload);
  corrupted[0] = 200;
  corrupted[1] = 200;
  assert.throws(() => inspectSurfaceSdfPayload(corrupted, decoded.header), /inside 2 class channels/);
});
