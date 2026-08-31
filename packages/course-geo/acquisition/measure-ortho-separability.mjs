#!/usr/bin/env node
/* The question the DTM probe left open: shape cannot separate Puttom's golf
   surfaces from ordinary ground — can reflectance?
 *
 * Runs on the authenticated runner. It acquires ONE bounded, resampled RGBI
 * window, derives a vegetation index, samples it at recorded green, fairway
 * and bunker positions against control points on the same played ground, and
 * exports the separability statistics only. No pixel and no derived raster
 * leaves this step: Ortofoto Nedladdning carries special access and GDPR
 * terms, and publishing a derivative needs its own redistribution decision.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { separabilitySummary } from '../../course-v2/terrain-derivatives.mjs';
import { lantmaterietCredentials } from './credentials.mjs';
import { acquireOrthoWindow } from './ortho-window.mjs';
import { runGeoCommand } from '../proj.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODEL = path.join(ROOT, 'geo_data/course-v2/puttom/migration/course-model.epsg3006.json');
const TARGET_RESOLUTION_METRES = 0.5;
const CONTROL_LATTICE = 16;

function argumentValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} needs a value`);
  return value;
}

function centroid(ring) {
  let easting = 0;
  let northing = 0;
  for (const [x, y] of ring) { easting += x; northing += y; }
  return { easting: easting / ring.length, northing: northing / ring.length };
}

/** Recorded surface positions. OSM-derived and approximate, which is exactly
    why the index is sampled over a small disc rather than a single pixel. */
function recordedSurfaces() {
  const model = JSON.parse(fs.readFileSync(MODEL, 'utf8'));
  const greens = [];
  const fairways = [];
  const bunkers = [];
  for (const hole of model.geometry.holes) {
    if (Array.isArray(hole.green?.ring) && hole.green.ring.length >= 3) {
      greens.push(centroid(hole.green.ring));
    }
    if (Array.isArray(hole.fairway?.ring) && hole.fairway.ring.length >= 3) {
      fairways.push(centroid(hole.fairway.ring));
    }
    for (const bunker of hole.bunkers || []) {
      const ring = bunker.ring || bunker;
      if (Array.isArray(ring) && ring.length >= 3) bunkers.push(centroid(ring));
    }
  }
  return { greens, fairways, bunkers };
}

function boundingBox(points, padMetres) {
  const eastings = points.map(point => point.easting);
  const northings = points.map(point => point.northing);
  return [
    Math.floor(Math.min(...eastings) - padMetres),
    Math.floor(Math.min(...northings) - padMetres),
    Math.ceil(Math.max(...eastings) + padMetres),
    Math.ceil(Math.max(...northings) + padMetres),
  ];
}

/** Read a single-band XYZ dump into a lookup keyed by rounded grid cell. */
async function readIndexGrid(xyzPath, resolutionMetres) {
  const values = new Map();
  const lines = createInterface({
    input: createReadStream(xyzPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 3) continue;
    const easting = Number(parts[0]);
    const northing = Number(parts[1]);
    const value = Number(parts[2]);
    if (!Number.isFinite(value)) continue;
    values.set(`${Math.round(easting / resolutionMetres)}/${Math.round(northing / resolutionMetres)}`, value);
  }
  return values;
}

function sampleDisc(values, point, resolutionMetres, radiusMetres) {
  const reach = Math.ceil(radiusMetres / resolutionMetres);
  const samples = [];
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (Math.hypot(dx, dy) * resolutionMetres > radiusMetres) continue;
      const key = `${Math.round(point.easting / resolutionMetres) + dx}/${Math.round(point.northing / resolutionMetres) + dy}`;
      const value = values.get(key);
      if (Number.isFinite(value)) samples.push(value);
    }
  }
  if (!samples.length) return Number.NaN;
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length / 2)];
}

