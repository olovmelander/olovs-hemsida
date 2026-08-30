import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { runGeoCommand } from '../proj.mjs';
import { sha256File } from '../manifest.mjs';
import { authorizationHeaders, gdalHttpEnvironment } from './credentials.mjs';

const GDAL_TYPE_BYTES = Object.freeze({
  Byte: 1,
  Int8: 1,
  UInt16: 2,
  Int16: 2,
  UInt32: 4,
  Int32: 4,
  Float32: 4,
  UInt64: 8,
  Int64: 8,
  Float64: 8,
  CInt16: 4,
  CInt32: 8,
  CFloat32: 8,
  CFloat64: 16,
});

function safeLantmaterietAsset(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'dl1.lantmateriet.se' ||
      !url.pathname.startsWith('/hojd/')) {
    throw new Error(`refusing non-height asset URL ${url.href}`);
  }
  return url;
}

function safeGroundId(value) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value || '')) throw new Error(`invalid ground id ${value}`);
  return value;
}

function round(value, decimals = 3) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function sumDecodedBytes(info) {
  const [width, height] = info.size || [];
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  let bytesPerPixel = 0;
  for (const band of info.bands || []) {
    const bytes = GDAL_TYPE_BYTES[band.type];
    if (!bytes) return null;
    bytesPerPixel += bytes;
  }
  return width * height * bytesPerPixel;
}

function parseJsonCommand(command, args, options) {
  const { stdout } = runGeoCommand(command, args, options);
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${command} returned invalid JSON: ${error.message}`);
  }
}

export function terrainWindowPlan(report, cacheRoot) {
  safeGroundId(report.groundId);
  const aoi = report.aoi?.bboxEpsg3006;
  if (!Array.isArray(aoi) || aoi.length !== 4 || aoi.some(value => !Number.isFinite(value))) {
    throw new Error('discovery report lacks an EPSG:3006 AOI');
  }
  if (!report.terrain?.coverage?.complete) throw new Error('terrain STAC selection does not cover the AOI');
  const sources = (report.terrain.items || []).map(item => ({
    id: item.id,
    url: safeLantmaterietAsset(item.assets?.data?.href).href,
    bytes: item.assets.data.bytes,
    sha256: item.assets.data.sha256,
  }));
  if (sources.length === 0 || sources.some(item => !item.sha256)) {
    throw new Error('terrain items require STAC SHA-256 multihashes');
  }
  const breaks = (report.terrain.items || []).map(item => ({
    id: item.id,
    url: safeLantmaterietAsset(item.assets?.breakgeometry?.href).href,
    bytes: item.assets.breakgeometry.bytes,
    sha256: item.assets.breakgeometry.sha256,
  }));
  if (breaks.length !== sources.length || breaks.some(item => !item.sha256)) {
    throw new Error('every terrain item requires checksummed break geometry');
  }
  const directory = path.resolve(cacheRoot, report.groundId);
  const vrt = path.join(directory, 'terrain-source.vrt');
  const terrainOutput = path.join(directory, 'terrain-window.cog.tif');
  const breakOutput = path.join(directory, 'water-breaks.gpkg');
  return {
    groundId: report.groundId,
    aoi,
    directory,
    sources,
    breaks,
    vrt,
    terrainOutput,
    breakOutput,
    buildVrtArgs: [
      '-overwrite', '-resolution', 'highest', vrt,
      ...sources.map(item => `/vsicurl/${item.url}`),
    ],
    translateArgs: [
      '-of', 'COG',
      '-projwin', String(aoi[0]), String(aoi[3]), String(aoi[2]), String(aoi[1]),
      '-co', 'COMPRESS=ZSTD',
      '-co', 'LEVEL=12',
      '-co', 'PREDICTOR=FLOATING_POINT',
      '-co', 'BLOCKSIZE=256',
      '-co', 'NUM_THREADS=ALL_CPUS',
      '-co', 'BIGTIFF=IF_SAFER',
      vrt,
      terrainOutput,
    ],
  };
}

async function downloadCheckedAsset(asset, output, credentials, fetchImpl) {
  const url = safeLantmaterietAsset(asset.url);
  const started = performance.now();
  const response = await fetchImpl(url, {
    headers: authorizationHeaders(credentials),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`download ${url.href} returned HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 16 * 1024 * 1024) throw new Error(`${url.href} exceeds the 16 MiB break-geometry limit`);
  if (Number.isFinite(asset.bytes) && bytes.byteLength !== asset.bytes) {
    throw new Error(`${url.href} size ${bytes.byteLength} does not match STAC ${asset.bytes}`);
  }
  fs.writeFileSync(output, bytes);
  const checksum = sha256File(output);
  if (checksum !== asset.sha256) {
    throw new Error(`${url.href} SHA-256 ${checksum} does not match STAC ${asset.sha256}`);
  }
  return {
    id: asset.id,
    href: url.href,
    bytes: bytes.byteLength,
    sha256: checksum,
    elapsedMilliseconds: round(performance.now() - started),
    path: output,
  };
}

function ogrLayers(file) {
  const { stdout } = runGeoCommand('ogrinfo', ['-ro', '-q', file]);
  return stdout.split(/\r?\n/).map(line => line.match(/^\s*\d+:\s+(.+?)(?:\s+\([^)]*\))?\s*$/)?.[1])
    .filter(Boolean);
}

