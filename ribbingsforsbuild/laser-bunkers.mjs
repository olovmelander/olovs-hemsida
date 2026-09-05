#!/usr/bin/env node
/* Sand over a dish: the measured bunkers checked against the 1 m laser.

   detect-sand.mjs found the bunkers as sand in the z18 imagery; this asks the
   laser terrain whether each one is also a hollow, the rule that reproduced
   all 32 surveyed bunkers at Veckefjärden and then found its unmapped ones.
   Three measurements per bunker, none of which entered its placement:

   - DISH: the median height of a 1.5–5 m band outside the ring minus the
     median inside it. A raked bunker with a lip reads 0.15–0.6 m; flat grass
     reads about zero.
   - SHIFT: the offset (±6 m, 1 m steps) at which the same ring reads its
     deepest dish. Sand and dish are one object, so the shift is the
     imagery's residual against the laser — the number the bunker positions
     inherit. Its median over all bunkers is the registration of the leaf-off
     capture against this ground.
   - TOP-HAT: the deepest cell of the black top-hat (13 m closing) inside the
     ring, the same instrument the ditch tracer uses.

   Then the other direction: the guide bunkers that resolved to NO sand are
   placed by the guide formula on the traced routes and tested for a dish
   within ±12 m, and every dish on the played ground that no bunker claims is
   listed with the imagery's colour over it — a hollow under grass is
   recorded, never adopted as sand.

     node ribbingsforsbuild/laser-bunkers.mjs   -> laser-bunkers.json (+ laser fields in sat-shapes.json) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTerrain } from './laser-lib.mjs';
import { blackTopHat } from '../geobuild/dtm-lib.mjs';
import { polySD, polyLen, pointInPoly, distToLine, r1 } from '../geobuild/lib.mjs';
import { labelComponents } from './raster-shapes.mjs';
import { loadMosaic } from './imagery.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readJson = file => JSON.parse(fs.readFileSync(path.join(HERE, file), 'utf8'));
const model = readJson('course-model.json');
const shapes = readJson('sat-shapes.json');
const guide = readJson('guide-notes.json');
const T = loadTerrain();
const th = blackTopHat(T, 6);
const thAt = (x, z) => { const i = T.cellOf(x, z); return i < 0 ? 0 : th[i]; };
const median = a => { if (!a.length) return NaN; const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };
const r2 = v => Math.round(v * 100) / 100;

function ellipse(c, major, minor, angleDeg, count = 24) {
  const a = angleDeg * Math.PI / 180, ux = Math.cos(a), uz = Math.sin(a);
  return Array.from({ length: count }, (_, i) => { const t = i / count * Math.PI * 2;
    return [c[0] + ux * Math.cos(t) * major / 2 - uz * Math.sin(t) * minor / 2, c[1] + uz * Math.cos(t) * major / 2 + ux * Math.sin(t) * minor / 2]; });
}

/* dish of a ring: band median outside minus median inside, at a given offset */
function dishOf(ring, dx = 0, dz = 0) {
  const xs = ring.map(p => p[0] + dx), zs = ring.map(p => p[1] + dz);
  const x0 = Math.floor(Math.min(...xs)) - 6, x1 = Math.ceil(Math.max(...xs)) + 6, z0 = Math.floor(Math.min(...zs)) - 6, z1 = Math.ceil(Math.max(...zs)) + 6;
  const shifted = ring.map(p => [p[0] + dx, p[1] + dz]);
  const inside = [], band = [];
  let deepest = 0;
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const sd = polySD(x, z, shifted), h = T.hAt(x, z);
    if (!Number.isFinite(h)) continue;
    if (sd <= -0.5) { inside.push(h); deepest = Math.max(deepest, thAt(x, z)); } else if (sd >= 1.5 && sd <= 5) band.push(h);
  }
  if (inside.length < 4 || band.length < 8) return { dish: NaN, floor: NaN, topHat: NaN, cells: inside.length };
  const sortedIn = [...inside].sort((p, q) => p - q);
  return { dish: median(band) - median(inside), floor: median(band) - sortedIn[Math.floor(sortedIn.length * 0.1)], topHat: deepest, cells: inside.length };
}
/* the offset at which the ring reads its deepest dish; an optimum ON the
   search edge has not converged — it is climbing toward some other hollow */
function bestShift(ring, reach = 8) {
  let best = { dx: 0, dz: 0, dish: -Infinity };
  for (let dz = -reach; dz <= reach; dz++) for (let dx = -reach; dx <= reach; dx++) {
    const { dish } = dishOf(ring, dx, dz);
    if (dish > best.dish) best = { dx, dz, dish };
  }
  best.converged = Math.abs(best.dx) < reach && Math.abs(best.dz) < reach;
  return best;
}
/* tree cover: {0 unknown, 2 open, 3 trees}, two bits per cell */
const cover = readJson('tree-cover.json');
const coverBytes = Buffer.from(cover.b64, 'base64');
const treesAt = (x, z) => { const c = Math.floor((x - cover.x0) / cover.cell), r = Math.floor((z - cover.z0) / cover.cell); if (c < 0 || r < 0 || c >= cover.nx || r >= cover.nz) return false; const i = r * cover.nx + c; return ((coverBytes[i >> 2] >> ((i & 3) * 2)) & 3) === 3; };

