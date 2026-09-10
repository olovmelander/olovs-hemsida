// Run: node --env-file=.env angsobuild/facilities/acquire-facilities-laser.mjs
// Bounded classified 2021 COPC returns for architecture reference; no runtime edits.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openItem, readWindow } from '../../packages/course-geo/copc-reader/copc-window.mjs';
import { authorizationHeaders, lantmaterietCredentials } from '../../packages/course-geo/acquisition/credentials.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const campaigns = JSON.parse(fs.readFileSync(path.join(root, 'geo_data/course-v2/angso/acquisition/laser-campaigns.json')));
const source = campaigns.items.find(item => item.id === '21c036-660_60');
if (!source) throw new Error('Pinned Angso 2021 laser source missing');
const windows = [
  { id: 'campus-range', bbox: [605400, 6604760, 605690, 6605320] },
  { id: 'northern-service-context', bbox: [605570, 6606090, 605680, 6606200] },
];
const relativeOutput = 'angsobuild/cache/facilities-2026-09-10/laser';
const output = path.join(root, relativeOutput);
fs.mkdirSync(output, { recursive: true });
const credentials = lantmaterietCredentials();
if (!credentials) throw new Error('Local Lantmateriet credentials are required');
const opened = await openItem({ url: source.assets.data.href, headers: authorizationHeaders(credentials) });
const rows = [], windowReports = [];
for (const window of windows) {
  const b = window.bbox, s = source.projBbox;
  if (!(b[0] >= s[0] && b[1] >= s[1] && b[2] <= s[2] && b[3] <= s[3])) throw new Error('Window escapes pinned laser source');
  console.log(JSON.stringify({ state: 'reading-focused-window', sourceId: source.id, ...window }));
  const { points, statistics } = await readWindow(opened, b);
  for (let i = 0; i < points.count; i++) rows.push([
    points.x[i], points.y[i], Math.round(points.z[i] * 100) / 100,
    points.classification[i], points.returnNumber[i], points.numberOfReturns[i], points.intensity[i],
  ]);
  windowReports.push({ ...window, pointCount: points.count, statistics });
  console.log(JSON.stringify({ state: 'window-complete', id: window.id, points: points.count }));
}
const raw = JSON.stringify({ columns: ['easting', 'northing', 'heightRH2000', 'classification', 'returnNumber', 'numberOfReturns', 'intensity'], points: rows });
fs.writeFileSync(path.join(output, 'points.json'), raw);
const metadata = {
  schemaVersion: 1, groundId: 'angso', acquiredAt: new Date().toISOString(),
  sourceId: source.id, capturedAt: source.capturedAt, captureStart: source.captureStart, captureEnd: source.captureEnd,
  captureDateMeaning: 'STAC campaign nominal timestamp and campaign interval. Individual point GPS times were not retained by this reader.',
  declaredPointDensityPerSquareMetre: source.declaredPointDensityPerSquareMetre,
  sourceUrl: source.assets.data.href, sourceSha256: source.assets.data.sha256,
  sourceChecksumVerification: 'Pinned catalog SHA-256. Focused HTTP range reads do not verify the complete 1.01 GB source checksum.',
  compoundCrs: 'EPSG:5845', horizontalCrs: 'EPSG:3006', verticalDatum: 'RH2000',
  licence: campaigns.terms.licence, attribution: campaigns.terms.attribution, termsUrl: campaigns.terms.url,
  windows: windowReports, pointCount: rows.length, transfer: opened.transfer,
  localPointsSha256: createHash('sha256').update(raw).digest('hex'), localPointsPath: `${relativeOutput}/points.json`,
  limitations: [
    'Laser capture interval is March 8-April 1 2021. The June 2026 publication timestamp does not mean a 2026 scan.',
    'Roof reconstruction is constrained by sparse forestry laser returns; nominal acquisition density is 1.2 points per square metre.',
    'LAS class 1 means unclassified, not building. Elevated planar returns need orthophoto and photographic interpretation.',
    'The bare-earth terrain cannot measure roofs. These source returns include nonground heights.',
    'Five years of possible roof and facility changes separate capture and modelling; current structure requires photographic/orthophoto confirmation.',
  ],
};
fs.writeFileSync(path.join(output, 'acquisition.json'), `${JSON.stringify(metadata, null, 2)}\n`);
console.log(JSON.stringify(metadata));
