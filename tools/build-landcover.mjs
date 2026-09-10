#!/usr/bin/env node
/* The land beyond the course, read off Lantmäteriet's orthophoto.

   WHY. The far ground was coloured by a RULE: forest floor everywhere, rock on
   the steep, a crop tone inside whichever OSM landuse rings the extract carried.
   Outside the 1.2-1.5 km tree-cover raster nothing measured said what the land
   was, so a kilometre out every hillside read as one brown floor -- fields,
   pasture, clear-fells, towns and closed forest alike -- and the far cones stood
   on all of it. This tool replaces the rule with a record: the national 0.5 m
   orthophoto, served at 4 m/px through the Min karta WMS the Visby build already
   uses, classified per 12 m cell out to +-6.4 km (the far tint's 6,144 m and
   Veckefjärden's 6 km far ring both fit inside).

   The classes are what the ground IS, never what colour it was on the day:
     0 unknown      (outside the imagery, or a service gap)
     1 water        (also injected from the model's own water rings)
     2 open green   (pasture, meadow, lawn, mown turf, green crop)
     3 trees        (closed canopy; the far ring plants cones here and nowhere else)
     4 open pale    (ripe or harvested crop, hay, bare soil, sand)
     5 light trees  (deciduous or mixed canopy: brighter, still textured)
     6 hard         (built-up, roads, rock, gravel)
   The palette and the season decide the colour at run time (main.js), which is
   why the imagery is a CLASSIFICATION SOURCE and never a runtime texture --
   the same policy the ortho-crop tools state, and the same reason the fields do
   not have to be the brown of a March flight.

   CALIBRATION. The trees-versus-open cut is not a constant: exposure and season
   differ per block. Where the build has a tree-cover raster (the 3 m satellite
   classification the planter obeys) its cells label the orthophoto inside the
   raster's box, and a grid search picks the excess-green / texture thresholds
   that reproduce it best; where it has none (Visby, Tortuna) the model's own
   OSM forest rings and mown fairways stand in as the labels. The agreement is
   PRINTED and gated -- a capture the rule cannot reproduce on ground somebody
   else classified is refused, not shipped.

   usage: node tools/build-landcover.mjs <build> [--half 6400] [--cell 12]
                                         [--px 4] [--no-fetch] [--min-agree 0.8]
   writes <build>/landcover.json and <build>/cache/landcover-review.png
   (the orthophoto beside the classes, for the eyeball this needs).          */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { decodePNG, encodePNG } from '../geobuild/png.mjs';
import { latLonToSweref99Tm } from '../packages/course-geo/chmv2/projection.mjs';
import { LANDCOVER, packNibbles, isTreeClass as isTree } from '../apps/golf/src/engine/landcover.mjs';
import { readChunk } from '../packages/course-v2/chunk-node.mjs';
import { decodeStandField, STAND_FLAG_MEASURED, STAND_FLAG_EXCLUDED } from '../packages/course-v2/stand-field.mjs';

/* the record's own encoding: nibbles, raw deflate, base64 -- the pack codec's inflate reads it back */
const encodeLandcover = cells => ({ bits: 4, enc: 'deflate-raw+b64', b64: zlib.deflateRawSync(Buffer.from(packNibbles(cells)), { level: 9 }).toString('base64') });

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const build = argv.find(a => !a.startsWith('--'));
if (!build) { console.error('usage: node tools/build-landcover.mjs <build> [--half 6400] [--cell 12] [--px 4]'); process.exit(2); }
const num = (flag, d) => { const i = argv.indexOf('--' + flag); return i >= 0 ? +argv[i + 1] : d; };
const HALF = num('half', 6400), CELL = num('cell', 12), PX = num('px', 4);
const MIN_AGREE = num('min-agree', 0.75);
const NO_FETCH = argv.includes('--no-fetch');
const DIR = path.join(ROOT, build);
const model = JSON.parse(fs.readFileSync(path.join(DIR, 'course-model.json'), 'utf8'));
const CACHE = path.join(DIR, 'cache', 'landcover');
fs.mkdirSync(CACHE, { recursive: true });

