#!/usr/bin/env node
/* Fairways read off the club's own hole plans, registered on the measured course.

   WHY THE PLANS. The only 2026 capture of Tortuna is Lantmäteriet's flight of
   2026-05-02, and every older national flight over this block is a spring one
   too (2024-05-03, 2022-05-19, 2020-04-23, 2018-05-23; the STAC catalogue,
   checked 2026-09-23), as is the capture Esri's live mosaic serves (2020-05-09,
   WV03, 0.31 m). Esri Wayback also holds one autumn frame (2018-10-25, WV02,
   0.5 m) and two older QuickBird ones (2008-07-29, 2004-05-08, 0.6 m): coarser,
   years older than the plans, and not tried here. In May
   the fairway, the semi and the mown rough are the same living turf cut in the
   same fortnight -- NDVI 0.24 against 0.23 (README) -- so trace-fairways.mjs
   could only ever find the mown ESTATE, and it clipped that to a design width
   of 24 m either side of the hole line. That clip is what the player saw:
   straight-edged 48 m bands with pixel-classifier edges, starting at the tees
   and running through the rough. The club's Caddee plans draw each fairway as
   its own striped shape, and they are the record of which mown ground is
   fairway that no photograph of this course can supply.

   HOW. Each plan (hash-pinned in reference/source-assets.json) is placed on the
   model by a least-squares similarity fitted to what the model MEASURED: its
   green (weight 3), every bunker the plan draws that lands on a model bunker
   (weight 1 each), and the two tee dots on their named platforms (weight 0.4
   and 0.3 once a bunker anchors the fit, since 27 of the 72 colour marks
   stand on card-derived platforms). lib/plans.mjs carries the rules. The
   fairway is the plan's fairway colour WITH its mowing stripes (the stripes
   are what separates it from the lit rough and the pond banks, measured:
   coherence 0.79-0.89 against 0.31-0.67), minus the drawn green and tee boxes,
   carried to local metres through the fitted transform and then kept clear of
   what the model says stands there: greens and their collars, bunkers, water,
   tee platforms, buildings, the range and practice features, and every tree
   the published vegetation plants (lib/published-trees.mjs, the runtime's own
   planner -- the player plants each record as it stands and never asks what
   surface is under it).

   WHAT IS CHECKED, NOT FITTED. The registration residuals are printed per
   anchor; the fraction of each fairway on ground the 2026 orthophoto shows
   MOWN (trace-fairways.mjs's own score, S > 0.5) is measured for the new and
   the old rings, and never entered the fit.

     node tortunabuild/trace-plan-fairways.mjs              # -> mapping/fairways-plan-2026.geojson
                                                            #    + cache/review/plan-fairway-NN.png
     node tortunabuild/trace-plan-fairways.mjs --no-ortho   # skip the orthophoto check and pictures */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, Canvas } from './lib/png.mjs';
import { dilate, erode, components, traceOuterRing, simplifyRing, ringArea, pointInRing, distToPolyline, chamferDistance, localStats } from './lib/imagery.mjs';
import { loadPlanBytes, planFeatures, planGreen, planFairwayMask, STRIPES, registerPlan, polygonCentroid, REGISTRATION } from './lib/plans.mjs';
import { loadPublishedTrees } from './lib/published-trees.mjs';
import { orthoWindow } from './lib/ortho-png.mjs';
import { TORTUNA_FRAME } from './frame.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const NO_ORTHO = process.argv.includes('--no-ortho');
const OUT = path.join(HERE, 'mapping', 'fairways-plan-2026.geojson');
const REVIEW = path.join(HERE, 'cache', 'review');
const toEpsg = ([x, z]) => [+(x + TORTUNA_FRAME.easting).toFixed(2), +(TORTUNA_FRAME.northing - z).toFixed(2)];

/* the plan-pixel mask: closes the distance arcs and numerals drawn across a fairway, then drops speckle */
const PLAN_MASK = Object.freeze({ closePx: 6, openPx: 2, greenMarginPx: 4, fillHoleSquareMetres: 150 });
/* the world raster each fairway is finished on */
const CELL = 0.5;
/* Sand, greens, tees and paths OUTRANK fairway in SURFACE_PRIORITY (surface.js), and every green
   and tee is ringed by its own fringe, so the fairway needs no hole for them; it is still held
   clear of their edges so a ring never runs under a green or a pad. Water and trees are the two
   things a fairway ring would otherwise paint under: the water sheet shows turf at its shore and
   the runtime plants a published tree whatever the surface. */
