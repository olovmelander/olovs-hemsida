#!/usr/bin/env node
/* Read a ground's finest (1 m) terrain window out of Lantmateriet's
   Markhojdmodell COGs with authenticated HTTP range requests and write it as
   a row-major little-endian Float32 raster on the reviewed sample lattice.

   node --env-file=.env packages/course-geo/acquisition/build-terrain-window.mjs --ground <id> [--out <dir>]

   This is the GDAL-free equivalent of the CI `gdal_translate -projwin` step.
   It exists because the same COG reader already serves the ring builder, and
   because a window cut here is addressed by SAMPLE CENTRES rather than pixel
   edges -- the half-sample distinction the runbook insists on. At factor 1 an
   overview is never involved: every published sample is a source pixel copied
   exactly, so this reader and a GDAL extraction cannot disagree.

   The raster goes to the ignored acquisition cache; the evidence file beside
   the ground's other acquisition records is committed. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { basicAuthorization, httpRange, openCog } from '../cog/cog-reader.mjs';
import { lantmaterietCredentials } from './credentials.mjs';
import { TERRAIN_WINDOW_SPECS } from './terrain-window-specs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ITEM_METRES = 10000;
const HREF_TEMPLATE = 'https://dl1.lantmateriet.se/hojd/data/grid/mhm/{dir}/m{item}.tif';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const groundId = arg('--ground');
const spec = TERRAIN_WINDOW_SPECS[groundId];
if (!spec) {
  throw new Error(`no reviewed terrain window for ground ${groundId}; known: ${Object.keys(TERRAIN_WINDOW_SPECS).join(', ')}`);
}

const cacheDir = path.resolve(arg('--out') ||
  path.join(ROOT, 'packages/course-geo/toolchain/.cache/acquisition', `${groundId}-terrain-window`));
const evidencePath = path.join(ROOT, `geo_data/course-v2/${groundId}/acquisition/terrain-window.json`);
fs.mkdirSync(cacheDir, { recursive: true });
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });

const credentials = lantmaterietCredentials(process.env);
const authorization = credentials.bearer
  ? `Bearer ${credentials.bearer}`
  : basicAuthorization(credentials.username, credentials.password);

/** The 10 km Markhojdmodell squares the reviewed window touches. */
function itemsFor({ originEasting, originNorthing, width, height, sampleSpacingMetres }) {
  const minEasting = originEasting;
  const maxEasting = originEasting + (width - 1) * sampleSpacingMetres;
  const maxNorthing = originNorthing;
  const minNorthing = originNorthing - (height - 1) * sampleSpacingMetres;
  const items = [];
  for (let n = Math.floor(minNorthing / ITEM_METRES); n <= Math.floor(maxNorthing / ITEM_METRES); n++) {
    for (let e = Math.floor(minEasting / ITEM_METRES); e <= Math.floor(maxEasting / ITEM_METRES); e++) {
      const id = `${n}_${e}`;
      const dir = `${String(n).slice(0, 2)}_${String(e).slice(0, 1)}`;
      items.push(Object.freeze({
        id,
        dir,
        href: HREF_TEMPLATE.replace('{dir}', dir).replace('{item}', id),
        minEasting: e * ITEM_METRES,
        maxEasting: (e + 1) * ITEM_METRES,
        minNorthing: n * ITEM_METRES,
        maxNorthing: (n + 1) * ITEM_METRES,
      }));
    }
  }
  return items;
}