async function main() {
  const cacheRoot = argumentValue('--cache', path.join(ROOT, 'geo_data/course-v2/.cache/ortho'));
  const out = argumentValue('--out');
  const discoveryPath = argumentValue('--discovery',
    path.join(ROOT, 'geo_data/course-v2/puttom/acquisition/d2-discovery.json'));
  const report = JSON.parse(fs.readFileSync(discoveryPath, 'utf8'));
  const surfaces = recordedSurfaces();
  const everything = [...surfaces.greens, ...surfaces.fairways, ...surfaces.bunkers];
  if (everything.length < 10) throw new Error('the migration model has too few recorded surfaces to measure');
  const window = boundingBox(everything, 60);

  const acquisition = await acquireOrthoWindow(report, {
    credentials: lantmaterietCredentials(),
    cacheRoot,
    bboxEpsg3006: window,
    targetResolutionMetres: TARGET_RESOLUTION_METRES,
  });

  /* NDVI from the campaign's own red and near-infrared bands. Mown, watered,
     dense turf and dry sand sit at opposite ends of it, which is precisely the
     distinction a bare-earth height model cannot make. */
  const indexPath = path.join(path.dirname(acquisition.cachePath), 'ortho-ndvi.tif');
  const xyzPath = path.join(path.dirname(acquisition.cachePath), 'ortho-ndvi.xyz');
  runGeoCommand('gdal_calc.py', [
    '-A', acquisition.cachePath, '--A_band', '1',
    '-B', acquisition.cachePath, '--B_band', '4',
    '--outfile', indexPath,
    '--calc', '(B.astype(float)-A.astype(float))/(B.astype(float)+A.astype(float)+1e-6)',
    '--type', 'Float32', '--NoDataValue', '-9999', '--overwrite',
  ]);
  runGeoCommand('gdal_translate', ['-of', 'XYZ', indexPath, xyzPath]);
  const values = await readIndexGrid(xyzPath, TARGET_RESOLUTION_METRES);

  const sampleAll = (points, radiusMetres) => points
    .map(point => sampleDisc(values, point, TARGET_RESOLUTION_METRES, radiusMetres))
    .filter(Number.isFinite);
  const controlPoints = [];
  for (let row = 0; row < CONTROL_LATTICE; row++) {
    for (let column = 0; column < CONTROL_LATTICE; column++) {
      controlPoints.push({
        easting: window[0] + (column + 0.5) * (window[2] - window[0]) / CONTROL_LATTICE,
        northing: window[1] + (row + 0.5) * (window[3] - window[1]) / CONTROL_LATTICE,
      });
    }
  }
  const control = sampleAll(controlPoints, 3);

  const measurements = {
    /* Sand is bare: its index should sit BELOW ordinary ground, so the
       direction is stated rather than inferred from whichever way helps. */
    bunkerVersusGround: separabilitySummary(sampleAll(surfaces.bunkers, 3), control, { direction: 'less' }),
    greenVersusGround: separabilitySummary(sampleAll(surfaces.greens, 4), control, { direction: 'greater' }),
    fairwayVersusGround: separabilitySummary(sampleAll(surfaces.fairways, 5), control, { direction: 'greater' }),
  };

  const result = {
    schemaVersion: 1,
    kind: 'puttom-ortho-separability',
    accuracyTier: 'C',
    claim: 'can reflectance separate recorded golf surfaces from ordinary course ground, where shape could not?',
    retainedPixels: 0,
    retentionNote: acquisition.retentionNote,
    window: {
      bboxEpsg3006: window,
      resolutionMetres: acquisition.resolutionMetres,
      sourceResolutionMetres: acquisition.sourceResolutionMetres,
      resampled: acquisition.resampled,
      pixels: acquisition.pixelWidth * acquisition.pixelHeight,
      collection: acquisition.collection,
      sourceItems: acquisition.sourceItems.map(item => ({ id: item.id, bytes: item.bytes, sha256: item.sha256 })),
      compressedBytes: acquisition.compressedBytes,
      elapsedMilliseconds: acquisition.measurements.totalMilliseconds,
    },
    counts: {
      greens: surfaces.greens.length,
      fairways: surfaces.fairways.length,
      bunkers: surfaces.bunkers.length,
      controlPoints: control.length,
    },
    measurements,
    verdict: Object.entries(measurements)
      .filter(([, value]) => value.separable)
      .map(([key]) => key),
  };
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(path.resolve(out), `${JSON.stringify(result, null, 2)}\n`);
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(`orthophoto separability measurement failed: ${error.message}`);
  process.exitCode = 1;
});