const CLEAR = Object.freeze({
  ownGreenMetres: 1.5,          /* the collar: the engine rings each green with its own fringe */
  otherGreenMetres: 3,
  bunkerMetres: 0.8,
  waterMetres: 1,
  teeMetres: 1,
  buildingMetres: 2,
  featureMetres: 2,             /* range, practice green and bunker, range targets, paved strips */
  treeMinMetres: 1.2,           /* a trunk and the inner crown: max(this, half the crown radius) */
  treeCrownFraction: 0.5,
  treeMarginMetres: 0.3,
});
/* the ring: the 0.5 m cell outline simplified, corner-cut twice, and simplified again, since the
   atlas rasterises it at 1 m and a denser ring only costs pack bytes */
const FINISH = Object.freeze({ closeMetres: 1.5, openMetres: 1.5, minAreaSquareMetres: 150, simplifyMetres: 0.5, chaikin: 2, resimplifyMetres: 0.12,
  corridorMetres: 60, teeBoxAreaSquareMetres: 800, teeBoxDistanceMetres: 25, keyholeCells: 1,
  /* a small striped piece at the tees or behind the green is a tee box or the next hole's apron */
  strayAreaSquareMetres: 400, strayTeeMetres: 45,
  /* beside a hole's main fairway only a second one of this size stands (the 12th's lay-up); the plans hatch
     lit patches of semi and aprons too, and a scrap of fairway on its own in the rough is one of those */
  secondaryMinSquareMetres: 800 });

const REVIEWED_ON = '2026-09-23';
const model = JSON.parse(fs.readFileSync(path.join(HERE, 'course-model.json'), 'utf8'));
/* the rule trace this replaces, for the comparison -- read from its own record, never from the model,
   which after apply-fairways-and-range.mjs holds these fairways themselves */
const RULE_TRACE = JSON.parse(fs.readFileSync(path.join(HERE, 'mapping', 'fairways-2026.geojson'), 'utf8'));
const toLocal = ([e, n]) => [e - TORTUNA_FRAME.easting, TORTUNA_FRAME.northing - n];
const ruleRings = n => RULE_TRACE.features.filter(f => f.properties.hole === n).map(f => f.geometry.coordinates[0].map(toLocal));
const bunkers = model.holes.flatMap(h => h.bunkers.map(b => ({ hole: h.n, id: b.sourceFeatureId, c: polygonCentroid(b.ring), area: ringArea(b.ring) })));
const published = loadPublishedTrees();
console.log(`published trees: ${published.stats.individuals} measured crowns + ${published.stats.standTrees} stand trees (${published.groundManifest})`);

