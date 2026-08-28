/* Mosaic the Terrarium tiles into the two heightfields norrfallsviken3d ships.

   HF0 is the cape at 4 m — course, Storsanden, the fishing village — and HF1 the
   sea vista at 32 m, wide enough to hold the real horizon: Mjältön to the
   north-west, the Ulvö islands to the north-east, Högbonden's island due south.
   Most of HF1 is the Gulf of Bothnia at 0 m, which deflate eats for breakfast,
   so the wide vista costs almost nothing.

   The water levels are measured, not assumed: the sea off the coastline chain,
   the lake by the 13th green off its own shoreline, each wetland pool likewise. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { terrariumHeights } from '../geobuild/png.mjs';
import {
  CACHE, ORIGIN, M_PER_LAT, M_PER_LON, xzToLonLat, lonLatToXZ, quantizeHF, decodeHF,
  readJSON, writeJSON, bbox,
} from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEM = path.join(CACHE, 'dem');
const manifest = readJSON(path.join(DEM, 'manifest.json'));
const osm = readJSON(path.join(HERE, 'osm-features.json'));

/* --- tile pyramid ------------------------------------------------------------ */
function loadLevel(name) {
  const L = manifest.levels[name];
  const T = new Map();
  for (const [x, y] of L.tiles) {
    const f = path.join(DEM, `${L.z}-${x}-${y}.png`);
    if (!fs.existsSync(f)) continue;
    T.set(`${x},${y}`, terrariumHeights(fs.readFileSync(f)));
  }
  const size = T.values().next().value.width;
  const N = 2 ** L.z * size;
  const at = (lon, lat) => {
    const px = (lon + 180) / 360 * N;
    const py = (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * N;
    const x0 = Math.floor(px - 0.5), y0 = Math.floor(py - 0.5);
    const fx = px - 0.5 - x0, fy = py - 0.5 - y0;
    let acc = 0, wsum = 0;
    for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
      const gx = x0 + dx, gy = y0 + dy;
      const t = T.get(`${Math.floor(gx / size)},${Math.floor(gy / size)}`);
      if (!t) continue;
      const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
      acc += t.h[(gy % size + size) % size * size + (gx % size + size) % size] * w;
      wsum += w;
    }
    return wsum > 0.001 ? acc / wsum : null;
  };
  return { L, at, tiles: T.size };
}

const core = loadLevel('core');
const wide = loadLevel('wide');
console.log(`tiles loaded: core z${core.L.z} ${core.tiles}, wide z${wide.L.z} ${wide.tiles}`);

const sampleCore = (x, z) => { const [lo, la] = xzToLonLat(x, z); return core.at(lo, la); };
const sampleWide = (x, z) => { const [lo, la] = xzToLonLat(x, z); return wide.at(lo, la); };
const sampleAny = (x, z) => sampleCore(x, z) ?? sampleWide(x, z) ?? 0;

/* --- HF0: the cape, at 4 m ---------------------------------------------------- */
/* The GPS survey is the only authoritative course extent, padded far enough that
   the village, the marina and Storsanden's dunes are all on the fine mesh. */
const gps = readJSON(path.join(HERE, '..', 'geo_data', 'norrfallsviken_clean.json'));
const gpsPts = gps.features.map(f => lonLatToXZ(...f.geometry.coordinates));
const PB = bbox(gpsPts);
const MARGIN = { x0: 900, x1: 700, z0: 900, z1: 1300 };   // stretched south to the village
const HF0 = { dx: 4, x0: Math.floor((PB.x0 - MARGIN.x0) / 4) * 4, z0: Math.floor((PB.z0 - MARGIN.z0) / 4) * 4 };
HF0.nx = Math.ceil((PB.x1 + MARGIN.x1 - HF0.x0) / 4) + 1;
HF0.nz = Math.ceil((PB.z1 + MARGIN.z1 - HF0.z0) / 4) + 1;
console.log(`HF0: ${HF0.nx}x${HF0.nz} @4 m  x ${HF0.x0}..${HF0.x0 + (HF0.nx - 1) * 4}  z ${HF0.z0}..${HF0.z0 + (HF0.nz - 1) * 4}`);

/* Terrarium carries real bathymetry in the Gulf of Bothnia (the wide field
   bottoms out at -166 m). The render only ever needs the first few metres of
   bed — the pale-shallows look — and clamping the abyss to a constant floor
   lets deflate flatten the open sea to almost nothing. */
const BED0 = -6, BED1 = -8;

const h0 = new Float32Array(HF0.nx * HF0.nz);
let miss = 0;
for (let j = 0; j < HF0.nz; j++) for (let i = 0; i < HF0.nx; i++) {
  const v = sampleCore(HF0.x0 + i * HF0.dx, HF0.z0 + j * HF0.dx);
  if (v === null) miss++;
  h0[j * HF0.nx + i] = Math.max(BED0, v ?? sampleWide(HF0.x0 + i * HF0.dx, HF0.z0 + j * HF0.dx) ?? 0);
}
if (miss) console.log(`  ${miss} core samples fell outside the z${core.L.z} tiles (filled from the vista)`);

