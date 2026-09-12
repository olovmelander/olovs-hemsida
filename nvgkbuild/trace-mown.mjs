#!/usr/bin/env node
/* THE MOWN GROUND, read off Lantmäteriet's orthophoto.
 *
 * Norrfällsviken's model carries 5.73 ha of traced fairway over eighteen holes
 * -- about a 20 m strip each -- and the engine paints mown-looking ground well
 * past it. So a tree at the real treeline stands inside what reads as fairway,
 * and the vegetation exclusion mask, built from those same narrow polygons,
 * never had a chance to refuse it. This measures where the mowing actually is.
 *
 * The imagery is a CLASSIFICATION SOURCE and never a runtime texture, which is
 * the policy every ortho tool here states: what leaves this file is a mask.
 * Ortofoto_0.5 and Ortofoto_IR are servable with NO credentials through the
 * viewing service Min karta proxies, WMS 1.1.1 with SRS= and easting first
 * (1.3.0 with EPSG:3006 wants northing first and answers pure white), PNG so
 * Node decodes it with the repo's own reader and no browser is needed.
 *
 *   node nvgkbuild/trace-mown.mjs [--px 0.5] [--margin 150] [--no-fetch]
 *
 * Writes nvgkbuild/mown-surface.json: one class per CELL metre square over the
 * played box, 0 unknown / 1 mown / 2 not mown, nibble-packed, raw-deflated,
 * base64 -- the land-cover record's own codec, so the engine already reads it.
 * Tiles cache in nvgkbuild/cache/mown/ and are gitignored.                    */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { decodePNG } from '../geobuild/png.mjs';
import { packNibbles } from '../apps/golf/src/engine/landcover.mjs';
import { latLonToSweref99Tm } from '../packages/course-geo/chmv2/projection.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'nvgkbuild');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? +argv[i + 1] : d; };
const PX = arg('--px', 0.5);            /* the imagery's sampling */
const CELL = arg('--cell', 1);          /* the mask's own cell */
const MARGIN = arg('--margin', 150);
const NO_FETCH = argv.includes('--no-fetch');
const CACHE = path.join(DIR, 'cache', 'mown');
fs.mkdirSync(CACHE, { recursive: true });

const model = JSON.parse(fs.readFileSync(path.join(DIR, 'course-model.json'), 'utf8'));
const toGrid = (x, z) => latLonToSweref99Tm(model.origin.lat - z / model.mPerLat, model.origin.lon + x / model.mPerLon);

/* ---- the played box, derived from the model and never typed --------------- */
const B = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
const put = p => { if (!p) return; B.x0 = Math.min(B.x0, p[0]); B.x1 = Math.max(B.x1, p[0]); B.z0 = Math.min(B.z0, p[1]); B.z1 = Math.max(B.z1, p[1]); };
for (const h of model.holes) {
  h.line.forEach(put);
  h.green?.ring?.forEach(put);
  for (const r of h.fairway?.rings || []) r.forEach(put);
  for (const t of h.tees?.pads || []) t.ring.forEach(put);
  for (const b of h.bunkers || []) (b.ring || []).forEach(put);
}
const box = { x0: Math.floor(B.x0 - MARGIN), x1: Math.ceil(B.x1 + MARGIN), z0: Math.floor(B.z0 - MARGIN), z1: Math.ceil(B.z1 + MARGIN) };
const nx = Math.ceil((box.x1 - box.x0) / CELL), nz = Math.ceil((box.z1 - box.z0) / CELL);
console.log(`played box x ${box.x0}..${box.x1}  z ${box.z0}..${box.z1}  -> ${nx} x ${nz} cells at ${CELL} m`);

