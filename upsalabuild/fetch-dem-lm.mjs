#!/usr/bin/env node
/* Read the ground under Upsala GK's legacy heightfields from Lantmäteriet's
   Markhöjdmodell COGs, replacing the AWS Terrarium tiles fetch-dem.mjs used to
   cache. Two rasters, both axis-aligned in EPSG:3006 and both addressed from
   the same grid centre as the published v2 window:

     terrain-block.f32   1 m  over HF0's rotated footprint
     terrain-vista.f32   32 m over HF1's

   build-heightfields.mjs then samples them THROUGH the derived legacy bridge,
   so the pack's flat-earth HF0 and the published EPSG:3006 tiles carry the
   same measurements of the same ground.

     node --env-file=.env upsalabuild/fetch-dem-lm.mjs [--force]

   No GDAL: the same Node COG reader that serves the ring builder issues
   authenticated range requests. Evidence goes to
   geo_data/course-v2/upsala/acquisition/legacy-field-window.json -- a separate
   file from the v2 window's own evidence, because they are separate reads with
   separate footprints.                                                       */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { basicAuthorization, httpRange, openCog } from '../packages/course-geo/cog/cog-reader.mjs';
import { lantmaterietCredentials } from '../packages/course-geo/acquisition/credentials.mjs';
import { CACHE, ROOT, UPSALA_LEGACY_FIELD } from './lib-v2.mjs';

const EVIDENCE = path.join(ROOT, 'geo_data/course-v2/upsala/acquisition/legacy-field-window.json');
const ITEM_METRES = 10000;
const force = process.argv.includes('--force');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

const credentials = lantmaterietCredentials(process.env);
const authorization = credentials.bearer
  ? `Bearer ${credentials.bearer}`
  : basicAuthorization(credentials.username, credentials.password);

function itemsFor({ originEasting, originNorthing, columns, rows, spacing }) {
  const minEasting = originEasting;
  const maxEasting = originEasting + (columns - 1) * spacing;
  const maxNorthing = originNorthing;
  const minNorthing = originNorthing - (rows - 1) * spacing;
  const items = [];
  for (let n = Math.floor(minNorthing / ITEM_METRES); n <= Math.floor(maxNorthing / ITEM_METRES); n++) {
    for (let e = Math.floor(minEasting / ITEM_METRES); e <= Math.floor(maxEasting / ITEM_METRES); e++) {
      const id = `${n}_${e}`;
      const dir = `${String(n).slice(0, 2)}_${String(e).slice(0, 1)}`;
      items.push({
        id,
        href: `https://dl1.lantmateriet.se/hojd/data/grid/mhm/${dir}/m${id}.tif`,
        minEasting: e * ITEM_METRES,
        maxEasting: (e + 1) * ITEM_METRES,
        minNorthing: n * ITEM_METRES,
        maxNorthing: (n + 1) * ITEM_METRES,
      });
    }
  }
  return items;
}

const opened = new Map();
const evidence = new Map();

async function openItem(item) {
  if (opened.has(item.id)) return opened.get(item.id);
  const head = await fetch(item.href, {
    method: 'HEAD',
    headers: { Authorization: authorization },
    signal: AbortSignal.timeout(60_000),
  });
  if (!head.ok) throw new Error(`HEAD ${item.id} returned HTTP ${head.status}`);
  const range = httpRange(item.href, { authorization });
  const cog = await openCog(range);
  if (cog.epsg !== 3006) throw new Error(`${item.id} is not EPSG:3006`);
  if (Math.abs(cog.originX - item.minEasting) > 1e-6 || Math.abs(cog.originY - item.maxNorthing) > 1e-6) {
    throw new Error(`${item.id} origin ${cog.originX},${cog.originY} is not its own 10 km square`);
  }
  if (cog.noData === null) throw new Error(`${item.id} declares no nodata value`);
  const record = { cog, range, item };
  opened.set(item.id, record);
  evidence.set(item.id, {
    id: item.id,
    href: item.href,
    etag: head.headers.get('etag'),
    lastModified: head.headers.get('last-modified'),
    contentLength: Number(head.headers.get('content-length')),
    noData: cog.noData,
    overviewFactors: cog.levels.map(level => level.factor),
    reads: [],
  });
  return record;
}

/** Fill a lattice from every item it touches, exactly where the lattice lands
    on the chosen overview's own pixel centres and bilinearly where it cannot. */
