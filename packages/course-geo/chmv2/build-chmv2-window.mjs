#!/usr/bin/env node
/* Sample the Meta/WRI canopy-height tile (CHMv2, CC BY 4.0) over a v2
   ground's rectangle onto the SAME 1 m EPSG:3006 grid the campaign rasters
   use, so the cross-check is raster against raster with no resampling of
   the laser side. Reads only the COG tiles the rectangle touches, by HTTP
   range request from the open bucket; no credentials are involved.

   node packages/course-geo/chmv2/build-chmv2-window.mjs --ground puttom \
     [--grid <campaign sidecar>] [--url <tile>] [--out <dir>] [--evidence <path>]

   Writes chmv2-<tile>.f32 + .json beside the campaign rasters (raw Float32,
   NaN = nodata/outside) and an evidence file with the object's identity. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { httpRange, openCog } from './cog-reader.mjs';
import { latLonToWebMercator, sweref99TmToLatLon, webMercatorGroundScale } from './projection.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULT_TILE = '1200130303';
const DEFAULT_URL = `https://dataforgood-fb-data.s3.amazonaws.com/forests/v2/global/dinov3_global_chm_v2_ml3/chm/${DEFAULT_TILE}.tif`;
const ATTRIBUTION = 'Canopy height (CHMv2) © Meta and World Resources Institute, CC BY 4.0';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const groundId = arg('--ground', 'puttom');
const cacheDir = path.resolve(ROOT, 'packages/course-geo/toolchain/.cache/acquisition', `${groundId}-vegetation`);
const gridPath = path.resolve(ROOT, arg('--grid', path.join(cacheDir, 'chm-26f015-702-69.json')));
const url = arg('--url', DEFAULT_URL);
const tileId = path.basename(new URL(url).pathname, '.tif');
const outDir = path.resolve(ROOT, arg('--out', cacheDir));
const evidencePath = path.resolve(ROOT, arg('--evidence', `geo_data/course-v2/${groundId}/vegetation/chmv2-window.json`));

const grid = JSON.parse(fs.readFileSync(gridPath, 'utf8'));
const { width, height, originEasting, originNorthing } = grid;
const spacing = grid.sampleSpacingMetres;
const startedAt = Date.now();

const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(60_000) });
if (!head.ok) throw new Error(`HEAD ${url} returned HTTP ${head.status}`);
const objectIdentity = {
  url,
  etag: head.headers.get('etag'),
  lastModified: head.headers.get('last-modified'),
  contentLength: Number(head.headers.get('content-length')),
};

const range = httpRange(url);
const cog = await openCog(range);
if (cog.epsg !== 3857) throw new Error(`expected an EPSG:3857 tile, got ${cog.epsg}`);

/* the mercator footprint of the rectangle, from its edges */
let minColumn = Infinity, maxColumn = -Infinity, minRow = Infinity, maxRow = -Infinity;
const edge = [];
for (let k = 0; k <= 64; k++) {
  const t = k / 64;
  edge.push(
    [originEasting + t * width * spacing, originNorthing],
    [originEasting + t * width * spacing, originNorthing - height * spacing],
    [originEasting, originNorthing - t * height * spacing],
    [originEasting + width * spacing, originNorthing - t * height * spacing],
  );
}
for (const [e, n] of edge) {
  const [lat, lon] = sweref99TmToLatLon(e, n);
  const [x, y] = latLonToWebMercator(lat, lon);
  const [column, row] = cog.pixelOf(x, y);
  minColumn = Math.min(minColumn, column); maxColumn = Math.max(maxColumn, column);
  minRow = Math.min(minRow, row); maxRow = Math.max(maxRow, row);
}
const tileColumns = [Math.floor(minColumn / cog.tileWidth), Math.floor(maxColumn / cog.tileWidth)];
const tileRows = [Math.floor(minRow / cog.tileLength), Math.floor(maxRow / cog.tileLength)];
const wanted = [];
for (let tr = tileRows[0]; tr <= tileRows[1]; tr++) for (let tc = tileColumns[0]; tc <= tileColumns[1]; tc++) wanted.push([tc, tr]);
let cursor = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (cursor < wanted.length) {
    const [tc, tr] = wanted[cursor++];
    await cog.tile(tc, tr);
  }
}));