/* --- HF1: the vista, at 32 m -------------------------------------------------- */
/* matches fetch-dem's wide box: lon ±0.22, lat -0.13..+0.105 about ORIGIN */
const HF1 = { dx: 32 };
{
  const [xw] = lonLatToXZ(ORIGIN.lon - 0.22, ORIGIN.lat);
  const [xe] = lonLatToXZ(ORIGIN.lon + 0.22, ORIGIN.lat);
  const [, zn] = lonLatToXZ(ORIGIN.lon, ORIGIN.lat + 0.105);
  const [, zs] = lonLatToXZ(ORIGIN.lon, ORIGIN.lat - 0.13);
  HF1.x0 = Math.floor(xw / 32) * 32; HF1.z0 = Math.floor(zn / 32) * 32;
  HF1.nx = Math.ceil((xe - HF1.x0) / 32) + 1;
  HF1.nz = Math.ceil((zs - HF1.z0) / 32) + 1;
}
const h1 = new Float32Array(HF1.nx * HF1.nz);
for (let j = 0; j < HF1.nz; j++) for (let i = 0; i < HF1.nx; i++)
  h1[j * HF1.nx + i] = Math.max(BED1, sampleWide(HF1.x0 + i * HF1.dx, HF1.z0 + j * HF1.dx) ?? 0);
console.log(`HF1: ${HF1.nx}x${HF1.nz} @32 m  x ${HF1.x0}..${HF1.x0 + (HF1.nx - 1) * 32}  z ${HF1.z0}..${HF1.z0 + (HF1.nz - 1) * 32}`);

const stat = a => { let mn = Infinity, mx = -Infinity, s = 0; for (const v of a) { if (v < mn) mn = v; if (v > mx) mx = v; s += v; } return { mn, mx, mean: s / a.length }; };
const s0 = stat(h0), s1 = stat(h1);
console.log(`  HF0 ${s0.mn.toFixed(1)}..${s0.mx.toFixed(1)} m (mean ${s0.mean.toFixed(1)})`);
console.log(`  HF1 ${s1.mn.toFixed(1)}..${s1.mx.toFixed(1)} m (mean ${s1.mean.toFixed(1)})`);

/* --- water levels, measured not assumed --------------------------------------- */
function levelOfPts(pts, pct = 0.30) {
  const s = [];
  for (const p of pts) {
    const v = sampleAny(p[0], p[1]);
    if (v != null) s.push(v);
  }
  s.sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length * pct)] : null;
}

/* The sea is at 0 by definition (Baltic, RH2000): Terrarium mixes land pixels
   and bathymetry along the shore, so "measuring" it there is meaningless — the
   number is only printed to show the shoreline bias. */
const coastPts = osm.coastline.flatMap(c => c.line);
const seaMeasured = levelOfPts(coastPts, 0.30);
const seaLevel = 0;
console.log(`\nsea: ${coastPts.length} coastline samples read ${seaMeasured.toFixed(2)} m (land bias) -> seaLevel pinned ${seaLevel}`);

const water = osm.water.map(w => ({
  id: w.id, name: w.name, area: w.area,
  level: Math.round(levelOfPts(w.ring) * 100) / 100, pts: w.ring.length,
}));
const wetlands = osm.wetland.map(w => ({
  id: w.id, area: w.area, level: Math.round(levelOfPts(w.ring, 0.20) * 100) / 100,
}));
console.log(`water levels (m ASL):`);
for (const w of water) console.log(`  ${(w.name || w.id).padEnd(16)} ${String(w.area).padStart(8)} m²  level ${w.level}`);
for (const w of wetlands) console.log(`  wetland ${w.id.padEnd(12)} ${String(w.area).padStart(8)} m²  level ${w.level}`);

/* --- what the terrain says about each hole ------------------------------------ */
const G = {};
for (const f of gps.features) {
  const p = f.properties, [lo, la] = f.geometry.coordinates;
  (G[+p.hole] ||= {})[p.name] = [(lo - ORIGIN.lon) * M_PER_LON, -(la - ORIGIN.lat) * M_PER_LAT];
}
const holeElev = {};
console.log(`\nhole  tee    green   plays`);
for (let n = 1; n <= 18; n++) {
  const tee = sampleAny(...G[n]['TheTipsTee Back Reach']);
  const grn = sampleAny(...G[n]['Green Center']);
  holeElev[n] = { tee: Math.round(tee * 10) / 10, green: Math.round(grn * 10) / 10, rise: Math.round((grn - tee) * 10) / 10 };
  console.log(`${String(n).padStart(4)}  ${tee.toFixed(1).padStart(5)}  ${grn.toFixed(1).padStart(6)}   ${(grn - tee >= 0 ? '+' : '') + (grn - tee).toFixed(1)} m`);
}

/* --- encode ------------------------------------------------------------------- */
const enc0 = quantizeHF(h0, HF0.nx, HF0.nz, 0.10);
const enc1 = quantizeHF(h1, HF1.nx, HF1.nz, 0.40);
for (const [nm, enc, src] of [['HF0', enc0, h0], ['HF1', enc1, h1]]) {
  const back = decodeHF(enc);
  let worst = 0;
  for (let i = 0; i < src.length; i++) worst = Math.max(worst, Math.abs(back[i] - src[i]));
  const b64 = Math.ceil(enc.b64.length / 1024);
  console.log(`\n${nm}: raw ${(enc.rawBytes / 1024).toFixed(0)} KB -> deflate ${(enc.packedBytes / 1024).toFixed(0)} KB -> base64 ${b64} KB  (round-trip worst ${worst.toFixed(3)} m)`);
  if (worst > enc.hs) throw new Error(`${nm}: codec round-trip lost ${worst.toFixed(3)} m, more than one quantum`);
}

const out = {
  hf0: { ...HF0, ...enc0 },
  hf1: { ...HF1, ...enc1 },
  seaLevel,
  water,
  wetlands,
  holeElev,
};
const dest = path.join(HERE, 'heightfields.json');
writeJSON(dest, out);
console.log(`\nwrote ${path.relative(process.cwd(), dest)} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB), sea ${seaLevel} m`);