/* ---- the frame: local metres -> EPSG:3006, exact per point --------------- */
const gridOrigin = /origin E([\d.]+) N([\d.]+)/.exec(model.frame || '');
const toGrid = gridOrigin
  ? (x, z) => [+gridOrigin[1] + x, +gridOrigin[2] - z]
  : (x, z) => latLonToSweref99Tm(model.origin.lat - z / model.mPerLat, model.origin.lon + x / model.mPerLon);
console.log(`${build}: ${gridOrigin ? 'grid-authored frame' : 'flat-earth frame'} at ${model.origin.lat.toFixed(5)} N ${model.origin.lon.toFixed(5)} E`);

/* the 3006 bounding box of the (slightly rotated) local square, on the px lattice */
const corners = [[-HALF, -HALF], [HALF, -HALF], [HALF, HALF], [-HALF, HALF]].map(([x, z]) => toGrid(x, z));
const pad = 2 * PX;
const minE = Math.floor((Math.min(...corners.map(c => c[0])) - pad) / PX) * PX;
const maxE = Math.ceil((Math.max(...corners.map(c => c[0])) + pad) / PX) * PX;
const minN = Math.floor((Math.min(...corners.map(c => c[1])) - pad) / PX) * PX;
const maxN = Math.ceil((Math.max(...corners.map(c => c[1])) + pad) / PX) * PX;
const W = Math.round((maxE - minE) / PX), H = Math.round((maxN - minN) / PX);
console.log(`orthophoto window E ${minE}-${maxE} N ${minN}-${maxN}: ${W} x ${H} px at ${PX} m`);

/* ---- the imagery: Ortofoto_0.5 through the Min karta WMS, in <= 2048 px pieces.
   WMS 1.1.1 with SRS= and easting first (1.3.0 wants northing first and answers
   pure white otherwise -- measured on the Visby build). PNG, so Node decodes it
   with the repo's own reader and no browser is needed. ------------------------ */
