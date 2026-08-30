import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { runGeoCommand } from '../proj.mjs';
import { sha256File } from '../manifest.mjs';
import { authorizationHeaders } from './credentials.mjs';
import { TREE_HEIGHT_CONTRACT } from './discovery.mjs';

const METADATA_LAYER = `${TREE_HEIGHT_CONTRACT.metadataService}/0`;

function round(value, decimals = 3) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function parseJsonCommand(command, args) {
  const { stdout } = runGeoCommand(command, args);
  return JSON.parse(stdout);
}

function isTiff(bytes) {
  return bytes.length >= 4 &&
    ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
     (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a));
}

export function treeHeightTiles(aoiBbox, { maxPixels = 2048, resolutionMetres = 1 } = {}) {
  if (!Array.isArray(aoiBbox) || aoiBbox.length !== 4 || aoiBbox.some(value => !Number.isFinite(value))) {
    throw new Error('tree-height AOI must be an EPSG:3006 bbox');
  }
  if (!Number.isInteger(maxPixels) || maxPixels < 256) throw new Error('maxPixels must be at least 256');
  const minX = Math.floor(aoiBbox[0] / resolutionMetres) * resolutionMetres;
  const minY = Math.floor(aoiBbox[1] / resolutionMetres) * resolutionMetres;
  const maxX = Math.ceil(aoiBbox[2] / resolutionMetres) * resolutionMetres;
  const maxY = Math.ceil(aoiBbox[3] / resolutionMetres) * resolutionMetres;
  const span = maxPixels * resolutionMetres;
  const tiles = [];
  for (let y = minY; y < maxY; y += span) {
    for (let x = minX; x < maxX; x += span) {
      const right = Math.min(maxX, x + span);
      const top = Math.min(maxY, y + span);
      tiles.push({
        index: tiles.length,
        bbox: [x, y, right, top],
        width: Math.round((right - x) / resolutionMetres),
        height: Math.round((top - y) / resolutionMetres),
      });
    }
  }
  return tiles;
}

export function treeHeightExportUrl(tile) {
  const url = new URL(`${TREE_HEIGHT_CONTRACT.service}/exportImage`);
  url.searchParams.set('bbox', tile.bbox.join(','));
  url.searchParams.set('bboxSR', '3006');
  url.searchParams.set('imageSR', '3006');
  url.searchParams.set('size', `${tile.width},${tile.height}`);
  url.searchParams.set('format', 'tiff');
  url.searchParams.set('pixelType', 'S16');
  url.searchParams.set('noData', '0');
  url.searchParams.set('interpolation', 'RSP_NearestNeighbor');
  url.searchParams.set('renderingRule', JSON.stringify({ rasterFunction: 'None' }));
  url.searchParams.set('f', 'image');
  return url;
}

async function authenticatedJson(url, credentials, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json', ...authorizationHeaders(credentials) },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`GET ${url} returned HTTP ${response.status}`);
  const value = await response.json();
  if (value?.error) throw new Error(`ArcGIS error ${value.error.code}: ${value.error.message}`);
  return value;
}

function metadataQueryUrl(aoiBbox) {
  const url = new URL(`${METADATA_LAYER}/query`);
  const x = (aoiBbox[0] + aoiBbox[2]) / 2;
  const y = (aoiBbox[1] + aoiBbox[3]) / 2;
  url.searchParams.set('where', '1=1');
  url.searchParams.set('geometry', JSON.stringify({ x, y, spatialReference: { wkid: 3006 } }));
  url.searchParams.set('geometryType', 'esriGeometryPoint');
  url.searchParams.set('inSR', '3006');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('outFields', 'Datum,Lov_Avlov');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('f', 'json');
  return url;
}

function serviceUrl() {
  const url = new URL(TREE_HEIGHT_CONTRACT.service);
  url.searchParams.set('f', 'pjson');
  return url;
}