function clipBreakGeometry(downloads, plan) {
  if (fs.existsSync(plan.breakOutput)) fs.unlinkSync(plan.breakOutput);
  const [minX, minY, maxX, maxY] = plan.aoi;
  let append = false;
  let inputLayerCount = 0;
  for (const download of downloads) {
    const layers = ogrLayers(download.path);
    if (layers.length === 0) throw new Error(`${download.path} has no vector layers`);
    for (const layer of layers) {
      const args = [
        '-f', 'GPKG',
        ...(append ? ['-update', '-append'] : ['-overwrite']),
        '-spat', String(minX), String(minY), String(maxX), String(maxY),
        '-spat_srs', 'EPSG:3006',
        '-t_srs', 'EPSG:3006',
        '-nln', 'water_breaks',
        '-nlt', 'PROMOTE_TO_MULTI',
        '-makevalid',
        plan.breakOutput,
        download.path,
        layer,
      ];
      runGeoCommand('ogr2ogr', args);
      append = true;
      inputLayerCount++;
    }
  }
  const info = parseJsonCommand('ogrinfo', ['-json', '-so', plan.breakOutput, 'water_breaks']);
  return {
    inputLayerCount,
    featureCount: info.layers?.[0]?.featureCount ?? null,
    bytes: fs.statSync(plan.breakOutput).size,
    sha256: sha256File(plan.breakOutput),
    path: plan.breakOutput,
  };
}

export async function acquireTerrainWindow(report, {
  credentials,
  cacheRoot,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!credentials) throw new Error('Lantmäteriet credentials are required for terrain acquisition');
  if (!cacheRoot) throw new Error('cacheRoot is required');
  const plan = terrainWindowPlan(report, cacheRoot);
  fs.mkdirSync(plan.directory, { recursive: true });
  const environment = gdalHttpEnvironment(credentials);
  const started = performance.now();
  const buildStarted = performance.now();
  runGeoCommand('gdalbuildvrt', plan.buildVrtArgs, { env: environment });
  const vrtMilliseconds = performance.now() - buildStarted;
  const translateStarted = performance.now();
  runGeoCommand('gdal_translate', plan.translateArgs, { env: environment });
  const translateMilliseconds = performance.now() - translateStarted;
  const inspectStarted = performance.now();
  const info = parseJsonCommand('gdalinfo', ['-json', '-stats', plan.terrainOutput]);
  const inspectMilliseconds = performance.now() - inspectStarted;
  const layout = info.metadata?.IMAGE_STRUCTURE?.LAYOUT || null;
  if (layout !== 'COG') throw new Error(`terrain output is not a COG (LAYOUT=${layout})`);

  const breakDownloads = [];
  for (const asset of plan.breaks) {
    const output = path.join(plan.directory, `${asset.id}-breakgeometry.gpkg`);
    breakDownloads.push(await downloadCheckedAsset(asset, output, credentials, fetchImpl));
  }
  const breakStarted = performance.now();
  const waterBreakGeometry = clipBreakGeometry(breakDownloads, plan);
  const breakClipMilliseconds = performance.now() - breakStarted;

  return {
    schemaVersion: 1,
    phase: 'D2-authenticated-terrain-window',
    groundId: report.groundId,
    acquiredOn: new Date().toISOString().slice(0, 10),
    aoi: report.aoi,
    sourceItems: plan.sources.map(({ id, url, bytes, sha256 }) => ({ id, href: url, bytes, sha256 })),
    sourceChecksumState: 'checksums supplied by Lantmäteriet STAC; range-read source files were not fully rehashed',
    terrainWindow: {
      format: 'image/tiff; application=geotiff; profile=cloud-optimized',
      compression: 'ZSTD level 12',
      blockSize: 256,
      width: info.size?.[0] ?? null,
      height: info.size?.[1] ?? null,
      bands: (info.bands || []).map(band => ({
        band: band.band,
        type: band.type,
        nodata: band.noDataValue ?? null,
        minimum: band.minimum ?? null,
        maximum: band.maximum ?? null,
        mean: band.mean ?? null,
        standardDeviation: band.stdDev ?? null,
      })),
      decodedBytes: sumDecodedBytes(info),
      compressedBytes: fs.statSync(plan.terrainOutput).size,
      sha256: sha256File(plan.terrainOutput),
      cachePath: plan.terrainOutput,
    },
    waterBreakGeometry: {
      sourceAssets: breakDownloads.map(({ path: ignored, ...item }) => item),
      inputLayerCount: waterBreakGeometry.inputLayerCount,
      featureCount: waterBreakGeometry.featureCount,
      bytes: waterBreakGeometry.bytes,
      sha256: waterBreakGeometry.sha256,
      cachePath: waterBreakGeometry.path,
    },
    measurements: {
      vrtMilliseconds: round(vrtMilliseconds),
      cogWindowMilliseconds: round(translateMilliseconds),
      statsDecodeMilliseconds: round(inspectMilliseconds),
      breakDownloadMilliseconds: round(breakDownloads.reduce((total, item) =>
        total + item.elapsedMilliseconds, 0)),
      breakClipMilliseconds: round(breakClipMilliseconds),
      totalMilliseconds: round(performance.now() - started),
      networkRangeBytes: null,
      networkRangeBytesReason: 'GDAL transfer tracing is disabled because verbose cURL logs may expose Authorization headers.',
    },
  };
}
