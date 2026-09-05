#!/usr/bin/env node
/* The practice ground, measured off the z18 orthoimagery and the 1 m laser.

   The club's own overview (cache/banguide-overview.jpg) labels two things
   here: DRIVING RANGE and ÖVNINGSOMRÅDE, both beside the 1st and 9th near the
   clubhouse. The model carried an eye-traced range ring (±8 m by its own
   statement) and TWO SYNTHETIC CIRCLES for the practice greens. Measured:

   THE RANGE FIELD is the one unmistakable thing in the capture. A driving
   range is not mown to fairway height, so in the 2023-04-28 leaf-off image it
   stands out as dormant ground: excess green 15–17 and brightness 121 inside
   it against 53–109 and 89–103 for every turf around it — a wider separation
   than any other surface pair on this course. The field is therefore
   classified per pixel (the tree-cover rule's shape: colour AND smoothness),
   the largest component taken, its holes filled and its outline traced. No
   registration step exists: a tile's coordinates ARE its georeference.

   THE PRACTICE GREENS are the harder half and the honest answer may be that
   the capture cannot place them. Each candidate is asked for two things a
   built putting green has and a patch of pasture does not: an interior
   materially greener than its own 3–8 m collar, and laser-flatness (the
   5 × 5 m spread the tee-deck rule uses). Everything is reported; nothing is
   adopted that fails both.

     node ribbingsforsbuild/trace-practice.mjs   -> practice-traces.json
                                                 + cache/review/practice-*.png */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMosaic, excessGreen, brightness } from './imagery.mjs';
import { loadTerrain, spreadAt, planeResidualAt } from './laser-lib.mjs';
import { gridOver, labelComponents, open, close, fillHoles, outerRing, simplifyRing, polygonArea, centroid } from './raster-shapes.mjs';
import { readGreen } from './green-grower.mjs';
import { pointInPoly, distToLine, r1 } from '../geobuild/lib.mjs';
import { encodePNG } from '../geobuild/png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readJson = f => JSON.parse(fs.readFileSync(path.join(HERE, f), 'utf8'));
const model = readJson('course-model.json');
const traces = readJson('surroundings-traces.json');
const WINDOW = { x0: -380, x1: 760, z0: -500, z1: 440 };
const IMG = await loadMosaic(WINDOW, { zoom: 18, name: 'course' });
const T = loadTerrain();
const S = 1;                                   /* raster spacing, metres */
/* measured 2026-09-05 in probe boxes: dormant range 15–17 / 121, every turf
   beside it 53–109 / 89–103 */
const DORMANT = { exgMax: 40, brightMin: 105 };
const FIELD = { box: { x0: 330, x1: 560, z0: -420, z1: -150 }, minArea: 2000 };

/* ---------------------------------------------------------------- the field */
const G = gridOver(FIELD.box, S, 0);
const mask = new Uint8Array(G.width * G.height);
for (let i = 0; i < mask.length; i++) {
  const p = IMG.rgbAt(...G.centre(i));
  if (p && excessGreen(p) <= DORMANT.exgMax && brightness(p) >= DORMANT.brightMin) mask[i] = 1;
}
const cleaned = close(open(mask, G.width, G.height, 1), G.width, G.height, 2);
const { label, sizes } = labelComponents(cleaned, G.width, G.height);
let bestId = 0;
for (let id = 1; id < sizes.length; id++) if (sizes[id] > sizes[bestId] || !bestId) bestId = id;
const member = new Uint8Array(mask.length);
for (let i = 0; i < member.length; i++) member[i] = label[i] === bestId ? 1 : 0;
const filled = fillHoles(member, G.width, G.height);
const ring0 = outerRing(i => filled[i], G);
if (!ring0) throw new Error('no dormant component found where the range should be');
const fieldRing = simplifyRing(ring0, () => 2).map(p => [r1(p[0]), r1(p[1])]);
const fieldArea = Math.round(Math.abs(polygonArea(fieldRing)));
const fieldCentre = centroid(ring0).map(r1);
const xs = fieldRing.map(p => p[0]), zs = fieldRing.map(p => p[1]);
console.log(`range field: ${fieldArea} m² (${(fieldArea / 10000).toFixed(2)} ha), centre (${fieldCentre}), x ${Math.min(...xs)}…${Math.max(...xs)}, z ${Math.min(...zs)}…${Math.max(...zs)}, ${fieldRing.length} points`);
/* compare against the EYE-TRACED ring, which the trace file keeps beside the
   measured one — otherwise a rerun compares the measurement with itself */