const MAXPX = 2048;
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36' };
async function piece(c0, r0, cols, rows) {
  const e0 = minE + c0 * PX, e1 = e0 + cols * PX, n1 = maxN - r0 * PX, n0 = n1 - rows * PX;
  const file = path.join(CACHE, `lm05_${PX}m_${e0}_${n0}_${cols}x${rows}.png`);
  if (!fs.existsSync(file)) {
    if (NO_FETCH) throw new Error(`--no-fetch and ${path.basename(file)} is not cached`);
    const url = `https://minkarta.lantmateriet.se/map/ortofoto?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=Ortofoto_0.5&STYLES=&SRS=EPSG:3006&BBOX=${e0},${n0},${e1},${n1}&WIDTH=${cols}&HEIGHT=${rows}&FORMAT=image/png`;
    const t = Date.now();
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) throw new Error(`WMS ${r.status} for ${cols}x${rows} at ${e0},${n0}`);
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length < 4096 || bytes[0] !== 0x89) throw new Error(`WMS answered ${bytes.length} bytes, not a PNG: ${bytes.toString('utf8', 0, 200)}`);
    fs.writeFileSync(file, bytes);
    console.log(`  fetched ${cols}x${rows} at E${e0} N${n0}: ${(bytes.length / 1e6).toFixed(1)} MB in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  }
  const png = decodePNG(fs.readFileSync(file));
  if (png.width !== cols || png.height !== rows) throw new Error(`${file} is ${png.width}x${png.height}, asked ${cols}x${rows}`);
  return { c0, r0, cols, rows, png };
}
const RGB = new Uint8Array(W * H * 3);
const nCols = Math.ceil(W / MAXPX), nRows = Math.ceil(H / MAXPX);
for (let pr = 0; pr < nRows; pr++) for (let pc = 0; pc < nCols; pc++) {
  const c0 = Math.floor(pc * W / nCols), c1 = Math.floor((pc + 1) * W / nCols);
  const r0 = Math.floor(pr * H / nRows), r1 = Math.floor((pr + 1) * H / nRows);
  const p = await piece(c0, r0, c1 - c0, r1 - r0);
  const ch = p.png.channels;
  for (let y = 0; y < p.rows; y++) for (let x = 0; x < p.cols; x++) {
    const s = (y * p.cols + x) * ch, d = ((r0 + y) * W + (c0 + x)) * 3;
    RGB[d] = p.png.data[s]; RGB[d + 1] = p.png.data[s + 1]; RGB[d + 2] = p.png.data[s + 2];
  }
}
/* a pixel the service had no imagery for is pure white or pure black */
const pxAt = (e, n) => {
  const i = Math.floor((e - minE) / PX), j = Math.floor((maxN - n) / PX);
  if (i < 0 || j < 0 || i >= W || j >= H) return null;
  const o = (j * W + i) * 3;
  return [RGB[o], RGB[o + 1], RGB[o + 2]];
};

/* ---- per-cell features: 4 x 4 samples inside each 12 m cell ---------------- */
const N = Math.round(2 * HALF / CELL);
const X0 = -HALF, Z0 = -HALF;
const SUB = 4;
const feat = { y: new Float32Array(N * N), exg: new Float32Array(N * N), br: new Float32Array(N * N),
  sat: new Float32Array(N * N), tex: new Float32Array(N * N), ok: new Uint8Array(N * N) };
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const k = j * N + i;
  let sy = 0, sy2 = 0, sr = 0, sg = 0, sb = 0, n = 0;
  for (let b = 0; b < SUB; b++) for (let a = 0; a < SUB; a++) {
    const x = X0 + (i + (a + 0.5) / SUB) * CELL, z = Z0 + (j + (b + 0.5) / SUB) * CELL;
    const [e, nn] = toGrid(x, z);
    const p = pxAt(e, nn);
    if (!p) continue;
    const [r, g, bl] = p;
    if ((r > 250 && g > 250 && bl > 250) || (r + g + bl === 0)) continue;
    const y = 0.299 * r + 0.587 * g + 0.114 * bl;
    sy += y; sy2 += y * y; sr += r; sg += g; sb += bl; n++;
  }
  if (n < SUB * SUB / 2) continue;
  const r = sr / n, g = sg / n, bl = sb / n, y = sy / n;
  feat.ok[k] = 1; feat.y[k] = y; feat.exg[k] = 2 * g - r - bl; feat.br[k] = bl - r;
  feat.sat[k] = Math.max(r, g, bl) - Math.min(r, g, bl);
  feat.tex[k] = Math.sqrt(Math.max(0, sy2 / n - y * y));
}

/* ---- labels: what somebody else already classified ------------------------- */
const ringSD = (x, z, ring) => { /* inside test only: even-odd */
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const bboxOf = ring => ring.reduce((b, [x, z]) => ({ x0: Math.min(b.x0, x), x1: Math.max(b.x1, x), z0: Math.min(b.z0, z), z1: Math.max(b.z1, z) }),
  { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
const withBB = rings => rings.filter(r => r && r.length > 2).map(ring => ({ ring, bb: bboxOf(ring) }));
const inAny = (x, z, list) => list.some(q => x >= q.bb.x0 && x <= q.bb.x1 && z >= q.bb.z0 && z <= q.bb.z1 && ringSD(x, z, q.ring));
const cellCentre = k => [X0 + ((k % N) + 0.5) * CELL, Z0 + (Math.floor(k / N) + 0.5) * CELL];

const label = new Uint8Array(N * N);   /* 0 none, 2 open, 3 trees, 1 water */
function standFieldLabels() {
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/golf/public/courses/index.json'), 'utf8'));
  const slug = index.courses.find(c => c.build === build)?.slug;
  if (!slug) return null;
  const v2 = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/golf/public/courses/v2-index.json'), 'utf8'));
  const entry = v2.courses.find(c => c.slug === slug);
  if (!entry?.manifest?.url) return null;
  const course = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/golf/public', entry.manifest.url), 'utf8'));
  const ground = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/golf/public', course.groundManifest.url), 'utf8'));
  const oE = ground.frame?.origin?.easting ?? ground.frame?.originEasting, oN = ground.frame?.origin?.northing ?? ground.frame?.originNorthing;
  if (!Number.isFinite(oE) || !Number.isFinite(oN)) throw new Error(`${build}: the ground manifest's frame origin is not readable`);
  if (Math.abs(oE - +gridOrigin[1]) > 1e-6 || Math.abs(oN - +gridOrigin[2]) > 1e-6)
    throw new Error(`${build}: ground origin E${oE} N${oN} is not the model's E${gridOrigin[1]} N${gridOrigin[2]}`);
  const tiles = ground.tiles.filter(t => t.layers?.stands);
  if (!tiles.length) return null;
  let closed = 0, open = 0;
  for (const tile of tiles) {
    const chunk = readChunk(fs.readFileSync(path.join(ROOT, 'apps/golf/public', tile.layers.stands.url)));
    const field = decodeStandField(chunk.payload, chunk.header.standField);
    const b = tile.bounds, cm = field.cellMetres;
    for (let r = 0; r < field.height; r++) for (let c = 0; c < field.width; c++) {
      const i = r * field.width + c, fl = field.flags[i];
      if (!(fl & STAND_FLAG_MEASURED) || (fl & STAND_FLAG_EXCLUDED)) continue;
      const x = b.minEasting - oE + (c + 0.5) * cm, z = oN - (b.maxNorthing - (r + 0.5) * cm);
      const k = Math.floor((z - Z0) / CELL) * N + Math.floor((x - X0) / CELL);
      if (k < 0 || k >= N * N) continue;
      /* every 4 m cell under a 12 m cell must agree, so a cell straddling an
         edge labels nothing: a first closed cell votes, a later open one vetoes */
      const f = field.fraction[i];
      if (f >= 0.6) { if (label[k] === 0) label[k] = 3; else if (label[k] === 2) label[k] = 255; }
      else if (f <= 0.05) { if (label[k] === 0) label[k] = 2; else if (label[k] === 3) label[k] = 255; }
      else label[k] = 255;
    }
  }
  for (let k = 0; k < N * N; k++) { if (label[k] === 255) label[k] = 0; else if (label[k] === 3) closed++; else if (label[k] === 2) open++; }
  console.log(`  stand fields: ${tiles.length} tiles, ${closed} closed-canopy and ${open} open 12 m cells`);
  return `published LiDAR stand fields (${ground.groundId}, ${tiles.length} tiles)`;
}
let cover = null;
try { cover = JSON.parse(fs.readFileSync(path.join(DIR, 'tree-cover.json'), 'utf8')); } catch {}
let labelSource;
if (cover) {
  const bytes = Buffer.from(cover.b64, 'base64');
  const at = (x, z) => {
    const i = Math.floor((x - cover.x0) / cover.cell), j = Math.floor((z - cover.z0) / cover.cell);
    if (i < 0 || j < 0 || i >= cover.nx || j >= cover.nz) return 0;
    const kk = j * cover.nx + i;
    return (bytes[kk >> 2] >> ((kk & 3) * 2)) & 3;
  };
  /* a 12 m cell takes the raster's verdict only when its 3 m cells agree */
  const m = Math.max(1, Math.round(CELL / cover.cell));
  for (let k = 0; k < N * N; k++) {
    const [cx, cz] = cellCentre(k);
    if (cx < cover.x0 + 60 || cz < cover.z0 + 60 || cx > cover.x0 + cover.nx * cover.cell - 60 || cz > cover.z0 + cover.nz * cover.cell - 60) continue;
    let t = 0, o = 0;
    for (let b = 0; b < m; b++) for (let a = 0; a < m; a++) {
      const v = at(cx - CELL / 2 + (a + 0.5) * cover.cell, cz - CELL / 2 + (b + 0.5) * cover.cell);
      if (v === 3) t++; else if (v === 2) o++;
    }
    if (t >= m * m * 0.9) label[k] = 3; else if (o >= m * m * 0.9) label[k] = 2;
  }
  labelSource = `tree-cover.json (${cover.source?.slice(0, 40) ?? 'raster'})`;
} else if (gridOrigin && (labelSource = standFieldLabels())) {
  /* the published LiDAR generation: canopy fraction per 4 m cell, on a
     grid-authored ground where a tile's EPSG:3006 bounds are local metres
     by subtraction (a flat-earth ground would need the bridge, and has a
     tree-cover raster anyway) */
} else {
  const forest = withBB([...(model.vegetation?.forest || []), ...(model.vegetation?.wood || [])].map(v => v.ring));
  const mown = withBB([...model.holes.flatMap(h => [h.green?.ring, ...((h.fairway?.rings) || [])]), ...((model.scenery?.fairways) || [])]);
  for (let k = 0; k < N * N; k++) {
    const [cx, cz] = cellCentre(k);
    if (inAny(cx, cz, forest)) label[k] = 3; else if (inAny(cx, cz, mown)) label[k] = 2;
  }
  labelSource = 'OSM forest rings vs the model\'s mown rings';
}
const waterRings = withBB(model.water.filter(w => !w.stream && w.ring).map(w => w.ring));
for (let k = 0; k < N * N; k++) {
  const [cx, cz] = cellCentre(k);
  if (inAny(cx, cz, waterRings)) label[k] = 1;
}