/* ---------- world helpers ---------- */
const bboxOf = rings => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const ring of rings) for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return [x0, z0, x1, z1]; };
const overlaps = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
const grow = (bb, m) => [bb[0] - m, bb[1] - m, bb[2] + m, bb[3] + m];
function grid([x0, z0, x1, z1]) {
  const gx0 = Math.floor(x0 / CELL) * CELL, gz0 = Math.floor(z0 / CELL) * CELL;
  const width = Math.ceil((x1 - gx0) / CELL) + 1, height = Math.ceil((z1 - gz0) / CELL) + 1;
  return { x0: gx0, z0: gz0, width, height, box: [gx0, gz0, gx0 + width * CELL, gz0 + height * CELL],
    centre: i => [gx0 + ((i % width) + 0.5) * CELL, gz0 + (Math.floor(i / width) + 0.5) * CELL] };
}
function fillRing(g, mask, ring, value = 1) {
  const [x0, z0, x1, z1] = bboxOf([ring]);
  const c0 = Math.max(0, Math.floor((x0 - g.x0) / CELL)), c1 = Math.min(g.width - 1, Math.ceil((x1 - g.x0) / CELL));
  const r0 = Math.max(0, Math.floor((z0 - g.z0) / CELL)), r1 = Math.min(g.height - 1, Math.ceil((z1 - g.z0) / CELL));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    if (pointInRing(g.x0 + (c + 0.5) * CELL, g.z0 + (r + 0.5) * CELL, ring)) mask[r * g.width + c] = value;
  }
}
/** mark the cells of grid g inside `ring` or within `metres` of it, working on a window round the ring only */
function clearNear(g, blocked, ring, metres) {
  const bb = grow(bboxOf([ring]), metres + CELL);
  if (!overlaps(bb, g.box)) return;
  const c0 = Math.max(0, Math.floor((bb[0] - g.x0) / CELL)), c1 = Math.min(g.width - 1, Math.ceil((bb[2] - g.x0) / CELL));
  const r0 = Math.max(0, Math.floor((bb[1] - g.z0) / CELL)), r1 = Math.min(g.height - 1, Math.ceil((bb[3] - g.z0) / CELL));
  const w = c1 - c0 + 1, h = r1 - r0 + 1;
  if (w <= 0 || h <= 0) return;
  const local = { x0: g.x0 + c0 * CELL, z0: g.z0 + r0 * CELL, width: w, height: h };
  const m = new Uint8Array(w * h);
  fillRing(local, m, ring);
  const d = metres > 0 ? chamferDistance(w, h, i => m[i] === 1) : null;
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const i = r * w + c;
    if (m[i] || (d && d[i] * CELL <= metres)) blocked[(r0 + r) * g.width + c0 + c] = 1;
  }
}
function clearDisc(g, blocked, [x, z], radius) {
  const c0 = Math.max(0, Math.floor((x - radius - g.x0) / CELL)), c1 = Math.min(g.width - 1, Math.ceil((x + radius - g.x0) / CELL));
  const r0 = Math.max(0, Math.floor((z - radius - g.z0) / CELL)), r1 = Math.min(g.height - 1, Math.ceil((z + radius - g.z0) / CELL));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    if (Math.hypot(g.x0 + (c + 0.5) * CELL - x, g.z0 + (r + 0.5) * CELL - z) <= radius) blocked[r * g.width + c] = 1;
  }
}
/** Fill enclosed background regions of `mask` smaller than `maxCells` (4-connected background, border-reached = outside). */
function fillHoles(mask, width, height, maxCells) {
  const out = Uint8Array.from(mask);
  const seen = new Uint8Array(mask.length), stack = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] || seen[start]) continue;
    let top = 0, touches = false; const cells = [];
    stack[top++] = start; seen[start] = 1;
    while (top) {
      const j = stack[--top]; cells.push(j);
      const y = (j / width) | 0, x = j - y * width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touches = true;
      for (const k of [j - 1, j + 1, j - width, j + width]) {
        if (k < 0 || k >= mask.length || seen[k] || mask[k]) continue;
        if ((k === j - 1 && x === 0) || (k === j + 1 && x === width - 1)) continue;
        seen[k] = 1; stack[top++] = k;
      }
    }
    if (!touches && cells.length <= maxCells) for (const j of cells) out[j] = 1;
  }
  return out;
}
/* A model fairway ring has no holes (surface-features.mjs rasterises each ring whole), so an enclosed
   island -- a tree's clearance, a pond, a rough island the plan draws -- is opened to the outside by a
   one-cell keyhole down the distance field, and the outer ring then runs round it. */
