// Run: node --env-file=.env puttombuild/facilities/acquire-facilities-laser.mjs
// Read the complete classified point window via bounded authenticated COPC ranges.
// Credentials and raw returns are never published; aggregates are modelling evidence.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openItem, readWindow } from '../../packages/course-geo/copc-reader/copc-window.mjs';
import { authorizationHeaders, lantmaterietCredentials } from '../../packages/course-geo/acquisition/credentials.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const campaigns = JSON.parse(fs.readFileSync(path.join(root, 'geo_data/course-v2/puttom/acquisition/laser-campaigns.json')));
const source = campaigns.items.find(item => item.id === '23f028-702_69');
const bbox = [697235, 7025130, 697605, 7025430];
const relativeOutput = 'puttombuild/cache/facilities-reference-2026-09-10/laser';
const output = path.join(root, relativeOutput);
fs.mkdirSync(output, { recursive: true });
if (bbox[1] < 7025000) throw new Error('Window crosses campaign boundary; never merge campaigns implicitly');
const credentials = lantmaterietCredentials();
if (!credentials) throw new Error('Local Lantmateriet credentials are required');
const opened = await openItem({ url: source.assets.data.href, headers: authorizationHeaders(credentials) });
console.log(JSON.stringify({ state: 'reading-focused-window', sourceId: source.id, boundsEpsg3006: bbox }));
const { points, statistics } = await readWindow(opened, bbox);
const rows = Array.from({ length: points.count }, (_, i) => [
  points.x[i], points.y[i], Math.round(points.z[i] * 100) / 100,
  points.classification[i], points.returnNumber[i], points.numberOfReturns[i], points.intensity[i],
]);
const raw = JSON.stringify({ columns: ['easting', 'northing', 'heightRH2000', 'classification', 'returnNumber', 'numberOfReturns', 'intensity'], points: rows });
fs.writeFileSync(path.join(output, 'points.json'), raw);
const metadata = {
  schemaVersion: 1, groundId: 'puttom', acquiredAt: new Date().toISOString(),
  sourceId: source.id, capturedAt: source.capturedAt, captureStart: source.captureStart, captureEnd: source.captureEnd,
  captureDateMeaning: 'STAC campaign nominal timestamp and interval; nearby pinned scan metadata reports 2023-06-07. Individual point GPS times were not retained by this reader.',
  nearbyPinnedScanMetadata: campaigns.scanMetadata.filter(entry => entry.entries.some(scan => scan.scanName.startsWith('23F028'))),
  sourceUrl: source.assets.data.href, sourceSha256: source.assets.data.sha256,
  sourceChecksumVerification: 'Pinned catalog SHA-256. Focused HTTP range reads do not verify the complete 1.06 GB source checksum.',
  compoundCrs: 'EPSG:5845', horizontalCrs: 'EPSG:3006', verticalDatum: 'RH2000',
  licence: campaigns.terms.licence, attribution: campaigns.terms.attribution, termsUrl: campaigns.terms.url,
  boundsEpsg3006: bbox, statistics, transfer: opened.transfer,
  localPointsSha256: createHash('sha256').update(raw).digest('hex'), localPointsPath: `${relativeOutput}/points.json`,
  limitations: [
    'This is the active June 2023 northern campaign, not June 2026 data from south of N=7025000.',
    'LAS class 1 means unclassified, not building. Elevated planar returns need orthophoto and photographic interpretation.',
    'The published bare-earth terrain cannot measure roof height; this acquisition retains nonground returns.',
  ],
};
fs.writeFileSync(path.join(output, 'acquisition.json'), `${JSON.stringify(metadata, null, 2)}\n`);
console.log(JSON.stringify(metadata));