async function readLattice(spec) {
  const { originEasting, originNorthing, columns, rows, spacing, factor } = spec;
  const values = new Float32Array(columns * rows).fill(Number.NaN);
  let requests = 0;
  let bytes = 0;
  const items = itemsFor(spec);
  for (const item of items) {
    const { cog, range } = await openItem(item);
    const level = cog.levelForFactor(factor);
    if (!level) throw new Error(`${item.id} has no ${factor}x overview`);
    const c0 = Math.max(0, Math.ceil((item.minEasting - originEasting) / spacing - 1e-9));
    const c1 = Math.min(columns - 1, Math.floor((item.maxEasting - originEasting) / spacing - 1e-9));
    const r0 = Math.max(0, Math.ceil((originNorthing - item.maxNorthing) / spacing - 1e-9));
    const r1 = Math.min(rows - 1, Math.floor((originNorthing - item.minNorthing) / spacing - 1e-9));
    if (c1 < c0 || r1 < r0) continue;
    const width = c1 - c0 + 1;
    const height = r1 - r0 + 1;
    const px = easting => (easting - item.minEasting) / factor - 0.5;
    const py = northing => (item.maxNorthing - northing) / factor - 0.5;
    const exactColumn = px(originEasting + c0 * spacing);
    const exactRow = py(originNorthing - r0 * spacing);
    const step = spacing / factor;
    const exact = Number.isInteger(step) && step >= 1 &&
      Math.abs(exactColumn - Math.round(exactColumn)) < 1e-6 &&
      Math.abs(exactRow - Math.round(exactRow)) < 1e-6;
    const beforeBytes = range.transfer.bytes;
    const beforeRequests = range.transfer.requests;
    if (exact) {
      const window = await level.readWindow({
        column0: Math.round(exactColumn), row0: Math.round(exactRow), columns: width, rows: height, step,
      });
      for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) values[(r0 + r) * columns + c0 + c] = window[r * width + c];
      }
    } else {
      const pc0 = Math.max(0, Math.floor(px(originEasting + c0 * spacing)));
      const pc1 = Math.min(level.width - 1, Math.ceil(px(originEasting + c1 * spacing)));
      const pr0 = Math.max(0, Math.floor(py(originNorthing - r0 * spacing)));
      const pr1 = Math.min(level.height - 1, Math.ceil(py(originNorthing - r1 * spacing)));
      const pixelColumns = pc1 - pc0 + 1;
      const pixelRows = pr1 - pr0 + 1;
      const window = await level.readWindow({ column0: pc0, row0: pr0, columns: pixelColumns, rows: pixelRows });
      const at = (c, r) => window[Math.min(pixelRows - 1, Math.max(0, r)) * pixelColumns + Math.min(pixelColumns - 1, Math.max(0, c))];
      for (let r = r0; r <= r1; r++) {
        const y = py(originNorthing - r * spacing) - pr0;
        const north = Math.floor(y);
        const ty = y - north;
        for (let c = c0; c <= c1; c++) {
          const x = px(originEasting + c * spacing) - pc0;
          const west = Math.floor(x);
          const tx = x - west;
          const a = at(west, north);
          const b = at(west + 1, north);
          const d = at(west, north + 1);
          const e = at(west + 1, north + 1);
          values[r * columns + c] = [a, b, d, e].every(Number.isFinite)
            ? (a + (b - a) * tx) * (1 - ty) + (d + (e - d) * tx) * ty
            : [a, b, d, e].find(Number.isFinite) ?? Number.NaN;
        }
      }
    }
    bytes += range.transfer.bytes - beforeBytes;
    requests += range.transfer.requests - beforeRequests;
    evidence.get(item.id).reads.push({
      sampleSpacingMetres: spacing,
      overviewFactor: factor,
      columns: width,
      rows: height,
      resampling: exact ? 'exact-pixel-centres' : 'bilinear',
    });
    level.dropCache();
  }
  return { values, requests, bytes, items: items.map(item => item.id) };
}

function statistics(values) {
  let finite = 0;
  let minimum = Infinity;
  let maximum = -Infinity;
  let sum = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    finite++;
    sum += value;
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
  }
  return {
    samples: values.length,
    finiteSamples: finite,
    minimumHeightRH2000: Number(minimum.toFixed(4)),
    maximumHeightRH2000: Number(maximum.toFixed(4)),
    meanHeightRH2000: Number((sum / finite).toFixed(4)),
  };
}