function keyholes(mask, width, height) {
  const N = mask.length, outside = new Uint8Array(N), stack = new Int32Array(N);
  let top = 0;
  for (let i = 0; i < N; i++) {
    const y = (i / width) | 0, x = i - y * width;
    if (!mask[i] && (x === 0 || y === 0 || x === width - 1 || y === height - 1)) { outside[i] = 1; stack[top++] = i; }
  }
  const neighbours = j => { const y = (j / width) | 0, x = j - y * width; return [x > 0 ? j - 1 : -1, x < width - 1 ? j + 1 : -1, y > 0 ? j - width : -1, y < height - 1 ? j + width : -1].filter(k => k >= 0); };
  while (top) { const j = stack[--top]; for (const k of neighbours(j)) if (!mask[k] && !outside[k]) { outside[k] = 1; stack[top++] = k; } }
  let cut = 0;
  for (let guard = 0; guard < 400; guard++) {
    let hole = -1; for (let i = 0; i < N; i++) if (!mask[i] && !outside[i]) { hole = i; break; }
    if (hole < 0) break;
    /* the island's cells, then the one nearest the outside by the chamfer field */
    const island = []; top = 0; stack[top++] = hole; const inIsland = new Uint8Array(N); inIsland[hole] = 1;
    while (top) { const j = stack[--top]; island.push(j); for (const k of neighbours(j)) if (!mask[k] && !inIsland[k]) { inIsland[k] = 1; stack[top++] = k; } }
    const d = chamferDistance(width, height, i => outside[i] === 1);
    let from = island[0]; for (const j of island) if (d[j] < d[from]) from = j;
    let j = from, steps = 0;
    while (!outside[j] && steps++ < width + height) {
      let next = -1, best = d[j];
      for (const k of neighbours(j)) if (d[k] < best) { best = d[k]; next = k; }
      if (next < 0) break;
      mask[next] = 0; j = next; cut++;
    }
    for (const k of island) outside[k] = 1;
    top = 0; for (const k of island) stack[top++] = k;
    while (top) { const q = stack[--top]; for (const k of neighbours(q)) if (!mask[k] && !outside[k]) { outside[k] = 1; stack[top++] = k; } }
  }
  return cut;
}
/** Chaikin corner cutting on a closed ring (open list in, open list out). */
function chaikin(ring, passes) {
  let pts = ring;
  for (let k = 0; k < passes; k++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    pts = out;
  }
  return pts;
}
const nearestHole = p => {
  let best = null, bestD = Infinity;
  for (const h of model.holes) { const { d } = distToPolyline(p, h.line); if (d < bestD) { bestD = d; best = h.n; } }
  return { hole: best, d: bestD };
};

/* ---------- the 2026 mown score, trace-fairways.mjs's rule, for the independent check ---------- */
async function mownFraction(rings) {
  if (NO_ORTHO || !rings.length) return null;
  const [x0, z0, x1, z1] = bboxOf(rings);
  const win = await orthoWindow([Math.floor(x0 - 6), Math.floor(z0 - 6), Math.ceil(x1 + 6), Math.ceil(z1 + 6)], 0.32);
  const W = win.width, H = win.height, N = W * H;
  const ex = new Float32Array(N), br = new Float32Array(N), bl = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const r = win.data[i * 3], g = win.data[i * 3 + 1], b = win.data[i * 3 + 2];
    ex[i] = 2 * g - r - b; br[i] = (r + g + b) / 3; bl[i] = b / Math.max(1, g);
  }
  const tex = localStats({ width: W, height: H, values: br }, 2).sd;
  const exs = localStats({ width: W, height: H, values: ex }, 6).mean, texs = localStats({ width: W, height: H, values: tex }, 6).mean, bls = localStats({ width: W, height: H, values: bl }, 6).mean;
  let inside = 0, mown = 0;
  for (let row = 0; row < H; row += 2) for (let col = 0; col < W; col += 2) {
    const p = win.toLocal(col, row);
    if (!rings.some(ring => pointInRing(p[0], p[1], ring))) continue;
    const i = row * W + col;
    inside++;
    if (exs[i] / 6 - texs[i] / 4 - (bls[i] - 0.93) * 30 > 0.5) mown++;
  }
  return inside ? +(mown / inside).toFixed(3) : null;
}

