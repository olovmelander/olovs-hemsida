#!/usr/bin/env node
/* Can LiDAR intensity tell a green, a fairway or a bunker from ordinary mown
 * course ground?
 *
 * This is the last route to surface outlines that needs no new permission at
 * all. Every other one is closed: the 1 m height model resolves no surface
 * class by depth or by smoothness, Esri World Imagery is RGB and separates
 * nothing, the orthophoto needs a Geotorget order, and a club relationship is
 * out of scope. Laserdata Skog is already entitled, and it is flown at 1064 nm
 * — the near infrared the orthophoto's NDVI would have used — so its Intensity
 * dimension is a pseudo-NIR band on a source we can already read.
 *
 * Same statistic as the DTM, orthophoto and canopy probes, so the answers are
 * comparable. Only statistics leave the runner.  */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { separabilitySummary } from '../../course-v2/terrain-derivatives.mjs';
import { runGeoCommand } from '../proj.mjs';
import { authorizationHeaders, lantmaterietCredentials } from './credentials.mjs';
import { probeLantmaterietLaserAccess } from './access-preflight.mjs';
import { laserWindowPlan } from './laser-window.mjs';
import {
  SURFACE_INTENSITY_RESOLUTION_METRES,
  canopyWindowStreamPipeline,
  surfaceIntensityPipeline,
  treeCoverIndex,
} from './canopy-window.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODEL = path.join(ROOT, 'geo_data/course-v2/puttom/migration/course-model.epsg3006.json');
const TREE_COVER = path.join(ROOT, 'puttombuild/tree-cover.json');
const SPAN_METRES = 512;
const OPEN_GROUND_CLASS = 2;
const CONTROL_LATTICE = 22;
const SAMPLE_RADIUS_METRES = 3;
const DEADLINE_MILLISECONDS = 7 * 60 * 1000;
const MINIMUM_COVERAGE = 0.3;

function argumentValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function centroid(ring) {
  let easting = 0;
  let northing = 0;
  for (const [x, y] of ring) { easting += x; northing += y; }
  return { easting: easting / ring.length, northing: northing / ring.length };
}

/** A green carries `ring`; a fairway carries `rings`, plural. */
function recordedSurfaces(model) {
  const greens = [];
  const fairways = [];
  const bunkers = [];
  const usable = ring => Array.isArray(ring) && ring.length >= 3;
  for (const hole of model.geometry.holes) {
    if (usable(hole.green?.ring)) greens.push(centroid(hole.green.ring));
    for (const ring of hole.fairway?.rings || []) if (usable(ring)) fairways.push(centroid(ring));
    for (const bunker of hole.bunkers || []) {
      const ring = bunker.ring || bunker;
      if (usable(ring)) bunkers.push(centroid(ring));
    }
  }
  return { greens, fairways, bunkers };
}

async function readGrid(xyzPath, resolutionMetres) {
  const values = new Map();
  let totalCells = 0;
  const lines = createInterface({ input: createReadStream(xyzPath, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 3) continue;
    totalCells++;
    const value = Number(parts[2]);
    if (!Number.isFinite(value) || value <= -9998) continue;
    values.set(`${Math.round(Number(parts[0]) / resolutionMetres)}/${Math.round(Number(parts[1]) / resolutionMetres)}`, value);
  }
  return { values, totalCells };
}

function sampleDisc(values, point, resolutionMetres, radiusMetres) {
  const reach = Math.ceil(radiusMetres / resolutionMetres);
  const samples = [];
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (Math.hypot(dx, dy) * resolutionMetres > radiusMetres) continue;
      const value = values.get(`${Math.round(point.easting / resolutionMetres) + dx}/${Math.round(point.northing / resolutionMetres) + dy}`);
      if (Number.isFinite(value)) samples.push(value);
    }
  }
  if (!samples.length) return Number.NaN;
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length / 2)];
}

