import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readChunk } from './chunk-node.mjs';
import { assertValid, validateGroundManifest } from './schema.mjs';
import {
  alignTerrainGridExtent,
  compileTerrainAssets,
  readFloat32TerrainFile,
  writeTerrainAssetFiles,
} from './terrain-compiler-node.mjs';

const HASH = 'a'.repeat(64);

function terrain(width, height) {
  const values = new Float64Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      values[row * width + column] = 35 + row * 0.11 + column * 0.07;
    }
  }
  values[3 * width + 3] += 1.25;
  return values;
}

function compile() {
  return compileTerrainAssets({
    groundId: 'test-ground',
    courseSlugs: ['test-short', 'test-main'],
    heights: terrain(9, 9),
    width: 9,
    height: 9,
    originEasting: 650000,
    originNorthing: 6640008,
    tileSegments: 4,
  });
}

test('terrain compiler emits deterministic shell and LOD BVCH assets ready for a ground manifest', () => {
  const first = compile();
  const second = compile();
  assert.deepEqual(first.courseSlugs, ['test-main', 'test-short']);
  assert.equal(first.tiles.length, 5);
  assert.equal(first.resources.size, 6);
  assert.equal(first.stats.tileChunks, 5);
  assert.equal(first.stats.levels[0].tiles, 4);
  assert.equal(first.stats.levels[1].tiles, 1);
  assert.ok(first.stats.encodedBytes > 0);
  assert.ok(first.stats.decodedBytes > 0);
  assert.equal(first.stats.decodedBytes,
    first.shell.decodedBytes + first.tiles.reduce((sum, tile) => sum + tile.layers.terrain.decodedBytes, 0));
  assert.deepEqual([...first.resources.keys()], [...second.resources.keys()]);
  for (const [url, bytes] of first.resources) {
    assert.deepEqual(bytes, second.resources.get(url));
    assert.match(url, new RegExp(`/[a-f0-9]{64}\\.bvch$`));
  }

  const shell = readChunk(first.resources.get(first.shell.url));
  assert.equal(shell.header.id, 'shell');
  assert.deepEqual(shell.header.bounds, first.bounds);
  assert.equal(shell.header.owner.id, 'test-ground');
  const offsets = new Set([...first.resources.values()].map(bytes => readChunk(bytes).header.grid.heightOffsetMetres));
  assert.equal(offsets.size, 1);

  const ground = {
    $schema: '../../packages/course-v2/schemas/ground-v2.schema.json',
    schemaVersion: 2,
    groundFormat: 2,
    groundId: 'test-ground',
    requiredFeatures: ['chunk-envelope-v2', 'terrain-grid-u16-v1'],
    frame: {
      compoundCrs: 'EPSG:5845',
      horizontalCrs: 'EPSG:3006',
      verticalCrs: 'EPSG:5613',
      origin: { easting: 650000, northing: 6640008, heightRH2000: 35 },
      axisMapping: {
        worldX: 'easting - originEasting',
        worldY: 'heightRH2000 - originHeightRH2000',
        worldZ: 'originNorthing - northing',
      },
      fingerprint: HASH,
    },
    bounds: first.bounds,
    sourceManifestSha256: HASH,
    shell: first.shell,
    tiles: first.tiles,
  };
  assertValid('compiled ground manifest fields', validateGroundManifest(ground));
});

test('Float32 reader applies byte order, nodata and exact source-size budgets', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'banvy-terrain-source-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePath = join(directory, 'height.f32');
  const bytes = Buffer.alloc(16);
  [41.25, -9999, 42.5, 43.75].forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  await writeFile(sourcePath, bytes);

  const raster = await readFloat32TerrainFile(sourcePath, { width: 2, height: 2, maxSourceBytes: 16 });
  assert.deepEqual([...raster.heights], [41.25, Number.NaN, 42.5, 43.75]);
  assert.equal(raster.finiteCount, 3);
  assert.equal(raster.noDataCount, 1);
  await assert.rejects(readFloat32TerrainFile(sourcePath, { width: 3, height: 2 }), /expected 24/);
  await assert.rejects(readFloat32TerrainFile(sourcePath, {
    width: 2, height: 2, maxSourceBytes: 15,
  }), /at least 16/);
});

test('source-grid alignment expands every ground to power-of-two overlapping tile samples', () => {
  const aligned = alignTerrainGridExtent({
    requiredBounds: {
      minEasting: 130,
      minNorthing: 8700,
      maxEasting: 1030,
      maxNorthing: 9900,
    },
    sourceOriginEasting: 0,
    sourceOriginNorthing: 10000,
  });
  assert.equal(aligned.tilesX, 8);
  assert.equal(aligned.tilesY, 8);
  assert.equal(aligned.width, 2049);
  assert.equal(aligned.height, 2049);
  assert.equal(aligned.originEasting, -256);
  assert.equal(aligned.originNorthing, 10256);
  assert.deepEqual(aligned.bounds, {
    minEasting: -256,
    minNorthing: 8208,
    maxEasting: 1792,
    maxNorthing: 10256,
  });
  assert.deepEqual(aligned.pixelWindow, {
    columnOffset: -256,
    rowOffset: -256,
    width: 2049,
    height: 2049,
  });
});

test('terrain asset writer is idempotent and refuses mutable hash-path replacement', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'banvy-terrain-assets-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const compilation = compile();
  const first = await writeTerrainAssetFiles(directory, compilation);
  const second = await writeTerrainAssetFiles(directory, compilation);
  assert.deepEqual(first, second);
  assert.equal(first.length, compilation.resources.size);
  assert.deepEqual(await readFile(first[0]), compilation.resources.get([...compilation.resources.keys()].sort()[0]));

  await writeFile(first[0], Buffer.from('not the content-addressed chunk'));
  await assert.rejects(writeTerrainAssetFiles(directory, compilation), /refusing to replace/);
});

test('terrain compiler rejects unsafe ground/course identity before creating paths', () => {
  assert.throws(() => compileTerrainAssets({
    groundId: '../test',
    courseSlugs: ['test-main'],
    heights: terrain(9, 9),
    width: 9,
    height: 9,
    originEasting: 0,
    originNorthing: 8,
    tileSegments: 4,
  }), /groundId/);
  assert.throws(() => compileTerrainAssets({
    groundId: 'test-ground',
    courseSlugs: ['test-main', 'test-main'],
    heights: terrain(9, 9),
    width: 9,
    height: 9,
    originEasting: 0,
    originNorthing: 8,
    tileSegments: 4,
  }), /duplicate course slug/);
  assert.throws(() => compileTerrainAssets({
    groundId: 'test-ground',
    courseSlugs: ['test-main'],
    heights: terrain(13, 9),
    width: 13,
    height: 9,
    originEasting: 0,
    originNorthing: 8,
    tileSegments: 4,
  }), /tile counts must be powers of two/);
});
