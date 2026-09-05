/* The two heightfields angso3d ships, cut from Lantmäteriet's laser DTM and
   expressed in RH 2000.

   This replaced a mosaic of AWS Terrarium tiles (build-heightfields-terrarium.mjs
   keeps that path for reference), and the replacement is not a refinement.
   Measured on 41,636 samples of mown ground (tools/measure-vertical-datum.mjs),
   the Terrarium field stood a median 9.12 m above the laser DTM with a 1.85 m
   median absolute deviation: its DATUM was unknown and its SHAPE was wrong,
   which on a low-relief Mälaren shore put the pack's water rings anywhere from
   3.7 m below to 6.1 m above the surface the laser sees.

   The laser comes from the PUBLISHED ring graph (see lib-v2.mjs for why that is
   the right source and not merely the available one). HF0 and HF1 are
   addressed in the pack's flat-earth frame -- the EPSG:3006 grid rotated by
   1.6135 degrees and scaled by (0.99778, 0.99950) -- so every sample here is
   taken THROUGH that derived bridge, the same one the runtime uses, and the
   vertical bridge between the pack and the v2 tiles is exactly zero.

   Water levels are measured, and in a laser DTM they are measurable properly
   for the first time here: the model treats a water surface as a flat plate,
   so a well-registered ring encloses samples with a few centimetres of spread.
   Every level is the median of the 1 m samples INSIDE the ring, with the
   spread recorded beside it -- which is simultaneously the level and the proof
   that the ring is where the water is. The satellite-traced ponds are measured
   the same way here (they used to take a percentile of the ring's own
   vertices off a 4 m field), and reconcile reads them back by centroid.

     node angsobuild/build-heightfields.mjs                                   */
import fs from 'node:fs';
import path from 'node:path';
import { legacyGridBridge } from '../apps/golf/src/engine/geodetic-frame.mjs';
import { createPublishedGroundLookup, openPublishedGround } from '../packages/course-v2/published-ground-lookup.mjs';
import {
  quantizeHF, decodeHF, readJSON, writeJSON, bbox, pointInPoly, centroid, polyArea,
} from './lib.mjs';
import { HERE, PUBLIC, GROUND_ID, LEGACY_FRAME, LEGACY_ORIGIN_EPSG3006, HF1_HALF_SPAN } from './lib-v2.mjs';

const osm = readJSON(path.join(HERE, 'osm-features.json'));
const traces = readJSON(path.join(HERE, 'sat-shapes.json'));

/* --- the published laser ground -------------------------------------------- */
const { ground, courseManifest, readAsset } = openPublishedGround(fs, path, PUBLIC, GROUND_ID);
const lookup = createPublishedGroundLookup(ground, readAsset);
console.log(`ground ${ground.groundId} ${courseManifest.groundManifest.sha256.slice(0, 12)}: ` +
  lookup.levels.map(level => `l${level.lod} ${level.tiles}@${level.spacing}m`).join(', '));

/* --- the bridge: pack metres -> EPSG:3006 ------------------------------------- */
const bridge = legacyGridBridge(LEGACY_FRAME);
console.log(`bridge: rotation ${bridge.rotationDegrees.toFixed(6)} deg, scaleX ${bridge.scaleX.toFixed(9)}, scaleZ ${bridge.scaleZ.toFixed(9)}`);
function toEpsg3006(x, z) {
  const [gridX, gridZ] = bridge.toGrid(x, z);
  return [LEGACY_ORIGIN_EPSG3006.easting + gridX, LEGACY_ORIGIN_EPSG3006.northing - gridZ];
}
const sampleAt = (x, z) => lookup.sample(...toEpsg3006(x, z));
const sampleFine = (x, z) => { const hit = sampleAt(x, z); return hit && hit.lod === 0 ? hit.heightRH2000 : null; };
const sampleAny = (x, z) => sampleAt(x, z)?.heightRH2000 ?? null;

/* --- HF0: the peninsula and its shore, at 4 m ---------------------------------- */
/* Same footprint rule as before: the OSM golf polygons unioned with a box about
   ORIGIN so the fourteen holes OSM never mapped still land on the fine mesh. */
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
const lodCount = {};
for (let j = 0; j < HF0.nz; j++) {
  for (let i = 0; i < HF0.nx; i++) {
    const hit = sampleAt(HF0.x0 + i * HF0.dx, HF0.z0 + j * HF0.dx);
    if (!hit || !Number.isFinite(hit.heightRH2000)) throw new Error(`HF0 sample ${i},${j} has no published ground under it`);
    lodCount[hit.lod] = (lodCount[hit.lod] || 0) + 1;
    h0[j * HF0.nx + i] = hit.heightRH2000;
  }
}
console.log(`  samples by level: ${Object.entries(lodCount).map(([lod, n]) => `l${lod} ${n}`).join(', ')}`);

