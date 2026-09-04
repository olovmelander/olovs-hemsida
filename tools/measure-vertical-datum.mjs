#!/usr/bin/env node
/* Measure a ground's legacy-to-RH-2000 vertical bridge.

   node tools/measure-vertical-datum.mjs --ground johannesberg \
     --terrain-f32 <aligned Float32 window> [--json <out>]

   The legacy heights in a GPK1 pack are AWS Terrarium and the pack never
   recorded what datum they are on, so there is nothing to derive an offset
   TO. It has to be MEASURED, and it is measured where the two products
   describe the same physical surface: the mown ground a player stands on --
   greens, tees and fairways -- and never on water, in a carve or under a
   canopy, where Terrarium and a laser DTM legitimately disagree.

   The statistic is the MEDIAN, with the median absolute deviation reported
   beside it, because a handful of samples in a pond or a building would drag
   a mean and leave no trace. The whole-overlap median is reported too, as
   corroboration that never entered the number.

   Reported, never applied: nothing here writes a config. Copy the value into
   the course's reviewed runtime config deliberately. The geoid runs from
   roughly 17 to 37 m across Sweden, so a value measured for one course is
   wrong for every other one. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeHF, pointInPoly } from '../geobuild/lib.mjs';
import { legacyGridBridge } from '../apps/golf/src/engine/geodetic-frame.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Each ground states where its legacy heightfield and played geometry live,
   and the flat-earth constants its own build declares. */
const GROUNDS = Object.freeze({
  angso: Object.freeze({
    buildDir: 'angsobuild',
    models: Object.freeze(['course-model.json']),
    legacyFrame: Object.freeze({
      latitude: 59.57390,
      longitude: 16.87100,
      metresPerLatitude: 111320,
      metresPerLongitude: 56375.41,
    }),
    /* The pack origin projected through PROJ, from the committed migration's
       candidateOrigin (geo_data/course-v2/angso/migration/course-model.epsg3006.json). */
    legacyOriginEpsg3006: Object.freeze({ easting: 605689.962, northing: 6605447.157 }),
    window: Object.freeze({ originEasting: 603617.5, originNorthing: 6607769.5, width: 4097, height: 4097 }),
  }),
  johannesberg: Object.freeze({
    buildDir: 'johannesbergbuild',
    models: Object.freeze(['course-model.json']),
    legacyFrame: Object.freeze({
      latitude: 59.72733,
      longitude: 18.19202,
      metresPerLatitude: 111320,
      metresPerLongitude: 56118.16,
    }),
    legacyOriginEpsg3006: Object.freeze({ easting: 679460.879, northing: 6625364.187 }),
    window: Object.freeze({ originEasting: 678403.5, originNorthing: 6626324.5, width: 2049, height: 2049 }),
  }),
  upsala: Object.freeze({
    buildDir: 'upsalabuild',
    /* One ground, two courses. Stora banan supplies most of the mown ground;
       Mellanbanan's nine stands east of it and is measured with it, because
       the offset belongs to the ground and not to a routing. */
    models: Object.freeze(['course-model.json', 'mellanbanan-model.json']),
    legacyFrame: Object.freeze({
      latitude: 59.839,
      longitude: 17.4952,
      metresPerLatitude: 111320,
      metresPerLongitude: 55930.68,
    }),
    /* The pack origin projected through PROJ, from the committed migration's
       candidateOrigin (geo_data/course-v2/upsala/migration/course-model.epsg3006.json). */
    legacyOriginEpsg3006: Object.freeze({ easting: 639830.271, northing: 6636114.391 }),
    window: Object.freeze({ originEasting: 639119.5, originNorthing: 6637169.5, width: 2049, height: 2049 }),
  }),
});

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const groundId = arg('--ground');
const spec = GROUNDS[groundId];
if (!spec) throw new Error(`no vertical-datum recipe for ground ${groundId}`);
const terrainPath = arg('--terrain-f32');
if (!terrainPath) throw new Error('--terrain-f32 is required');

/* ---- the legacy field, exactly as the pack stores it -------------------- */
const heightfields = JSON.parse(fs.readFileSync(path.join(ROOT, spec.buildDir, 'heightfields.json'), 'utf8'));
const hf = heightfields.hf0;
const legacyHeights = decodeHF(hf);
function legacyHeightAt(x, z) {
  const column = (x - hf.x0) / hf.dx;
  const row = (z - hf.z0) / hf.dx;
  const c0 = Math.floor(column), r0 = Math.floor(row);
  if (c0 < 0 || r0 < 0 || c0 + 1 >= hf.nx || r0 + 1 >= hf.nz) return Number.NaN;
  const tx = column - c0, tz = row - r0;
  const at = (c, r) => legacyHeights[r * hf.nx + c];
  const a = at(c0, r0), b = at(c0 + 1, r0), d = at(c0, r0 + 1), e = at(c0 + 1, r0 + 1);
  if (![a, b, d, e].every(Number.isFinite)) return Number.NaN;
  return (a + (b - a) * tx) * (1 - tz) + (d + (e - d) * tx) * tz;
}