/* ---------- per hole: the plan, its registration and its striped fairway pixels ---------- */
const results = [];
for (const hole of model.holes) {
  const { bytes, asset } = await loadPlanBytes(hole.n);
  const F = planFeatures(decodePng(bytes));
  const green = planGreen(F);
  const { transform: T, residuals } = registerPlan(hole, F, green, bunkers);
  const W = F.W, H = F.H, N = W * H;
  const planMask = planFairwayMask(F);
  let mask = planMask.mask;
  mask = erode(dilate(mask, W, H, PLAN_MASK.closePx), W, H, PLAN_MASK.closePx);
  /* the worn-patch stipples, lettering and distance plates drawn inside a fairway are holes in it,
     not rough; an enclosed hole smaller than fillHoleSquareMetres is filled, a larger one is a real
     island the plan draws in rough and stays */
  mask = fillHoles(mask, W, H, PLAN_MASK.fillHoleSquareMetres / (T.scale * T.scale));
  mask = dilate(erode(mask, W, H, PLAN_MASK.openPx), W, H, PLAN_MASK.openPx);
  const greenZone = dilate(green.region, W, H, PLAN_MASK.greenMarginPx);
  for (let i = 0; i < N; i++) if (greenZone[i] || F.background[i]) mask[i] = 0;
  const comp = components(mask, W, H);
  const dotLabels = new Set([F.orangeDot, F.redDot].filter(Boolean).map(d => comp.labels[Math.round(d.c[1]) * W + Math.round(d.c[0])]).filter(Boolean));
  const kept = [], refused = [];
  for (let label = 1; label <= comp.count; label++) {
    const areaM2 = comp.sizes[label] * T.scale * T.scale;
    if (areaM2 < FINISH.minAreaSquareMetres) continue;
    let seed = -1; for (let i = 0; i < N; i++) if (comp.labels[i] === label) { seed = i; break; }
    const ring = simplifyRing(traceOuterRing(i => comp.labels[i] === label, W, H, seed), 1).map(p => T.apply(p));
    const c = polygonCentroid(ring);
    const owner = nearestHole(c);
    const teeDistance = Math.min(...hole.tees.marks.map(m => Math.hypot(m.c[0] - c[0], m.c[1] - c[1])));
    /* behind the green: past the pin along the line's last leg */
    const last = hole.line.at(-1), prev = hole.line.at(-2), leg = Math.hypot(last[0] - prev[0], last[1] - prev[1]);
    const pastPin = ((c[0] - last[0]) * (last[0] - prev[0]) + (c[1] - last[1]) * (last[1] - prev[1])) / leg;
    const why = dotLabels.has(label) ? 'contains a drawn tee dot (a tee box)'
      : areaM2 < FINISH.strayAreaSquareMetres && teeDistance < FINISH.strayTeeMetres ? 'a small striped piece at the tees (a tee box or its surround)'
      : areaM2 < FINISH.strayAreaSquareMetres && pastPin > 0 ? 'a small striped piece behind the green (the next hole\'s apron)'
      : owner.hole !== hole.n ? `nearer hole ${owner.hole}'s line (a neighbour drawn in the margin)`
      : areaM2 < FINISH.teeBoxAreaSquareMetres && teeDistance < FINISH.teeBoxDistanceMetres ? 'a small striped box at the tees (a tee box without a dot)'
      : null;
    (why ? refused : kept).push({ label, areaM2: Math.round(areaM2), ring, bb: bboxOf([ring]), why });
  }
  results.push({ hole, asset, F, T, residuals, kept, refused, comp, stripeDegrees: planMask.stripeDegrees });
}

