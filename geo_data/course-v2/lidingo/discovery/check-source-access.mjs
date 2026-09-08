import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { lantmaterietCredentials, authorizationHeaders } from '../../../../packages/course-geo/acquisition/credentials.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const report = JSON.parse(fs.readFileSync(new URL('../acquisition/d2-discovery.json', import.meta.url), 'utf8'));
const headers = authorizationHeaders(lantmaterietCredentials(process.env));
const targets = [
  { kind: 'water-breakgeometry', item: report.terrain.items[0], assetName: 'breakgeometry', download: true },
  { kind: 'laser-copc', item: report.laser.items[0], assetName: 'data' },
  { kind: 'orthophoto', item: report.orthophoto.items[0], assetName: 'data' },
];
const evidence = [];
for (const target of targets) {
  const asset = target.item.assets[target.assetName];
  const url = new URL(asset.href);
  if (url.protocol !== 'https:' || url.hostname !== 'dl1.lantmateriet.se') throw new Error('unexpected asset host');
  const response = await fetch(url, { method: target.download ? 'GET' : 'HEAD', headers, signal: AbortSignal.timeout(60000) });
  const record = { kind: target.kind, itemId: target.item.id, url: url.href, checkedAt: new Date().toISOString(), httpStatus: response.status, etag: response.headers.get('etag'), contentLength: Number(response.headers.get('content-length')) || null, lastModified: response.headers.get('last-modified'), state: response.ok ? 'access-confirmed-data-not-read' : 'access-not-available-with-configured-account' };
  if (response.ok && target.download) {
    const raw = Buffer.from(await response.arrayBuffer());
    if (raw.length > 16 * 1024 * 1024) throw new Error('break geometry exceeds 16 MiB');
    const hash = createHash('sha256').update(raw).digest('hex');
    if (hash !== asset.sha256 || raw.length !== asset.bytes) throw new Error('break-geometry checksum or size mismatch');
    const destination = path.join(ROOT, 'lidingobuild/cache/water-breakgeometry', `${target.item.id}.gpkg`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, raw);
    Object.assign(record, { state: 'downloaded-checksum-verified-unclipped', bytes: raw.length, sha256: hash, path: path.relative(ROOT, destination).split(path.sep).join('/') });
  }
  evidence.push(record);
}
const output = { schemaVersion: 1, groundId: 'lidingo', acquiredOn: new Date().toISOString().slice(0,10), credentialHandling: 'Existing ignored .env account used only in HTTP request headers; no credentials serialized.', sources: evidence };
fs.writeFileSync(new URL('./source-access.json', import.meta.url), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
