/* Bounded Tortuna roof evidence. Existing credentials stay in the environment.
 * node --env-file=../olovs-hemsida/.env tortunabuild/acquire-building-laser.mjs
 * A 500 m square covers the clubhouse, range service yard and nearby houses.
 * Classification 1 remains unclassified; footprint selection is a hypothesis.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { authorizationHeaders, lantmaterietCredentials } from '../packages/course-geo/acquisition/credentials.mjs';
import { openItem, readWindow } from '../packages/course-geo/copc-reader/copc-window.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BBOX = [597260, 6614860, 597760, 6615360];
const RAW = 'tortunabuild/cache/buildings/laser-2021-points.json';
const EVIDENCE = 'tortunabuild/mapping/building-laser-acquisition.json';
const SOURCE_SHA = '4354289e6e6e5c0e42188f62bda0400997e121704dc85a98d88e68b231508b45';
const hash = data => createHash('sha256').update(data).digest('hex');
const read = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));

async function main() {
  if (process.argv.slice(2).some(arg => arg !== '--refresh')) throw new Error('Unsupported argument');
  if (!process.argv.includes('--refresh') && fs.existsSync(path.join(ROOT, EVIDENCE))) {
    const previous = read(EVIDENCE);
    if (previous.source.catalogueSha256 !== SOURCE_SHA || JSON.stringify(previous.bboxEpsg3006) !== JSON.stringify(BBOX) ||
        hash(fs.readFileSync(path.join(ROOT, previous.rasterlessPoints.path))) !== previous.rasterlessPoints.sha256) throw new Error('Retained source changed');
    console.log(JSON.stringify({ state: 'retained-bounded-source-verified', points: previous.statistics.pointsInWindow }));
    return;
  }
  const source = read('geo_data/course-v2/tortuna/acquisition/d2-discovery.json').laser.items.find(item => item.id === '21c035-661_59');
  if (source.assets.data.sha256 !== SOURCE_SHA || source.assets.data.bytes !== 930359431 || source.projCode !== 'EPSG:5845') throw new Error('Pinned source changed');
  const credentials = lantmaterietCredentials();
  if (!credentials) throw new Error('Existing Lantmateriet credentials required');
  const headers = authorizationHeaders(credentials);
  const head = await fetch(source.assets.data.href, { method: 'HEAD', headers, redirect: 'error', signal: AbortSignal.timeout(60000) });
  if (head.status !== 200 || Number(head.headers.get('content-length')) !== source.assets.data.bytes) throw new Error('Pinned asset unavailable or changed');
  const opened = await openItem({ url: source.assets.data.href, headers });
  if (opened.header.pointCount !== source.pointCount) throw new Error('STAC and LAS point counts differ');
  const window = await readWindow(opened, BBOX);
  const p = window.points;
  const rows = Array.from({ length: p.count }, (_, i) => [p.x[i], p.y[i], p.z[i], p.classification[i], p.returnNumber[i], p.numberOfReturns[i]]);
  const bytes = Buffer.from(JSON.stringify({ columns: ['easting', 'northing', 'heightRH2000', 'classification', 'returnNumber', 'numberOfReturns'], points: rows }) + '\n');
  fs.mkdirSync(path.dirname(path.join(ROOT, RAW)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, RAW), bytes);
  const evidence = { schemaVersion: 1, groundId: 'tortuna', state: 'bounded-point-window-retained', retrievedAt: new Date().toISOString(),
    capturedAt: source.capturedAt, captureStart: source.captureStart, captureEnd: source.captureEnd,
    horizontalCrs: 'EPSG:3006', verticalCrs: 'EPSG:5613', bboxEpsg3006: BBOX,
    source: { sourceId: 'laser-lm-skog', itemId: source.id, href: source.assets.data.href, catalogueSha256: SOURCE_SHA,
      etag: head.headers.get('etag'), bytes: source.assets.data.bytes, fullAssetSha256Verified: false },
    rasterlessPoints: { path: RAW, bytes: bytes.length, sha256: hash(bytes) }, statistics: window.statistics, transfer: opened.transfer,
    method: 'All intersecting COPC hierarchy nodes with exact decoded counts; original points/classes retained within the bounded500m square.',
    limitations: ['Class1 includes vegetation and roofs; no building classification is inferred from a source footprint.',
      'The2021 campaign must be compared with2026 roof outlines before present-day reuse.',
      'The full930359431-byte source hash was not recomputed; bounded payload, source size, ETag and exact node counts are retained.'] };
  fs.writeFileSync(path.join(ROOT, EVIDENCE), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ state: evidence.state, statistics: evidence.statistics, transfer: evidence.transfer, payloadBytes: bytes.length }, null, 2));
}
main().catch(error => { console.error(`Tortuna building source failed: ${error.name} ${error.code || ''}`); process.exitCode = 1; });
