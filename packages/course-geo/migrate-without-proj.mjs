#!/usr/bin/env node
/* Migrate one legacy model to EPSG:3006 on a machine that has no PROJ, and
   refuse to unless it can first REPRODUCE a committed cs2cs migration of the
   same ground.

   migrate-legacy.mjs is the authority and shells out to cs2cs through the
   pinned Pixi environment. Where that environment is unavailable, this driver
   substitutes the repository's own Krüger series
   (packages/course-geo/chmv2/projection.mjs) -- but a substitute projection is
   only admissible if it is measured against the one it substitutes for, on the
   same ground, over the same kind of geometry. So the first thing it does is
   re-project every coordinate of a committed migration's own source model and
   compare with what cs2cs wrote. If the worst disagreement exceeds the
   tolerance it exits non-zero and writes nothing.

     node packages/course-geo/migrate-without-proj.mjs \
       --ground upsala \
       --model upsalamellanbuild/course-model.json \
       --reference geo_data/course-v2/upsala/migration/course-model.epsg3006.json \
       --out geo_data/course-v2/upsala/migration/mellanbanan-course-model.epsg3006.json

   The output carries the measured agreement, so a reader can see at a glance
   which projection produced it and how far that is from the authority. Rerun
   migrate-legacy.mjs over the same model when PROJ is available; the two
   should differ by less than the tolerance printed here. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectCoordinatePairs, coordinatePathCounts, localToLatLon, roundedCoordinate } from './migration.mjs';
import { latLonToSweref99Tm } from './chmv2/projection.mjs';

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(PACKAGE_DIR, '..', '..');
const GENERATOR = 'course-geo/legacy-vector-migrator-krueger@1';
/* Five millimetres. The series and cs2cs agree far closer than this on the
   grounds measured so far; the point of the number is that a wrong ellipsoid,
   a wrong central meridian or a swapped axis order all miss it by metres. */
const TOLERANCE_METRES = 0.005;

const hash = text => createHash('sha256').update(text).digest('hex');

function flag(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : null;
}

const groundId = flag('ground');
const modelPath = flag('model');
const referencePath = flag('reference');
const outPath = flag('out');
if (!groundId || !modelPath || !referencePath || !outPath) {
  throw new Error('usage: --ground <id> --model <legacy model> --reference <committed cs2cs migration> --out <file>');
}

function projectPairs(pairs, frame) {
  return pairs.map(pair => {
    const { latitude, longitude } = localToLatLon(pair, frame);
    const [easting, northing] = latLonToSweref99Tm(latitude, longitude);
    return { easting, northing };
  });
}

/* ---- 1. reproduce the committed cs2cs migration ------------------------- */
const reference = JSON.parse(await readFile(join(REPO_ROOT, referencePath), 'utf8'));
if (reference.groundId !== groundId) {
  throw new Error(`reference migration is for ground ${reference.groundId}, not ${groundId}`);
}
const referenceSourcePath = reference.source?.path;
if (!referenceSourcePath) throw new Error('the reference migration records no source model');
const referenceSourceText = await readFile(join(REPO_ROOT, referenceSourcePath), 'utf8');
const referenceFrame = {
  originWgs84: {
    latitude: reference.source.localFrame.originWgs84.latitude,
    longitude: reference.source.localFrame.originWgs84.longitude,
  },
  metresPerLatitude: reference.source.localFrame.metresPerLatitude,
  metresPerLongitude: reference.source.localFrame.metresPerLongitude,
};
const referenceLocal = collectCoordinatePairs(JSON.parse(referenceSourceText));
const referenceProjected = collectCoordinatePairs(reference.geometry ?? reference);
if (referenceLocal.coordinates.length !== referenceProjected.coordinates.length) {
  throw new Error('the reference migration and its source model disagree about how many coordinates they carry');
}
const reprojected = projectPairs(referenceLocal.coordinates.map(entry => entry.pair), referenceFrame);
let worstMetres = 0;
for (const [index, entry] of referenceProjected.coordinates.entries()) {
  const distance = Math.hypot(
    reprojected[index].easting - entry.pair[0],
    reprojected[index].northing - entry.pair[1],
  );
  if (distance > worstMetres) worstMetres = distance;
}
const validation = {
  reference: referencePath,
  referenceSource: referenceSourcePath,
  points: referenceProjected.coordinates.length,
  worstDisagreementMetres: Number(worstMetres.toFixed(6)),
  toleranceMetres: TOLERANCE_METRES,
  note: 'every coordinate of the reference migration\'s own source model, re-projected with the in-repo Krüger series and compared with what cs2cs wrote',
};
console.log(`series vs cs2cs on ${groundId}: worst ${worstMetres.toFixed(6)} m over ${validation.points} coordinates`);
if (!(worstMetres <= TOLERANCE_METRES)) {
  throw new Error(`the Krüger series disagrees with the committed cs2cs migration by ${worstMetres.toFixed(6)} m, over the ${TOLERANCE_METRES} m tolerance; nothing written`);
}

