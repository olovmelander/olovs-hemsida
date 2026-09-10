// Reference-only bounded extraction. Run from repository root with node --env-file=.env.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { openItem, readWindow } from '../../../packages/course-geo/copc-reader/copc-window.mjs';
import { lantmaterietCredentials, authorizationHeaders } from '../../../packages/course-geo/acquisition/credentials.mjs';

const outDir = 'upsalabuild/cache/facilities-reference-2026-09-10/lidar';
const cataloguePath = 'geo_data/course-v2/upsala/acquisition/laser-campaigns.json';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const catalogueBytes = fs.readFileSync(cataloguePath);
const catalogue = JSON.parse(catalogueBytes);
const source = catalogue.items.find(item => item.id === '21c037-663_63');
const bbox = [639730, 6636270, 639980, 6636520];
const credentials = lantmaterietCredentials();
if (!credentials) throw new Error('Lantmateriet credentials are not configured');
const headers = authorizationHeaders(credentials);
const redact = error => {
  let message = String(error?.message || error);
  for (const value of [...Object.values(headers), ...Object.values(credentials)]) {
    if (typeof value === 'string' && value.length > 3) message = message.split(value).join('<redacted>');
  }
  return message.slice(0, 600);
};
try {
  const head = await fetch(source.assets.data.href, { method: 'HEAD', headers, signal: AbortSignal.timeout(60000) });
  if (head.status !== 200) throw new Error(`Source HEAD returned HTTP ${head.status}`);
  if (Number(head.headers.get('content-length')) !== source.assets.data.bytes) throw new Error('Source length differs from pinned catalogue');
  console.log('Verified source byte length; opening bounded COPC reader.');
  const opened = await openItem({ url: source.assets.data.href, headers, timeoutMs: 60000 });
  if (opened.header.pointCount !== source.stacPointCount) throw new Error('LAS point count differs from pinned catalogue');
  const wkt = opened.copc.wkt;
  if (!wkt || !/SWEREF.?99.?TM/i.test(wkt) || !/RH.?2000/i.test(wkt)) throw new Error('LAS WKT did not independently confirm SWEREF 99 TM and RH 2000');
  console.log(`LAS CRS verified. Reading ${bbox.join(', ')}.`);
  const window = await readWindow(opened, bbox);
  const p = window.points;
  if (!p.count || p.count > 1000000) throw new Error(`Unexpected bounded-window point count ${p.count}`);
  fs.mkdirSync(outDir, { recursive: true });
  const lines = ['easting,northing,height_rh2000,classification,return_number,number_of_returns,intensity'];
  for (let i = 0; i < p.count; i++) lines.push(`${p.x[i].toFixed(2)},${p.y[i].toFixed(2)},${p.z[i].toFixed(2)},${p.classification[i]},${p.returnNumber[i]},${p.numberOfReturns[i]},${p.intensity[i]}`);
  const csv = Buffer.from(lines.join('\n') + '\n');
  const zipped = gzipSync(csv);
  const pointPath = `${outDir}/clubhouse-central-2021.csv.gz`;
  const wktPath = `${outDir}/source-crs.wkt`;
  fs.writeFileSync(pointPath, zipped);
  fs.writeFileSync(wktPath, wkt);
  const report = {
    schemaVersion: 1, purpose: 'Reference only: original classified laser returns; no roof, eave or floor-height adoption.',
    acquiredAt: new Date().toISOString(), sourceCatalogue: { path: cataloguePath, sha256: sha(catalogueBytes) },
    source: { itemId: source.id, href: source.assets.data.href, catalogueFullAssetSha256: source.assets.data.sha256, fullAssetHashIndependentlyVerified: false,
      expectedBytes: source.assets.data.bytes, observedBytes: Number(head.headers.get('content-length')), observedEtag: head.headers.get('etag'),
      capturedAt: source.capturedAt, captureStart: source.captureStart, captureEnd: source.captureEnd, scanArea: source.scanArea,
      licence: catalogue.terms.licence, attribution: catalogue.terms.attribution },
    crs: { horizontal: 'EPSG:3006', vertical: 'EPSG:5613', compoundCatalogue: source.assets.data.projCode,
      verticalDatum: 'RH 2000', lasWktVerified: true, lasWktPath: wktPath, lasWktSha256: sha(Buffer.from(wkt)), lasWkt: wkt },
    window: { bboxEpsg3006: bbox, widthMetres: bbox[2]-bbox[0], heightMetres: bbox[3]-bbox[1], boundaryRule: 'minimum inclusive, maximum exclusive' },
    header: opened.header, hierarchyPages: opened.hierarchyPages, statistics: window.statistics, transfer: opened.transfer,
    points: { path: pointPath, sha256: sha(zipped), compressedBytes: zipped.length, uncompressedBytes: csv.length,
      csvSha256: sha(csv), rows: p.count, format: 'gzip CSV, original dimensions, coordinates rounded to source LAS 0.01 metre quantisation', rawCloudPublished: false },
    limitations: ['2021 acquisition is earlier than 2025 orthophotography and 2026 municipal building records.', 'LAS class 1 is unclassified; points over a footprint are not automatically roof points.', 'No plane segmentation, eave/ridge survey or physical-building height adoption is performed.']
  };
  fs.writeFileSync(path.join(outDir, 'window-acquisition.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ pointPath, points: p.count, byClass: window.statistics.byClass, transfer: opened.transfer }));
} catch (error) {
  console.error(redact(error));
  process.exitCode = 1;
}
