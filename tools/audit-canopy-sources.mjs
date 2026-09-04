#!/usr/bin/env node
/* How much canopy does each source think a ground has, and do they agree?

   node tools/audit-canopy-sources.mjs --ground johannesberg \
     --rasters <dir with chm-*.f32/.json and chmv2-*.f32/.json> \
     [--json geo_data/course-v2/<ground>/vegetation/canopy-source-audit.json]

   Three independent statements about the same ground, compared cell for cell
   inside the published v2 window:

     laser      the campaign CHM rasters (Lantmateriet Laserdata Skog)
     chmv2      Meta/WRI Canopy Height Maps v2, an optical ML model
     satellite  the legacy tree-cover raster the GPK1 planter obeys

   This exists because replacing a satellite scatter with measured crowns can
   thin a forest either because the forest really is thinner or because the
   scan missed it, and those look identical in a render. A LEAF-OFF scan is
   the case to worry about: it under-detects deciduous crowns.

   The discriminating statistic is not the canopy fraction but the LASER
   HEIGHT where the satellite claims canopy and the laser does not. A crown
   the scan merely thinned still returns something from its branches; a
   distribution piled at 0.00 m is open ground, and then it is the satellite
   that is wrong.

   Read chmv2 as CALIBRATION, not truth: it compresses height and smears
   crowns outward, so it reads HIGH on fraction. It brackets rather than
   settles. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { legacyGridBridge } from '../apps/golf/src/engine/geodetic-frame.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Each ground states where its legacy cover raster lives and the flat-earth
   frame that raster is drawn in. */
const GROUNDS = Object.freeze({
  johannesberg: Object.freeze({
    buildDir: 'johannesbergbuild',
    legacyFrame: Object.freeze({
      latitude: 59.72733,
      longitude: 18.19202,
      metresPerLatitude: 111320,
      metresPerLongitude: 111320 * Math.cos(59.72733 * Math.PI / 180),
    }),
    legacyOriginEpsg3006: Object.freeze({ easting: 679460.879, northing: 6625364.187 }),
    window: Object.freeze({
      minEasting: 678403.5, maxEasting: 680451.5,
      minNorthing: 6624276.5, maxNorthing: 6626324.5,
    }),
  }),
});

const arg = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
};

const groundId = arg('--ground');
const spec = GROUNDS[groundId];
if (!spec) throw new Error(`no canopy-audit recipe for ground ${groundId}`);
const rasterDir = path.resolve(ROOT, arg('--rasters')
  || `packages/course-geo/toolchain/.cache/vegetation/${groundId}`);

/* ---- the legacy satellite cover raster: two bits per cell, little bitorder,
        exactly as build-treecover.py packs it (np.packbits over unpackbits
        count=2). Reading it a byte per cell silently reports zero canopy. ---- */
const cover = JSON.parse(fs.readFileSync(path.join(ROOT, spec.buildDir, 'tree-cover.json'), 'utf8'));
const coverBits = Buffer.from(cover.b64, 'base64');
const cell = cover.cell;
const TREES = Number(Object.entries(cover.legend).find(([, name]) => name === 'trees')?.[0]);
if (!Number.isInteger(TREES)) throw new Error('the cover raster legend has no "trees" class');
const coverAt = index => (coverBits[index >> 2] >> (2 * (index & 3))) & 3;
if (coverBits.length !== Math.ceil(cover.nx * cover.nz / 4)) {
  throw new Error(`cover raster is ${coverBits.length} bytes; a 2-bit packing of ${cover.nx}x${cover.nz} needs ${Math.ceil(cover.nx * cover.nz / 4)}`);
}

/* ---- float rasters on the EPSG:3006 lattice ---- */
function loadRasters(prefix) {
  const loaded = [];
  for (const file of fs.readdirSync(rasterDir)) {
    if (!file.startsWith(prefix) || !file.endsWith('.json')) continue;
    const meta = JSON.parse(fs.readFileSync(path.join(rasterDir, file), 'utf8'));
    const raw = fs.readFileSync(path.join(rasterDir, `${file.slice(0, -5)}.f32`));
    loaded.push({ id: file.slice(0, -5), meta, data: new Float32Array(raw.buffer, raw.byteOffset, meta.width * meta.height) });
  }
  return loaded;
}
function samplerFor(rasters) {
  return (easting, northing) => {
    for (const r of rasters) {
      const column = Math.round((easting - r.meta.originEasting) / r.meta.sampleSpacingMetres);
      const row = Math.round((r.meta.originNorthing - northing) / r.meta.sampleSpacingMetres);
      if (column < 0 || row < 0 || column >= r.meta.width || row >= r.meta.height) continue;
      const value = r.data[row * r.meta.width + column];
      if (Number.isFinite(value)) return value;
    }
    return Number.NaN;
  };
}
const laser = loadRasters('chm-');
const chmv2 = loadRasters('chmv2-');
if (!laser.length) throw new Error(`no chm-*.f32 campaign rasters in ${rasterDir}`);
const laserAt = samplerFor(laser);
const chmv2At = samplerFor(chmv2);