function writeFloat32(file, values) {
  const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
  fs.writeFileSync(file, bytes);
  return sha256(bytes);
}

function readFloat32(file, expected) {
  const bytes = fs.readFileSync(file);
  if (bytes.byteLength !== expected * 4) {
    throw new Error(`${path.basename(file)} has ${bytes.byteLength} bytes; expected ${expected * 4}`);
  }
  const values = new Float32Array(expected);
  for (let index = 0; index < expected; index++) values[index] = bytes.readFloatLE(index * 4);
  return { values, sha256: sha256(bytes) };
}

async function readOrCache(spec, label) {
  const file = path.join(CACHE, spec.file);
  if (!force && fs.existsSync(file)) {
    const read = readFloat32(file, spec.columns * spec.rows);
    process.stdout.write(`${spec.file}: cached ${spec.columns}x${spec.rows}\n`);
    return { values: read.values, sha256: read.sha256, transfer: { requests: 0, bytes: 0 }, items: [] };
  }
  process.stdout.write(`${spec.file}: reading ${spec.columns}x${spec.rows} at ${spec.spacing} m (${label}) ... `);
  const read = await readLattice(spec);
  const digest = writeFloat32(file, read.values);
  process.stdout.write(`${(read.bytes / 1e6).toFixed(1)} MB in ${read.requests} range requests\n`);
  return { values: read.values, sha256: digest, transfer: { requests: read.requests, bytes: read.bytes }, items: read.items };
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  const { block, vista } = UPSALA_LEGACY_FIELD;
  const readBlock = await readOrCache(block, 'HF0');
  const readVista = await readOrCache(vista, 'HF1');
  const blockStats = statistics(readBlock.values);
  const vistaStats = statistics(readVista.values);
  for (const [name, stats] of [['block', blockStats], ['vista', vistaStats]]) {
    if (stats.finiteSamples !== stats.samples) {
      throw new Error(`the ${name} raster has ${stats.samples - stats.finiteSamples} nodata samples`);
    }
  }

  const report = {
    schemaVersion: 1,
    kind: 'upsala-legacy-field-window',
    groundId: 'upsala',
    courseSlugs: ['upsala', 'upsala-mellanbanan'],
    acquiredOn: new Date().toISOString().slice(0, 10),
    purpose: 'the ground under the GPK1 pack\'s HF0 and HF1, which are addressed in the pack\'s rotated flat-earth frame and therefore need an axis-aligned EPSG:3006 box that contains their footprint',
    reader: 'packages/course-geo/cog/cog-reader.mjs over authenticated HTTP range requests; no GDAL',
    provider: {
      name: 'Lantmäteriet',
      product: 'Markhöjdmodell Nedladdning',
      collection: 'dtm-cog',
      licence: 'CC-BY-4.0',
      horizontalCrs: 'EPSG:3006',
      verticalCrs: 'EPSG:5613',
      resolutionMetres: 1,
    },
    items: [...evidence.values()],
    rasters: {
      block: {
        file: `upsalabuild/cache/${block.file} (ignored)`,
        sampleSpacingMetres: block.spacing,
        columns: block.columns,
        rows: block.rows,
        originEasting: block.originEasting,
        originNorthing: block.originNorthing,
        sourceItems: readBlock.items,
        sha256: readBlock.sha256,
        ...blockStats,
      },
      vista: {
        file: `upsalabuild/cache/${vista.file} (ignored)`,
        sampleSpacingMetres: vista.spacing,
        columns: vista.columns,
        rows: vista.rows,
        originEasting: vista.originEasting,
        originNorthing: vista.originNorthing,
        sourceItems: readVista.items,
        resampling: 'bilinear from each item\'s own 32x overview; the 10 km item origins are not congruent modulo 32, so no single 32 m lattice can land on every item\'s pixel centres',
        sha256: readVista.sha256,
        ...vistaStats,
      },
    },
    transfer: {
      blockRequests: readBlock.transfer.requests,
      blockBytes: readBlock.transfer.bytes,
      vistaRequests: readVista.transfer.requests,
      vistaBytes: readVista.transfer.bytes,
    },
  };
  fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  fs.writeFileSync(EVIDENCE, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ block: blockStats, vista: vistaStats, items: [...evidence.keys()] }, null, 2));
}

main().catch(error => {
  console.error(`Upsala legacy-field acquisition failed: ${error.message}`);
  process.exitCode = 1;
});