/* --- HF1: the far ring, at 32 m ----------------------------------------------- */
/* Every sample from the published rings (2, 4 and 8 m), none from Terrarium:
   a vista stitched from two datums would carry a step at the join. The page's
   FARR reaches +-5400 m; lib-v2 states why +-7520 is the widest square the
   published root can hold about the pack origin. */
const HF1 = { dx: 32, x0: -HF1_HALF_SPAN, z0: -HF1_HALF_SPAN };
HF1.nx = 2 * HF1_HALF_SPAN / 32 + 1;
HF1.nz = HF1.nx;
const h1 = new Float32Array(HF1.nx * HF1.nz);
const lodCount1 = {};
for (let j = 0; j < HF1.nz; j++) {
  for (let i = 0; i < HF1.nx; i++) {
    const hit = sampleAt(HF1.x0 + i * HF1.dx, HF1.z0 + j * HF1.dx);
    if (!hit || !Number.isFinite(hit.heightRH2000)) throw new Error(`HF1 sample ${i},${j} fell outside the published root; narrow HF1_HALF_SPAN`);
    lodCount1[hit.lod] = (lodCount1[hit.lod] || 0) + 1;
    h1[j * HF1.nx + i] = hit.heightRH2000;
  }
}
console.log(`HF1: ${HF1.nx}x${HF1.nz} @32 m  x ${HF1.x0}..${HF1.x0 + (HF1.nx - 1) * 32}  z ${HF1.z0}..${HF1.z0 + (HF1.nz - 1) * 32}`);
console.log(`  samples by level: ${Object.entries(lodCount1).map(([lod, n]) => `l${lod} ${n}`).join(', ')}`);

const stat = values => {
  let minimum = Infinity, maximum = -Infinity, sum = 0;
  for (const value of values) { if (value < minimum) minimum = value; if (value > maximum) maximum = value; sum += value; }
  return { minimum, maximum, mean: sum / values.length };
};
const s0 = stat(h0), s1 = stat(h1);
console.log(`  HF0 ${s0.minimum.toFixed(1)}..${s0.maximum.toFixed(1)} m RH 2000 (mean ${s0.mean.toFixed(1)})`);
console.log(`  HF1 ${s1.minimum.toFixed(1)}..${s1.maximum.toFixed(1)} m RH 2000 (mean ${s1.mean.toFixed(1)})`);

/* --- water levels, from the plate the laser saw ------------------------------- */
const MIN_INTERIOR = 12;

function measureRing(ring, shorePercentile = 0.30) {
  const box = bbox(ring);
  const interior = [];
  /* the 1 m sample is arithmetic and the point-in-polygon test is not: ask the
     cheap question first, or the Mälaren ring's 4 x 12 km box costs minutes */
  for (let z = Math.ceil(box.z0); z <= box.z1; z++) {
    for (let x = Math.ceil(box.x0); x <= box.x1; x++) {
      const value = sampleFine(x, z);
      if (value == null || !pointInPoly(x, z, ring)) continue;
      interior.push(value);
    }
  }
  if (interior.length >= MIN_INTERIOR) {
    interior.sort((left, right) => left - right);
    const level = interior[Math.floor(interior.length * 0.5)];
    const mean = interior.reduce((sum, value) => sum + value, 0) / interior.length;
    const spread = Math.sqrt(interior.reduce((sum, value) => sum + (value - mean) ** 2, 0) / interior.length);
    return { level, method: 'interior-median', samples: interior.length, spread };
  }
  /* too small, or outside the 1 m tiles: fall back to the shoreline percentile */
  const shore = ring.map(point => sampleAny(point[0], point[1])).filter(v => v != null).sort((left, right) => left - right);
  return {
    level: shore.length ? shore[Math.floor(shore.length * shorePercentile)] : null,
    method: 'shore-percentile',
    samples: shore.length,
    spread: null,
  };
}

