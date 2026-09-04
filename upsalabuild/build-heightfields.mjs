/* The two heightfields upsala3d ships, cut from Lantmäteriet's Markhöjdmodell
   and expressed in RH 2000.

   This replaced a mosaic of AWS Terrarium tiles, and the replacement is not a
   refinement. Measured on 61,123 samples of mown ground (tools/measure-vertical-
   datum.mjs), the Terrarium field stood a median 6.75 m above the laser DTM with
   a 1.92 m median absolute deviation and a 0-15 m range: its DATUM was unknown
   and its SHAPE was wrong. The per-pond consequence is the sharpest form of it
   -- correcting Terrarium by its own median offset still leaves this course's
   water anywhere from 2.8 m below its bed to 5.3 m above its surface.

   HF0 and HF1 are addressed in the pack's flat-earth frame, which is the
   EPSG:3006 grid rotated by 2.1577 degrees and scaled by (0.99766, 0.99936).
   Every sample here is therefore taken THROUGH that derived bridge -- the same
   one apps/golf/src/engine/geodetic-frame.mjs gives the runtime -- so the
   pack's ground and the published v2 tiles are one field, and the vertical
   bridge between them is exactly zero rather than a measured offset.

   Water levels are measured, and in a laser DTM they are measurable properly
   for the first time here: the model treats a water surface as a flat plate,
   so a well-registered ring encloses samples with a few centimetres of spread.
   Every level is the median of the samples INSIDE the ring, and the spread is
   recorded beside it -- which is simultaneously the level and the proof that
   the ring is where the water is.

     node --env-file=.env upsalabuild/fetch-dem-lm.mjs   # cache the rasters
     node upsalabuild/build-heightfields.mjs                                   */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { legacyGridBridge } from '../apps/golf/src/engine/geodetic-frame.mjs';
import {
  CACHE, quantizeHF, decodeHF, readJSON, writeJSON, bbox, pointInPoly,
} from './lib.mjs';
import { LEGACY_FRAME, LEGACY_ORIGIN_EPSG3006, UPSALA_LEGACY_FIELD } from './lib-v2.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const osm = readJSON(path.join(HERE, 'osm-features.json'));

