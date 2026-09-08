#!/usr/bin/env node
/* node --env-file=.env geo_data/course-v2/visby/reference/acquire-access-evidence.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { authorizationHeaders, lantmaterietCredentials } from '../../../../packages/course-geo/acquisition/credentials.mjs';
import { probeLantmaterietTerrainAccess, probeLantmaterietLaserAccess } from '../../../../packages/course-geo/acquisition/access-preflight.mjs';
import { probeOrthoAccess } from '../../../../packages/course-geo/acquisition/ortho-window.mjs';

const reference = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(reference, '../../../..');
const cache = path.join(root, 'visbybuild/cache/geodata-2026-09-07');
const report = JSON.parse(fs.readFileSync(path.join(reference, '../acquisition/d2-discovery.json')));
const credentials = lantmaterietCredentials();
const write = (name,value) => fs.writeFileSync(path.join(reference,name), JSON.stringify(value,null,2)+'\n');
const preflight = {
  groundId: 'visby', observedAt: new Date().toISOString(), credentialState: credentials?.type || 'missing',
  terrain: await probeLantmaterietTerrainAccess(report, { credentials }).catch(error => ({ error: error.message })),
  laser: await probeLantmaterietLaserAccess(report, { credentials }).catch(error => ({ error: error.message })),
  orthophoto: await probeOrthoAccess(report, { credentials }),
};
write('lm-access-preflight.json', preflight);

const records = [];
async function retain(asset, kind, authenticated) {
  const url = new URL(asset.href);
  if (url.origin !== 'https://dl1.lantmateriet.se' || url.search || url.username || url.password) throw new Error('unexpected data source');
  const file = path.join(cache, path.basename(url.pathname));
  const ledger = file + '.download.json';
  let bytes;
  let record;
  if (fs.existsSync(file) && fs.existsSync(ledger)) {
    bytes = fs.readFileSync(file);
    record = JSON.parse(fs.readFileSync(ledger));
  } else {
    const response = await fetch(url, { headers: authenticated ? authorizationHeaders(credentials) : {}, redirect: 'error', signal: AbortSignal.timeout(45_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    bytes = Buffer.from(await response.arrayBuffer());
    record = { url: url.href, kind, acquiredAt: new Date().toISOString(), path: path.relative(root,file).replaceAll(path.sep,'/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), etag: response.headers.get('etag'), contentType: response.headers.get('content-type') };
  }
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== record.sha256 || (asset.sha256 && hash !== asset.sha256) || (asset.bytes && bytes.length !== asset.bytes)) throw new Error(`pinned source changed: ${url}`);
  fs.writeFileSync(file, bytes);
  fs.writeFileSync(ledger, JSON.stringify(record,null,2)+'\n');
  records.push({ ...record, sizeVerified: true, checksumVerified: true });
}
for (const item of report.metadataEvidence) await retain({ href:item.href, bytes:item.expectedBytes, sha256:item.expectedSha256 }, 'public-product-metadata', false);
if (preflight.terrain.ready) for (const item of report.terrain.items) await retain(item.assets.breakgeometry, 'water-breakgeometry-geopackage', true);
write('lm-retained-assets.json', { schemaVersion:1, groundId:'visby', assets:records, limitations:['Water break geometry describes terrain-model water flattening, not bathymetry or golf penalty-area status.', 'All metadata hashes checked against the pinned discovery response.', 'No credentials or authorization headers are retained.'] });
console.log(JSON.stringify({ preflight, retainedAssets:records.length, retainedBytes:records.reduce((sum,item)=>sum+item.bytes,0) },null,2));