function writeReport(out, report, exitCode = 0) {
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(path.resolve(out), `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
  if (exitCode) process.exitCode = exitCode;
}

async function main() {
  const out = argumentValue('--out');
  const discoveryPath = argumentValue('--discovery',
    path.join(ROOT, 'geo_data/course-v2/puttom/acquisition/d2-discovery.json'));
  const report = JSON.parse(fs.readFileSync(discoveryPath, 'utf8'));
  const model = JSON.parse(fs.readFileSync(MODEL, 'utf8'));
  const credentials = lantmaterietCredentials();

  let access;
  try {
    access = await probeLantmaterietLaserAccess(report, { credentials });
  } catch (error) {
    return writeReport(out, {
      schemaVersion: 1, kind: 'puttom-surface-intensity', measured: false,
      blocked: 'source-not-authorized',
      reason: String(error?.message || error).slice(0, 300),
      nextAction: 'Laserdata Skog is normally readable by this account; re-run, and if it persists check the Geotorget order',
    }, 1);
  }

  /* Centred on the played ground, unlike the canopy probe: the surfaces under
     test are the course, so there is nothing to choose and no room to fit. */
  const surfaces = recordedSurfaces(model);
  const everything = [...surfaces.greens, ...surfaces.fairways, ...surfaces.bunkers];
  if (everything.length < 10) throw new Error('the migration model has too few recorded surfaces to measure');
  const focus = [
    everything.reduce((sum, p) => sum + p.easting, 0) / everything.length,
    everything.reduce((sum, p) => sum + p.northing, 0) / everything.length,
  ];
  const plan = laserWindowPlan(report, { spanMetres: SPAN_METRES, focusEpsg3006: focus });

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'banvy-intensity-'));
  const windowPath = path.join(temporaryDirectory, 'window.laz');
  const rasterPath = path.join(temporaryDirectory, 'intensity.tif');
  const xyzPath = path.join(temporaryDirectory, 'intensity.xyz');
  const streamPipeline = canopyWindowStreamPipeline(plan, credentials, {
    outputPath: windowPath, authorizationHeaders,
  });
  const secrets = Object.values(streamPipeline[0].filename.headers);
  const redact = value => {
    let text = String(value);
    for (const secret of secrets.filter(Boolean)) text = text.replaceAll(secret, '<redacted>');
    return text;
  };
  const started = performance.now();
  let values;
  let totalCells = 0;
  try {
    const remaining = () => Math.max(1000, DEADLINE_MILLISECONDS - (performance.now() - started));
    try {
      runGeoCommand('pdal', ['pipeline', '--stdin', '--stream'], {
        input: JSON.stringify(streamPipeline), timeoutMilliseconds: remaining(),
      });
    } catch (error) {
      if (error.code === 'GEO_COMMAND_TIMEOUT') throw error;
      throw new Error(`PDAL bounded COPC stream failed: ${redact(error.message)}`);
    }
    runGeoCommand('pdal', ['pipeline', '--stdin'], {
      input: JSON.stringify(surfaceIntensityPipeline(windowPath, { outputPath: rasterPath })),
      timeoutMilliseconds: remaining(),
    });
    runGeoCommand('gdal_translate', ['-of', 'XYZ', rasterPath, xyzPath]);
    const grid = await readGrid(xyzPath, SURFACE_INTENSITY_RESOLUTION_METRES);
    values = grid.values;
    totalCells = grid.totalCells;
  } catch (error) {
    if (error.code !== 'GEO_COMMAND_TIMEOUT') throw error;
    return writeReport(out, {
      schemaVersion: 1, kind: 'puttom-surface-intensity', measured: false,
      blocked: 'acquisition-timeout',
      deadlineMilliseconds: DEADLINE_MILLISECONDS,
      elapsedMilliseconds: Math.round(performance.now() - started),
      note: 'the bounded read or the intensity derivation ran past this script\'s own deadline; a timeout is not a measurement of zero',
    }, 1);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  /* Ordinary MOWN ground, never forest: conifer would otherwise dominate the
     control, exactly as it did in the height-model and orthophoto probes. */
  const cover = treeCoverIndex(JSON.parse(fs.readFileSync(TREE_COVER, 'utf8')));
  const origin = model.candidateOrigin;
  const [minX, minY, maxX, maxY] = plan.boundsEpsg3006;
  const controlPoints = [];
  let forestRejected = 0;
  for (let row = 0; row < CONTROL_LATTICE; row++) {
    for (let column = 0; column < CONTROL_LATTICE; column++) {
      const easting = minX + (column + 0.5) * (maxX - minX) / CONTROL_LATTICE;
      const northing = minY + (row + 0.5) * (maxY - minY) / CONTROL_LATTICE;
      if (cover.classAt(easting - origin.easting, origin.northing - northing) !== OPEN_GROUND_CLASS) {
        forestRejected++;
        continue;
      }
      controlPoints.push({ easting, northing });
    }
  }
  const sampleAll = points => points
    .map(point => sampleDisc(values, point, SURFACE_INTENSITY_RESOLUTION_METRES, SAMPLE_RADIUS_METRES))
    .filter(Number.isFinite);
  const control = sampleAll(controlPoints);
  const coverage = totalCells ? +(values.size / totalCells).toFixed(4) : 0;

  const compare = (points, direction, label) => {
    const observed = sampleAll(points);
    return observed.length && control.length
      ? separabilitySummary(observed, control, { direction })
      : { unmeasured: true, direction, referenceSamples: observed.length, controlSamples: control.length,
          note: `${label} had too few samples to compare` };
  };
  const measurements = {
    /* At 1064 nm healthy turf reflects more than dry sand, so each direction
       is declared before the numbers rather than read off them. */
    bunkerVersusGround: compare(surfaces.bunkers, 'less', 'bunkers'),
    greenVersusGround: compare(surfaces.greens, 'greater', 'greens'),
    fairwayVersusGround: compare(surfaces.fairways, 'greater', 'fairways'),
  };
  const thin = coverage < MINIMUM_COVERAGE || control.length < 40;

  writeReport(out, {
    schemaVersion: 1,
    kind: 'puttom-surface-intensity',
    accuracyTier: 'C',
    claim: 'can 1064 nm LiDAR intensity separate recorded golf surfaces from ordinary mown course ground, where shape and RGB could not?',
    measured: !thin,
    ...(thin ? { blocked: 'insufficient-intensity-coverage' } : {}),
    retainedPointCloudBytes: 0,
    retainedRasterBytes: 0,
    retentionNote: 'COPC was range-streamed and the intensity raster derived and discarded in a temporary directory; only statistics are retained',
    caveats: [
      'LiDAR intensity is not radiometrically calibrated between flight lines, so only relative comparisons inside this one window mean anything',
      'Laserdata Skog is a FOREST product; its intensity handling is tuned for canopy, not turf',
      'ground returns only, below 0.5 m above ground, so a crown cannot stand in for the turf beneath it',
    ],
    access: { ready: access.ready, collection: access.collection, assetId: access.assetId },
    window: {
      boundsEpsg3006: plan.boundsEpsg3006,
      focusEpsg3006: plan.focusEpsg3006,
      focusRule: 'centroid of every recorded green, fairway ring and bunker; the surfaces under test are the course, so nothing is chosen',
      spanMetres: plan.spanMetres,
      resolutionMetres: SURFACE_INTENSITY_RESOLUTION_METRES,
      sourceItemId: plan.source.id,
      intensityCells: values.size,
      rasterCells: totalCells,
      coverage,
      elapsedMilliseconds: Math.round(performance.now() - started),
    },
    counts: {
      greens: surfaces.greens.length,
      fairways: surfaces.fairways.length,
      bunkers: surfaces.bunkers.length,
      controlPoints: control.length,
      controlForestRejected: forestRejected,
    },
    measurements,
    verdict: Object.entries(measurements).filter(([, v]) => v.separable === true).map(([k]) => k),
    unmeasured: Object.entries(measurements).filter(([, v]) => v.unmeasured).map(([k]) => k),
  }, thin ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`surface intensity measurement failed: ${error.message}`);
    process.exitCode = 1;
  });
}