/* ---- the classifier: a linear discriminant the labels fit --------------------
   A fixed cut cannot survive a change of capture: Veckefjärden's summer flight
   reads closed spruce as DARK BLUE-GREEN (Y 62, blue over red by 18) and open
   ground as bright green (Y 94), so any "trees are the textured green" rule
   called the forest water. What separates the three labelled classes is where
   they sit in (luminance, excess green, blue-red, saturation, texture), and
   Fisher's discriminant on the labels finds that per course. The remaining
   classes are read RELATIVE to the fitted open class: paler and less green
   than open is dry ground, grey and bright is hard ground, a tree cell
   brighter than the midpoint between the tree and open medians is light
   (deciduous) canopy. */
const F = ['y', 'exg', 'br', 'sat', 'tex'], D = F.length;
const fvec = k => F.map(f => feat[f][k]);
const LABELLED = { 1: [], 2: [], 3: [] };
for (let k = 0; k < N * N; k++) if (feat.ok[k] && LABELLED[label[k]]) LABELLED[label[k]].push(k);
const classesFit = Object.keys(LABELLED).map(Number).filter(c => LABELLED[c].length >= 50);
if (!classesFit.includes(2) || !classesFit.includes(3)) throw new Error(`${build}: need labelled trees AND open cells to fit (have ${JSON.stringify(Object.fromEntries(classesFit.map(c => [c, LABELLED[c].length])))})`);
const mean = idx => { const m = new Float64Array(D); for (const k of idx) fvec(k).forEach((v, i) => m[i] += v); return m.map(v => v / idx.length); };
const MU = Object.fromEntries(classesFit.map(c => [c, mean(LABELLED[c])]));
const median = (idx, f) => { const a = Float32Array.from(idx.map(k => feat[f][k])).sort(); return a[a.length >> 1]; };
const S = Array.from({ length: D }, () => new Float64Array(D));
let nS = 0;
for (const c of classesFit) for (const k of LABELLED[c]) {
  const v = fvec(k).map((x, i) => x - MU[c][i]);
  for (let i = 0; i < D; i++) for (let j = 0; j < D; j++) S[i][j] += v[i] * v[j];
  nS++;
}
for (let i = 0; i < D; i++) { for (let j = 0; j < D; j++) S[i][j] /= nS; S[i][i] += 1e-3; }
const invert = M => {   /* Gauss-Jordan on a small symmetric positive matrix */
  const n = M.length, A = M.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0)]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c]; if (Math.abs(d) < 1e-12) throw new Error('singular feature covariance');
    for (let j = 0; j < 2 * n; j++) A[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c]; for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[c][j]; }
  }
  return A.map(r => r.slice(n));
};
const SI = invert(S);
const LDA = Object.fromEntries(classesFit.map(c => {
  const w = SI.map(row => row.reduce((s, v, j) => s + v * MU[c][j], 0));
  const b = -0.5 * w.reduce((s, v, i) => s + v * MU[c][i], 0);
  return [c, { w, b }];
}));
const score = (k, c) => LDA[c].w.reduce((s, v, i) => s + v * feat[F[i]][k], LDA[c].b);
const OPEN = { y: median(LABELLED[2], 'y'), exg: median(LABELLED[2], 'exg'), sat: median(LABELLED[2], 'sat'), tex: median(LABELLED[2], 'tex') };
const TREE = { y: median(LABELLED[3], 'y'), br: median(LABELLED[3], 'br'), tex: median(LABELLED[3], 'tex') };
const lightCut = (OPEN.y + TREE.y) / 2;
const WATER_TRUSTED = (LABELLED[1]?.length ?? 0) >= 2000;
/* Two things the discriminant alone got wrong on Tortuna's patchwork capture
   (a bare-spring frame beside a summer one): ploughed clay is dark and smooth
   and was called water, and smooth grey bare soil was called built ground.
   Water must also be at least as blue as the forest and darker than it; hard
   ground must be TEXTURED (roofs and roads under a 12 m cell) or it is a
   field between crops. */
