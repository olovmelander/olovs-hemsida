#!/usr/bin/env node
/* Stage 0 of the vegetation plan: the credential-safe hierarchy census.

   usage: node packages/course-geo/acquisition/run-copc-census.mjs
            --ground puttom [--write] [--full] [--items id,id] [--observed-on YYYY-MM-DD]

   Reads only the LAS header, the COPC info VLR and the hierarchy pages of
   every pinned item (superseded ones included, for comparison) over
   authenticated range requests, and writes per-window point totals to
   geo_data/course-v2/<ground>/acquisition/copc-hierarchy-census.json. The
   windows are the AOI, a 1024 m square on the legacy origin (which straddles
   the seam on purpose), 512 m squares either side of every seam, and the
   per-hole 256 m control windows. No point byte is read; no URL with a
   credential and no error text carrying one is ever written.               */
import fs from 'node:fs';
import path from 'node:path';
import { readJson, sha256File } from '../manifest.mjs';
import { COURSE_DATA_DIR, PILOT_GROUND_IDS, loadPilotManifest } from './pilots.mjs';
import { authorizationHeaders, credentialState, lantmaterietCredentials } from './credentials.mjs';
import { alignedControlWindows } from './hole-source-controls.mjs';
import { hierarchyCensus, httpRangeReader } from './copc-hierarchy-census.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? fallback : args[index + 1];
};
const groundId = flag('ground');
const write = args.includes('--write');
const full = args.includes('--full');
const onlyItems = (flag('items', '') || '').split(',').filter(Boolean);
const observedOn = flag('observed-on', new Date().toISOString().slice(0, 10));
if (!PILOT_GROUND_IDS.includes(groundId)) {
  console.error(`--ground must be one of ${PILOT_GROUND_IDS.join(', ')}`);
  process.exit(2);
}

const groundDir = path.join(COURSE_DATA_DIR, groundId);
const campaignsPath = path.join(groundDir, 'acquisition/laser-campaigns.json');
if (!fs.existsSync(campaignsPath)) {
  console.error('no pinned campaign inventory; run record-laser-campaigns.mjs --write first');
  process.exit(1);
}
const campaigns = readJson(campaignsPath);
const manifest = loadPilotManifest(groundId);
const credentials = lantmaterietCredentials();
if (!credentials) {
  console.error('Lantmäteriet credentials are required (LANTMATERIET_USERNAME/PASSWORD or LANTMATERIET_BEARER_TOKEN)');
  process.exit(1);
}
const headers = authorizationHeaders(credentials);
const redact = text => {
  let out = String(text);
  for (const value of Object.values(headers)) out = out.split(value).join('<redacted>');
  if (credentials.password) out = out.split(credentials.password).join('<redacted>');
  if (credentials.username) out = out.split(credentials.username).join('<redacted>');
  return out.slice(0, 300);
};

function safeCopcUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'dl1.lantmateriet.se' ||
      !url.pathname.startsWith('/hojd/data/pointcloud/sls/') || !url.pathname.endsWith('.copc.laz') ||
      url.search || url.hash || url.username || url.password) {
    throw new Error('refusing a data URL that is not a Laserdata Skog COPC asset');
  }
  return url;
}