async function downloadTile(tile, output, credentials, fetchImpl) {
  const url = treeHeightExportUrl(tile);
  const started = performance.now();
  const response = await fetchImpl(url, {
    headers: { Accept: 'image/tiff, application/octet-stream', ...authorizationHeaders(credentials) },
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`tree-height export ${tile.index} returned HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!isTiff(bytes)) throw new Error(`tree-height export ${tile.index} did not return a TIFF`);
  const maximumBytes = tile.width * tile.height * 4 + 16 * 1024 * 1024;
  if (bytes.byteLength > maximumBytes) throw new Error(`tree-height export ${tile.index} exceeds safety limit`);
  fs.writeFileSync(output, bytes);
  return {
    index: tile.index,
    bbox: tile.bbox,
    width: tile.width,
    height: tile.height,
    bytes: bytes.byteLength,
    sha256: sha256File(output),
    elapsedMilliseconds: round(performance.now() - started),
    path: output,
  };
}

export async function acquireTreeHeight(report, {
  credentials,
  cacheRoot,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!credentials) throw new Error('Skogsstyrelsen credentials are required for tree-height acquisition');
  if (!cacheRoot) throw new Error('cacheRoot is required');
  const started = performance.now();
  const directory = path.resolve(cacheRoot, report.groundId, 'tree-height');
  fs.mkdirSync(directory, { recursive: true });
  const [service, captureMetadata] = await Promise.all([
    authenticatedJson(serviceUrl(), credentials, fetchImpl),
    authenticatedJson(metadataQueryUrl(report.aoi.bboxEpsg3006), credentials, fetchImpl),
  ]);
  const advertisedWidth = Number.isInteger(service.maxImageWidth) ? service.maxImageWidth : 2048;
  const advertisedHeight = Number.isInteger(service.maxImageHeight) ? service.maxImageHeight : 2048;
  const maxPixels = Math.min(2048, advertisedWidth, advertisedHeight);
  if (maxPixels < 256) throw new Error(`tree-height service advertises unusable export size ${maxPixels}`);
  const tiles = treeHeightTiles(report.aoi.bboxEpsg3006, { maxPixels });
  const downloads = [];
  for (const tile of tiles) {
    const output = path.join(directory, `tree-height-${String(tile.index).padStart(3, '0')}.tif`);
    downloads.push(await downloadTile(tile, output, credentials, fetchImpl));
  }

  const vrt = path.join(directory, 'tree-height.vrt');
  const output = path.join(directory, 'tree-height-window.cog.tif');
  const compileStarted = performance.now();
  runGeoCommand('gdalbuildvrt', ['-overwrite', '-resolution', 'highest', vrt, ...downloads.map(item => item.path)]);
  runGeoCommand('gdal_translate', [
    '-of', 'COG',
    '-co', 'COMPRESS=ZSTD',
    '-co', 'LEVEL=12',
    '-co', 'PREDICTOR=STANDARD',
    '-co', 'BLOCKSIZE=256',
    '-co', 'NUM_THREADS=ALL_CPUS',
    '-co', 'BIGTIFF=IF_SAFER',
    vrt,
    output,
  ]);
  const compileMilliseconds = performance.now() - compileStarted;
  const inspectStarted = performance.now();
  const info = parseJsonCommand('gdalinfo', ['-json', '-stats', output]);
  const inspectMilliseconds = performance.now() - inspectStarted;
  if (info.metadata?.IMAGE_STRUCTURE?.LAYOUT !== 'COG') throw new Error('tree-height output is not a COG');
  if ((info.bands || []).length !== 1 || info.bands[0].type !== 'Int16') {
    throw new Error('tree-height output must contain one signed Int16 band');
  }
  return {
    schemaVersion: 1,
    phase: 'D2-authenticated-tree-height-window',
    groundId: report.groundId,
    acquiredOn: new Date().toISOString().slice(0, 10),
    contract: TREE_HEIGHT_CONTRACT,
    serviceMetadata: {
      name: service.name || null,
      pixelType: service.pixelType || null,
      pixelSizeX: service.pixelSizeX ?? null,
      pixelSizeY: service.pixelSizeY ?? null,
      spatialReference: service.spatialReference || null,
      maxImageWidth: service.maxImageWidth ?? null,
      maxImageHeight: service.maxImageHeight ?? null,
    },
    captureMetadata: (captureMetadata.features || []).map(feature => feature.attributes || {}),
    sourceTiles: downloads.map(({ path: ignored, ...item }) => item),
    output: {
      width: info.size?.[0] ?? null,
      height: info.size?.[1] ?? null,
      type: info.bands[0].type,
      unit: 'decimetre',
      nodata: info.bands[0].noDataValue ?? 0,
      minimum: info.bands[0].minimum ?? null,
      maximum: info.bands[0].maximum ?? null,
      mean: info.bands[0].mean ?? null,
      standardDeviation: info.bands[0].stdDev ?? null,
      decodedBytes: (info.size?.[0] || 0) * (info.size?.[1] || 0) * 2,
      compressedBytes: fs.statSync(output).size,
      sha256: sha256File(output),
      cachePath: output,
    },
    measurements: {
      downloadMilliseconds: round(downloads.reduce((total, item) => total + item.elapsedMilliseconds, 0)),
      compileMilliseconds: round(compileMilliseconds),
      statsDecodeMilliseconds: round(inspectMilliseconds),
      totalMilliseconds: round(performance.now() - started),
    },
  };
}