function classifyCell(k) {
  if (!feat.ok[k]) return LANDCOVER.UNKNOWN;
  let bestC = 0, bestS = -Infinity;
  for (const c of classesFit) { const s = score(k, c); if (s > bestS) { bestS = s; bestC = c; } }
  const y = feat.y[k], exg = feat.exg[k], sat = feat.sat[k], tex = feat.tex[k], br = feat.br[k];
  if (bestC === 1) {
    /* a water class fitted on thousands of labelled cells is believed as it
       is (Mälaren is browner and brighter than Ängsö's spruce, and the strict
       rule below threw 98% of it away); one fitted on a few hundred pond
       cells is not, and must also be darker and bluer than the forest */
    if (tex < 6 && (WATER_TRUSTED || (y < TREE.y * 0.95 && br >= TREE.br - 3))) return LANDCOVER.WATER;
    return exg > OPEN.exg * 0.3 ? LANDCOVER.TREES : LANDCOVER.OPEN_PALE;   /* dark still ground that is not water: shade or bare soil */
  }
  if (bestC === 3) return y > lightCut && exg > OPEN.exg * 0.5 ? LANDCOVER.LIGHT_TREES : LANDCOVER.TREES;
  const grey = sat < OPEN.sat * 0.55 && y > OPEN.y * 0.9;
  if (grey) return tex > Math.max(OPEN.tex, TREE.tex * 0.8) ? LANDCOVER.HARD : LANDCOVER.OPEN_PALE;
  if (exg < OPEN.exg * 0.45 && y > OPEN.y * 0.85) return LANDCOVER.OPEN_PALE;
  return LANDCOVER.OPEN_GREEN;
}
/* how well the fit reproduces its own labels -- a linear model of five
   numbers cannot memorise ten thousand cells, so resubstitution is honest */
