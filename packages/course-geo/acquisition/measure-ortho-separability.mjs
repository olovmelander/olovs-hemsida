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
import { treeCoverIndex } from './canopy-window.mjs';
import { lantmaterietCredentials } from './credentials.mjs';
import { acquireOrthoWindow, probeOrthoAccess } from './ortho-window.mjs';
import { runGeoCommand } from '../proj.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODEL = path.join(ROOT, 'geo_data/course-v2/puttom/migration/course-model.epsg3006.json');
const TARGET_RESOLUTION_METRES = 0.5;
const CONTROL_LATTICE = 22;
const TREE_COVER = path.join(ROOT, 'puttombuild/tree-cover.json');
/* The tree-cover raster's own legend: 0 unknown, 2 open, 3 trees. */
const OPEN_GROUND_CLASS = 2;

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
    why the index is sampled over a small disc rather than a single pixel.
 *
 * A green carries `ring`; a fairway carries `rings`, PLURAL, because a fairway
 * can be split by a road or a stand of trees. Reading `fairway.ring` here
 * silently produced zero fairways on every Puttom hole, and an empty reference
 * set makes separabilitySummary throw -- so this measurement would have
 * crashed the first time the Geotorget order granted it access, having looked
 * healthy for as long as the entitlement check returned early. */
export function recordedSurfaces() {
  const model = JSON.parse(fs.readFileSync(MODEL, 'utf8'));
  const greens = [];
  const fairways = [];
  const bunkers = [];
  const usable = ring => Array.isArray(ring) && ring.length >= 3;
  for (const hole of model.geometry.holes) {
    if (usable(hole.green?.ring)) greens.push(centroid(hole.green.ring));
    for (const ring of hole.fairway?.rings || (usable(hole.fairway?.ring) ? [hole.fairway.ring] : [])) {
      if (usable(ring)) fairways.push(centroid(ring));
    }
    for (const bunker of hole.bunkers || []) {
      const ring = bunker.ring || bunker;
      if (usable(ring)) bunkers.push(centroid(ring));
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
  const credentials = lantmaterietCredentials();

  /* Entitlement first. Ortofoto Nedladdning is a separate free order whose
     intended use Lantmäteriet reviews under GDPR, and it is reviewed
     separately from Markhöjdmodell, so an account can hold every byte of
     image metadata and be refused every pixel. Asked here it is a recorded
     answer; discovered inside GDAL it is a warning per tile and exit 1. */
  const access = await probeOrthoAccess(report, { credentials });
  if (!access.authorized) {
    const blocked = {
      schemaVersion: 1,
      kind: 'puttom-ortho-separability',
      measured: false,
      blocked: 'source-not-authorized',
      access,
      /* An entitlement gap is a fact about the account, not a broken build:
         it is reported and the run continues. */
      note: access.forbidden
        ? 'every orthophoto asset returned HTTP 403 to credentials that read Markhöjdmodell in the same run: this account is authenticated but has not completed the separate Ortofoto Nedladdning order at Geotorget'
        : access.unauthenticated
          ? 'every orthophoto asset returned HTTP 401, which is what the service answers with no credentials at all: this is a secrets problem on our side, not an entitlement one'
          : 'the orthophoto campaign could not be read with the configured credentials',
      nextAction: access.unauthenticated
        ? 'check that LANTMATERIET_USERNAME and LANTMATERIET_PASSWORD reached this step before assuming anything about entitlement'
        : 'order Ortofoto Nedladdning for this account at geotorget.lantmateriet.se and re-run; no code change will grant access',
      /* The collection metadata says CC-BY-4.0, so the licence is open and the
         DELIVERY is what is gated. That distinction matters after the order
         lands: derived rasters could then be committed with attribution
         instead of statistics only. It does not touch GDPR, which applies to
         high-resolution aerial imagery regardless of copyright terms. */
      licence: 'CC-BY-4.0 per the STAC collection; open licence, gated delivery',
    };
    if (out) {
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(path.resolve(out), `${JSON.stringify(blocked, null, 2)}\n`);
    }
    console.log(JSON.stringify(blocked, null, 2));
    return;
  }

  const acquisition = await acquireOrthoWindow(report, {
    credentials,
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
  /* "Ordinary course ground" has to mean mown ground. A plain lattice over the
     played extent is 45.3% FOREST here, measured against the committed
     tree-cover raster -- and conifer is the greenest thing for miles, so
     comparing a green against that control would report "not separable" for
     entirely the wrong reason. Forest and unknown cells are dropped. */
  const cover = treeCoverIndex(JSON.parse(fs.readFileSync(TREE_COVER, 'utf8')));
  const origin = JSON.parse(fs.readFileSync(MODEL, 'utf8')).candidateOrigin;
  const controlPoints = [];
  let forestRejected = 0;
  for (let row = 0; row < CONTROL_LATTICE; row++) {
    for (let column = 0; column < CONTROL_LATTICE; column++) {
      const easting = window[0] + (column + 0.5) * (window[2] - window[0]) / CONTROL_LATTICE;
      const northing = window[1] + (row + 0.5) * (window[3] - window[1]) / CONTROL_LATTICE;
      if (cover.classAt(easting - origin.easting, origin.northing - northing) !== OPEN_GROUND_CLASS) {
        forestRejected++;
        continue;
      }
      controlPoints.push({ easting, northing });
    }
  }
  const control = sampleAll(controlPoints, 3);

  /* A group with no recorded surfaces is a gap in the MODEL, and saying so is
     more useful than throwing out of separabilitySummary with "needs finite
     samples on both sides" -- which is what a missing fairway ring produced. */
  const compare = (values, direction, label) => (values.length && control.length
    ? separabilitySummary(values, control, { direction })
    : { unmeasured: true, direction, referenceSamples: values.length, controlSamples: control.length,
        note: `${label} had too few samples to compare; this is a gap in the recorded model, not a property of the imagery` });
  const measurements = {
    /* Sand is bare: its index should sit BELOW ordinary ground, so the
       direction is stated rather than inferred from whichever way helps. */
    bunkerVersusGround: compare(sampleAll(surfaces.bunkers, 3), 'less', 'bunkers'),
    greenVersusGround: compare(sampleAll(surfaces.greens, 4), 'greater', 'greens'),
    fairwayVersusGround: compare(sampleAll(surfaces.fairways, 5), 'greater', 'fairways'),
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
    measured: true,
    access,
    counts: {
      greens: surfaces.greens.length,
      fairways: surfaces.fairways.length,
      bunkers: surfaces.bunkers.length,
      controlPoints: control.length,
      controlForestRejected: forestRejected,
      controlRule: 'lattice over the played extent, restricted to open ground by the committed tree-cover raster',
    },
    measurements,
    verdict: Object.entries(measurements)
      .filter(([, value]) => value.separable === true)
      .map(([key]) => key),
    unmeasured: Object.entries(measurements)
      .filter(([, value]) => value.unmeasured)
      .map(([key]) => key),
  };
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(path.resolve(out), `${JSON.stringify(result, null, 2)}\n`);
  }
  console.log(JSON.stringify(result, null, 2));
}

/* Guarded so the module can be imported and its surface extraction tested
   without running a network measurement -- the fairway bug lived here
   untested precisely because nothing could import this file. */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`orthophoto separability measurement failed: ${error.message}`);
    process.exitCode = 1;
  });
}