/* ---- the imagery window on the EPSG:3006 lattice -------------------------- */
const corners = [[box.x0, box.z0], [box.x1, box.z0], [box.x1, box.z1], [box.x0, box.z1]].map(([x, z]) => toGrid(x, z));
const minE = Math.floor(Math.min(...corners.map(c => c[0])) / PX) * PX;
const maxE = Math.ceil(Math.max(...corners.map(c => c[0])) / PX) * PX;
const minN = Math.floor(Math.min(...corners.map(c => c[1])) / PX) * PX;
const maxN = Math.ceil(Math.max(...corners.map(c => c[1])) / PX) * PX;
const W = Math.round((maxE - minE) / PX), H = Math.round((maxN - minN) / PX);
console.log(`imagery window E ${minE}-${maxE} N ${minN}-${maxN}: ${W} x ${H} px at ${PX} m`);

const MAXPX = 2048;
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36' };
async function piece(layer, c0, r0, cols, rows) {
  const e0 = minE + c0 * PX, e1 = e0 + cols * PX, n1 = maxN - r0 * PX, n0 = n1 - rows * PX;
  const file = path.join(CACHE, `${layer}_${PX}m_${e0}_${n0}_${cols}x${rows}.png`);
  if (!fs.existsSync(file)) {
    if (NO_FETCH) throw new Error(`--no-fetch and ${path.basename(file)} is not cached`);
    const url = `https://minkarta.lantmateriet.se/map/ortofoto?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${layer}&STYLES=&SRS=EPSG:3006&BBOX=${e0},${n0},${e1},${n1}&WIDTH=${cols}&HEIGHT=${rows}&FORMAT=image/png`;
    let r = null;
    /* the proxy answers an occasional 502/504 on a big piece */
    for (let a = 1; a <= 3; a++) { r = await fetch(url, { headers: HEADERS }); if (r.ok || r.status < 500 || a === 3) break; await new Promise(s => setTimeout(s, 3000 * a)); }
    if (!r.ok) throw new Error(`WMS ${r.status} for ${layer} ${cols}x${rows} at ${e0},${n0}`);
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length < 4096 || bytes[0] !== 0x89) throw new Error(`${layer}: ${bytes.length} bytes, not a PNG`);
    fs.writeFileSync(file, bytes);
    console.log(`  fetched ${layer} ${cols}x${rows}: ${(bytes.length / 1e6).toFixed(1)} MB`);
  }
  return decodePNG(fs.readFileSync(file));
}
async function mosaic(layer) {
  const out = new Uint8Array(W * H * 3);
  const nC = Math.ceil(W / MAXPX), nR = Math.ceil(H / MAXPX);
  for (let pr = 0; pr < nR; pr++) for (let pc = 0; pc < nC; pc++) {
    const c0 = Math.floor(pc * W / nC), c1 = Math.floor((pc + 1) * W / nC);
    const r0 = Math.floor(pr * H / nR), r1 = Math.floor((pr + 1) * H / nR);
    const p = await piece(layer, c0, r0, c1 - c0, r1 - r0), ch = p.channels;
    for (let y = 0; y < r1 - r0; y++) for (let x = 0; x < c1 - c0; x++) {
      const s = (y * (c1 - c0) + x) * ch, d = ((r0 + y) * W + (c0 + x)) * 3;
      out[d] = p.data[s]; out[d + 1] = p.data[s + 1]; out[d + 2] = p.data[s + 2];
    }
  }
  return out;
}
const RGB = await mosaic('Ortofoto_0.5');
const IR = await mosaic('Ortofoto_IR');

const px = (buf, x, z) => {
  const [e, n] = toGrid(x, z);
  const i = Math.floor((e - minE) / PX), j = Math.floor((maxN - n) / PX);
  if (i < 0 || j < 0 || i >= W || j >= H) return null;
  const p = (j * W + i) * 3;
  if (buf[p] === 255 && buf[p + 1] === 255 && buf[p + 2] === 255) return null;   /* no imagery */
  return [buf[p], buf[p + 1], buf[p + 2]];
};
/* excess green and near infrared, the two that separated mown from canopy on
   this course's own ground; luminance is kept for the report only */
const feat = (x, z) => {
  const s = px(RGB, x, z), c = px(IR, x, z);
  if (!s || !c) return null;
  return { exg: 2 * s[1] - s[0] - s[2], nir: c[0], lum: 0.299 * s[0] + 0.587 * s[1] + 0.114 * s[2] };
};