const agree = {};
for (const c of classesFit) {
  let hit = 0;
  for (const k of LABELLED[c]) {
    const got = classifyCell(k);
    const same = c === 1 ? got === LANDCOVER.WATER : c === 3 ? isTree(got) : (got === LANDCOVER.OPEN_GREEN || got === LANDCOVER.OPEN_PALE || got === LANDCOVER.HARD);
    if (same) hit++;
  }
  agree[c] = hit / LABELLED[c].length;
}
const best = { bal: (agree[2] + agree[3]) / 2, treeRecall: agree[3], openRecall: agree[2], waterRecall: agree[1] ?? null, tn: LABELLED[3].length, on: LABELLED[2].length, wn: LABELLED[1]?.length ?? 0 };
console.log(`fitted on ${labelSource}: trees ${(100 * best.treeRecall).toFixed(1)}% of ${best.tn}, open ${(100 * best.openRecall).toFixed(1)}% of ${best.on}` +
  (best.waterRecall !== null ? `, water ${(100 * best.waterRecall).toFixed(1)}% of ${best.wn}` : '') + `, balanced ${(100 * best.bal).toFixed(1)}%`);
const refused = best.bal < MIN_AGREE ? `${build}: the fit reproduces only ${(100 * best.bal).toFixed(1)}% of the labelled cells (floor ${100 * MIN_AGREE}%) -- look at the review image before shipping this` : null;

const cls = new Uint8Array(N * N);
for (let k = 0; k < N * N; k++) cls[k] = classifyCell(k);
/* the model's own water is water whatever the picture says (the picture may be
   reeds, algae or a sun glint) */
for (let k = 0; k < N * N; k++) if (label[k] === 1 && cls[k] !== LANDCOVER.UNKNOWN) cls[k] = LANDCOVER.WATER;
/* a 3 x 3 majority pass takes the speckle out of a class map without moving an
   edge: a cell changes only when at least five of its nine neighbours agree */
const smoothed = new Uint8Array(cls);
for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
  const k = j * N + i;
  const count = new Uint8Array(8);
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) count[cls[k + dj * N + di]]++;
  let bestC = cls[k], bestN = 0;
  for (let c = 0; c < 8; c++) if (count[c] > bestN) { bestN = count[c]; bestC = c; }
  if (bestN >= 5 && bestC !== LANDCOVER.UNKNOWN) smoothed[k] = bestC;
}