async function main() {
  const started = Date.now();
  const { originEasting, originNorthing, width, height, sampleSpacingMetres } = spec;
  if (sampleSpacingMetres !== 1) throw new Error('only a 1 m finest window is supported');
  const values = new Float32Array(width * height).fill(Number.NaN);
  const items = itemsFor(spec);
  const touched = items.map(item => item.id);
  if (touched.length !== spec.sourceItemIds.length ||
      !touched.every(id => spec.sourceItemIds.includes(id))) {
    throw new Error(`window touches ${touched.join(', ')}; reviewed items are ${spec.sourceItemIds.join(', ')}`);
  }
  const evidence = [];
  let requests = 0;
  let bytes = 0;
  for (const item of items) {
    const head = await fetch(item.href, {
      method: 'HEAD', headers: { Authorization: authorization }, signal: AbortSignal.timeout(60_000),
    });
    if (!head.ok) throw new Error(`HEAD ${item.id} returned HTTP ${head.status}`);
    const range = httpRange(item.href, { authorization });
    const cog = await openCog(range);
    if (cog.epsg !== 3006) throw new Error(`${item.id} is not EPSG:3006`);
    if (Math.abs(cog.originX - item.minEasting) > 1e-6 || Math.abs(cog.originY - item.maxNorthing) > 1e-6) {
      throw new Error(`${item.id} origin ${cog.originX},${cog.originY} is not its 10 km square`);
    }
    const level = cog.levelForFactor(1);
    if (!level) throw new Error(`${item.id} has no full-resolution level`);

    /* The reviewed lattice rows/columns that fall inside this item. Sample
       centres are x.5, so the sample at easting E is the pixel whose index
       within the item is E - item.minEasting - 0.5. */
    const c0 = Math.max(0, Math.ceil(item.minEasting - originEasting));
    const c1 = Math.min(width - 1, Math.floor(item.maxEasting - originEasting));
    const r0 = Math.max(0, Math.ceil(originNorthing - item.maxNorthing));
    const r1 = Math.min(height - 1, Math.floor(originNorthing - item.minNorthing));
    if (c1 < c0 || r1 < r0) continue;
    const pixelColumn0 = Math.round(originEasting + c0 - item.minEasting - 0.5);
    const pixelRow0 = Math.round(item.maxNorthing - (originNorthing - r0) - 0.5);
    const columns = c1 - c0 + 1;
    const rows = r1 - r0 + 1;
    if (pixelColumn0 < 0 || pixelRow0 < 0 ||
        pixelColumn0 + columns > level.width || pixelRow0 + rows > level.height) {
      throw new Error(`${item.id} window ${pixelColumn0},${pixelRow0} ${columns}x${rows} leaves the item`);
    }
    const beforeBytes = range.transfer.bytes;
    const beforeRequests = range.transfer.requests;
    const window = await level.readWindow({ column0: pixelColumn0, row0: pixelRow0, columns, rows });
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) values[(r0 + r) * width + c0 + c] = window[r * columns + c];
    }
    bytes += range.transfer.bytes - beforeBytes;
    requests += range.transfer.requests - beforeRequests;
    level.dropCache();
    evidence.push({
      id: item.id,
      href: item.href,
      etag: head.headers.get('etag'),
      contentLength: Number(head.headers.get('content-length')),
      lastModified: head.headers.get('last-modified'),
      noData: cog.noData,
      overviewFactors: cog.levels.map(entry => entry.factor),
      overviewFactorUsed: 1,
      windowPixels: { column0: pixelColumn0, row0: pixelRow0, columns, rows },
      latticeWindow: { column0: c0, row0: r0, columns, rows },
    });
  }

  let finite = 0;
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    finite++;
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
  }
  if (finite !== values.length) {
    throw new Error(`${values.length - finite} of ${values.length} window samples are nodata or unread`);
  }
  const band = spec.plausibleHeightRangeRH2000;
  if (minimum < band.minimum || maximum > band.maximum) {
    throw new Error(`window RH 2000 range ${minimum}-${maximum} m leaves the reviewed band ${band.minimum}-${band.maximum}`);
  }

  const raster = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
  const rasterPath = path.join(cacheDir, 'terrain-1m.f32');
  fs.writeFileSync(rasterPath, raster);
  const sha256 = crypto.createHash('sha256').update(raster).digest('hex');

  const report = {
    schemaVersion: 1,
    phase: 'authenticated-finest-terrain-window',
    groundId,
    acquiredOn: new Date().toISOString().slice(0, 10),
    state: 'acquisition-evidence-only',
    reader: 'packages/course-geo/cog/cog-reader.mjs over authenticated HTTP range requests',
    readerNote: 'factor-1 samples are source pixels copied exactly; no overview and no resampling is involved',
    provider: {
      name: 'Lantmateriet',
      product: 'Markhojdmodell Nedladdning',
      collection: 'dtm-cog',
      licence: 'CC-BY-4.0',
    },
    lattice: {
      horizontalCrs: 'EPSG:3006',
      verticalCrs: 'EPSG:5613',
      compoundCrs: 'EPSG:5845',
      coordinateOrder: ['easting', 'northing'],
      sampleSpacingMetres,
      width,
      height,
      originEasting,
      originNorthing,
      sampleCentreBounds: {
        minEasting: originEasting,
        maxEasting: originEasting + (width - 1) * sampleSpacingMetres,
        minNorthing: originNorthing - (height - 1) * sampleSpacingMetres,
        maxNorthing: originNorthing,
      },
      pixelEdgeWindow: spec.pixelEdgeWindow,
    },
    sourceItems: evidence,
    raster: {
      path: path.relative(ROOT, rasterPath).split(path.sep).join('/'),
      format: 'row-major little-endian Float32, north-up',
      bytes: raster.byteLength,
      sha256,
    },
    samples: {
      total: values.length,
      finite,
      minimumHeightRH2000: minimum,
      maximumHeightRH2000: maximum,
      reviewedBand: band,
    },
    transfer: { rangeRequests: requests, rangeBytes: bytes, elapsedMilliseconds: Date.now() - started },
  };
  fs.writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, sourceItems: report.sourceItems.map(item => item.id) }, null, 2));
  console.log(`wrote ${path.relative(ROOT, rasterPath)} and ${path.relative(ROOT, evidencePath)}`);
}

main().catch(error => {
  console.error(`terrain window acquisition failed: ${error.message}`);
  process.exitCode = 1;
});
