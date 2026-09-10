#!/usr/bin/env node
/* Fairways traced BY RULE from the 2026-05-02 orthophoto, hole by hole.

   The retained model carried 15 fairway strips over 18 holes, several of them
   beside rather than on the mown corridor (hole 1's ran through the rough west
   of the fairway), so at the tee every hole opened on flat rough. Early May
   is a good month for this: the fairways have greened up and the meadow rough
   is still last year's straw, so mown turf reads as GREENER, SMOOTHER and less
   grey than the rough beside it. Measured on the 0.32 m review mosaic against
   the model's own traced fairways and a rough band 40-70 m off every line
   (tortunabuild/cache/calib3.mjs), the score
       S = ExG/6 - textureSD/4 - (B/G - 0.93) * 30      (each box-averaged over 4 m)
   passes 81% of traced fairway and 12.5% of that rough at S > 0.5.

   ONE THRESHOLD IS NOT A FAIRWAY, MEASURED. At S > 0.5 the mask is the whole
   mown estate -- fairway, semi and the mown rough beside it, 13,800 m² on the
   1st where a par 4 fairway is 8-10,000 -- and at S > 1.5 it is five
   fragments of the 2nd. The fairway proper is the DARKER, GREENER band the
   hole line runs down, and it differs from hole to hole (the 13th is vivid,
   the 1st is not), so the level is taken from each hole's OWN corridor: the
   60th percentile of S over its cells within 12 m of the line (never the
   line's stations -- a dogleg's chord cuts through forest), and the fairway is
   the connected ground grown from those stations down to (level - delta),
   regularised by an 8 m box blur so its edge is a fairway's and not a pixel
   classifier's. delta is chosen per hole as the loosest of a ladder whose
   result still has a fairway's width -- median under 44 m, p90 under the
   par's cap -- because the failure mode of a loose delta is a flood sideways
   into the mown rough, which is width, not colour; among those, the best line
   coverage. Ownership where two holes share a corridor goes to the nearest
   line. Greens, tees, bunkers, water, roads, buildings and 2021 canopy of
   3 m or more are taken out first.

   Reads: cache/orthophoto/{north,south}.png, cache/expanded-canopy, course-model.json.
   Writes: mapping/fairways-2026.geojson (EPSG:3006 rings, one feature per
   component, the per-hole trial table beside them) and
   cache/review/fairway-NN.png, the picture that has to be looked at before
   any of it is adopted. Per-hole knobs live in OVERRIDES with a reason.       */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadReviewMosaic, exg, brightness, toEpsg, toLocal, sampleRaster, localStats, rasterizeRings, chamferDistance,
  dilate, erode, components, traceOuterRing, simplifyRing, ringArea, distToPolyline, dist } from './lib/imagery.mjs';
import { loadCanopy } from './lib/rasters.mjs';
import { Canvas } from './lib/png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const METRES = 0.32;
const SMOOTH_R = 6;                       /* 13 px = 4.2 m box */
const OPEN_R = 3;                         /* 1.9 m: cuts the necks a flood leaks through */
const CLOSE_R = 4;                        /* 2.6 m: heals the worn patches inside a fairway */
const BLUR_R = 12;                        /* 8 m box: the edge a fairway has, not the edge a pixel classifier has */
const MIN_AREA_M2 = 300;
const STATION_STEP = 2;
const DELTAS = [1.6, 1.4, 1.2, 1.0, 0.85, 0.7, 0.55, 0.4, 0.3];   /* loosest first */
const CORRIDOR = { 3: 32, 4: 44, 5: 48 };   /* half-width off the line a hole's mown ground may lie */
const WIDTH_CAP = { 3: 40, 4: 52, 5: 56 };  /* p90 cross-section a fairway may have */
const WIDTH_MEDIAN_CAP = 44;
/* THE MOWN ESTATE IS NOT THE FAIRWAY, and in May neither colour nor NIR tells them apart:
   NDVI reads 0.24 on the traced fairways and 0.23 on the mown rough 22-32 m off the lines
   (cache/calib-nir.mjs), because both are living turf cut in the same fortnight. What
   differs is the cut height, which an orthophoto shows only as mowing stripes. So the
   grown region is CLIPPED to a fairway's half-width off the line -- a design width, said
   so in the provenance -- and its real mown edge is kept wherever that edge lies inside it. */