/* ---- the record --------------------------------------------------------- */
const counts = new Uint32Array(8);
for (let k = 0; k < N * N; k++) counts[smoothed[k]]++;
const share = c => (100 * counts[c] / (N * N)).toFixed(1) + '%';
console.log(`classes over ${N} x ${N} cells at ${CELL} m: unknown ${share(0)} water ${share(1)} open-green ${share(2)} trees ${share(3)} open-pale ${share(4)} light-trees ${share(5)} hard ${share(6)}`);
const out = {
  cell: CELL, x0: X0, z0: Z0, nx: N, nz: N,
  legend: { 0: 'unknown', 1: 'water', 2: 'open-green', 3: 'trees', 4: 'open-pale', 5: 'light-trees', 6: 'hard' },
  source: `Lantmäteriet Ortofoto_0.5 via minkarta.lantmateriet.se WMS at ${PX} m/px, classified per ${CELL} m cell; fetched ${new Date().toISOString().slice(0, 10)}`,
  calibration: { labels: labelSource, method: 'Fisher LDA on (Y, excess green, B-R, saturation, texture)',
    treeRecall: +best.treeRecall.toFixed(4), openRecall: +best.openRecall.toFixed(4), waterRecall: best.waterRecall === null ? null : +best.waterRecall.toFixed(4),
    balanced: +best.bal.toFixed(4), labelledTrees: best.tn, labelledOpen: best.on, labelledWater: best.wn,
    means: Object.fromEntries(Object.entries(MU).map(([c, m]) => [c, Object.fromEntries(F.map((f, i) => [f, +m[i].toFixed(2)]))])) },
  shares: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(c => [c, +(counts[c] / (N * N)).toFixed(4)])),
  ...encodeLandcover(smoothed),
};
const outPath = path.join(DIR, 'landcover.json');
if (!refused) {
  fs.writeFileSync(outPath, JSON.stringify(out) + '\n');
  console.log(`wrote ${path.relative(ROOT, outPath)}: ${(fs.statSync(outPath).size / 1024).toFixed(0)} kB (deflated ${(out.b64.length * 3 / 4 / 1024).toFixed(0)} kB for ${N * N} cells)`);
}

/* ---- the review image: the orthophoto beside its classes ------------------ */
const COL = { 0: [40, 40, 40], 1: [30, 60, 110], 2: [120, 190, 90], 3: [30, 90, 40], 4: [215, 190, 110], 5: [90, 150, 60], 6: [150, 145, 140] };
const RW = N * 2 + 8, RH = N;
const img = new Uint8Array(RW * RH * 3);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const [cx, cz] = cellCentre(j * N + i);
  const [e, nn] = toGrid(cx, cz);
  const p = pxAt(e, nn) || [0, 0, 0];
  const o = (j * RW + i) * 3;
  img[o] = p[0]; img[o + 1] = p[1]; img[o + 2] = p[2];
  const c = COL[smoothed[j * N + i]];
  const o2 = (j * RW + N + 8 + i) * 3;
  img[o2] = c[0]; img[o2 + 1] = c[1]; img[o2 + 2] = c[2];
}
/* the labelled box, drawn on both halves */
if (cover) {
  const bx0 = Math.round((cover.x0 - X0) / CELL), bx1 = Math.round((cover.x0 + cover.nx * cover.cell - X0) / CELL);
  const bz0 = Math.round((cover.z0 - Z0) / CELL), bz1 = Math.round((cover.z0 + cover.nz * cover.cell - Z0) / CELL);
  const dot = (i, j) => { for (const off of [0, N + 8]) { if (i >= 0 && i < N && j >= 0 && j < N) { const o = (j * RW + off + i) * 3; img[o] = 255; img[o + 1] = 40; img[o + 2] = 40; } } };
  for (let i = bx0; i <= bx1; i++) { dot(i, bz0); dot(i, bz1); }
  for (let j = bz0; j <= bz1; j++) { dot(bx0, j); dot(bx1, j); }
}
const review = path.join(DIR, 'cache', 'landcover-review.png');
fs.writeFileSync(review, encodePNG(RW, RH, img));
console.log(`review: ${path.relative(ROOT, review)}`);
if (refused) { console.error(refused); process.exit(1); }
