/* Mosaic the Terrarium tiles into the two heightfields the page ships with.

   HF0 is the course itself at 4 m, HF1 the 12 km vista at 32 m. Both are sampled
   bilinearly out of web-mercator tile space into the course's own metric frame, which
   is a resample rather than a reprojection: at 63.28 N mercator's scale factor is
   2.2, so a tile pixel is 2.15 m on the ground and the 4 m grid is a genuine
   downsample, not invented resolution.

   It also reads the water levels off the DEM. A lake surface is not sea level here --
   Veckefjarden sits about 20.5 m up -- and each pond has its own level, which is the
   thing that has to be measured rather than assumed if ponds are not to come out as
   craters with a sheet of water laid across them.                                   */
import fs from 'node:fs';
import path from 'node:path';
import { terrariumHeights } from './png.mjs';
import {
  CACHE, ROOT, ORIGIN, M_PER_LAT, M_PER_LON, xzToLonLat, quantizeHF, decodeHF,
  readJSON, writeJSON, bbox, polySD, pointInPoly, clamp,
} from './lib.mjs';

const DEM = path.join(CACHE, 'dem');
const manifest = readJSON(path.join(DEM, 'manifest.json'));
const osm = readJSON(path.join(ROOT, 'geobuild', 'osm-features.json'));

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
  /* world -> global pixel, then bilinear across the tile seams */
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

/* --- HF0: the course, at 4 m ------------------------------------------------- */
/* The play area plus enough margin that a camera anywhere on the course sees the
   4 m mesh in every direction it can look, not the 24 m one. */
const play = [];
for (const k of ['greens', 'fairways', 'tees', 'bunkers', 'roughs', 'drivingRange'])
  for (const f of osm[k] || []) play.push(...f.ring);
for (const h of osm.holeWays) play.push(...h.line);
const PB = bbox(play);
const MARGIN = 620;
const HF0 = { dx: 4, x0: Math.floor((PB.x0 - MARGIN) / 4) * 4, z0: Math.floor((PB.z0 - MARGIN) / 4) * 4 };
HF0.nx = Math.ceil((PB.x1 + MARGIN - HF0.x0) / 4) + 1;
HF0.nz = Math.ceil((PB.z1 + MARGIN - HF0.z0) / 4) + 1;
console.log(`HF0: ${HF0.nx}x${HF0.nz} @4 m  x ${HF0.x0}..${HF0.x0 + (HF0.nx - 1) * 4}  z ${HF0.z0}..${HF0.z0 + (HF0.nz - 1) * 4}`);

const h0 = new Float32Array(HF0.nx * HF0.nz);
let miss = 0;
for (let j = 0; j < HF0.nz; j++) for (let i = 0; i < HF0.nx; i++) {
  const v = sampleCore(HF0.x0 + i * HF0.dx, HF0.z0 + j * HF0.dx);
  if (v === null) miss++;
  h0[j * HF0.nx + i] = v ?? sampleWide(HF0.x0 + i * HF0.dx, HF0.z0 + j * HF0.dx) ?? 0;
}
if (miss) console.log(`  ${miss} core samples fell outside the z${core.L.z} tiles (filled from the vista)`);

/* --- HF1: the vista, at 32 m ------------------------------------------------- */
const HF1 = { dx: 32, x0: -6016, z0: -6592, nx: 377, nz: 395 };
const h1 = new Float32Array(HF1.nx * HF1.nz);
for (let j = 0; j < HF1.nz; j++) for (let i = 0; i < HF1.nx; i++)
  h1[j * HF1.nx + i] = sampleWide(HF1.x0 + i * HF1.dx, HF1.z0 + j * HF1.dx) ?? 0;
console.log(`HF1: ${HF1.nx}x${HF1.nz} @32 m  x ${HF1.x0}..${HF1.x0 + (HF1.nx - 1) * 32}  z ${HF1.z0}..${HF1.z0 + (HF1.nz - 1) * 32}`);

const stat = a => { let mn = Infinity, mx = -Infinity, s = 0; for (const v of a) { if (v < mn) mn = v; if (v > mx) mx = v; s += v; } return { mn, mx, mean: s / a.length }; };
const s0 = stat(h0), s1 = stat(h1);
console.log(`  HF0 ${s0.mn.toFixed(1)}..${s0.mx.toFixed(1)} m (mean ${s0.mean.toFixed(1)})`);
console.log(`  HF1 ${s1.mn.toFixed(1)}..${s1.mx.toFixed(1)} m (mean ${s1.mean.toFixed(1)})`);

/* --- water levels, measured not assumed -------------------------------------- */
/* A lake's surface is the level its shoreline sits at. Sampling the shoreline rather
   than the interior avoids the bathymetry the DEM does not have: Terrarium fills lake
   beds with the surface height anyway, but a pond small enough to be a single pixel
   would otherwise pick up the bank. Take a low percentile so a bank sample cannot
   drag the level up. */
function levelOfRing(ring) {
  const s = [];
  for (const p of ring) {
    const v = sampleAny(p[0], p[1]);
    if (v != null) s.push(v);
  }
  s.sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length * 0.30)] : null;
}

const water = osm.water.map(w => {
  const level = levelOfRing(w.ring);
  return { id: w.id, name: w.name, area: w.area, level: Math.round(level * 100) / 100, pts: w.ring.length };
});
water.sort((a, b) => b.area - a.area);
const lake = water[0];
console.log(`\nwater levels (m ASL):`);
for (const w of water.slice(0, 10))
  console.log(`  ${(w.name || w.id).padEnd(16)} ${String(w.area).padStart(8)} m²  level ${w.level}`);
if (water.length > 10) console.log(`  ... and ${water.length - 10} smaller`);

/* --- what the terrain says about each hole ----------------------------------- */
const gps = readJSON(path.join(ROOT, 'geo_data', 'veckefjarden_clean.json'));
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

/* --- encode ------------------------------------------------------------------ */
const enc0 = quantizeHF(h0, HF0.nx, HF0.nz, 0.10);
const enc1 = quantizeHF(h1, HF1.nx, HF1.nz, 0.25);
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
  lakeLevel: lake.level,
  lakeId: lake.id,
  water,
  holeElev,
};
const dest = path.join(ROOT, 'geobuild', 'heightfields.json');
writeJSON(dest, out);
console.log(`\nwrote ${path.relative(process.cwd(), dest)} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB), lake level ${lake.level} m`);
