import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { runGeoCommand } from '../proj.mjs';
import { sha256File } from '../manifest.mjs';
import { gdalHttpEnvironment } from './credentials.mjs';

/* A bounded orthophoto window, acquired the way the terrain window is: read
   through /vsicurl with credentials that are never serialised, clipped to a
   declared AOI, and kept on the runner. Nothing here publishes a pixel.
   Ortofoto Nedladdning is CC-BY-4.0 with special access and GDPR terms, and a
   derived raster is still a derivative work, so what may LEAVE this step is
   aggregate statistics — the same discipline the Laserdata probe already
   follows. Imagery is measurement input, never the rendered ground. */

const RGBI_BANDS = 4;

function safeOrthoAsset(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'dl1.lantmateriet.se' ||
      !url.pathname.startsWith('/bild/')) {
    throw new Error(`refusing non-orthophoto asset URL ${url.href}`);
  }
  if (url.search || url.hash || url.username || url.password) {
    throw new Error('orthophoto asset URL must carry no query, fragment or credentials');
  }
  return url;
}

function safeGroundId(value) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value || '')) throw new Error(`invalid ground id ${value}`);
  return value;
}

function finiteBbox(value, label) {
  if (!Array.isArray(value) || value.length !== 4 || value.some(item => !Number.isFinite(item))) {
    throw new Error(`${label} must be a finite [minE, minN, maxE, maxN]`);
  }
  if (value[0] >= value[2] || value[1] >= value[3]) throw new Error(`${label} minimums must be below maximums`);
  return value;
}

/**
 * Plan a bounded RGBI window. The window is deliberately a SUBSET of the AOI:
 * the full Puttom property at 16 cm is 785 megapixels and 3.1 GB decoded,
 * which is exactly why the plan calls imagery an offline digitisation source
 * rather than a runtime texture. A caller states the metres it needs.
 */
export function orthoWindowPlan(report, cacheRoot, {
  bboxEpsg3006,
  maximumMegapixels = 64,
  /* Resample coarser than the source when the question is about metres-scale
     boundaries rather than centimetre-scale edges. A separability measurement
     over a whole course needs the whole course, and 16 cm over 1.3 km would
     be hundreds of megapixels to answer a question 0.5 m settles. The report
     records the resolution actually read, never the campaign's. */
  targetResolutionMetres = null,
} = {}) {
  safeGroundId(report.groundId);
  if (!report.orthophoto?.coverage?.complete) {
    throw new Error('orthophoto STAC selection does not cover the AOI');
  }
  const sourceResolutionMetres = report.orthophoto.resolutionMetres;
  if (!Number.isFinite(sourceResolutionMetres) || sourceResolutionMetres <= 0) {
    throw new Error('orthophoto selection lacks a finite resolution');
  }
  if (targetResolutionMetres !== null &&
      (!Number.isFinite(targetResolutionMetres) || targetResolutionMetres < sourceResolutionMetres)) {
    throw new Error('targetResolutionMetres must be finite and no finer than the source campaign');
  }
  const resolutionMetres = targetResolutionMetres ?? sourceResolutionMetres;
  const aoi = finiteBbox(report.aoi?.bboxEpsg3006, 'discovery AOI');
  const window = finiteBbox(bboxEpsg3006 ?? aoi, 'requested window');
  if (window[0] < aoi[0] || window[1] < aoi[1] || window[2] > aoi[2] || window[3] > aoi[3]) {
    throw new Error('requested orthophoto window must lie inside the discovered AOI');
  }
  const pixelWidth = Math.round((window[2] - window[0]) / resolutionMetres);
  const pixelHeight = Math.round((window[3] - window[1]) / resolutionMetres);
  const megapixels = (pixelWidth * pixelHeight) / 1e6;
  if (megapixels > maximumMegapixels) {
    throw new Error(`requested window is ${megapixels.toFixed(1)} Mpx; the bounded budget is ${maximumMegapixels} Mpx`);
  }
  const sources = (report.orthophoto.items || []).map(item => ({
    id: item.id,
    url: safeOrthoAsset(item.assets?.data?.href).href,
    bytes: item.assets.data.bytes,
    sha256: item.assets.data.sha256,
  }));
  if (!sources.length) throw new Error('orthophoto selection has no data assets');

  const directory = path.resolve(cacheRoot, report.groundId);
  const vrt = path.join(directory, 'ortho-source.vrt');
  const orthoOutput = path.join(directory, 'ortho-window.cog.tif');
  return Object.freeze({
    groundId: report.groundId,
    collection: report.orthophoto.collection,
    resolutionMetres,
    window: Object.freeze([...window]),
    pixelWidth,
    pixelHeight,
    megapixels: +megapixels.toFixed(2),
    directory,
    sources: Object.freeze(sources),
    vrt,
    orthoOutput,
    buildVrtArgs: Object.freeze([
      '-overwrite', '-resolution', 'highest', vrt,
      ...sources.map(item => `/vsicurl/${item.url}`),
    ]),
    sourceResolutionMetres,
    resampled: targetResolutionMetres !== null,
    translateArgs: Object.freeze([
      '-of', 'COG',
      '-projwin', String(window[0]), String(window[3]), String(window[2]), String(window[1]),
      ...(targetResolutionMetres === null
        ? []
        : ['-tr', String(resolutionMetres), String(resolutionMetres), '-r', 'average']),
      '-co', 'COMPRESS=ZSTD',
      '-co', 'LEVEL=12',
      '-co', 'BLOCKSIZE=512',
      '-co', 'NUM_THREADS=ALL_CPUS',
      '-co', 'BIGTIFF=IF_SAFER',
      vrt,
      orthoOutput,
    ]),
  });
}