/* --- the 18 measured bunkers ------------------------------------------------ */
const measured = [];
for (const b of shapes.bunkers) {
  const ring = ellipse(b.c, b.major, b.minor, b.angleDeg);
  const at = dishOf(ring), shift = bestShift(ring);
  /* the bunker IS its dish: re-centre the sand ring on the laser where the
     search converged and the dish is materially deeper there */
  const recentre = shift.converged && shift.dish - at.dish >= 0.05 && Math.hypot(shift.dx, shift.dz) > 0;
  b.laser = { dish: r2(at.dish), floor: r2(at.floor), topHat: r2(at.topHat), shift: [shift.dx, shift.dz], dishAtShift: r2(shift.dish), converged: shift.converged,
    verdict: at.dish >= 0.10 ? 'dish' : shift.dish >= 0.15 && shift.converged ? 'dish nearby' : 'no dish',
    c: recentre ? [r1(b.c[0] + shift.dx), r1(b.c[1] + shift.dz)] : b.c.slice(), recentred: recentre };
  measured.push({ hole: b.hole, cSand: b.c, ...b.laser });
}
console.log('measured bunkers against the laser (dish = band median − inside median, m):');
for (const m of measured) console.log(`  hole ${m.hole} (${m.cSand}): dish ${m.dish.toFixed(2)} floor ${m.floor.toFixed(2)} top-hat ${m.topHat.toFixed(2)}  best shift (${m.shift}) → ${m.dishAtShift.toFixed(2)}${m.converged ? '' : ' (edge)'}  ${m.verdict}${m.recentred ? ' → re-centred at (' + m.c + ')' : ''}`);
const shiftsX = measured.map(m => m.shift[0]), shiftsZ = measured.map(m => m.shift[1]);
const registration = { medianShift: [median(shiftsX), median(shiftsZ)], medianAbs: median(measured.map(m => Math.hypot(...m.shift))), within3m: measured.filter(m => Math.hypot(...m.shift) <= 3).length };
console.log(`registration of the imagery against the laser over ${measured.length} bunkers: median shift (${registration.medianShift}) m, median |shift| ${registration.medianAbs.toFixed(1)} m, ${registration.within3m} within 3 m; ${measured.filter(m => m.recentred).length} re-centred on their dish`);

/* --- the guide bunkers that resolved to no sand ---------------------------- */
const pointAt = (line, d) => { let acc = 0; for (let i = 0; i < line.length - 1; i++) { const s = Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]); if (acc + s >= d) { const t = (d - acc) / s; return { p: [line[i][0] + (line[i + 1][0] - line[i][0]) * t, line[i][1] + (line[i + 1][1] - line[i][1]) * t], u: [(line[i + 1][0] - line[i][0]) / s, (line[i + 1][1] - line[i][1]) / s] }; } acc += s; } const a = line[line.length - 2], b = line[line.length - 1], s = Math.hypot(b[0] - a[0], b[1] - a[1]); return { p: b, u: [(b[0] - a[0]) / s, (b[1] - a[1]) / s] }; };
const guideTests = [];
for (const hole of model.holes) {
  const note = guide.holes.find(h => h.n === hole.n);
  for (const spec of note.bunkers) {
    const L = polyLen(hole.line);
    const { p, u } = pointAt(hole.line, L - spec.fromGreen);
    const right = [-u[1], u[0]], half = hole.par === 3 ? 12 : 20;
    const c = [p[0] + right[0] * spec.side * half, p[1] + right[1] * spec.side * half];
    const nearestMeasured = Math.min(...shapes.bunkers.filter(b => b.hole === hole.n).map(b => Math.hypot(b.c[0] - c[0], b.c[1] - c[1])), Infinity);
    const angle = Math.atan2(u[1], u[0]) * 180 / Math.PI;
    const ring = ellipse(c, spec.size[0], spec.size[1], angle);
    const at = dishOf(ring), shift = bestShift(ring, 12);
    guideTests.push({ hole: hole.n, fromGreen: spec.fromGreen, side: spec.side, c: c.map(r1), nearestMeasuredBunker: r1(nearestMeasured),
      dish: r2(at.dish), bestShift: [shift.dx, shift.dz], dishAtShift: r2(shift.dish), converged: shift.converged,
      status: nearestMeasured <= 25 ? 'matches a measured bunker' : shift.dish >= 0.15 && shift.converged ? 'no sand, but a dish within reach' : 'no sand and no dish' });
  }
}
console.log('guide-formula bunkers on the traced routes:');
for (const g of guideTests) console.log(`  hole ${g.hole} fromGreen ${g.fromGreen} side ${g.side > 0 ? 'R' : 'L'} at (${g.c}): nearest measured ${g.nearestMeasuredBunker} m, dish ${g.dish.toFixed(2)}, best within 12 m (${g.bestShift}) ${g.dishAtShift.toFixed(2)}${g.converged ? '' : ' (edge)'} — ${g.status}`);