/* ---- the legacy frame -> EPSG:3006 ---- */
const bridge = legacyGridBridge(spec.legacyFrame);
const toEpsg = (x, z) => {
  const [gx, gz] = bridge.toGrid(x, z);
  return [spec.legacyOriginEpsg3006.easting + gx, spec.legacyOriginEpsg3006.northing - gz];
};

const MIN_TREE_METRES = 3;
const w = spec.window;
let both = 0, satelliteOnly = 0, laserOnly = 0, neither = 0, outside = 0;
let chmv2Canopy = 0, chmv2Cells = 0;
const missedHeights = [];
for (let j = 0; j < cover.nz; j++) {
  for (let i = 0; i < cover.nx; i++) {
    const [easting, northing] = toEpsg(cover.x0 + i * cell, cover.z0 + j * cell);
    if (easting < w.minEasting || easting > w.maxEasting ||
        northing < w.minNorthing || northing > w.maxNorthing) { outside++; continue; }
    const satelliteTree = coverAt(j * cover.nx + i) === TREES;
    const height = laserAt(easting, northing);
    const laserTree = Number.isFinite(height) && height >= MIN_TREE_METRES;
    if (satelliteTree && laserTree) both++;
    else if (satelliteTree) { satelliteOnly++; if (Number.isFinite(height)) missedHeights.push(height); }
    else if (laserTree) laserOnly++;
    else neither++;
    if (chmv2.length) {
      const optical = chmv2At(easting, northing);
      if (Number.isFinite(optical)) { chmv2Cells++; if (optical >= MIN_TREE_METRES) chmv2Canopy++; }
    }
  }
}
const inside = both + satelliteOnly + laserOnly + neither;
missedHeights.sort((left, right) => left - right);
const quantile = f => missedHeights.length
  ? Math.round(missedHeights[Math.floor(missedHeights.length * f)] * 100) / 100 : null;
const fraction = value => Math.round(value / inside * 10000) / 10000;

const report = {
  schemaVersion: 1,
  kind: 'canopy-source-audit',
  groundId,
  observedOn: new Date().toISOString().slice(0, 10),
  windowEpsg3006: w,
  comparisonGrid: { cellMetres: cell, cells: inside, minimumTreeHeightMetres: MIN_TREE_METRES },
  sources: {
    laser: { rasters: laser.map(r => r.id), canopyFraction: fraction(both + laserOnly) },
    chmv2: chmv2.length
      ? { rasters: chmv2.map(r => r.id), canopyFraction: chmv2Cells ? Math.round(chmv2Canopy / chmv2Cells * 10000) / 10000 : null,
          note: 'independent optical ML; compresses height and smears crowns outward, so it reads HIGH on fraction — calibration, not truth' }
      : null,
    satellite: { raster: `${spec.buildDir}/tree-cover.json`, canopyFraction: fraction(both + satelliteOnly),
      note: 'the legacy GPK1 planting basis, from leaf-on Esri imagery' },
  },
  agreement: {
    bothCanopy: both, satelliteOnly, laserOnly, neither,
    laserOverSatellite: Math.round((both + laserOnly) / (both + satelliteOnly) * 1000) / 1000,
  },
  discriminator: {
    statement: 'laser canopy height where the satellite claims canopy and the laser does not',
    samples: missedHeights.length,
    medianMetres: quantile(0.5),
    p75Metres: quantile(0.75),
    p90Metres: quantile(0.9),
    p99Metres: quantile(0.99),
    reading: 'a distribution piled at 0.00 m is open ground the satellite over-detected, not canopy the scan lost; a thinned-but-real crown returns branch height',
  },
};
console.log(JSON.stringify(report, null, 2));
const out = arg('--json');
if (out) {
  const file = path.resolve(ROOT, out);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`wrote ${path.relative(ROOT, file)} sha256 ${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`);
}
