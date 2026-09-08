#!/usr/bin/env node
// Read-only acquisition of the municipality's public primary-map survey records.
// Raw source responses must remain in an ignored cache, never in runtime models.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node geobuild/acquire-upsala-survey.mjs --out <new-cache-directory> [--layers 6278,562,564,570,571]\nDownloads public municipal metadata and EPSG:3006 geometry for the Upsala review window.\nThe destination must be empty; existing source evidence is never overwritten. No model is modified.');
  process.exit(0);
}
for (let i = 0; i < args.length; i += 2) {
  if (!['--out', '--layers'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) {
    throw new Error(`Unknown or incomplete argument: ${args[i]}; use --help`);
  }
}
const flag = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const out = path.resolve(flag('--out', 'upsalabuild/cache/review-2026-09-07/source-inventory/primary-map'));
if (!out.split(path.sep).includes('cache')) throw new Error('--out must be beneath a cache directory');
const bbox = [639100, 6635100, 641200, 6637200];
const layerIds = flag('--layers', '518,519,520,6179890,609,610,611,6292,6291,6287,6288,6289,536,513,514,575,62790,6279,6278,562,563,564,566,568,569,570,571,572,573').split(',').map(Number);
if (layerIds.some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error('Invalid layer list');
const base = 'https://kartportal.uppsala.se/mapping/rest/services/nPlanBygg/Bygglov_Primarkarta_utskrift/MapServer';
await fs.mkdir(out, {recursive: true});
if ((await fs.readdir(out)).length) throw new Error('Source cache is not empty; select a new --out directory to preserve prior evidence');
const records = [];
async function acquire(id, type, params) {
  const url = new URL(`${base}/${id}${type === 'query' ? '/query' : ''}`);
  url.search = new URLSearchParams({f: 'pjson', ...params});
  const response = await fetch(url, {signal: AbortSignal.timeout(120_000)});
  const bytes = Buffer.from(await response.arrayBuffer());
  const file = `${id}-${type}.json`;
  await fs.writeFile(path.join(out, file), bytes);
  const data = JSON.parse(bytes.toString());
  const record = {layer: id, type, url: String(url), file, status: response.status,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
    retrievedAt: new Date().toISOString(), featureCount: data.features?.length,
    exceededTransferLimit: data.exceededTransferLimit ?? false, error: data.error};
  records.push(record);
  if (!response.ok || data.error) throw new Error(JSON.stringify(record));
  return data;
}
let failed = false;
// Independent read-only requests, bounded concurrency to respect the public server.
for (let start = 0; start < layerIds.length; start += 3) {
  const batch = await Promise.allSettled(layerIds.slice(start, start + 3).map(async id => {
    const meta = await acquire(id, 'meta', {});
    const query = await acquire(id, 'query', {where: '1=1', geometry: bbox.join(','),
      geometryType: 'esriGeometryEnvelope', inSR: '3006', spatialRel: 'esriSpatialRelIntersects',
      outFields: '*', returnGeometry: 'true', outSR: '3006'});
    if (query.exceededTransferLimit) throw new Error(`Layer ${id}: incomplete response; refine the source window before use`);
    console.log(`${id} ${meta.name}: ${query.features?.length ?? 0}`);
  }));
  for (const result of batch) if (result.status === 'rejected') {failed = true; console.error(result.reason.message);}
}
await fs.writeFile(path.join(out, 'downloads.json'), JSON.stringify({schemaVersion: 1,
  provider: 'Uppsala kommun', service: base, queryCrs: 'EPSG:3006', bbox,
  retrievedAt: new Date().toISOString(), complete: !failed, records}, null, 2) + '\n');
if (failed) process.exitCode = 1;