/* ---------- finish in the world, each hole on its own grid; a cell two plans draw goes to the nearer line ---------- */
let treesKeptClear = 0;
for (const r of results) {
  const n = r.hole.n;
  r.world = null;
  if (!r.kept.length) continue;
  const g = grid(grow(bboxOf(r.kept.map(k => k.ring)), 12));
  const N = g.width * g.height;
  const m = new Uint8Array(N);
  for (const k of r.kept) fillRing(g, m, k.ring);
  const stage = { planSquareMetres: 0 };
  const areaOf = mask => { let c = 0; for (let i = 0; i < N; i++) if (mask[i]) c++; return Math.round(c * CELL * CELL); };
  stage.planSquareMetres = areaOf(m);
  for (const other of results) {
    if (other.hole.n === n) continue;
    for (const k of other.kept) {
      if (!overlaps(k.bb, g.box)) continue;
      const theirs = new Uint8Array(N);
      fillRing(g, theirs, k.ring);
      for (let i = 0; i < N; i++) if (m[i] && theirs[i]) {
        const p = g.centre(i);
        if (distToPolyline(p, other.hole.line).d < distToPolyline(p, r.hole.line).d) m[i] = 0;
      }
    }
  }
  /* soft: outranked by fairway's betters in the atlas, cut back at an edge but never holed;
     hard: painted under by a fairway ring, so cut back AND keyholed when enclosed */
  stage.afterSharedCorridorSquareMetres = areaOf(m);
  const soft = new Uint8Array(N), blocked = new Uint8Array(N);
  for (const h of model.holes) {
    clearNear(g, soft, h.green.ring, h.n === n ? CLEAR.ownGreenMetres : CLEAR.otherGreenMetres);
    for (const b of h.bunkers) clearNear(g, soft, b.ring, CLEAR.bunkerMetres);
    for (const p of h.tees.pads) clearNear(g, soft, p.ring, CLEAR.teeMetres);
  }
  for (const w of model.water) clearNear(g, blocked, w.ring, CLEAR.waterMetres);
  for (const b of model.infra.buildings) clearNear(g, blocked, b.ring, CLEAR.buildingMetres);
  for (const f of model.scenery.mappedFeatures) for (const ring of f.rings) clearNear(g, blocked, ring, CLEAR.featureMetres);
  for (const ring of model.scenery.range) clearNear(g, blocked, ring, CLEAR.featureMetres);
  let treesInPlan = 0;
  for (const t of published.trees) {
    if (t.x < g.box[0] - 8 || t.z < g.box[1] - 8 || t.x > g.box[2] + 8 || t.z > g.box[3] + 8) continue;
    const c = Math.floor((t.x - g.x0) / CELL), row = Math.floor((t.z - g.z0) / CELL);
    if (c >= 0 && row >= 0 && c < g.width && row < g.height && m[row * g.width + c]) treesInPlan++;
    clearDisc(g, blocked, [t.x, t.z], Math.max(CLEAR.treeMinMetres, t.radius * CLEAR.treeCrownFraction) + CLEAR.treeMarginMetres);
    treesKeptClear++;
  }
  r.treesInPlan = treesInPlan;
  for (let i = 0; i < N; i++) if (m[i] && blocked[i]) m[i] = 0;
  stage.afterHardClearancesSquareMetres = areaOf(m);
  for (let i = 0; i < N; i++) if (m[i] && distToPolyline(g.centre(i), r.hole.line).d > FINISH.corridorMetres) m[i] = 0;
  stage.afterCorridorSquareMetres = areaOf(m);
  const closeCells = Math.round(FINISH.closeMetres / CELL), openCells = Math.round(FINISH.openMetres / CELL);
  let s = erode(dilate(m, g.width, g.height, closeCells), g.width, g.height, closeCells);
  s = dilate(erode(s, g.width, g.height, openCells), g.width, g.height, openCells);
  /* smoothing may creep into a clearance or past the plan's own edge; neither is allowed */
  const reach = dilate(m, g.width, g.height, closeCells);
  for (let i = 0; i < N; i++) if (blocked[i] || !reach[i]) s[i] = 0;
  const keyholeCells = keyholes(s, g.width, g.height);
  /* soft blockers last: an edge is cut back from a green, bunker or pad, an enclosed one is left to the atlas */
  const edgeSoft = new Uint8Array(N);
  { const outside = new Uint8Array(N); for (let i = 0; i < N; i++) outside[i] = s[i] ? 0 : 1;
    const nearEdge = dilate(outside, g.width, g.height, Math.round(3 / CELL));
    for (let i = 0; i < N; i++) if (soft[i] && nearEdge[i]) edgeSoft[i] = 1; }
  for (let i = 0; i < N; i++) if (edgeSoft[i]) s[i] = 0;
  stage.finishedSquareMetres = areaOf(s);
  r.stage = stage;
  if (process.env.TRACE_STAGES) console.log(`  hole ${n} stages ${JSON.stringify(stage)}`);
  r.world = { g, mask: s, keyholeCells };
}
console.log(`${treesKeptClear} tree clearances applied round the plan fairways`);

