#!/usr/bin/env node
/* Bounded 8,192 m vista from the same national DTM product as the fine grid.
 * This is a display/background input, never a replacement for the 1 m ground. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { openCog, httpRange } from '../../../../packages/course-geo/cog/cog-reader.mjs';
import { authorizationHeaders, lantmaterietCredentials } from '../../../../packages/course-geo/acquisition/credentials.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const OUT = path.join(ROOT, 'lidingobuild/cache/terrain-vista');
const REPORT = path.join(ROOT, 'geo_data/course-v2/lidingo/mapping/terrain-vista.json');
const lattice = { width: 257, height: 257, originEasting: 673604.5, originNorthing: 6590495.5, sampleSpacingMetres: 32 };
const headers = authorizationHeaders(lantmaterietCredentials());
if (!headers.Authorization) throw new Error('Existing Lantmateriet height credentials are required');
const samples = new Float32Array(lattice.width * lattice.height).fill(Number.NaN);
const sources = [];
const minimumNorthing = lattice.originNorthing - (lattice.height - 1) * 32;
const maximumEasting = lattice.originEasting + (lattice.width - 1) * 32;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const start = Date.now();

for (let north = Math.floor(minimumNorthing / 10000); north <= Math.floor(lattice.originNorthing / 10000); north++) {
  for (let east = Math.floor(lattice.originEasting / 10000); east <= Math.floor(maximumEasting / 10000); east++) {
    const id = `${north}_${east}`;
    const metadataUrl = `https://api.lantmateriet.se/stac-hojd/v1/collections/dtm-cog/items/${id}`;
    const metadataResponse = await fetch(metadataUrl, { signal: AbortSignal.timeout(30000) });
    if (!metadataResponse.ok) throw new Error(`${id} metadata HTTP ${metadataResponse.status}; missing data is not filled`);
    const metadataBytes = Buffer.from(await metadataResponse.arrayBuffer());
    const item = JSON.parse(metadataBytes);
    const asset = item.assets.data;
    const url = new URL(asset.href);
    if (url.hostname !== 'dl1.lantmateriet.se' || !url.pathname.startsWith('/hojd/data/grid/mhm/')) throw new Error('Unexpected DTM source host/product');
    const head = await fetch(url, { method: 'HEAD', headers, signal: AbortSignal.timeout(30000) });
    if (!head.ok) throw new Error(`${id} data access HTTP ${head.status}`);
    const range = httpRange(url.href, { authorization: headers.Authorization, timeoutMs: 60000 });
    const cog = await openCog(range);
    if (cog.epsg !== 3006 || cog.originX !== east * 10000 || cog.originY !== (north + 1) * 10000) throw new Error(`${id} georeferencing mismatch`);
    const level = cog.levelForFactor(32);
    if (!level) throw new Error(`${id} has no factor-32 overview`);
    const c0 = Math.max(0, Math.ceil((cog.originX - lattice.originEasting) / 32));
    const c1 = Math.min(256, Math.floor((cog.originX + cog.width - lattice.originEasting) / 32 - 1e-9));
    const r0 = Math.max(0, Math.ceil((lattice.originNorthing - cog.originY) / 32));
    const r1 = Math.min(256, Math.floor((lattice.originNorthing - (cog.originY - cog.height)) / 32 - 1e-9));
    const px = e => (e - level.originX) / level.pixelScaleX - 0.5;
    const py = n => (level.originY - n) / level.pixelScaleY - 0.5;
    const pc0 = Math.max(0, Math.floor(px(lattice.originEasting + c0 * 32)));
    const pc1 = Math.min(level.width - 1, Math.ceil(px(lattice.originEasting + c1 * 32)));
    const pr0 = Math.max(0, Math.floor(py(lattice.originNorthing - r0 * 32)));
    const pr1 = Math.min(level.height - 1, Math.ceil(py(lattice.originNorthing - r1 * 32)));
    const columns = pc1 - pc0 + 1, rows = pr1 - pr0 + 1;
    const values = await level.readWindow({ column0: pc0, row0: pr0, columns, rows });
    const at = (c, r) => values[Math.max(0, Math.min(rows - 1, r)) * columns + Math.max(0, Math.min(columns - 1, c))];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const x = px(lattice.originEasting + c * 32) - pc0;
      const y = py(lattice.originNorthing - r * 32) - pr0;
      const west = Math.floor(x), top = Math.floor(y), tx = x - west, ty = y - top;
      const a = at(west, top), b = at(west + 1, top), d = at(west, top + 1), e = at(west + 1, top + 1);
      if (![a, b, d, e].every(Number.isFinite)) throw new Error(`${id} has nodata in the vista; no inferred sea fill is authorized`);
      samples[r * 257 + c] = (a + (b - a) * tx) * (1 - ty) + (d + (e - d) * tx) * ty;
    }
    sources.push({ id, href: url.href, stacUrl: metadataUrl, stacResponseSha256: sha256(metadataBytes),
      advertisedChecksum: asset['file:checksum'] ?? null, sourceBbox: item.bbox, sourceCapture: item.properties.datetime ?? null,
      etag: head.headers.get('etag'), sourceBytes: Number(head.headers.get('content-length')),
      overviewFactor: 32, overviewPixelScaleMetres: [level.pixelScaleX, level.pixelScaleY],
      sourceWindow: { column0: pc0, row0: pr0, columns, rows }, transfer: { ...range.transfer } });
    level.dropCache();
    console.log(`${id}: ${columns} x ${rows} overview window; ${range.transfer.bytes} range bytes`);
  }
}
let minimum = Infinity, maximum = -Infinity;
for (const value of samples) {
  if (!Number.isFinite(value) || value < -10 || value > 150) throw new Error(`Uncovered or implausible vista sample ${value}`);
  minimum = Math.min(minimum, value); maximum = Math.max(maximum, value);
}
fs.mkdirSync(OUT, { recursive: true });
const bytes = Buffer.from(samples.buffer);
const rasterPath = path.join(OUT, 'terrain-vista.f32');
fs.writeFileSync(rasterPath, bytes);
const report = { schemaVersion: 1, groundId: 'lidingo', state: 'acquired-background-terrain-candidate',
  acquiredAt: new Date().toISOString(), horizontalCrs: 'EPSG:3006', verticalCrs: 'EPSG:5613', compoundCrs: 'EPSG:5845',
  lattice, bounds: { minEasting: lattice.originEasting, maxEasting: maximumEasting, minNorthing: minimumNorthing, maxNorthing: lattice.originNorthing },
  raster: { path: path.relative(ROOT, rasterPath).replaceAll(path.sep, '/'), format: 'row-major little-endian Float32, north-up', bytes: bytes.length, sha256: sha256(bytes) },
  sources, samples: { total: samples.length, finite: samples.length, minimumHeightRH2000: minimum, maximumHeightRH2000: maximum },
  method: 'Bilinear sampling of factor-32 COG overviews onto a 32 m lattice aligned to the finest ground sample-centre lattice; edge sampling clamped inside each source item.',
  licence: 'CC-BY-4.0', attribution: 'Markhojdmodell Nedladdning, © Lantmateriet, processed information, CC BY 4.0.',
  durationMilliseconds: Date.now() - start,
  limitations: ['Background terrain only; fine playing terrain is not replaced.', 'Coarse overviews average shores and local relief; no independent local accuracy claim.', 'No missing samples, procedural sea fill or unknown heights substituted.', 'Adjacent 10 km source seams require runtime terrain/ring review.'] };
fs.writeFileSync(path.join(OUT, 'terrain-vista.json'), JSON.stringify(report, null, 2) + '\n');
fs.mkdirSync(path.dirname(REPORT), { recursive: true });
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ raster: report.raster, samples: report.samples }));
