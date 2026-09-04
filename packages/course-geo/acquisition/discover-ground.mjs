#!/usr/bin/env node
/* Public STAC discovery for one ground, without the PROJ toolchain.

   node packages/course-geo/acquisition/discover-ground.mjs --ground <id> [--write]

   `discover-pilots.mjs` is the canonical entry point and projects its AOI
   bbox with PROJ's cs2cs, which is right: PROJ is this repository's
   projection authority. It therefore cannot run on a machine without the
   Pixi toolchain, and the bbox is the ONLY thing it needs PROJ for -- the
   STAC search itself takes WGS 84 and is public.

   So this variant projects the AOI with the repository's own Krüger series
   (packages/course-geo/chmv2/projection.mjs) and SAYS SO in the evidence it
   writes. That series is tested against PROJ's own numbers, and at this
   repository's grounds it reproduces the committed PROJ-derived migration
   origins to about a millimetre. The projected bbox only selects which 10 km
   items to look at and how much of the AOI they cover; it never becomes a
   published coordinate. Where PROJ is available, prefer discover-pilots.mjs. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { latLonToSweref99Tm } from '../chmv2/projection.mjs';
import { discoverPilot, summarizeDiscoveryReport } from './discovery.mjs';
import { COURSE_DATA_DIR, edgePoints, loadPilotManifest } from './pilots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

/* The same densified-edge rule pilots.mjs uses: projecting two corners is not
   a safe projected extent, because the graticule is not straight in the grid. */
function projectBboxWgs84(bbox, segments = 16) {
  return edgePoints(bbox, segments)
    .map(point => latLonToSweref99Tm(point.latitude, point.longitude))
    .reduce((extent, [easting, northing]) => [
      Math.min(extent[0], easting), Math.min(extent[1], northing),
      Math.max(extent[2], easting), Math.max(extent[3], northing),
    ], [Infinity, Infinity, -Infinity, -Infinity])
    .map(value => Math.round(value * 1000) / 1000);
}

async function main() {
  const groundId = arg('--ground');
  if (!groundId) throw new Error('--ground is required');
  const observedOn = arg('--observed-on', new Date().toISOString().slice(0, 10));
  const manifest = loadPilotManifest(groundId);
  const aoi = {
    groundId,
    groundName: manifest.groundName,
    courseSlugs: manifest.courseSlugs,
    bboxWgs84: manifest.targetBboxWgs84,
    bboxEpsg3006: projectBboxWgs84(manifest.targetBboxWgs84),
  };
  const report = await discoverPilot(aoi, { observedOn, fetchMetadata: true });
  report.projection = {
    library: 'packages/course-geo/chmv2/projection.mjs',
    note: 'AOI bbox projected with the repository Krüger series because the PROJ toolchain is unavailable here; PROJ remains the projection authority and no published coordinate comes from this file',
  };
  const summary = summarizeDiscoveryReport(report);
  console.log(`${groundId}: DTM ${(summary.terrain.coverage * 100).toFixed(2)}%, ` +
    `LiDAR ${(summary.laser.coverage * 100).toFixed(2)}%, ` +
    `${summary.orthophoto.campaign} ${(summary.orthophoto.coverage * 100).toFixed(2)}%`);
  if (process.argv.includes('--write')) {
    const file = path.join(COURSE_DATA_DIR, groundId, 'acquisition', 'd2-discovery.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`wrote ${path.relative(ROOT, file)}`);
  } else {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
}

main().catch(error => {
  console.error(`ground discovery failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