/* ---------- rings, the independent check, records and review pictures ---------- */
const features = [];
const report = [];
fs.mkdirSync(REVIEW, { recursive: true });
for (const r of results) {
  const n = r.hole.n;
  const rings = [];
  if (r.world) {
    const { g, mask } = r.world;
    const cc = components(mask, g.width, g.height);
    for (let label = 1; label <= cc.count; label++) {
      if (cc.sizes[label] * CELL * CELL < FINISH.minAreaSquareMetres) continue;
      let seed = -1; for (let i = 0; i < mask.length; i++) if (cc.labels[i] === label) { seed = i; break; }
      const corners = traceOuterRing(i => cc.labels[i] === label, g.width, g.height, seed).map(([c, row]) => [g.x0 + c * CELL, g.z0 + row * CELL]);
      const ring = simplifyRing(chaikin(simplifyRing(corners, FINISH.simplifyMetres), FINISH.chaikin), FINISH.resimplifyMetres);
      const area = ringArea(ring);
      if (area >= FINISH.minAreaSquareMetres) rings.push({ ring, area });
    }
  }
  rings.sort((a, b) => b.area - a.area);
  const scraps = rings.splice(1).filter(x => { if (x.area >= FINISH.secondaryMinSquareMetres) return true; r.refused.push({ areaM2: Math.round(x.area), why: 'a scrap apart from the main fairway (hatched semi or an apron)' }); return false; });
  rings.push(...scraps);
  const oldRings = ruleRings(n);
  const mownNew = await mownFraction(rings.map(x => x.ring));
  const mownOld = await mownFraction(oldRings);
  const res = r.residuals;
  const record = {
    hole: n, par: r.hole.par, plan: { id: r.asset.id, sha256: r.asset.sha256 },
    registration: { metresPerPixel: +r.T.scale.toFixed(4), rotationDegrees: +(r.T.rotation * 180 / Math.PI).toFixed(2),
      greenResidualMetres: +res.greenMetres.toFixed(2), bunkerResidualsMetres: res.bunkers.map(b => ({ hole: b.hole, id: b.id, metres: +b.metres.toFixed(2) })),
      teeResidualsMetres: res.tees.map(t => ({ anchor: t.anchor, metres: +t.metres.toFixed(2) })) },
    planStripeDegrees: r.stripeDegrees, planComponents: { kept: r.kept.map(k => k.areaM2), refused: r.refused.map(k => ({ areaSquareMetres: k.areaM2, why: k.why })) },
    fairways: rings.map(x => Math.round(x.area)),
    previousFairways: oldRings.map(ring => Math.round(ringArea(ring))),
    mownFraction2026: { plan: mownNew, previous: mownOld },
  };
  report.push(record);
  rings.forEach((x, index) => features.push({ type: 'Feature', id: `tortuna-h${String(n).padStart(2, '0')}-fairway-plan-2026-${index + 1}`, properties: {
    kind: 'fairway', hole: n, sourceId: r.asset.id, sourceUrl: r.asset.resolvedUrl, sourceSha256: r.asset.sha256, sourceKind: 'club-published hole plan (Caddee), a stylised illustration',
    method: `the plan fairway colour carrying its mowing stripes (structure-tensor orientation within ${STRIPES.angleToleranceDegrees} degrees of the plan stripe angle), grown ${STRIPES.growPx} px into connected fairway colour, placed by a least-squares similarity on the model green, bunkers and tee platforms, and kept clear of greens, bunkers, water, tees, buildings, practice features and every published tree`,
    registration: record.registration, reviewStatus: 'agent-rule-based-registration; human-review-pending', accuracyStatus: 'plan-derived shape on measured anchors; not surveyed',
    stages: r.stage ?? null, publishedTreesInsidePlanShape: r.treesInPlan ?? 0, keyholeCells: r.world?.keyholeCells ?? 0,
    horizontalUncertaintyMetres: +Math.max(2, res.greenMetres, ...res.bunkers.map(b => b.metres)).toFixed(1),
    areaSquareMetres: Math.round(x.area * 10) / 10, mownFraction2026: mownNew, notSurveyed: true, terrainModified: false,
  }, geometry: { type: 'Polygon', coordinates: [[...x.ring, x.ring[0]].map(toEpsg)] } }));
  const bunkerText = res.bunkers.map(b => b.metres.toFixed(1)).join(',') || '-';
  console.log(`hole ${String(n).padStart(2)}: ${r.T.scale.toFixed(3)} m/px, green ${res.greenMetres.toFixed(1)} m, bunkers [${bunkerText}] m, tees [${res.tees.map(t => t.metres.toFixed(1)).join(',')}] m -> ${rings.length} fairway${rings.length === 1 ? '' : 's'} ${rings.map(x => Math.round(x.area)).join('+') || 0} m² (was ${record.previousFairways.join('+')}); mown 2026 ${mownNew ?? '-'} (was ${mownOld ?? '-'})`);

  /* the plan with its kept (green) and refused (red) pixels beside the orthophoto with the new (lime) and previous (cyan) rings */
  if (NO_ORTHO) continue;
  const planCanvas = new Canvas(r.F.W, r.F.H);
  const keptLabels = new Set(r.kept.map(k => k.label)), refusedLabels = new Set(r.refused.map(k => k.label));
  for (let i = 0; i < r.F.W * r.F.H; i++) {
    const base = [r.F.R[i], r.F.G[i], r.F.B[i]], label = r.comp.labels[i];
    const tint = keptLabels.has(label) ? [60, 255, 60] : refusedLabels.has(label) ? [255, 40, 40] : null;
    planCanvas.data.set(tint ? base.map((v, k) => Math.round(v * 0.45 + tint[k] * 0.55)) : base, i * 3);
  }
  const [bx0, bz0, bx1, bz1] = bboxOf([[...rings.flatMap(x => x.ring), ...oldRings.flat(), ...r.hole.line, ...r.hole.green.ring]]);
  const metres = Math.max(0.32, +((Math.max(bx1 - bx0, bz1 - bz0) + 60) / 1000).toFixed(2));
  const win = await orthoWindow([Math.floor(bx0 - 30), Math.floor(bz0 - 30), Math.ceil(bx1 + 30), Math.ceil(bz1 + 30)], metres);
  const ortho = new Canvas(win.width, win.height); ortho.data.set(win.data);
  for (const ring of oldRings) ortho.polyline(ring.map(win.toPixel), [0, 220, 255], 0.9, true, 2);
  for (const x of rings) ortho.polyline(x.ring.map(win.toPixel), [160, 255, 40], 1, true, 2);
  ortho.polyline(r.hole.green.ring.map(win.toPixel), [255, 255, 255], 0.9, true, 1);
  for (const b of r.hole.bunkers) ortho.polyline(b.ring.map(win.toPixel), [255, 255, 0], 0.9, true, 1);
  for (const p of r.hole.tees.pads) ortho.polyline(p.ring.map(win.toPixel), [255, 60, 255], 0.9, true, 1);
  ortho.polyline(r.hole.line.map(win.toPixel), [255, 255, 255], 0.5, false, 1);
  const width = r.F.W + ortho.width, height = Math.max(r.F.H, ortho.height);
  const sheet = new Canvas(width, height, [255, 255, 255]);
  const paste = (src, ox) => { for (let y = 0; y < src.height; y++) sheet.data.set(src.data.subarray(y * src.width * 3, (y + 1) * src.width * 3), (y * width + ox) * 3); };
  paste(planCanvas, 0); paste(ortho, r.F.W);
  fs.writeFileSync(path.join(REVIEW, `plan-fairway-${String(n).padStart(2, '0')}.png`), sheet.toPng());
}