/* ---- the v2 window, on its own EPSG:3006 lattice ------------------------ */
const raster = fs.readFileSync(path.resolve(terrainPath));
const { originEasting, originNorthing, width, height } = spec.window;
if (raster.byteLength !== width * height * 4) {
  throw new Error(`raster is ${raster.byteLength} bytes; the reviewed window needs ${width * height * 4}`);
}
const v2 = new Float32Array(raster.buffer, raster.byteOffset, width * height);
function v2HeightAt(easting, northing) {
  const column = easting - originEasting;
  const row = originNorthing - northing;
  const c0 = Math.floor(column), r0 = Math.floor(row);
  if (c0 < 0 || r0 < 0 || c0 + 1 >= width || r0 + 1 >= height) return Number.NaN;
  const tx = column - c0, tz = row - r0;
  const at = (c, r) => v2[r * width + c];
  const a = at(c0, r0), b = at(c0 + 1, r0), d = at(c0, r0 + 1), e = at(c0 + 1, r0 + 1);
  if (![a, b, d, e].every(Number.isFinite)) return Number.NaN;
  return (a + (b - a) * tx) * (1 - tz) + (d + (e - d) * tx) * tz;
}

/* ---- the bridge, from the two frames' own declared constants ------------ */
const bridge = legacyGridBridge(spec.legacyFrame);
/* legacy world -> EPSG:3006 */
function legacyToEpsg3006(x, z) {
  const [gx, gz] = bridge.toGrid(x, z);
  return [spec.legacyOriginEpsg3006.easting + gx, spec.legacyOriginEpsg3006.northing - gz];
}

/* ---- the mown ground: greens, tees and fairways only -------------------- */
const rings = [];
for (const file of spec.models) {
  const model = JSON.parse(fs.readFileSync(path.join(ROOT, spec.buildDir, file), 'utf8'));
  for (const hole of model.holes || []) {
    /* A green is one ring; a fairway is a LIST of rings, and reading it as if
       it were one silently drops every fairway sample. */
    const green = hole.green?.ring;
    if (Array.isArray(green) && green.length > 2) rings.push({ kind: 'green', ring: green });
    for (const ring of hole.fairway?.rings || []) {
      if (Array.isArray(ring) && ring.length > 2) rings.push({ kind: 'fairway', ring });
    }
    for (const pad of hole.tees?.pads || []) {
      if (Array.isArray(pad?.ring) && pad.ring.length > 2) rings.push({ kind: 'tee', ring: pad.ring });
    }
  }
}
if (!rings.length) throw new Error('no mown polygons found; the played-ground mask would be empty');

/* Water is where the two products are guaranteed to disagree: Terrarium
   carries a flooded surface and the DTM the same, but the pack's own carve
   does not. Anything inside a water ring is dropped outright. */
const water = [];
for (const file of spec.models) {
  const model = JSON.parse(fs.readFileSync(path.join(ROOT, spec.buildDir, file), 'utf8'));
  for (const body of model.water || []) {
    const ring = body?.ring || body;
    if (Array.isArray(ring) && ring.length > 2 && Array.isArray(ring[0])) water.push(ring);
  }
}

function bboxOf(ring) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of ring) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  return { x0, x1, z0, z1 };
}

const STEP = 2;
/* The mown sample points, resolved once: the polygon test is the expensive
   part and the registration sweep reuses them at every shift. */
const mownPoints = [];
for (const { kind, ring } of rings) {
  const box = bboxOf(ring);
  for (let z = Math.ceil(box.z0 / STEP) * STEP; z <= box.z1; z += STEP) {
    for (let x = Math.ceil(box.x0 / STEP) * STEP; x <= box.x1; x += STEP) {
      if (!pointInPoly(x, z, ring)) continue;
      if (water.some(body => pointInPoly(x, z, body))) continue;
      mownPoints.push({ kind, x, z });
    }
  }
}