/* ---- 2. migrate the requested model ------------------------------------- */
const modelText = await readFile(join(REPO_ROOT, modelPath), 'utf8');
const model = JSON.parse(modelText);
const frame = {
  originWgs84: { latitude: model.origin?.lat, longitude: model.origin?.lon },
  metresPerLatitude: model.mPerLat,
  metresPerLongitude: model.mPerLon,
};
for (const [label, value] of Object.entries({
  latitude: frame.originWgs84.latitude,
  longitude: frame.originWgs84.longitude,
  metresPerLatitude: frame.metresPerLatitude,
  metresPerLongitude: frame.metresPerLongitude,
})) {
  if (!Number.isFinite(value)) throw new Error(`${modelPath} declares no ${label}`);
}
/* The two models must be on the SAME legacy frame, or the validated
   agreement above says nothing about this one. */
for (const [label, left, right] of [
  ['latitude', frame.originWgs84.latitude, referenceFrame.originWgs84.latitude],
  ['longitude', frame.originWgs84.longitude, referenceFrame.originWgs84.longitude],
  ['metresPerLatitude', frame.metresPerLatitude, referenceFrame.metresPerLatitude],
  ['metresPerLongitude', frame.metresPerLongitude, referenceFrame.metresPerLongitude],
]) {
  if (Math.abs(left - right) > 1e-9) {
    throw new Error(`${modelPath} declares ${label} ${left} but the validated reference frame is ${right}`);
  }
}

const migrated = structuredClone(model);
const collected = collectCoordinatePairs(migrated);
const projected = projectPairs(collected.coordinates.map(entry => entry.pair), frame);
collected.coordinates.forEach(({ pair }, index) => {
  pair[0] = roundedCoordinate(projected[index].easting);
  pair[1] = roundedCoordinate(projected[index].northing);
});
delete migrated.mPerLat;
delete migrated.mPerLon;
delete migrated.origin;
migrated.frame = 'absolute EPSG:3006 coordinate pairs [easting,northing]; legacy scalar heights are unapproved and unchanged';

const output = {
  schemaVersion: 1,
  generator: GENERATOR,
  groundId,
  source: {
    path: modelPath,
    sha256: hash(modelText.replace(/\r\n/g, '\n')),
    localFrame: {
      originWgs84: frame.originWgs84,
      metresPerLatitude: frame.metresPerLatitude,
      metresPerLongitude: frame.metresPerLongitude,
      frame: model.frame ?? null,
    },
  },
  target: {
    horizontalCrs: 'EPSG:3006',
    coordinateOrder: ['easting', 'northing'],
    verticalStatus: 'legacy-height-datum-unknown-not-converted',
    approvalStatus: 'migration-only-pending-independent-control',
    projection: 'packages/course-geo/chmv2/projection.mjs (Krüger series on GRS 80); PROJ was unavailable on the migrating machine',
    projValidation: validation,
  },
  coordinatePairCount: collected.coordinates.length,
  ignoredMetadataPairCount: collected.ignored.length,
  coordinatePaths: coordinatePathCounts(collected.coordinates),
  geometry: migrated,
};
/* collectCoordinatePairs throws on an unclassified numeric pair itself, which
   is the fail-closed rule migrate-legacy relies on; nothing to re-check here. */
await mkdir(dirname(join(REPO_ROOT, outPath)), { recursive: true });
await writeFile(join(REPO_ROOT, outPath), `${JSON.stringify(output, null, 2)}\n`.replace(/\r\n/g, '\n'));
console.log(`wrote ${relative(REPO_ROOT, join(REPO_ROOT, outPath))}: ${collected.coordinates.length} coordinates`);
