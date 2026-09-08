#!/usr/bin/env node
/* Retain one bounded source window for roof/footprint correspondence.
 * node --env-file=.env lidingobuild/acquire-building-laser.mjs [--refresh]
 * Classification 1 is unclassified: a footprint does not prove a roof return. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { authorizationHeaders, lantmaterietCredentials } from '../packages/course-geo/acquisition/credentials.mjs';
import { openItem, readWindow } from '../packages/course-geo/copc-reader/copc-window.mjs';
import { LIDINGO_CANOPY_CONFIG as CONFIG, assertLidingoLaserSource } from '../packages/course-geo/copc-reader/lidingo-canopy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BBOX = [677610, 6586220, 677710, 6586550];
const RAW = 'lidingobuild/cache/buildings/laser-2021-points.json';
const EVIDENCE = 'lidingobuild/mapping/building-laser-acquisition.json';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));

async function main() {
  if (process.argv.slice(2).some(arg => arg !== '--refresh')) throw new Error('Only --refresh is supported');
  if (!process.argv.includes('--refresh') && fs.existsSync(path.join(ROOT, EVIDENCE))) {
    const prior = read(EVIDENCE);
    if (prior.source.catalogueSha256 !== CONFIG.sourceSha256 || JSON.stringify(prior.bboxEpsg3006) !== JSON.stringify(BBOX) ||
        hash(fs.readFileSync(path.join(ROOT, prior.rasterlessPoints.path))) !== prior.rasterlessPoints.sha256) throw new Error('Retained building laser source differs');
    console.log(JSON.stringify({ state: 'retained-bounded-source-verified', points: prior.statistics.pointsInWindow, evidence: EVIDENCE }));
    return;
  }
  const source = assertLidingoLaserSource(read('geo_data/course-v2/lidingo/acquisition/d2-discovery.json').laser.items.find(i => i.id === CONFIG.campaignId));
  const credentials = lantmaterietCredentials();
  if (!credentials) throw new Error('Configured Lantmateriet credentials are required');
  const headers = authorizationHeaders(credentials);
  const head = await fetch(CONFIG.sourceHref, { method: 'HEAD', headers, signal: AbortSignal.timeout(60000) });
  if (head.status !== 200 || head.headers.get('etag') !== CONFIG.sourceEtag || Number(head.headers.get('content-length')) !== CONFIG.sourceBytes) throw new Error(`Pinned laser changed or unavailable (HTTP ${head.status})`);
  const opened = await openItem({ url: source.assets.data.href, headers });
  if (opened.header.pointCount !== CONFIG.sourcePoints) throw new Error('Pinned laser point count differs');
  const window = await readWindow(opened, BBOX);
  const p = window.points;
  const rows = Array.from({ length: p.count }, (_, i) => [p.x[i], p.y[i], p.z[i], p.classification[i], p.returnNumber[i], p.numberOfReturns[i]]);
  const payload = { columns: ['easting', 'northing', 'heightRH2000', 'classification', 'returnNumber', 'numberOfReturns'], points: rows };
  const bytes = Buffer.from(JSON.stringify(payload) + '\n');
  fs.mkdirSync(path.dirname(path.join(ROOT, RAW)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, RAW), bytes);
  const report = { schemaVersion: 1, groundId: 'lidingo', state: 'bounded-point-window-retained', retrievedAt: new Date().toISOString(),
    capturedAt: '2021-03-23', horizontalCrs: 'EPSG:3006', verticalCrs: 'EPSG:5613', bboxEpsg3006: BBOX,
    source: { sourceId: 'laser-lm-skog', itemId: CONFIG.campaignId, href: CONFIG.sourceHref, catalogueSha256: CONFIG.sourceSha256,
      etag: CONFIG.sourceEtag, bytes: CONFIG.sourceBytes, fullAssetSha256Verified: false },
    rasterlessPoints: { path: RAW, sha256: hash(bytes), bytes: bytes.length }, statistics: window.statistics, transfer: opened.transfer,
    method: 'Every source point in the bounded window, all intersecting COPC hierarchy nodes, exact decoded node counts. No point classification is changed.',
    limitations: ['Classification 1 is unclassified and includes roof and vegetation returns. Footprint/interior selection is a spatial hypothesis, not a building classifier.',
      'The 2021 source and 2019 roof image cannot prove current building outlines or current use.', 'Full asset SHA not verified: bounded reads retain the source identity, ETag, size and exact node counts.'] };
  fs.writeFileSync(path.join(ROOT, EVIDENCE), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ state: report.state, statistics: report.statistics, transfer: report.transfer, evidence: EVIDENCE }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