const tracedRange = traces.features.range.sourceRing?.ring ?? traces.features.range.ring;
const tracedCentre = centroid(tracedRange).map(r1);
console.log(`  the eye-traced ring was ${Math.hypot(fieldCentre[0] - tracedCentre[0], fieldCentre[1] - tracedCentre[1]).toFixed(1)} m away at (${tracedCentre}), ${Math.round(Math.abs(polygonArea(tracedRange)))} m²`);

/* THE BAYS ARE MEASURED, not derived. The engine's generic rule is "the end of
   the range you walk to from the clubhouse", which here is the north end — and
   the ground says otherwise: a tee line is a built, level platform, so each end
   is searched for laser-flat benches (the 5 x 5 m spread the tee-deck rule
   uses). The south end carries 1,270 flat cells against the north end's 175,
   and one 369 m² bench among them; that is also the end the club's own range
   photographs show the bays at, so two records that never entered each other
   agree. */
function benchesNear(centreZ, box) {
  const BG = gridOver(box, 1, 0);
  const flat = new Uint8Array(BG.width * BG.height);
  let n = 0;
  for (let i = 0; i < flat.length; i++) { const [x, z] = BG.centre(i); const sp = spreadAt(T, x, z, 2); if (Number.isFinite(sp) && sp < 0.12) { flat[i] = 1; n++; } }
  const { label: bl, sizes: bs } = labelComponents(open(flat, BG.width, BG.height, 1), BG.width, BG.height);
  const acc = new Map();
  for (let i = 0; i < bl.length; i++) { const id = bl[i]; if (!id || bs[id] < 25) continue; let a = acc.get(id); if (!a) { a = { sx: 0, sz: 0, n: 0, dark: 0 }; acc.set(id, a); } const [x, z] = BG.centre(i); const p = IMG.rgbAt(x, z); a.sx += x; a.sz += z; a.n++; if (p && brightness(p) < 60) a.dark++; }
  /* water is flat and dark; a tee bench is flat and mown */
  const benches = [...acc.values()].filter(a => a.dark / a.n < 0.3).map(a => ({ c: [r1(a.sx / a.n), r1(a.sz / a.n)], area: a.n })).sort((p, q) => q.area - p.area);
  return { flatCells: n, cells: flat.length, benches };
}
const zs2 = fieldRing.map(p => p[1]), xs2 = fieldRing.map(p => p[0]);
const ends = {
  north: benchesNear(Math.min(...zs2), { x0: Math.min(...xs2) - 15, x1: Math.max(...xs2) + 30, z0: Math.min(...zs2) - 35, z1: Math.min(...zs2) + 10 }),
  south: benchesNear(Math.max(...zs2), { x0: Math.min(...xs2) - 15, x1: Math.max(...xs2) + 30, z0: Math.max(...zs2) - 10, z1: Math.max(...zs2) + 35 }),
};
for (const [name, e] of Object.entries(ends)) console.log(`  ${name} end: ${e.flatCells} of ${e.cells} cells laser-flat, ${e.benches.length} mown bench(es) >= 25 m²${e.benches.length ? `, largest ${e.benches[0].area} m² at (${e.benches[0].c})` : ''}`);
const teeEnd = ends.south.flatCells >= ends.north.flatCells ? 'south' : 'north';
const bays = ends[teeEnd].benches.length ? ends[teeEnd].benches[0].c : null;
console.log(`  the bays are at the ${teeEnd} end${bays ? `, on the ${ends[teeEnd].benches[0].area} m² bench at (${bays})` : ' (no bench resolves; not placed)'}`);

/* a lone tree standing IN the field: dark, textured, small, well inside */
const trees = [];
{
  const TG = gridOver(FIELD.box, S, 0);
  const dark = new Uint8Array(TG.width * TG.height);
  for (let i = 0; i < dark.length; i++) {
    const [x, z] = TG.centre(i);
    if (!pointInPoly(x, z, fieldRing)) continue;
    const p = IMG.rgbAt(x, z);
    if (p && brightness(p) < 70) dark[i] = 1;
  }
  const { label: tl, sizes: ts } = labelComponents(open(dark, TG.width, TG.height, 1), TG.width, TG.height);
  const acc = new Map();
  for (let i = 0; i < tl.length; i++) { const id = tl[i]; if (!id || ts[id] < 8 || ts[id] > 400) continue; let a = acc.get(id); if (!a) { a = { sx: 0, sz: 0, n: 0 }; acc.set(id, a); } const [x, z] = TG.centre(i); a.sx += x; a.sz += z; a.n++; }
  for (const a of acc.values()) trees.push({ c: [r1(a.sx / a.n), r1(a.sz / a.n)], crownArea: a.n });
  trees.sort((p, q) => q.crownArea - p.crownArea);
}
const tracedOak = traces.features.range.sourceRing?.loneOak ?? traces.features.range.loneOak ?? null;
console.log(`  ${trees.length} lone tree(s) inside the field: ${trees.map(t => `(${t.c}) ${t.crownArea} m²`).join(', ') || '—'}`);
if (trees.length && tracedOak) console.log(`  the traced lone oak at (${tracedOak}) is ${Math.hypot(trees[0].c[0] - tracedOak[0], trees[0].c[1] - tracedOak[1]).toFixed(1)} m from the largest`);