/* --- dishes nobody claims -------------------------------------------------- */
const mosaic = await loadMosaic({ x0: -380, x1: 760, z0: -500, z1: 440 }, { zoom: 18, name: 'course' });
const played = [];
for (const hole of model.holes) played.push(hole.line, [hole.green.c]);
const nearPlay = (x, z) => !treesAt(x, z) && model.holes.some(h => distToLine(x, z, h.line) <= 45 || Math.hypot(x - h.green.c[0], z - h.green.c[1]) <= 45);
const waterRings = model.water.map(w => w.ring);
const infraLines = [...model.infra.roads, ...model.infra.tracks, ...model.infra.paths].map(f => f.line);
const streamLines = model.streams.map(s => s.line);
const { W, H } = T;
const mask = new Uint8Array(W * H);
for (let i = 0; i < mask.length; i++) if (th[i] >= 0.30) mask[i] = 1;
const { label, sizes } = labelComponents(mask, W, H);
const comps = new Map();
for (let i = 0; i < label.length; i++) { const id = label[i]; if (!id || sizes[id] < 12 || sizes[id] > 250) continue; const [x, z] = T.worldOf(i); let c = comps.get(id); if (!c) { c = { sx: 0, sz: 0, n: 0, deepest: 0 }; comps.set(id, c); } c.sx += x; c.sz += z; c.n++; c.deepest = Math.max(c.deepest, th[i]); }
const unclaimed = [];
for (const c of comps.values()) {
  const x = c.sx / c.n, z = c.sz / c.n;
  if (!nearPlay(x, z)) continue;
  if (waterRings.some(r => polySD(x, z, r) < 4)) continue;
  if (streamLines.some(l => distToLine(x, z, l) < 4)) continue;
  if (infraLines.some(l => distToLine(x, z, l) < 8)) continue;
  const nearestBunker = Math.min(...shapes.bunkers.map(b => Math.hypot(b.c[0] - x, b.c[1] - z)));
  if (nearestBunker < 10) continue;
  const holes = model.holes.filter(h => distToLine(x, z, h.line) <= 45 || Math.hypot(x - h.green.c[0], z - h.green.c[1]) <= 45).map(h => h.n);
  /* the imagery's colour over the dish: the sand rule of detect-sand.mjs */
  let rgb = [0, 0, 0], n = 0;
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) { const p = mosaic.rgbAt(x + dx, z + dz); if (p) { rgb = rgb.map((v, k) => v + p[k]); n++; } }
  rgb = n ? rgb.map(v => Math.round(v / n)) : null;
  const sand = rgb && Math.min(...rgb) >= 132 && Math.max(...rgb) - Math.min(...rgb) <= 75 && rgb[0] - rgb[2] >= 30 && rgb[1] - rgb[0] <= -6;
  unclaimed.push({ c: [r1(x), r1(z)], area: c.n, depth: r2(c.deepest), holes, rgb, sand: !!sand });
}
unclaimed.sort((p, q) => q.depth - p.depth);
console.log(`${unclaimed.length} hollows >= 0.30 m deep on open played ground that no bunker, water, ditch or road claims:`);
for (const u of unclaimed) console.log(`  (${u.c}) ${u.area} m² ${u.depth.toFixed(2)} m holes ${u.holes} imagery ${u.rgb} ${u.sand ? 'SAND-COLOURED' : ''}`);

const out = {
  schemaVersion: 1,
  source: 'Lantmäteriet Markhöjdmodell 1 m (the published v2 tiles) against the measured bunkers of sat-shapes.json; laser-bunkers.mjs',
  method: {
    dish: 'median height of the 1.5–5 m band outside the ring minus the median inside it (cells >= 0.5 m inside); floor = band median minus the inside 10th percentile',
    shift: 'the offset in [-8, 8] m at which the ring reads its deepest dish — the imagery residual against the laser; a bunker is re-centred on it where the search converged inside the box and the dish gains >= 0.05 m',
    topHat: 'deepest black top-hat (13 m square closing) cell inside the ring',
    guide: 'guide bunkers placed by the guide formula on the traced routes (par-3 half-width 12 m, else 20 m) and tested for a dish within ±12 m',
    unclaimed: 'top-hat components >= 0.30 m deep, 12–250 m², on open ground (tree-cover raster) within 45 m of a hole line or green, clear of water (4 m), ditches (4 m), roads/tracks/paths (8 m) and measured bunkers (10 m); the z18 colour over each is classified by detect-sand\'s rule',
  },
  measured, registration, guideTests, unclaimed,
};
fs.writeFileSync(path.join(HERE, 'laser-bunkers.json'), JSON.stringify(out, null, 1) + '\n');
shapes.laserCheck = { file: 'laser-bunkers.json', dished: measured.filter(m => m.verdict !== 'no dish').length, of: measured.length, registration };
fs.writeFileSync(path.join(HERE, 'sat-shapes.json'), JSON.stringify(shapes, null, 2) + '\n');
console.log(`wrote laser-bunkers.json; ${shapes.laserCheck.dished}/${measured.length} measured bunkers stand over a laser dish`);