/* ---- calibration on the course's own ground ------------------------------- */
const inRing = (x, z, r) => { let w = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    if ((r[j][1] > z) !== (r[i][1] > z) && x < r[j][0] + (z - r[j][1]) * (r[i][0] - r[j][0]) / (r[i][1] - r[j][1])) w = !w;
  return w; };
const sampleRing = (ring, step = 2) => {
  const out = [], xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
  for (let z = Math.min(...zs); z <= Math.max(...zs); z += step)
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += step) {
      if (!inRing(x, z, ring)) continue;
      const f = feat(x, z); if (f) out.push(f);
    }
  return out;
};
/* GREENS AND TEE PADS ARE CERTAINLY MOWN; the traced fairway rings are a
   reading and are held back as an independent check on the cuts rather than
   used to set them. */
const MOWN = [];
for (const h of model.holes) {
  if (h.green?.ring) MOWN.push(...sampleRing(h.green.ring, 1));
  for (const t of h.tees?.pads || []) MOWN.push(...sampleRing(t.ring, 1));
}
const FAIRWAY = [];
for (const h of model.holes) for (const r of h.fairway?.rings || []) FAIRWAY.push(...sampleRing(r, 2));
/* canopy: the satellite tree-cover raster's closed cells, well clear of play */
const cover = JSON.parse(fs.readFileSync(path.join(DIR, 'tree-cover.json'), 'utf8'));
/* two bits per cell, four to the byte, little bitorder, and NOT deflated --
   the legacy raster is raw base64 (CLAUDE.md's own note on this decoder) */
const coverBits = Buffer.from(cover.b64, 'base64');
const coverAt = (x, z) => {
  const i = Math.floor((x - cover.x0) / cover.cell), j = Math.floor((z - cover.z0) / cover.cell);
  if (i < 0 || j < 0 || i >= cover.nx || j >= cover.nz) return 0;
  const k = j * cover.nx + i, byte = coverBits[k >> 2];
  return (byte >> ((k & 3) * 2)) & 3;
};
const dLine = (x, z) => { let best = Infinity;
  for (const h of model.holes) for (let i = 1; i < h.line.length; i++) {
    const a = h.line[i - 1], b = h.line[i], dx = b[0] - a[0], dz = b[1] - a[1];
    const L = dx * dx + dz * dz; let u = L ? ((x - a[0]) * dx + (z - a[1]) * dz) / L : 0;
    u = Math.max(0, Math.min(1, u));
    const d = Math.hypot(x - (a[0] + u * dx), z - (a[1] + u * dz));
    if (d < best) best = d;
  } return best; };
const CANOPY = [];
for (let z = box.z0; z < box.z1; z += 4) for (let x = box.x0; x < box.x1; x += 4) {
  if (coverAt(x, z) !== 3 || dLine(x, z) < 60) continue;
  const f = feat(x, z); if (f) CANOPY.push(f);
}
const med = (a, k) => { const b = a.map(v => v[k]).sort((p, q) => p - q); return b[b.length >> 1]; };
console.log(`\ncalibration  mown(greens+tees) n=${MOWN.length}  canopy n=${CANOPY.length}  fairway(held back) n=${FAIRWAY.length}`);
for (const k of ['exg', 'nir', 'lum'])
  console.log(`  ${k.padEnd(4)} mown ${med(MOWN, k).toFixed(1).padStart(7)}  canopy ${med(CANOPY, k).toFixed(1).padStart(7)}  fairway ${med(FAIRWAY, k).toFixed(1).padStart(7)}`);
/* THE CUT IS SWEPT, NOT ARITHMETIC. A percentile pair looks principled and set
   a luminance cut that threw away 42% of the greens; sweeping for the balanced
   optimum is what the two references can actually support. */