/* sample every cell centre; nearest pixel, which at 0.54 m per pixel is
   finer than the 1 m cell it lands in */
const values = new Float32Array(width * height);
const histogram = new Array(64).fill(0);
let valid = 0, canopy = 0, sum = 0;
for (let row = 0; row < height; row++) {
  const n = originNorthing - (row + 0.5) * spacing;
  for (let column = 0; column < width; column++) {
    const e = originEasting + (column + 0.5) * spacing;
    const [lat, lon] = sweref99TmToLatLon(e, n);
    const [x, y] = latLonToWebMercator(lat, lon);
    const [pc, pr] = cog.pixelOf(x, y);
    const value = cog.sampleSync(pc, pr);
    values[row * width + column] = value;
    if (Number.isFinite(value)) {
      valid++; sum += value;
      if (value >= 2) canopy++;
      histogram[Math.min(63, Math.floor(value))]++;
    }
  }
}

fs.mkdirSync(outDir, { recursive: true });
const dataPath = path.join(outDir, `chmv2-${tileId}.f32`);
const sidecarPath = path.join(outDir, `chmv2-${tileId}.json`);
fs.writeFileSync(dataPath, Buffer.from(values.buffer));
const observedOn = new Date().toISOString().slice(0, 10);
const source = {
  ...objectIdentity, tileId, epsg: cog.epsg,
  pixelScaleMercatorMetres: cog.pixelScaleX,
  groundMetresPerPixelAt63_3N: cog.pixelScaleX * webMercatorGroundScale(63.3),
  attribution: ATTRIBUTION,
};
const sidecar = {
  width, height, sampleSpacingMetres: spacing, originEasting, originNorthing, noData: null,
  campaignId: null, groundId, frameFingerprint: grid.frameFingerprint, observedOn, layer: 'chmv2', source,
};
fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2) + '\n');
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(dataPath)).digest('hex');
const evidence = {
  kind: 'chmv2-window',
  groundId,
  observedOn,
  source,
  licence: 'CC BY 4.0',
  attribution: ATTRIBUTION,
  projection: 'EPSG:3006 cell centres to WGS 84 by a Snyder transverse Mercator series verified against PROJ values in this repository (projection.node-test.mjs), then to EPSG:3857 by the spherical formula; SWEREF 99 treated as WGS 84 (decimetres, below the 0.54 m pixel)',
  grid: { width, height, sampleSpacingMetres: spacing, originEasting, originNorthing },
  cogTiles: {
    fetched: cog.cachedTiles, columns: tileColumns, rows: tileRows,
    tileSizePixels: [cog.tileWidth, cog.tileLength], predictor: cog.predictor, compression: cog.compression, noData: cog.noData,
  },
  transfer: { ...range.transfer },
  raster: { data: path.relative(ROOT, dataPath).replaceAll('\\', '/'), sidecar: path.relative(ROOT, sidecarPath).replaceAll('\\', '/'), sha256, bytes: values.byteLength },
  statistics: {
    cells: width * height, valid, nodata: width * height - valid,
    canopyFraction: valid ? canopy / valid : null, meanHeightMetres: valid ? sum / valid : null, histogramMetres: histogram,
  },
  elapsedSeconds: (Date.now() - startedAt) / 1000,
};
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({
  tiles: cog.cachedTiles, requests: range.transfer.requests, bytes: range.transfer.bytes, valid,
  canopyFraction: evidence.statistics.canopyFraction, meanHeightMetres: evidence.statistics.meanHeightMetres,
  elapsedSeconds: evidence.elapsedSeconds, sha256: sha256.slice(0, 12),
}));