const round2 = value => (value == null ? null : Math.round(value * 100) / 100);
const water = osm.water.map(feature => {
  const measured = measureRing(feature.ring);
  return {
    id: feature.id, name: feature.name, area: feature.area,
    level: round2(measured.level), pts: feature.ring.length,
    method: measured.method, samples: measured.samples,
    spread: measured.spread == null ? null : Math.round(measured.spread * 1000) / 1000,
  };
});
const wetlands = osm.wetland.map(feature => {
  const measured = measureRing(feature.ring, 0.20);
  return { id: feature.id, area: feature.area, level: round2(measured.level), method: measured.method };
});
/* the satellite-traced ponds, keyed by centroid because they have no id until reconcile numbers them */
const ponds = [];
for (const hole of traces.holes) {
  for (const [index, trace] of (hole.water || []).entries()) {
    const measured = measureRing(trace.ring);
    const c = centroid(trace.ring);
    ponds.push({
      hole: hole.hole, index, centroid: [Math.round(c[0] * 10) / 10, Math.round(c[1] * 10) / 10],
      area: Math.round(Math.abs(polyArea(trace.ring))),
      level: round2(measured.level), method: measured.method, samples: measured.samples,
      spread: measured.spread == null ? null : Math.round(measured.spread * 1000) / 1000,
    });
  }
}

/* Mälaren is a real lake at a real level, but the model carries it only as the
   OSM ring of its western bay (no isSea ring), so seaLevel stays the page's
   "nothing below water" floor: just under the lowest measured body. */
const levels = [...water, ...ponds].map(feature => feature.level).filter(value => value != null);
const seaLevel = levels.length ? Math.round((Math.min(...levels) - 1) * 100) / 100 : 0;
console.log(`\nlowest measured water ${Math.min(...levels).toFixed(2)} m RH 2000 -> floor ${seaLevel}`);
const describe = feature => (feature.spread == null
  ? `${feature.samples} shore points`
  : `sd ${feature.spread.toFixed(2)} m over ${feature.samples} interior samples`);
console.log('water levels (m RH 2000):');
for (const feature of water) {
  console.log(`  ${(feature.name || feature.id).padEnd(16)} ${String(feature.area).padStart(8)} m²  level ${String(feature.level).padStart(6)}  ${describe(feature)}`);
}
for (const pond of ponds) {
  console.log(`  hole ${String(pond.hole).padStart(2)} pond ${pond.index}   ${String(pond.area).padStart(6)} m²  level ${String(pond.level).padStart(6)}  ${describe(pond)}`);
}
for (const feature of wetlands) console.log(`  wetland ${feature.id.padEnd(12)} ${String(feature.area).padStart(8)} m²  level ${feature.level}`);

/* A laser DTM flattens water. A ring whose interior is NOT flat is either
   misregistered or is not water, and either way the level below it is a
   guess -- so the spread is a gate and not a footnote. */
const measuredInside = [...water, ...ponds].filter(feature => feature.spread != null);
const worst = measuredInside.length ? Math.max(...measuredInside.map(feature => feature.spread)) : 0;
console.log(`\n${measuredInside.length} of ${water.length + ponds.length} rings measured from inside; worst spread ${worst.toFixed(2)} m`);
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
    product: 'Lantmäteriet Markhöjdmodell Nedladdning (dtm-cog), 1 m, via the published Ängsö ring graph',
    groundManifest: courseManifest.groundManifest.url,
    groundManifestSha256: courseManifest.groundManifest.sha256,
    horizontalCrs: 'EPSG:3006',
    verticalCrs: 'EPSG:5613 (RH 2000)',
    verticalDatumOffsetToPackMetres: 0,
    evidence: 'geo_data/course-v2/angso/acquisition/terrain-window.json and ground-rings.json',
    note: `Sampled through the derived legacy-to-grid bridge (rotation ${bridge.rotationDegrees.toFixed(6)} deg, scale ${bridge.scaleX.toFixed(9)} / ${bridge.scaleZ.toFixed(9)}) about the pack origin at E ${LEGACY_ORIGIN_EPSG3006.easting} N ${LEGACY_ORIGIN_EPSG3006.northing}, from the finest published level under each sample, so these heights and the streamed v2 tiles are one field.`,
  },
  hf0: { ...HF0, ...enc0 },
  hf1: { ...HF1, ...enc1 },
  seaLevel,
  water,
  ponds,
  wetlands,
  holeElev,
};
const dest = path.join(HERE, 'heightfields.json');
writeJSON(dest, out);
console.log(`\nwrote ${path.relative(process.cwd(), dest)} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB), floor ${seaLevel} m`);