/* --- the rasters, on their own EPSG:3006 lattices ----------------------------- */
function loadRaster(spec) {
  const file = path.join(CACHE, spec.file);
  if (!fs.existsSync(file)) {
    throw new Error(`${spec.file} is missing; run: node --env-file=.env upsalabuild/fetch-dem-lm.mjs`);
  }
  const bytes = fs.readFileSync(file);
  if (bytes.byteLength !== spec.columns * spec.rows * 4) {
    throw new Error(`${spec.file} has ${bytes.byteLength} bytes; expected ${spec.columns * spec.rows * 4}`);
  }
  const values = new Float32Array(spec.columns * spec.rows);
  for (let index = 0; index < values.length; index++) values[index] = bytes.readFloatLE(index * 4);
  if (!values.every(Number.isFinite)) throw new Error(`${spec.file} contains non-finite samples`);
  return (easting, northing) => {
    const column = (easting - spec.originEasting) / spec.spacing;
    const row = (spec.originNorthing - northing) / spec.spacing;
    const c0 = Math.floor(column);
    const r0 = Math.floor(row);
    if (c0 < 0 || r0 < 0 || c0 + 1 >= spec.columns || r0 + 1 >= spec.rows) return null;
    const tx = column - c0;
    const tz = row - r0;
    const a = values[r0 * spec.columns + c0];
    const b = values[r0 * spec.columns + c0 + 1];
    const c = values[(r0 + 1) * spec.columns + c0];
    const d = values[(r0 + 1) * spec.columns + c0 + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  };
}
const blockAt = loadRaster(UPSALA_LEGACY_FIELD.block);
const vistaAt = loadRaster(UPSALA_LEGACY_FIELD.vista);

/* --- the bridge: pack metres -> EPSG:3006 ------------------------------------- */
const bridge = legacyGridBridge(LEGACY_FRAME);
console.log(`bridge: rotation ${bridge.rotationDegrees.toFixed(6)} deg, scaleX ${bridge.scaleX.toFixed(9)}, scaleZ ${bridge.scaleZ.toFixed(9)}`);
function toEpsg3006(x, z) {
  const [gridX, gridZ] = bridge.toGrid(x, z);
  return [LEGACY_ORIGIN_EPSG3006.easting + gridX, LEGACY_ORIGIN_EPSG3006.northing - gridZ];
}
const sampleFine = (x, z) => blockAt(...toEpsg3006(x, z));
const sampleWide = (x, z) => vistaAt(...toEpsg3006(x, z));
const sampleAny = (x, z) => sampleFine(x, z) ?? sampleWide(x, z) ?? 0;

/* --- HF0: the course and its surroundings, at 4 m ----------------------------- */
/* No usable GPS survey for this course (GolfTraxx holds only hole 1), so the
   play area comes from the OSM golf polygons, unioned with a box about the
   origin so the holes OSM has not mapped still land on the fine mesh. */
const play = [];
for (const key of ['greens', 'fairways', 'tees', 'bunkers', 'roughs', 'drivingRange']) {
  for (const feature of (osm[key] || [])) play.push(...feature.ring);
}
for (const way of (osm.holeWays || [])) play.push(...way.line);
play.push([-700, -700], [700, 700]);
const PB = bbox(play);
const MARGIN = { x0: 800, x1: 800, z0: 900, z1: 900 };
const HF0 = { dx: 4, x0: Math.floor((PB.x0 - MARGIN.x0) / 4) * 4, z0: Math.floor((PB.z0 - MARGIN.z0) / 4) * 4 };
HF0.nx = Math.ceil((PB.x1 + MARGIN.x1 - HF0.x0) / 4) + 1;
HF0.nz = Math.ceil((PB.z1 + MARGIN.z1 - HF0.z0) / 4) + 1;
console.log(`HF0: ${HF0.nx}x${HF0.nz} @4 m  x ${HF0.x0}..${HF0.x0 + (HF0.nx - 1) * 4}  z ${HF0.z0}..${HF0.z0 + (HF0.nz - 1) * 4}`);

const h0 = new Float32Array(HF0.nx * HF0.nz);
let outsideFine = 0;
for (let j = 0; j < HF0.nz; j++) {
  for (let i = 0; i < HF0.nx; i++) {
    const x = HF0.x0 + i * HF0.dx;
    const z = HF0.z0 + j * HF0.dx;
    const value = sampleFine(x, z);
    if (value == null) outsideFine++;
    h0[j * HF0.nx + i] = value ?? sampleWide(x, z) ?? 0;
  }
}
if (outsideFine) {
  throw new Error(`${outsideFine} HF0 samples fell outside the 1 m block; widen it in lib-v2.mjs`);
}

/* --- HF1: the far ring, at 32 m ----------------------------------------------- */
/* The page's FARR reaches +-5400 m; this field is the legacy one's own footprint,
   which is wider, so nothing that used to be drawn stops being drawn. */
const HF1 = { dx: 32, x0: -10080, z0: -9472, nx: 631, nz: 593 };
const h1 = new Float32Array(HF1.nx * HF1.nz);
let outsideWide = 0;
for (let j = 0; j < HF1.nz; j++) {
  for (let i = 0; i < HF1.nx; i++) {
    const value = sampleWide(HF1.x0 + i * HF1.dx, HF1.z0 + j * HF1.dx);
    if (value == null) outsideWide++;
    h1[j * HF1.nx + i] = value ?? 0;
  }
}
if (outsideWide) throw new Error(`${outsideWide} HF1 samples fell outside the 32 m vista; widen it in lib-v2.mjs`);
console.log(`HF1: ${HF1.nx}x${HF1.nz} @32 m  x ${HF1.x0}..${HF1.x0 + (HF1.nx - 1) * 32}  z ${HF1.z0}..${HF1.z0 + (HF1.nz - 1) * 32}`);

const stat = values => {
  let minimum = Infinity;
  let maximum = -Infinity;
  let sum = 0;
  for (const value of values) {
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
    sum += value;
  }
  return { minimum, maximum, mean: sum / values.length };
};
const s0 = stat(h0);
const s1 = stat(h1);
console.log(`  HF0 ${s0.minimum.toFixed(1)}..${s0.maximum.toFixed(1)} m RH 2000 (mean ${s0.mean.toFixed(1)})`);
console.log(`  HF1 ${s1.minimum.toFixed(1)}..${s1.maximum.toFixed(1)} m RH 2000 (mean ${s1.mean.toFixed(1)})`);

/* --- water levels, from the plate the laser saw ------------------------------- */
const MIN_INTERIOR = 12;

function measureRing(ring, shorePercentile = 0.30) {
  const box = bbox(ring);
  const interior = [];
  for (let z = Math.ceil(box.z0); z <= box.z1; z++) {
    for (let x = Math.ceil(box.x0); x <= box.x1; x++) {
      if (!pointInPoly(x, z, ring)) continue;
      const value = sampleFine(x, z);
      if (value != null) interior.push(value);
    }
  }
  if (interior.length >= MIN_INTERIOR) {
    interior.sort((left, right) => left - right);
    const level = interior[Math.floor(interior.length * 0.5)];
    const mean = interior.reduce((sum, value) => sum + value, 0) / interior.length;
    const spread = Math.sqrt(interior.reduce((sum, value) => sum + (value - mean) ** 2, 0) / interior.length);
    return { level, method: 'interior-median', samples: interior.length, spread };
  }
  /* too small, or outside the 1 m block: fall back to the shoreline percentile */
  const shore = ring.map(point => sampleAny(point[0], point[1])).sort((left, right) => left - right);
  return {
    level: shore.length ? shore[Math.floor(shore.length * shorePercentile)] : null,
    method: 'shore-percentile',
    samples: shore.length,
    spread: null,
  };
}

const water = osm.water.map(feature => {
  const measured = measureRing(feature.ring);
  return {
    id: feature.id,
    name: feature.name,
    area: feature.area,
    level: Math.round(measured.level * 100) / 100,
    pts: feature.ring.length,
    method: measured.method,
    samples: measured.samples,
    spread: measured.spread == null ? null : Math.round(measured.spread * 1000) / 1000,
  };
});
const wetlands = osm.wetland.map(feature => {
  const measured = measureRing(feature.ring, 0.20);
  return {
    id: feature.id,
    area: feature.area,
    level: Math.round(measured.level * 100) / 100,
    method: measured.method,
  };
});

/* No sea here -- Håmö is 25 km inland. seaLevel is only the page's "nothing
   below water" floor, just under the lowest measured body. */
const levels = water.map(feature => feature.level).filter(value => value != null);
const seaLevel = levels.length ? Math.round((Math.min(...levels) - 1) * 100) / 100 : 0;
console.log(`\ninland: lowest measured water ${Math.min(...levels).toFixed(2)} m RH 2000 -> floor ${seaLevel}`);
console.log('water levels (m RH 2000):');
for (const feature of water) {
  const spread = feature.spread == null
    ? `${feature.samples} shore points`
    : `sd ${feature.spread.toFixed(2)} m over ${feature.samples} interior samples`;
  console.log(`  ${(feature.name || feature.id).padEnd(16)} ${String(feature.area).padStart(8)} m²  level ${String(feature.level).padStart(6)}  ${spread}`);
}
for (const feature of wetlands) console.log(`  wetland ${feature.id.padEnd(12)} ${String(feature.area).padStart(8)} m²  level ${feature.level}`);

/* A laser DTM flattens water. A ring whose interior is NOT flat is either
   misregistered or is not water, and either way the level below it is a
   guess -- so the spread is a gate and not a footnote. */
const measuredInside = water.filter(feature => feature.spread != null);
const worst = measuredInside.length ? Math.max(...measuredInside.map(feature => feature.spread)) : 0;
console.log(`\n${measuredInside.length} of ${water.length} rings measured from inside; worst spread ${worst.toFixed(2)} m`);
if (worst > 1.5) {
  throw new Error(`a water ring spreads ${worst.toFixed(2)} m inside a DTM that flattens water: it is probably misregistered`);
}

/* --- what the terrain says about each hole ------------------------------------ */
/* filled by reconcile once the holes exist; there is no GPS survey to read here */
const holeElev = {};

/* --- encode ------------------------------------------------------------------- */
const enc0 = quantizeHF(h0, HF0.nx, HF0.nz, 0.10);
const enc1 = quantizeHF(h1, HF1.nx, HF1.nz, 0.40);
for (const [name, encoded, source] of [['HF0', enc0, h0], ['HF1', enc1, h1]]) {
  const back = decodeHF(encoded);
  let error = 0;
  for (let index = 0; index < source.length; index++) error = Math.max(error, Math.abs(back[index] - source[index]));
  console.log(`\n${name}: raw ${(encoded.rawBytes / 1024).toFixed(0)} KB -> deflate ${(encoded.packedBytes / 1024).toFixed(0)} KB -> base64 ${Math.ceil(encoded.b64.length / 1024)} KB  (round-trip worst ${error.toFixed(3)} m)`);
  if (error > encoded.hs) throw new Error(`${name}: codec round-trip lost ${error.toFixed(3)} m, more than one quantum`);
}

const out = {
  source: {
    product: 'Lantmäteriet Markhöjdmodell Nedladdning (dtm-cog), 1 m',
    horizontalCrs: 'EPSG:3006',
    verticalCrs: 'EPSG:5613 (RH 2000)',
    verticalDatumOffsetToPackMetres: 0,
    evidence: 'geo_data/course-v2/upsala/acquisition/legacy-field-window.json',
    note: 'Sampled through the derived legacy-to-grid bridge (rotation 2.157738 deg, scale 0.997659212 / 0.999356507) about the pack origin at E 639830.271 N 6636114.391, so these heights and the published v2 tiles are one field.',
  },
  hf0: { ...HF0, ...enc0 },
  hf1: { ...HF1, ...enc1 },
  seaLevel,
  water,
  wetlands,
  holeElev,
};
const dest = path.join(HERE, 'heightfields.json');
writeJSON(dest, out);
console.log(`\nwrote ${path.relative(process.cwd(), dest)} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB), floor ${seaLevel} m`);