const sweep = (k) => {
  const all = [...MOWN, ...CANOPY].map(v => v[k]);
  const lo = Math.min(...all), hi = Math.max(...all);
  let best = { score: -1 };
  for (let t = lo; t <= hi; t += (hi - lo) / 400) {
    const keep = MOWN.filter(f => f[k] > t).length / MOWN.length;
    const refuse = CANOPY.filter(f => f[k] <= t).length / CANOPY.length;
    const score = (keep + refuse) / 2;
    if (score > best.score) best = { score, t, keep, refuse, k };
  }
  return best;
};
const cands = ['exg', 'nir', 'lum'].map(sweep).sort((a, b) => b.score - a.score);
for (const c of cands) console.log(`  ${c.k.padEnd(4)} best cut ${c.t.toFixed(1).padStart(7)}  balanced ${(100 * c.score).toFixed(1)}%  (mown kept ${(100 * c.keep).toFixed(1)}%, canopy refused ${(100 * c.refuse).toFixed(1)}%)`);
const D = cands[0];
/* a second feature only if it earns its place on the held-back fairways */
const isMown = f => f[D.k] > D.t;
const selfMown = D.keep, selfCanopy = D.refuse;
const fairwayMown = FAIRWAY.filter(isMown).length / FAIRWAY.length;
console.log(`  -> ${D.k} > ${D.t.toFixed(1)}; the held-back traced fairways read ${(100 * fairwayMown).toFixed(1)}% mown`);
if (D.score < 0.85) throw new Error(`the cut reproduces the course's own ground at only ${(100 * D.score).toFixed(1)}%; refusing to write a mask`);

/* ---- the mask ------------------------------------------------------------- */
const cells = new Uint8Array(nx * nz);
let mown = 0, unknown = 0;
for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
  const x = box.x0 + (i + 0.5) * CELL, z = box.z0 + (j + 0.5) * CELL;
  const f = feat(x, z);
  if (!f) { cells[j * nx + i] = 0; unknown++; continue; }
  const m = isMown(f); cells[j * nx + i] = m ? 1 : 2; if (m) mown++;
}
const ha = n => (n * CELL * CELL / 10000).toFixed(2);
console.log(`\nmown ${ha(mown)} ha of ${ha(nx * nz)} ha in the box (unknown ${ha(unknown)} ha)`);
const out = {
  source: `Lantmäteriet Ortofoto_0.5 + Ortofoto_IR via minkarta.lantmateriet.se WMS at ${PX} m/px, classified per ${CELL} m cell; fetched ${new Date().toISOString().slice(0, 10)}`,
  note: 'Where the mowing actually is. A classification source, never a runtime texture.',
  x0: box.x0, z0: box.z0, nx, nz, cell: CELL,
  calibration: {
    feature: D.k, cut: +D.t.toFixed(2), balancedAccuracy: +D.score.toFixed(4),
    mownSamples: MOWN.length, canopySamples: CANOPY.length,
    mownKept: +selfMown.toFixed(4), canopyRefused: +selfCanopy.toFixed(4),
    /* never entered the fit: the traced fairway rings, scored by the cut */
    heldBackFairwaySamples: FAIRWAY.length, heldBackFairwayMown: +fairwayMown.toFixed(4),
    alternatives: cands.map(c => ({ feature: c.k, cut: +c.t.toFixed(2), balanced: +c.score.toFixed(4) })),
    mownMedian: { exg: +med(MOWN, 'exg').toFixed(1), nir: +med(MOWN, 'nir').toFixed(1), lum: +med(MOWN, 'lum').toFixed(1) },
    canopyMedian: { exg: +med(CANOPY, 'exg').toFixed(1), nir: +med(CANOPY, 'nir').toFixed(1), lum: +med(CANOPY, 'lum').toFixed(1) },
  },
  mownHectares: +ha(mown), unknownHectares: +ha(unknown),
  enc: 'deflate-raw+b64',
  b64: zlib.deflateRawSync(Buffer.from(packNibbles(cells)), { level: 9 }).toString('base64'),
};
const file = path.join(DIR, 'mown-surface.json');
fs.writeFileSync(file, JSON.stringify(out));
console.log(`wrote nvgkbuild/mown-surface.json: ${(fs.statSync(file).size / 1024).toFixed(0)} kB`);