const CLIP_HALF = { 3: 16, 4: 24, 5: 24 };
const OVERRIDES = {
  /* skipHead: metres from the back tee before the fairway can start (the tee surrounds are mown too);
     skipTail: metres before the green centre where the collar takes over */
  1: { skipHead: 60 }, 2: { skipHead: 40 }, 3: { skipHead: 30, corridor: 26 }, 4: { skipHead: 40 }, 5: { skipHead: 30, corridor: 26 },
  6: { skipHead: 60 }, 7: { skipHead: 40 }, 8: { skipHead: 40 }, 9: { skipHead: 20, corridor: 30 },
  10: { skipHead: 40 }, 11: { skipHead: 30, corridor: 28 }, 12: { skipHead: 60 }, 13: { skipHead: 60 }, 14: { skipHead: 30, corridor: 28 },
  15: { skipHead: 40 }, 16: { skipHead: 40 }, 17: { skipHead: 40 }, 18: { skipHead: 60 },
};

const model = JSON.parse(fs.readFileSync(path.join(HERE, 'course-model.json'), 'utf8'));
const mosaic = loadReviewMosaic();
const chm = loadCanopy();
const t0 = Date.now();
const lap = label => console.log(`${label} ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const X0 = -420, X1 = 470, Z0 = -1070, Z1 = 1130;
const win = { boundsEpsg3006: [toEpsg([X0, 0])[0], toEpsg([0, Z1])[1], toEpsg([X1, 0])[0], toEpsg([0, Z0])[1]], metres: METRES };
const [E0, , , N1] = win.boundsEpsg3006;
const ex = sampleRaster(win, (e, n) => { const c = mosaic.rgb(e, n); return c ? exg(c) : 0; });
const br = sampleRaster(win, (e, n) => { const c = mosaic.rgb(e, n); return c ? brightness(c) : 0; });
const bl = sampleRaster(win, (e, n) => { const c = mosaic.rgb(e, n); return c ? c[2] / Math.max(1, c[1]) : 1; });
const W = ex.width, H = ex.height, N = W * H;
const tex = localStats(br, 2).sd;
const exs = localStats(ex, SMOOTH_R).mean, texs = localStats({ width: W, height: H, values: tex }, SMOOTH_R).mean, bls = localStats(bl, SMOOTH_R).mean;
const S = new Float32Array(N);
for (let i = 0; i < N; i++) S[i] = exs[i] / 6 - texs[i] / 4 - (bls[i] - 0.93) * 30;
lap('features');

/* what is never fairway, whatever colour it is */
const epsgRing = ring => ring.map(toEpsg);
const blocked = new Uint8Array(N);
rasterizeRings(ex, model.water.map(w => epsgRing(w.ring)), blocked);
rasterizeRings(ex, (model.infra.buildings || []).map(b => epsgRing(b.ring)), blocked);
rasterizeRings(ex, (model.scenery.range || []).map(epsgRing), blocked);
rasterizeRings(ex, (model.scenery.mappedFeatures || []).flatMap(f => f.rings.map(epsgRing)), blocked);
rasterizeRings(ex, (model.infra.parking || []).map(p => epsgRing(p.ring)), blocked);
const roadCells = new Uint8Array(N);
const roads = [...(model.infra.roads || []), ...(model.infra.tracks || []), ...(model.infra.paths || [])];
for (const road of roads) for (let i = 1; i < road.line.length; i++) {
  const a = toEpsg(road.line[i - 1]), b = toEpsg(road.line[i]);
  const steps = Math.max(1, Math.ceil(dist(a, b) / (METRES * 0.7)));
  for (let s = 0; s <= steps; s++) {
    const [c, r] = ex.cell(a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps);
    if (c >= 0 && r >= 0 && c < W && r < H) roadCells[r * W + c] = 1;
  }
}
const roadD = chamferDistance(W, H, i => roadCells[i] === 1);
for (let i = 0; i < N; i++) if (roadD[i] * METRES <= 3.5) blocked[i] = 1;
for (let row = 0; row < H; row++) {
  const n = N1 - (row + 0.5) * METRES;
  for (let col = 0; col < W; col++) { const c = chm.at(E0 + (col + 0.5) * METRES - 597400.5, 6614899.5 - n); if (c >= 3) blocked[row * W + col] = 1; }
}
lap('blocked');

/* ownership: the nearest line whose corridor holds the cell, with its distance and station */
const lines = model.holes.map(h => ({ n: h.n, par: h.par, line: h.line.map(toEpsg), corridor: OVERRIDES[h.n]?.corridor ?? CORRIDOR[h.par],
  skipHead: OVERRIDES[h.n]?.skipHead ?? 40, skipTail: OVERRIDES[h.n]?.skipTail ?? 10, length: h.lineLen }));
const owner = new Int16Array(N).fill(-1), nearLine = new Float32Array(N);
for (let row = 0; row < H; row++) {
  const n = N1 - (row + 0.5) * METRES;
  for (let col = 0; col < W; col++) {
    const i = row * W + col;
    if (blocked[i]) continue;
    const e = E0 + (col + 0.5) * METRES;
    let best = -1, bestD = Infinity;
    for (let k = 0; k < lines.length; k++) {
      const L = lines[k];
      const { d, t } = distToPolyline([e, n], L.line);
      if (d > L.corridor || d >= bestD) continue;
      const along = t * L.length;
      if (along < L.skipHead - 15 || along > L.length - L.skipTail + 5) continue;
      bestD = d; best = k;
    }
    if (best >= 0) { owner[i] = best; nearLine[i] = bestD; }
  }
}
lap('ownership');

const quantile = (arr, p) => { const s = Float64Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const stationsOf = L => {
  const out = [];
  let acc = 0;
  for (let i = 1; i < L.line.length; i++) {
    const a = L.line[i - 1], b = L.line[i], len = dist(a, b);
    const F = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], Nn = [-F[1], F[0]];
    for (let s = 0; s < len; s += STATION_STEP) {
      const along = acc + s;
      if (along < L.skipHead || along > L.length - L.skipTail) continue;
      out.push({ p: [a[0] + F[0] * s, a[1] + F[1] * s], n: Nn, along });
    }
    acc += len;
  }
  return out;
};

/* per hole, on the sub-window of its own corridor: grow from the line at a ladder of levels and
   keep the loosest level that still has a fairway's width; where none has, the level with the best
   line coverage under a slightly wider cap, and the tightest as a last resort -- said in the report */
const features = [];
const reviewRings = new Map();
const report = [];
for (let k = 0; k < lines.length; k++) {
  const L = lines[k];
  let c0 = W, c1 = -1, r0 = H, r1 = -1;
  for (let i = 0; i < N; i++) if (owner[i] === k) { const r = (i / W) | 0, c = i - r * W; if (c < c0) c0 = c; if (c > c1) c1 = c; if (r < r0) r0 = r; if (r > r1) r1 = r; }
  if (c1 < 0) { report.push({ hole: L.n, par: L.par, note: 'no owned cells' }); console.log(`hole ${L.n}: no owned cells`); continue; }
  c0 = Math.max(0, c0 - 30); r0 = Math.max(0, r0 - 30); c1 = Math.min(W - 1, c1 + 30); r1 = Math.min(H - 1, r1 + 30);
  const w = c1 - c0 + 1, h = r1 - r0 + 1, n = w * h;
  const sub = new Float32Array(n), own = new Uint8Array(n), near = new Float32Array(n);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) { const gi = (r0 + r) * W + c0 + c, li = r * w + c; sub[li] = S[gi]; own[li] = owner[gi] === k ? 1 : 0; near[li] = nearLine[gi]; }
  const idx = (e, nn) => { const [c, r] = ex.cell(e, nn); const lc = c - c0, lr = r - r0; return lc < 0 || lr < 0 || lc >= w || lr >= h ? -1 : lr * w + lc; };
  const stations = stationsOf(L);
  const nearScores = [];
  for (let i = 0; i < N; i++) if (owner[i] === k && nearLine[i] <= 12) nearScores.push(S[i]);
  const level = nearScores.length ? quantile(nearScores, 0.6) : 0;
  const seedCells = [];
  for (const { p, n: nn } of stations) for (const off of [-4, -2, 0, 2, 4]) { const i = idx(p[0] + nn[0] * off, p[1] + nn[1] * off); if (i >= 0 && own[i] && sub[i] >= level - 0.3) seedCells.push(i); }
  const mask = new Uint8Array(n), region = new Uint8Array(n), queue = new Int32Array(n);
  const grow = threshold => {
    mask.fill(0);
    for (let i = 0; i < n; i++) if (own[i] && sub[i] >= threshold) mask[i] = 1;
    const morphed = dilate(erode(erode(dilate(mask, w, h, CLOSE_R), w, h, CLOSE_R), w, h, OPEN_R), w, h, OPEN_R);
    const blurred = localStats({ width: w, height: h, values: morphed }, BLUR_R).mean;
    const cleaned = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (blurred[i] >= 0.5 && own[i] && near[i] <= CLIP_HALF[L.par]) cleaned[i] = 1;
    region.fill(0);
    let head = 0, tail = 0;
    for (const i of seedCells) if (cleaned[i] && !region[i]) { region[i] = 1; queue[tail++] = i; }
    while (head < tail) {
      const j = queue[head++];
      const row = (j / w) | 0, col = j - row * w;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = row + dr, cc = col + dc; if (rr < 0 || rr >= h || cc < 0 || cc >= w) continue;
        const m = rr * w + cc; if (cleaned[m] && !region[m]) { region[m] = 1; queue[tail++] = m; }
      }
    }
    return tail;
  };
  const widthsOf = () => stations.map(({ p, n: nn }) => {
    const i0 = idx(...p); if (i0 < 0 || !region[i0]) return 0;
    let width = 0;
    for (const sign of [1, -1]) for (let t = 0.5; t <= 80; t += 0.5) { const i = idx(p[0] + nn[0] * t * sign, p[1] + nn[1] * t * sign); if (i < 0 || !region[i]) { width += t - 0.5; break; } if (t >= 80) width += 80; }
    return width;
  });
  const trials = [];
  for (const delta of DELTAS) {
    const threshold = level - delta;
    const cells = grow(threshold);
    const widths = widthsOf();
    const covered = widths.filter(v => v > 0).length / Math.max(1, widths.length);
    trials.push({ delta, threshold: +threshold.toFixed(2), areaM2: Math.round(cells * METRES * METRES), coverage: +covered.toFixed(2),
      widthMedian: Math.round(quantile(widths, 0.5)), widthP90: Math.round(quantile(widths, 0.9)), region: Uint8Array.from(region) });
  }
  const fits = t => t.widthMedian <= WIDTH_MEDIAN_CAP && t.widthP90 <= WIDTH_CAP[L.par];
  const byCoverage = (a, b) => b.coverage - a.coverage || b.delta - a.delta;
  let chosen = trials.filter(t => fits(t) && t.coverage >= 0.6).sort(byCoverage)[0];
  let selection = 'fairway width and line coverage';
  if (!chosen) { chosen = trials.filter(t => t.widthP90 <= WIDTH_CAP[L.par] + 12).sort(byCoverage)[0]; selection = 'best line coverage under a widened cap'; }
  if (!chosen) { chosen = trials.at(-1); selection = 'tightest level; nothing had a fairway width'; }
  /* rings of the chosen region, largest first */
  const comp = components(chosen.region, w, h);
  const rings = [];
  for (let c = 1; c <= comp.count; c++) {
    if (comp.sizes[c] * METRES * METRES < MIN_AREA_M2) continue;
    let seed = -1; for (let i = 0; i < n; i++) if (comp.labels[i] === c) { seed = i; break; }
    const outline = traceOuterRing(i => comp.labels[i] === c, w, h, seed);
    const simple = simplifyRing(outline.map(([px, py]) => [E0 + (c0 + px) * METRES, N1 - (r0 + py) * METRES]), 0.8);
    if (simple.length < 4) continue;
    const area = ringArea(simple);
    if (area < MIN_AREA_M2) continue;
    rings.push({ ring: [...simple, simple[0]], area, cells: comp.sizes[c] });
  }
  rings.sort((a, b) => b.area - a.area);
  reviewRings.set(L.n, rings);
  const strip = ({ region: _r, ...t }) => t;
  report.push({ hole: L.n, par: L.par, level: +level.toFixed(2), stations: stations.length, selection, chosen: strip(chosen), trials: trials.map(strip), components: rings.map(r => Math.round(r.area)) });
  rings.forEach((r, index) => features.push({ type: 'Feature', id: `tortuna-h${String(L.n).padStart(2, '0')}-fairway-rule-2026-${index + 1}`, properties: {
    kind: 'fairway', hole: L.n, sourceId: 'imagery-lm-ortho', sourceCollection: 'orto-n2-2026', captureDate: '2026-05-02', observedYear: 2026,
    method: 'rule-based-orthophoto-classification; ground grown from the hole line to a per-hole level, kept at the loosest level with a fairway width',
    rule: { score: 'ExG/6 - textureSD/4 - (B/G - 0.93)*30 over a 4.2 m box', corridorLevel: +level.toFixed(2), delta: chosen.delta, threshold: chosen.threshold, selection, metresPerPixel: METRES,
      closeMetres: +(CLOSE_R * 2 * METRES).toFixed(2), openMetres: +(OPEN_R * 2 * METRES).toFixed(2), blurMetres: +(BLUR_R * 2 * METRES).toFixed(2), corridorHalfWidthMetres: L.corridor, clipHalfWidthMetres: CLIP_HALF[L.par], widthMedianMetres: chosen.widthMedian, widthP90Metres: chosen.widthP90, lineCoverage: chosen.coverage },
    reviewStatus: 'agent-visual-review; human-review-pending', accuracyStatus: 'classification-estimate; not-surveyed', horizontalUncertaintyMetres: 1.5,
    areaSquareMetres: Math.round(r.area * 10) / 10, pixelAreaSquareMetres: Math.round(r.cells * METRES * METRES * 10) / 10, notSurveyed: true, terrainModified: false,
  }, geometry: { type: 'Polygon', coordinates: [r.ring.map(p => p.map(v => Math.round(v * 100) / 100))] } }));
  console.log(`hole ${String(L.n).padStart(2)}: level ${level.toFixed(2)} delta ${chosen.delta} (${selection}) width med/p90 ${chosen.widthMedian}/${chosen.widthP90} m cover ${chosen.coverage} -> ${rings.length} ring${rings.length === 1 ? '' : 's'} ${rings.map(r => Math.round(r.area) + ' m²').join(', ')}`);
}
lap('rings');

/* review pictures: the RGB crop with old rings (cyan), new rings (green), the line and the greens */
const REVIEW = path.join(HERE, 'cache', 'review');
fs.mkdirSync(REVIEW, { recursive: true });
for (const h of model.holes) {
  const pts = [...h.line, ...h.green.ring, ...h.tees.pads.flatMap(p => p.ring)];
  const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
  const x0 = Math.min(...xs) - 50, x1 = Math.max(...xs) + 50, z0 = Math.min(...zs) - 50, z1 = Math.max(...zs) + 50;
  const cw = Math.round((x1 - x0) / METRES), ch = Math.round((z1 - z0) / METRES);
  const canvas = new Canvas(cw, ch);
  for (let r = 0; r < ch; r++) for (let c = 0; c < cw; c++) {
    const rgb = mosaic.rgbLocal(x0 + (c + 0.5) * METRES, z0 + (r + 0.5) * METRES);
    if (rgb) canvas.data.set(rgb, (r * cw + c) * 3);
  }
  const px = ([x, z]) => [(x - x0) / METRES, (z - z0) / METRES];
  for (const ring of h.fairway.rings) canvas.polyline(ring.map(px), [0, 220, 255], 0.9, true, 2);
  for (const r of reviewRings.get(h.n) || []) canvas.polyline(r.ring.map(p => px(toLocal(p))), [60, 255, 60], 0.95, true, 2);
  canvas.polyline(h.green.ring.map(px), [255, 255, 255], 0.8, true, 1);
  for (const p of h.tees.pads) canvas.polyline(p.ring.map(px), [255, 60, 255], 0.9, true, 1);
  canvas.polyline(h.line.map(px), [255, 255, 255], 0.6, false, 1);
  fs.writeFileSync(path.join(REVIEW, `fairway-${String(h.n).padStart(2, '0')}.png`), canvas.toPng());
}
lap('review pictures');

const collection = { type: 'FeatureCollection', name: 'tortuna-fairways-2026', crs: { type: 'name', properties: { name: 'EPSG:3006' } }, axisOrder: ['easting', 'northing'],
  source: { windows: Object.fromEntries(mosaic.windows.map(w => [w.id, { file: w.file, boundsEpsg3006: w.boundsEpsg3006, metres: w.metres, sha256: createHash('sha256').update(fs.readFileSync(path.join(HERE, 'cache', w.file))).digest('hex') }])),
    canopy: { file: 'tortunabuild/cache/expanded-canopy/chm.f32', use: 'cells with 2021 canopy of 3 m or more never count as mown' } },
  generatedOn: new Date().toISOString().slice(0, 10), script: 'tortunabuild/trace-fairways.mjs', report, features };
fs.writeFileSync(path.join(HERE, 'mapping', 'fairways-2026.geojson'), JSON.stringify(collection, null, 1) + '\n');
console.log(`wrote ${features.length} fairway features for ${new Set(features.map(f => f.properties.hole)).size} holes`);