const collection = { type: 'FeatureCollection', name: 'tortuna-fairways-plan-2026', crs: { type: 'name', properties: { name: 'EPSG:3006' } }, axisOrder: ['easting', 'northing'],
  generatedOn: REVIEWED_ON, script: 'tortunabuild/trace-plan-fairways.mjs',
  sources: {
    plans: 'tortunabuild/reference/source-assets.json (caddee-hole-1..18, sha256-pinned; the images stay in the ignored cache)',
    anchors: 'tortunabuild/course-model.json greens, bunkers and tee platforms',
    trees: `published vegetation of ${published.groundManifest}: ${published.stats.individuals} crowns + ${published.stats.standTrees} stand trees, planted by the runtime planner`,
    check: 'Lantmäteriet Ortofoto_0.16 (orto-n2-2026, 2026-05-02) through the Min karta WMS; the mown score of trace-fairways.mjs, never an input to the fit',
  },
  registration: REGISTRATION, planMask: { ...PLAN_MASK, stripes: STRIPES }, clearances: CLEAR, finish: FINISH,
  why: 'Every Lantmäteriet capture of this course is a spring one, as is the one Esri\'s live mosaic serves; in May the fairway cannot be told from the mown rough in colour or NIR, so the 2026 rule trace clipped the mown estate to a 24 m design half-width. The club plans draw the fairway itself.',
  report, features };
fs.writeFileSync(OUT, JSON.stringify(collection, null, 1) + '\n');
console.log(`wrote ${path.relative(ROOT, OUT)}: ${features.length} fairway rings on ${new Set(features.map(f => f.properties.hole)).size} holes`);
