import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { assetReferenceForChunk, writeChunk } from './chunk-node.mjs';
import { compileTerrainPyramid } from './terrain-pyramid.mjs';

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DEFAULT_MAX_SOURCE_BYTES = 512 * 1024 * 1024;
const TERRAIN_FEATURES = Object.freeze(['chunk-envelope-v2', 'terrain-grid-u16-v1']);

function sourceDimensions(width, height) {
  if (!Number.isSafeInteger(width) || width < 2 || width > 1_000_000) {
    throw new RangeError('width must be an integer from 2 to 1000000');
  }
  if (!Number.isSafeInteger(height) || height < 2 || height > 1_000_000) {
    throw new RangeError('height must be an integer from 2 to 1000000');
  }
  const count = width * height;
  if (!Number.isSafeInteger(count)) throw new RangeError('raster sample count exceeds the safe integer range');
  return count;
}

function powerOfTwo(value) {
  return Number.isSafeInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

function nextPowerOfTwo(value) {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function terrainTileCounts(width, height, tileSegments) {
  if (!Number.isSafeInteger(tileSegments) || tileSegments < 2 ||
      (tileSegments & (tileSegments - 1)) !== 0) {
    throw new RangeError('tileSegments must be a power-of-two integer of at least 2');
  }
  const tilesX = (width - 1) / tileSegments;
  const tilesY = (height - 1) / tileSegments;
  if (!Number.isSafeInteger(tilesX) || !Number.isSafeInteger(tilesY) || tilesX < 1 || tilesY < 1) {
    throw new RangeError('source dimensions must equal tileSegments * tileCount + 1');
  }
  return { tilesX, tilesY };
}

function id(value, label) {
  if (!ID.test(value || '')) throw new TypeError(`${label} must be a lowercase kebab-case id`);
  return value;
}

function sortedCourseSlugs(values) {
  if (!Array.isArray(values) || !values.length) throw new TypeError('courseSlugs must be a non-empty array');
  const result = values.map((value, index) => id(value, `courseSlugs[${index}]`)).sort();
  for (let index = 1; index < result.length; index++) {
    if (result[index - 1] === result[index]) throw new Error(`duplicate course slug ${result[index]}`);
  }
  return Object.freeze(result);
}

function terrainChunk({ groundId, tile, chunkId, bounds, assetDirectory, codec }) {
  const chunk = writeChunk({
    header: {
      schemaVersion: 2,
      id: chunkId,
      kind: 'terrain',
      owner: { type: 'ground', id: groundId },
      bounds,
      payloadFormat: 'terrain-grid-u16-le-v1',
      requiredFeatures: [...TERRAIN_FEATURES],
      grid: { ...tile.grid },
    },
    payload: tile.payload,
    codec,
  });
  const reference = assetReferenceForChunk(chunk, {
    kind: 'terrain',
    directory: assetDirectory,
  });
  return Object.freeze({ chunk, reference });
}

function fullBounds(pyramid) {
  return Object.freeze({
    minEasting: pyramid.originEasting,
    minNorthing: pyramid.originNorthing - (pyramid.height - 1) * pyramid.sampleSpacingMetres,
    minHeightRH2000: pyramid.sourceMinimumHeightRH2000,
    maxEasting: pyramid.originEasting + (pyramid.width - 1) * pyramid.sampleSpacingMetres,
    maxNorthing: pyramid.originNorthing,
    maxHeightRH2000: pyramid.sourceMaximumHeightRH2000,
  });
}

/**
 * Expand required sample-coordinate bounds to power-of-two terrain-tile counts
 * on an existing north-up source grid. The returned inclusive pixel window is
 * directly suitable for a 1 m Float32 extraction: N tiles require N*256+1
 * samples so adjacent BVCH tiles share their boundary row/column.
 */
export function alignTerrainGridExtent({
  requiredBounds,
  sourceOriginEasting,
  sourceOriginNorthing,
  sampleSpacingMetres = 1,
  tileSegments = 256,
} = {}) {
  if (!requiredBounds || ![
    requiredBounds.minEasting,
    requiredBounds.minNorthing,
    requiredBounds.maxEasting,
    requiredBounds.maxNorthing,
  ].every(Number.isFinite)) throw new TypeError('requiredBounds must contain finite projected coordinates');
  if (requiredBounds.minEasting >= requiredBounds.maxEasting ||
      requiredBounds.minNorthing >= requiredBounds.maxNorthing) {
    throw new RangeError('requiredBounds minimums must be below maximums');
  }
  if (!Number.isFinite(sourceOriginEasting) || !Number.isFinite(sourceOriginNorthing)) {
    throw new TypeError('source sample origin must be finite');
  }
  if (!Number.isFinite(sampleSpacingMetres) || sampleSpacingMetres <= 0) {
    throw new RangeError('sampleSpacingMetres must be positive and finite');
  }
  terrainTileCounts(tileSegments + 1, tileSegments + 1, tileSegments);
  const tileSpan = tileSegments * sampleSpacingMetres;
  let westTile = Math.floor((requiredBounds.minEasting - sourceOriginEasting) / tileSpan);
  let eastTile = Math.ceil((requiredBounds.maxEasting - sourceOriginEasting) / tileSpan);
  let northTile = Math.floor((sourceOriginNorthing - requiredBounds.maxNorthing) / tileSpan);
  let southTile = Math.ceil((sourceOriginNorthing - requiredBounds.minNorthing) / tileSpan);
  const tilesX = nextPowerOfTwo(Math.max(1, eastTile - westTile));
  const tilesY = nextPowerOfTwo(Math.max(1, southTile - northTile));
  westTile -= Math.floor((tilesX - (eastTile - westTile)) / 2);
  northTile -= Math.floor((tilesY - (southTile - northTile)) / 2);
  eastTile = westTile + tilesX;
  southTile = northTile + tilesY;
  const originEasting = sourceOriginEasting + westTile * tileSpan;
  const originNorthing = sourceOriginNorthing - northTile * tileSpan;
  const width = tilesX * tileSegments + 1;
  const height = tilesY * tileSegments + 1;
  return Object.freeze({
    originEasting,
    originNorthing,
    sampleSpacingMetres,
    tileSegments,
    tilesX,
    tilesY,
    width,
    height,
    bounds: Object.freeze({
      minEasting: originEasting,
      minNorthing: originNorthing - (height - 1) * sampleSpacingMetres,
      maxEasting: originEasting + (width - 1) * sampleSpacingMetres,
      maxNorthing: originNorthing,
    }),
    pixelWindow: Object.freeze({
      columnOffset: westTile * tileSegments,
      rowOffset: northTile * tileSegments,
      width,
      height,
    }),
  });
}

/**
 * Compile one north-to-south EPSG:5845 height grid into immutable BVCH terrain
 * resources plus the shell/tile fields consumed by a ground-v2 manifest.
 */
export function compileTerrainAssets({
  groundId: requestedGroundId,
  courseSlugs: requestedCourseSlugs,
  heights,
  width,
  height,
  originEasting,
  originNorthing,
  sampleSpacingMetres = 1,
  tileSegments = 256,
  heightScaleMetres = 0.01,
  maximumLod,
  assetDirectory,
  codec = 'deflate-raw',
} = {}) {
  const groundId = id(requestedGroundId, 'groundId');
  const courseSlugs = sortedCourseSlugs(requestedCourseSlugs);
  const directory = assetDirectory || `grounds/${groundId}/terrain`;
  const tileCounts = terrainTileCounts(width, height, tileSegments);
  if (!powerOfTwo(tileCounts.tilesX) || !powerOfTwo(tileCounts.tilesY)) {
    throw new RangeError(
      'authoritative terrain tile counts must be powers of two; use alignTerrainGridExtent before extraction',
    );
  }
  const pyramid = compileTerrainPyramid({
    heights,
    width,
    height,
    originEasting,
    originNorthing,
    sampleSpacingMetres,
    tileSegments,
    heightScaleMetres,
    maximumLod,
  });
  const bounds = fullBounds(pyramid);
  const resources = new Map();

  const shellAsset = terrainChunk({
    groundId,
    tile: pyramid.shell,
    chunkId: 'shell',
    bounds,
    assetDirectory: directory,
    codec,
  });
  resources.set(shellAsset.reference.url, shellAsset.chunk);

  const tiles = [];
  const levelStats = [];
  for (const level of pyramid.levels) {
    let encodedBytes = 0;
    let decodedBytes = 0;
    for (const tile of level.tiles) {
      const asset = terrainChunk({
        groundId,
        tile,
        chunkId: tile.id,
        bounds: tile.bounds,
        assetDirectory: directory,
        codec,
      });
      const prior = resources.get(asset.reference.url);
      if (prior && !Buffer.from(prior).equals(Buffer.from(asset.chunk))) {
        throw new Error(`content-address collision for ${asset.reference.url}`);
      }
      resources.set(asset.reference.url, asset.chunk);
      encodedBytes += asset.reference.bytes;
      decodedBytes += asset.reference.decodedBytes;
      tiles.push(Object.freeze({
        id: tile.id,
        lod: tile.lod,
        bounds: tile.bounds,
        geometricErrorMetres: tile.grid.geometricErrorMetres,
        courses: courseSlugs,
        layers: Object.freeze({ terrain: asset.reference, surface: null, objects: null }),
      }));
    }
    levelStats.push(Object.freeze({
      lod: level.lod,
      sampleSpacingMetres: level.sampleSpacingMetres,
      tiles: level.tiles.length,
      encodedBytes,
      decodedBytes,
    }));
  }

  let encodedBytes = 0;
  let decodedBytes = 0;
  for (const resource of resources.values()) encodedBytes += resource.byteLength;
  decodedBytes = shellAsset.reference.decodedBytes +
    tiles.reduce((total, tile) => total + tile.layers.terrain.decodedBytes, 0);

  return Object.freeze({
    groundId,
    courseSlugs,
    bounds,
    shell: shellAsset.reference,
    tiles: Object.freeze(tiles),
    resources,
    pyramid,
    stats: Object.freeze({
      sourceSamples: width * height,
      finiteSamples: pyramid.finiteCount,
      tileChunks: tiles.length,
      rootTiles: pyramid.levels.at(-1).tiles.length,
      uniqueChunks: resources.size,
      encodedBytes,
      decodedBytes,
      shellEncodedBytes: shellAsset.reference.bytes,
      shellDecodedBytes: shellAsset.reference.decodedBytes,
      levels: Object.freeze(levelStats),
    }),
  });
}

/** Read a headerless IEEE-754 Float32 raster without trusting its byte size. */
export async function readFloat32TerrainFile(filePath, {
  width,
  height,
  littleEndian = true,
  noDataValue = -9999,
  maxSourceBytes = DEFAULT_MAX_SOURCE_BYTES,
} = {}) {
  if (typeof filePath !== 'string' || !filePath) throw new TypeError('filePath must be a non-empty string');
  const count = sourceDimensions(width, height);
  const expectedBytes = count * 4;
  if (!Number.isSafeInteger(maxSourceBytes) || maxSourceBytes < 16) {
    throw new RangeError('maxSourceBytes must be a safe integer of at least 16');
  }
  if (expectedBytes > maxSourceBytes) {
    throw new RangeError(`Float32 terrain source requires ${expectedBytes} bytes; budget is ${maxSourceBytes}`);
  }
  if (typeof littleEndian !== 'boolean') throw new TypeError('littleEndian must be boolean');
  if (noDataValue !== null && !Number.isFinite(noDataValue)) {
    throw new TypeError('noDataValue must be finite or null');
  }
  const metadata = await stat(filePath);
  if (!metadata.isFile()) throw new Error('Float32 terrain source is not a regular file');
  if (metadata.size !== expectedBytes) {
    throw new RangeError(`Float32 terrain source has ${metadata.size} bytes; expected ${expectedBytes}`);
  }
  const source = await readFile(filePath);
  if (source.byteLength !== expectedBytes) throw new Error('Float32 terrain source changed while it was being read');
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const heights = new Float32Array(count);
  const normalizedNoData = noDataValue === null ? null : new Float32Array([noDataValue])[0];
  let finiteCount = 0;
  let noDataCount = 0;
  for (let index = 0; index < count; index++) {
    const value = view.getFloat32(index * 4, littleEndian);
    if (Number.isNaN(value) || (normalizedNoData !== null && value === normalizedNoData)) {
      heights[index] = Number.NaN;
      noDataCount++;
    } else if (!Number.isFinite(value)) {
      throw new Error(`Float32 terrain source contains a non-finite sample at ${index}`);
    } else {
      heights[index] = value;
      finiteCount++;
    }
  }
  if (!finiteCount) throw new Error('Float32 terrain source contains no finite height samples');
  return Object.freeze({ heights, width, height, bytes: source.byteLength, finiteCount, noDataCount });
}

function resourceTarget(outputRoot, relativeUrl) {
  const target = resolve(outputRoot, relativeUrl);
  if (target !== outputRoot && !target.startsWith(`${outputRoot}${sep}`)) {
    throw new Error(`terrain resource escapes output directory: ${relativeUrl}`);
  }
  return target;
}

async function writeImmutable(target, data) {
  await mkdir(dirname(target), { recursive: true });
  try {
    await writeFile(target, data, { flag: 'wx' });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = await readFile(target);
    if (!existing.equals(Buffer.from(data))) {
      throw new Error(`refusing to replace non-matching immutable terrain asset ${target}`);
    }
  }
}

/** Persist only content-addressed files; manifests remain a separate gated step. */
export async function writeTerrainAssetFiles(outputDirectory, compilation) {
  if (typeof outputDirectory !== 'string' || !outputDirectory) {
    throw new TypeError('outputDirectory must be a non-empty string');
  }
  if (!(compilation?.resources instanceof Map)) throw new TypeError('a terrain asset compilation is required');
  const outputRoot = resolve(outputDirectory);
  const written = [];
  for (const [relativeUrl, data] of [...compilation.resources].sort(([left], [right]) => left.localeCompare(right))) {
    const target = resourceTarget(outputRoot, relativeUrl);
    await writeImmutable(target, data);
    written.push(target);
  }
  return Object.freeze(written);
}