/* ------------------------------------------------------- the practice greens */
/* a built putting green: greener inside than its own collar, and laser-flat */
function greenEvidence(c, r = 9) {
  const inside = [], collar = [];
  for (let dz = -14; dz <= 14; dz += 0.5) for (let dx = -14; dx <= 14; dx += 0.5) {
    const d = Math.hypot(dx, dz); const p = IMG.rgbAt(c[0] + dx, c[1] + dz);
    if (!p) continue;
    if (d <= r) inside.push(excessGreen(p)); else if (d >= r + 3 && d <= r + 8) collar.push(excessGreen(p));
  }
  const med = a => a.length ? [...a].sort((p, q) => p - q)[a.length >> 1] : NaN;
  return { exgInside: Math.round(med(inside)), exgCollar: Math.round(med(collar)), contrast: Math.round(med(inside) - med(collar)),
    spread: +spreadAt(T, c[0], c[1], 4).toFixed(2), roughness: +planeResidualAt(T, c[0], c[1], 4).toFixed(3) };
}
/* the same measurement on the nine SURVEYED greens, so the thresholds are
   calibrated on greens this course is known to have */
const calib = model.holes.map(h => ({ hole: h.n, ...greenEvidence(h.green.c) }));
const medOf = a => [...a].sort((p, q) => p - q)[a.length >> 1];
const cal = { contrast: medOf(calib.map(c => c.contrast)), spread: medOf(calib.map(c => c.spread)), roughness: medOf(calib.map(c => c.roughness)),
  contrastMin: Math.min(...calib.map(c => c.contrast)), spreadMax: Math.max(...calib.map(c => c.spread)) };
console.log('\nthe nine surveyed greens, measured the same way (calibration):');
for (const c of calib) console.log(`  hole ${c.hole}: ExG ${c.exgInside} inside vs ${c.exgCollar} collar (contrast ${c.contrast}), laser spread ${c.spread} m, roughness ${c.roughness}`);
console.log(`  median contrast ${cal.contrast}, worst ${cal.contrastMin}; median spread ${cal.spread} m, worst ${cal.spreadMax} m`);

const practice = [];
for (const [index, spec] of traces.features.practiceGreens.entries()) {
  const at = greenEvidence(spec.c, spec.r);
  const grown = readGreen(IMG, T, spec.c);
  practice.push({ index, traced: spec.c, radius: spec.r, ...at,
    grower: grown.chosen ? { area: grown.chosen.area, set: grown.chosen.set, solidity: grown.chosen.solidity, centroidShift: grown.chosen.centroidShift } : null,
    verdict: at.contrast >= cal.contrastMin && at.spread <= cal.spreadMax ? 'reads like a green' : 'does not read like a green' });
  const p = practice[practice.length - 1];
  console.log(`\npractice green ${index + 1} at (${spec.c}) r ${spec.r}: ExG ${p.exgInside} vs collar ${p.exgCollar} (contrast ${p.contrast}), spread ${p.spread} m, roughness ${p.roughness} — ${p.verdict}`);
  console.log(`  the grower ${p.grower ? `accepts ${p.grower.area} m² (set ${p.grower.set}, solidity ${p.grower.solidity}, centroid ${p.grower.centroidShift} m off)` : 'refuses this centre'}`);
}