/* census windows */
const aoi = campaigns.aoi.bboxEpsg3006;
const windows = [{ id: 'aoi', bboxEpsg3006: aoi, role: 'whole AOI' }];
if (campaigns.origin) {
  const { easting, northing } = campaigns.origin;
  windows.push({ id: 'origin-1024', bboxEpsg3006: [easting - 512, northing - 512, easting + 512, northing + 512], role: 'legacy origin, straddles the seam' });
}
for (const seam of campaigns.seams) {
  const mid = campaigns.origin ? (seam.axis === 'northing' ? campaigns.origin.easting : campaigns.origin.northing) : (seam.from + seam.to) / 2;
  const along = [Math.max(seam.from, mid - 256), Math.min(seam.to, mid + 256)];
  if (seam.axis === 'northing') {
    windows.push({ id: `${seam.id}-north-512`, bboxEpsg3006: [along[0], seam.value, along[1], seam.value + 512], role: 'north of the seam' });
    windows.push({ id: `${seam.id}-south-512`, bboxEpsg3006: [along[0], seam.value - 512, along[1], seam.value], role: 'south of the seam' });
  } else {
    windows.push({ id: `${seam.id}-east-512`, bboxEpsg3006: [seam.value, along[0], seam.value + 512, along[1]], role: 'east of the seam' });
    windows.push({ id: `${seam.id}-west-512`, bboxEpsg3006: [seam.value - 512, along[0], seam.value, along[1]], role: 'west of the seam' });
  }
}
/* per-hole 256 m control windows from the committed EPSG:3006 migration model */
const modelPath = path.join(groundDir, 'migration/course-model.epsg3006.json');
let holeWindows = 0;
if (fs.existsSync(modelPath)) {
  const model = readJson(modelPath);
  const seen = new Set();
  for (const hole of model.geometry?.holes || model.holes || []) {
    const points = [...(hole.line || []), ...(hole.green?.ring || [])];
    if (!points.length) continue;
    const xs = points.map(point => point[0]);
    const ys = points.map(point => point[1]);
    const bbox = [Math.min(...xs) - 48, Math.min(...ys) - 48, Math.max(...xs) + 48, Math.max(...ys) + 48];
    for (const window of alignedControlWindows(bbox, { spanMetres: 256 })) {
      if (seen.has(window.id)) continue;
      seen.add(window.id);
      windows.push({ id: window.id, bboxEpsg3006: [...window.bboxEpsg3006], role: `hole ${hole.n ?? hole.number ?? '?'} control window` });
      holeWindows++;
    }
  }
}
console.log(`${groundId}: ${windows.length} census windows (${holeWindows} per-hole), credentials ${credentialState(credentials)}`);

const items = campaigns.items.filter(item => !onlyItems.length || onlyItems.includes(item.id));
const results = [];
let failures = 0;
for (const item of items) {
  const url = safeCopcUrl(item.assets.data.href);
  process.stdout.write(`  ${item.id} (${item.role}, ${item.captureStart?.slice(0, 10)}): `);
  try {
    const census = await hierarchyCensus({
      range: httpRangeReader(url.href, { headers }),
      windows,
      full,
    });
    const headerMatches = census.header.pointCount === item.statistics?.pointCount;
    console.log(`${census.hierarchy.nodes} nodes over ${census.hierarchy.pagesRead} page(s), header ${census.header.pointCount} points ${headerMatches ? '(matches info)' : '(DIFFERS from info)'}, ${census.transfer.bytes} bytes in ${census.transfer.requests} requests`);
    for (const window of census.windows) {
      console.log(`      ${window.id.padEnd(28)} ${String(window.estimatedPoints).padStart(10)} pts  ${String(window.estimatedAllReturnDensityPerSquareMetre).padStart(7)} /m²  deepest ${window.deepestDepth} (${window.deepestNodeSizeMetres} m), empty ${window.deepestNodesEmpty}/${window.deepestNodesTouched}`);
    }
    results.push({ itemId: item.id, role: item.role, captureStart: item.captureStart, captureEnd: item.captureEnd, status: 'ok', headerMatchesInfo: headerMatches, ...census });
  } catch (error) {
    failures++;
    const message = redact(error.message);
    console.log(`FAILED: ${message}`);
    results.push({ itemId: item.id, role: item.role, captureStart: item.captureStart, captureEnd: item.captureEnd, status: /denied|401|403/.test(message) ? 'denied' : 'failed', error: message });
  }
}

const report = {
  schemaVersion: 1,
  groundId,
  groundName: manifest.groundName,
  observedOn,
  state: failures ? 'incomplete' : 'census-complete',
  campaignsSha256: sha256File(campaignsPath),
  method: 'LAS header + COPC info VLR + hierarchy pages over authenticated HTTP range requests; point counts are area-weighted sums of octree nodes; no point bytes were read',
  full,
  windows: windows.map(window => ({ id: window.id, role: window.role, bboxEpsg3006: window.bboxEpsg3006 })),
  items: results,
};
if (write) {
  const outputPath = path.join(groundDir, 'acquisition/copc-hierarchy-census.json');
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`  wrote ${path.relative(process.cwd(), outputPath)} sha256 ${sha256File(outputPath)}`);
}
process.exit(failures ? 1 : 0);