function differencesAt(dx = 0, dz = 0, filterKind = null) {
  const values = [];
  for (const point of mownPoints) {
    if (filterKind && point.kind !== filterKind) continue;
    const legacy = legacyHeightAt(point.x, point.z);
    const [easting, northing] = legacyToEpsg3006(point.x + dx, point.z + dz);
    const modern = v2HeightAt(easting, northing);
    if (!Number.isFinite(legacy) || !Number.isFinite(modern)) continue;
    values.push(legacy - modern);
  }
  return values;
}

const played = differencesAt();
const perKind = new Map();
for (const kind of new Set(mownPoints.map(point => point.kind))) {
  perKind.set(kind, differencesAt(0, 0, kind));
}

/* The whole overlap, as corroboration that never entered the number. */
const overlap = [];
for (let z = hf.z0; z <= hf.z0 + (hf.nz - 1) * hf.dx; z += 16) {
  for (let x = hf.x0; x <= hf.x0 + (hf.nx - 1) * hf.dx; x += 16) {
    const legacy = legacyHeightAt(x, z);
    const [easting, northing] = legacyToEpsg3006(x, z);
    const modern = v2HeightAt(easting, northing);
    if (Number.isFinite(legacy) && Number.isFinite(modern)) overlap.push(legacy - modern);
  }
}

/* A large spread is either a datum question or a REGISTRATION one, and the two
   look identical in a single median. Sweeping a rigid shift of the legacy
   sample point tells them apart: if the spread collapses at a non-zero shift,
   the geometry is in the wrong place and the offset is measuring that. */
function registrationSweep(sampleAt, radiusMetres = 12, stepMetres = 2) {
  const results = [];
  for (let dz = -radiusMetres; dz <= radiusMetres; dz += stepMetres) {
    for (let dx = -radiusMetres; dx <= radiusMetres; dx += stepMetres) {
      const values = sampleAt(dx, dz);
      if (values.length < 100) continue;
      const centre = median(values);
      results.push({ dx, dz, samples: values.length, medianMetres: centre, madMetres: medianAbsoluteDeviation(values, centre) });
    }
  }
  results.sort((left, right) => left.madMetres - right.madMetres);
  return results;
}

function median(values) {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function medianAbsoluteDeviation(values, centre) {
  return median(values.map(value => Math.abs(value - centre)));
}
const round = (value, decimals = 4) => Math.round(value * 10 ** decimals) / 10 ** decimals;

const playedMedian = median(played);
const report = {
  schemaVersion: 1,
  kind: 'legacy-to-rh2000-vertical-bridge',
  groundId,
  measuredOn: new Date().toISOString().slice(0, 10),
  method: 'legacy Terrarium heightfield minus published RH 2000, sampled through the frames-derived horizontal bridge on mown ground (greens, tees, fairways), water rings excluded',
  statistic: 'median',
  playedGround: {
    samples: played.length,
    stepMetres: STEP,
    medianMetres: round(playedMedian),
    medianAbsoluteDeviationMetres: round(medianAbsoluteDeviation(played, playedMedian)),
    minimumMetres: round(Math.min(...played)),
    maximumMetres: round(Math.max(...played)),
  },
  byKind: Object.fromEntries([...perKind].map(([kind, values]) => {
    const centre = median(values);
    return [kind, {
      samples: values.length,
      medianMetres: round(centre),
      medianAbsoluteDeviationMetres: round(medianAbsoluteDeviation(values, centre)),
    }];
  })),
  registration: (() => {
    const sweep = registrationSweep((dx, dz) => differencesAt(dx, dz));
    const centred = sweep.find(entry => entry.dx === 0 && entry.dz === 0);
    const best = sweep[0];
    return {
      note: 'a rigid shift of the legacy sample point; if the best shift is not (0,0) the spread is registration, not datum',
      atOrigin: { madMetres: round(centred?.madMetres), medianMetres: round(centred?.medianMetres) },
      best: { dx: best?.dx, dz: best?.dz, madMetres: round(best?.madMetres), medianMetres: round(best?.medianMetres) },
      madImprovementMetres: round((centred?.madMetres ?? 0) - (best?.madMetres ?? 0)),
    };
  })(),
  wholeOverlap: {
    samples: overlap.length,
    stepMetres: 16,
    medianMetres: round(median(overlap)),
    note: 'corroboration only; it did not enter the reported value',
  },
  horizontalBridge: {
    rotationDegrees: round(bridge.rotationDegrees, 6),
    scaleX: round(bridge.scaleX, 9),
    scaleZ: round(bridge.scaleZ, 9),
    pointScale: round(bridge.pointScale, 9),
    source: 'derived from the two frames’ own declared constants; exact',
  },
  verticalDatumOffsetMetres: round(playedMedian),
};
const out = arg('--json');
if (out) fs.writeFileSync(path.resolve(out), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
