#!/usr/bin/env node
/* Pin, or re-check, the Laserdata Skog campaign inventory for one ground.

   usage: node packages/course-geo/acquisition/record-laser-campaigns.mjs
            --ground puttom [--write | --check] [--observed-on YYYY-MM-DD]

   --write  queries the public catalogue, the public per-item metadata and
            Skogsstyrelsen's scan-area layer, and writes the pinned inventory to
            geo_data/course-v2/<ground>/acquisition/laser-campaigns.json.
   --check  re-derives the live inventory and exits non-zero if the pinned set
            of items, their checksums, capture windows, roles or seams differ —
            the Stage 1 "re-pin or refuse" gate. A new north item at Puttom
            will trip it, which is the point: a re-fly must be adopted on
            purpose, never discovered by a screenshot.
   Without either flag the live inventory is printed and nothing is written.

   Nothing here needs credentials, and nothing here reads a point byte.       */
import fs from 'node:fs';
import path from 'node:path';
import { readJson, sha256File } from '../manifest.mjs';
import { ACQUISITION_GROUND_IDS, COURSE_DATA_DIR, loadPilotManifest } from './pilots.mjs';
import {
  campaignDrift,
  campaignInventory,
  fetchItemInfo,
  fetchLaserItems,
  fetchScanMetadata,
  itemStatisticsFromInfo,
  laserCampaignsReport,
  validateLaserCampaignsReport,
} from './laser-campaigns.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? fallback : args[index + 1];
};
const groundId = flag('ground');
const write = args.includes('--write');
const check = args.includes('--check');
const observedOn = flag('observed-on', new Date().toISOString().slice(0, 10));
if (!ACQUISITION_GROUND_IDS.includes(groundId)) {
  console.error(`--ground must be one of ${ACQUISITION_GROUND_IDS.join(', ')}`);
  process.exit(2);
}
if (write && check) {
  console.error('--write and --check are exclusive');
  process.exit(2);
}

const groundDir = path.join(COURSE_DATA_DIR, groundId);
const outputPath = path.join(groundDir, 'acquisition/laser-campaigns.json');
const manifest = loadPilotManifest(groundId);
const discovery = readJson(path.join(groundDir, 'acquisition/d2-discovery.json'));
const aoi = {
  bboxWgs84: manifest.targetBboxWgs84,
  bboxEpsg3006: discovery.aoi.bboxEpsg3006,
};

/* The legacy frame origin, projected by PROJ during migration, is the point
   the course is drawn about; the v2 ground rectangle is what the terrain
   compiler already publishes. Both are read from committed artifacts so the
   report needs neither PROJ nor the app. */
let origin = null;
const residualPath = path.join(groundDir, 'migration/residual-report.json');
if (fs.existsSync(residualPath)) {
  const candidate = readJson(residualPath).candidateOrigin;
  if (Number.isFinite(candidate?.easting) && Number.isFinite(candidate?.northing)) {
    origin = { easting: candidate.easting, northing: candidate.northing, source: 'migration/residual-report.json candidateOrigin' };
  }
}
let groundBounds = null;
if (groundId === 'puttom') {
  const { puttomRequiredBoundsEpsg3006 } = await import('../../course-v2/puttom-ground-graph.mjs');
  const bounds = puttomRequiredBoundsEpsg3006();
  groundBounds = [bounds.minEasting, bounds.minNorthing, bounds.maxEasting, bounds.maxNorthing];
}

console.log(`${groundId}: querying ${aoi.bboxWgs84.join(',')} for dsm-skoglig-copc items`);
const features = await fetchLaserItems(aoi.bboxWgs84);
console.log(`  ${features.length} item(s) in the catalogue`);
const infoStatistics = new Map();
const infoEvidence = [];
for (const feature of features) {
  const evidence = await fetchItemInfo(feature);
  infoStatistics.set(feature.id, itemStatisticsFromInfo(evidence.info));
  const { info, ...rest } = evidence;
  infoEvidence.push(rest);
  const stats = infoStatistics.get(feature.id);
  console.log(`  ${feature.id}: ${stats.pointCount} points, ${stats.allReturnDensityPerSquareMetre} returns/m², info ${evidence.checksumVerified ? 'checksum ok' : 'UNVERIFIED'}`);
}
const inventory = campaignInventory(features, aoi.bboxEpsg3006, { infoStatistics });
for (const item of inventory.items) {
  console.log(`  ${item.role.padEnd(10)} ${item.id} ${item.captureStart?.slice(0, 10)}..${item.captureEnd?.slice(0, 10)} exclusive ${Math.round(item.exclusiveSquareMetres / 1e4) / 100} km²`);
}
for (const seam of inventory.seams) console.log(`  seam ${seam.axis} = ${seam.value} between ${seam.items.join(' and ')}`);

const points = [];
if (origin) points.push({ label: 'legacy-origin', easting: origin.easting, northing: origin.northing });
points.push({ label: 'aoi-centre', easting: (aoi.bboxEpsg3006[0] + aoi.bboxEpsg3006[2]) / 2, northing: (aoi.bboxEpsg3006[1] + aoi.bboxEpsg3006[3]) / 2 });
for (const item of inventory.items) {
  if (item.role !== 'active') continue;
  const [x0, y0, x1, y1] = item.overlapBboxEpsg3006;
  points.push({ label: `centre-of-${item.id}`, easting: (x0 + x1) / 2, northing: (y0 + y1) / 2 });
}
const scanMetadata = [];
for (const point of points) {
  try {
    const entries = await fetchScanMetadata(point);
    scanMetadata.push({ point, entries });
    for (const entry of entries) console.log(`  ${point.label}: ${entry.scanName} ${entry.date} ${entry.scanner} ${entry.cycle} ${entry.leafOn ? 'leaf-on' : 'leaf-off'}`);
  } catch (error) {
    scanMetadata.push({ point, entries: [], error: String(error.message).slice(0, 200) });
    console.log(`  ${point.label}: scan metadata unavailable (${String(error.message).slice(0, 120)})`);
  }
}

const report = laserCampaignsReport({
  groundId,
  groundName: manifest.groundName,
  courseSlugs: manifest.courseSlugs,
  observedOn,
  aoi,
  inventory,
  origin,
  groundBounds,
  scanMetadata,
  infoEvidence,
});
const errors = validateLaserCampaignsReport(report, manifest);
if (errors.length) {
  console.error('live inventory is invalid:\n' + errors.map(error => '  ' + error).join('\n'));
  process.exit(1);
}

if (check) {
  if (!fs.existsSync(outputPath)) {
    console.error(`no pinned inventory at ${path.relative(process.cwd(), outputPath)}; run --write first`);
    process.exit(1);
  }
  const pinned = readJson(outputPath);
  const drift = campaignDrift(pinned, report);
  if (drift.drifted) {
    console.error('pinned campaign inventory DRIFTED from the live catalogue:');
    for (const id of drift.added) console.error(`  added   ${id}`);
    for (const id of drift.removed) console.error(`  removed ${id}`);
    for (const change of drift.changed) console.error(`  changed ${change.id || ''} ${change.field}: ${JSON.stringify(change.pinned)} -> ${JSON.stringify(change.live)}`);
    console.error('re-pin deliberately with --write after reviewing the change');
    process.exit(1);
  }
  console.log(`  ok   pinned inventory matches the live catalogue (${pinned.items.length} items, ${pinned.seams.length} seam(s))`);
} else if (write) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`  wrote ${path.relative(process.cwd(), outputPath)} sha256 ${sha256File(outputPath)}`);
} else {
  console.log(JSON.stringify(report, null, 2));
}
