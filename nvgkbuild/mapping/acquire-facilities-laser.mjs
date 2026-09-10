// Focused, authenticated read of the pinned LM 2025 cloud. Raw returns stay in
// the ignored local cache; only aggregate modelling evidence is publishable.
// Run: node --env-file=.env nvgkbuild/mapping/acquire-facilities-laser.mjs
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { openItem, readWindow } from '../../packages/course-geo/copc-reader/copc-window.mjs';
import { authorizationHeaders, lantmaterietCredentials } from '../../packages/course-geo/acquisition/credentials.mjs';

const campaigns = JSON.parse(fs.readFileSync('geo_data/course-v2/norrfallsviken/acquisition/laser-campaigns.json'));
const source = campaigns.items.find(i => i.id === '25f014-698_67');
const contextOnly = process.argv.includes('--southern-context');
const bbox = contextOnly ? [678660, 6988190, 678710, 6988240] : [678520, 6988200, 678690, 6988460];
const output = `nvgkbuild/cache/facilities-reference/laser${contextOnly ? '-southern-context' : ''}`;
fs.mkdirSync(output, { recursive: true });
const credentials = lantmaterietCredentials();
if (!credentials) throw new Error('Local Lantmateriet credentials are required');
const opened = await openItem({ url: source.assets.data.href, headers: authorizationHeaders(credentials) });
console.log(JSON.stringify({ state: 'reading-focused-window', sourceId: source.id, bboxEpsg3006: bbox }));
const { points, statistics } = await readWindow(opened, bbox);
const rows = Array.from({ length: points.count }, (_, i) => [
  points.x[i], points.y[i], Math.round(points.z[i] * 100) / 100,
  points.classification[i], points.returnNumber[i], points.numberOfReturns[i], points.intensity[i],
]);
const raw = JSON.stringify({ columns: ['easting', 'northing', 'heightRH2000', 'classification', 'returnNumber', 'numberOfReturns', 'intensity'], points: rows });
fs.writeFileSync(`${output}/points.json`, raw);
const metadata = {
  schemaVersion: 1, groundId: 'norrfallsviken', acquiredOn: new Date().toISOString().slice(0, 10),
  sourceId: source.id, capturedAt: source.capturedAt, sourceUrl: source.assets.data.href,
  sourceSha256: source.assets.data.sha256,
  sourceChecksumVerification: 'Pinned catalog SHA-256; focused HTTP range reads do not verify the full 1.91 GB source checksum.',
  compoundCrs: 'EPSG:5845', horizontalCrs: 'EPSG:3006', verticalDatum: 'RH2000',
  licence: campaigns.terms.licence, attribution: campaigns.terms.attribution,
  boundsEpsg3006: bbox, statistics, transfer: opened.transfer,
  localPointsSha256: createHash('sha256').update(raw).digest('hex'),
  localPointsPath: `${output}/points.json`,
};
fs.writeFileSync(`${output}/acquisition.json`, `${JSON.stringify(metadata, null, 2)}\n`);
console.log(JSON.stringify(metadata));