fs.writeFileSync(path.join(HERE, 'practice-traces.json'), JSON.stringify({
  schemaVersion: 1,
  source: 'Esri World Imagery z18 (2023-04-28 WorldView-2, leaf-off) and the published 1 m laser terrain; ribbingsforsbuild/trace-practice.mjs 2026-09-05. Migration-only, no imagery stored.',
  method: {
    field: `dormant ground classified per pixel (excess green <= ${DORMANT.exgMax}, brightness >= ${DORMANT.brightMin} — measured 15–17/121 inside the field against 53–109/89–103 for every turf beside it), opened 1 m, closed 2 m, largest component, holes filled, outline simplified to 2 m`,
    bays: 'each end searched for laser-flat benches (5 x 5 m spread < 0.12 m, components >= 25 m², dark cells < 30% so the pond is not a bench); the end with more flat ground carries the tee line, and its largest bench is the bays',
    oak: 'dark (brightness < 70) components of 8–400 m² wholly inside the field',
    practiceGreens: 'excess green inside the disc against a 3–8 m collar, and the laser 5x5 m spread, both calibrated on the nine surveyed greens',
  },
  range: { ring: fieldRing, area: fieldArea, centre: fieldCentre, bays, teeEnd, ends: { north: { flatCells: ends.north.flatCells, cells: ends.north.cells, benches: ends.north.benches }, south: { flatCells: ends.south.flatCells, cells: ends.south.cells, benches: ends.south.benches } }, trees, tracedBefore: { ring: tracedRange, centre: tracedCentre, movedMetres: +Math.hypot(fieldCentre[0] - tracedCentre[0], fieldCentre[1] - tracedCentre[1]).toFixed(1) } },
  greenCalibration: { holes: calib, summary: cal },
  practiceGreens: practice,
}, null, 1) + '\n');
console.log('\nwrote practice-traces.json');

/* review sheet */
const REVIEW = path.join(HERE, 'cache', 'review');
fs.mkdirSync(REVIEW, { recursive: true });
function sheet(file, box, scale, rings) {
  const W = Math.round((box.x1 - box.x0) * scale), H = Math.round((box.z1 - box.z0) * scale);
  const rgb = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = IMG.rgbAt(box.x0 + x / scale, box.z0 + y / scale) || [0, 0, 0]; const o = (y * W + x) * 3; rgb[o] = p[0]; rgb[o + 1] = p[1]; rgb[o + 2] = p[2]; }
  const put = (X, Y, c) => { if (X < 0 || Y < 0 || X >= W || Y >= H) return; const o = (Y * W + X) * 3; rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2]; };
  for (const [ring, colour, closed] of rings) for (let i = 0; i < ring.length - (closed === false ? 1 : 0); i++) {
    const P = ring[i], Q = ring[(i + 1) % ring.length], n = Math.ceil(Math.hypot(Q[0] - P[0], Q[1] - P[1]) * scale) + 1;
    for (let s = 0; s <= n; s++) put(Math.round((P[0] + (Q[0] - P[0]) * s / n - box.x0) * scale), Math.round((P[1] + (Q[1] - P[1]) * s / n - box.z0) * scale), colour);
  }
  for (let g = Math.ceil(box.x0 / 50) * 50; g <= box.x1; g += 50) for (let y = 0; y < H; y += 5) put(Math.round((g - box.x0) * scale), y, [255, 255, 0]);
  for (let g = Math.ceil(box.z0 / 50) * 50; g <= box.z1; g += 50) for (let x = 0; x < W; x += 5) put(x, Math.round((g - box.z0) * scale), [255, 255, 0]);
  fs.writeFileSync(path.join(REVIEW, file), encodePNG(W, H, rgb));
}
const disc = (c, r) => Array.from({ length: 24 }, (_, i) => [c[0] + r * Math.cos(i / 24 * Math.PI * 2), c[1] + r * Math.sin(i / 24 * Math.PI * 2)]);
sheet('practice-range.png', { x0: 340, x1: 560, z0: -420, z1: -160 }, 3, [
  [fieldRing, [0, 255, 0]], [tracedRange, [255, 0, 0]], ...(bays ? [[disc(bays, 6), [0, 200, 255]]] : []),
  ...trees.map(t => [disc(t.c, 4), [255, 255, 255]]), ...(tracedOak ? [[disc(tracedOak, 4), [255, 120, 0]]] : []),
]);
sheet('practice-greens.png', { x0: 460, x1: 600, z0: -500, z1: -390 }, 6, [
  ...traces.features.practiceGreens.map(s => [disc(s.c, s.r), [255, 0, 0]]),
  ...model.holes.map(h => [h.green.ring, [200, 255, 0]]),
  ...model.infra.buildings.map(b => [b.ring, [255, 0, 255]]),
]);
console.log('review sheets: cache/review/practice-range.png (green measured, red traced), practice-greens.png');