function parseJsonCommand(command, args) {
  const { stdout } = runGeoCommand(command, args);
  try { return JSON.parse(stdout); }
  catch (error) { throw new Error(`${command} did not return JSON: ${error.message}`); }
}

/** Acquire the planned window. The raster stays on the runner; the caller
    decides what derived statistics may leave. */
export async function acquireOrthoWindow(report, {
  credentials,
  cacheRoot,
  bboxEpsg3006,
  maximumMegapixels,
  targetResolutionMetres,
} = {}) {
  if (!credentials) throw new Error('Lantmäteriet credentials are required for orthophoto acquisition');
  if (!cacheRoot) throw new Error('cacheRoot is required');
  const plan = orthoWindowPlan(report, cacheRoot, {
    bboxEpsg3006, maximumMegapixels, targetResolutionMetres,
  });
  fs.mkdirSync(plan.directory, { recursive: true });
  const environment = gdalHttpEnvironment(credentials);
  const started = performance.now();
  runGeoCommand('gdalbuildvrt', [...plan.buildVrtArgs], { env: environment });
  const translateStarted = performance.now();
  runGeoCommand('gdal_translate', [...plan.translateArgs], { env: environment });
  const translateMilliseconds = performance.now() - translateStarted;
  const info = parseJsonCommand('gdalinfo', ['-json', '-stats', plan.orthoOutput]);
  if (info.size?.[0] !== plan.pixelWidth || info.size?.[1] !== plan.pixelHeight) {
    throw new Error(`orthophoto window is ${info.size?.join('x')}; expected ${plan.pixelWidth}x${plan.pixelHeight}`);
  }
  if ((info.bands || []).length < RGBI_BANDS) {
    throw new Error(`orthophoto window has ${(info.bands || []).length} bands; RGBI needs ${RGBI_BANDS}`);
  }
  return Object.freeze({
    schemaVersion: 1,
    phase: 'D2-authenticated-orthophoto-window',
    groundId: plan.groundId,
    collection: plan.collection,
    acquiredOn: new Date().toISOString().slice(0, 10),
    window: plan.window,
    resolutionMetres: plan.resolutionMetres,
    sourceResolutionMetres: plan.sourceResolutionMetres,
    resampled: plan.resampled,
    pixelWidth: plan.pixelWidth,
    pixelHeight: plan.pixelHeight,
    megapixels: plan.megapixels,
    sourceItems: plan.sources.map(({ id, url, bytes, sha256 }) => ({ id, href: url, bytes, sha256 })),
    bands: (info.bands || []).map(band => ({
      band: band.band,
      type: band.type,
      minimum: band.minimum ?? null,
      maximum: band.maximum ?? null,
      mean: band.mean ?? null,
      standardDeviation: band.stdDev ?? null,
    })),
    compressedBytes: fs.statSync(plan.orthoOutput).size,
    sha256: sha256File(plan.orthoOutput),
    cachePath: plan.orthoOutput,
    retained: false,
    retentionNote: 'the window stays on the runner; only derived statistics may be exported, because Ortofoto Nedladdning carries special access and GDPR terms',
    measurements: {
      cogWindowMilliseconds: Math.round(translateMilliseconds),
      totalMilliseconds: Math.round(performance.now() - started),
      networkRangeBytes: null,
      networkRangeBytesReason: 'GDAL transfer tracing is disabled because verbose cURL logs may expose Authorization headers.',
    },
  });
}
