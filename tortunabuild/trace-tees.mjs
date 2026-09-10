#!/usr/bin/env node
/* Tee platforms found BY RULE: laser-flat, mown, small, and where the card
   says a tee should be.

   A built tee deck is the one thing on a golf course that is flat to a few
   centimetres over its whole top, and on this ground -- the forest loop
   undulates by metres -- that alone separates it from the corridor it stands
   in (Ribbingsfors' rule; measured here first, see the report). The 1 m laser
   DTM gives the flatness; the 2026 orthophoto says the flat thing is turf
   and not a car park; the card says how far from the green each tee stands,
   so a candidate deck is attributed to a hole and a colour by the ROUTE
   distance from its centre to the green centre, never by the model's own
   marks (which all stood on one point). The reading is a candidate list with
   a review picture per hole; adoption is a separate, reviewed decision in
   mapping/tee-decisions.json.

   Reads: cache/terrain/terrain-1m.f32, cache/orthophoto/*.png, course-model.json.
   Writes: mapping/tee-candidates-2026.geojson, cache/review/tees-NN.png.       */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadReviewMosaic, exg, brightness, toEpsg, toLocal, sampleRaster, localStats, pointInRing, ringBounds,
  components, traceOuterRing, simplifyRing, ringArea, ringCentroid, distToPolyline, dist } from './lib/imagery.mjs';
import { loadTerrain, loadCanopy } from './lib/rasters.mjs';
import { Canvas } from './lib/png.mjs';
import { fetchWindow } from './ortho-crop.mjs';
import { decodePng } from './lib/png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FLAT_RANGE_METRES = 0.14;     /* 5 x 5 m height range on the laser under which a cell is deck-flat */
const MIN_AREA = 35, MAX_AREA = 900;  /* m² */
const model = JSON.parse(fs.readFileSync(path.join(HERE, 'course-model.json'), 'utf8'));
const terrain = loadTerrain();
const chm = loadCanopy();
const mosaic = loadReviewMosaic();

/* the mown score at 0.32 m, the fairway tracer's rule, sampled at 1 m */
const X0 = -420, X1 = 470, Z0 = -1070, Z1 = 1130;
const win = { boundsEpsg3006: [toEpsg([X0, 0])[0], toEpsg([0, Z1])[1], toEpsg([X1, 0])[0], toEpsg([0, Z0])[1]], metres: 0.32 };
const ex = sampleRaster(win, (e, n) => { const c = mosaic.rgb(e, n); return c ? exg(c) : 0; });
const br = sampleRaster(win, (e, n) => { const c = mosaic.rgb(e, n); return c ? brightness(c) : 0; });
const bl = sampleRaster(win, (e, n) => { const c = mosaic.rgb(e, n); return c ? c[2] / Math.max(1, c[1]) : 1; });
const tex = localStats(br, 2).sd;
const exs = localStats(ex, 3).mean, texs = localStats({ width: ex.width, height: ex.height, values: tex }, 3).mean, bls = localStats(bl, 3).mean;
const scoreAt = (x, z) => { const [c, r] = ex.cell(...toEpsg([x, z])); if (c < 0 || r < 0 || c >= ex.width || r >= ex.height) return NaN; const i = r * ex.width + c; return exs[i] / 6 - texs[i] / 4 - (bls[i] - 0.93) * 30; };
const textureAt = (x, z) => { const [c, r] = ex.cell(...toEpsg([x, z])); if (c < 0 || r < 0 || c >= ex.width || r >= ex.height) return NaN; return texs[r * ex.width + c]; };

/* the 1 m lattice over the course window */
const GW = X1 - X0, GH = Z1 - Z0;
const flat = new Uint8Array(GW * GH);
const heightAt = terrain.heightAt;
const blockedRings = [...model.water.map(w => w.ring), ...model.holes.flatMap(h => [h.green.ring, ...h.bunkers.map(b => b.ring)]), ...(model.infra.buildings || []).map(b => b.ring), ...(model.infra.parking || []).map(p => p.ring), ...(model.scenery.mappedFeatures || []).flatMap(f => f.rings), ...(model.scenery.range || [])];
const roads = [...(model.infra.roads || []), ...(model.infra.tracks || []), ...(model.infra.paths || [])];
const nearRoad = (x, z) => roads.some(r => distToPolyline([x, z], r.line).d < 2.5);
for (let row = 0; row < GH; row++) for (let col = 0; col < GW; col++) {
  const x = X0 + col + 0.5, z = Z0 + row + 0.5;
  /* flat over 5 x 5 m, or over 3 x 3 m for the narrow strip decks this course builds (the 1st's is 5 m wide) */
  let lo = Infinity, hi = -Infinity, lo3 = Infinity, hi3 = -Infinity;
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) { const h = heightAt(x + dx, z + dz); if (h < lo) lo = h; if (h > hi) hi = h; if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) { if (h < lo3) lo3 = h; if (h > hi3) hi3 = h; } }
  if (!(hi - lo < FLAT_RANGE_METRES) && !(hi3 - lo3 < FLAT_RANGE_METRES * 0.7)) continue;
  if (chm.at(x, z) >= 2) continue;
  const s = scoreAt(x, z), t = textureAt(x, z);
  if (!(t < 6.5) || !(s > -1.2)) continue;                 /* smooth turf; a worn May deck may not be green */
  if (blockedRings.some(r => pointInRing(x, z, r)) || nearRoad(x, z)) continue;
  flat[row * GW + col] = 1;
}
const comp = components(flat, GW, GH);
const candidates = [];
for (let c = 1; c <= comp.count; c++) {
  const size = comp.sizes[c];
  if (size < MIN_AREA || size > MAX_AREA) continue;
  const cells = [];
  for (let i = 0; i < flat.length; i++) if (comp.labels[i] === c) cells.push(i);
  let seed = cells[0];
  const outline = traceOuterRing(i => comp.labels[i] === c, GW, GH, seed).map(([px, py]) => [X0 + px, Z0 + py]);
  const ring = simplifyRing(outline, 0.6);
  const centre = [0, 0]; for (const i of cells) { centre[0] += X0 + (i % GW) + 0.5; centre[1] += Z0 + Math.floor(i / GW) + 0.5; }
  centre[0] /= cells.length; centre[1] /= cells.length;
  /* principal axes */
  let sxx = 0, szz = 0, sxz = 0;
  for (const i of cells) { const dx = X0 + (i % GW) + 0.5 - centre[0], dz = Z0 + Math.floor(i / GW) + 0.5 - centre[1]; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
  const tr = (sxx + szz) / cells.length, det = (sxx * szz - sxz * sxz) / (cells.length * cells.length);
  const l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det)), l2 = tr / 2 - Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const heights = cells.map(i => heightAt(X0 + (i % GW) + 0.5, Z0 + Math.floor(i / GW) + 0.5));
  const scores = cells.map(i => scoreAt(X0 + (i % GW) + 0.5, Z0 + Math.floor(i / GW) + 0.5));
  candidates.push({ id: `deck-${candidates.length + 1}`, ring: [...ring, ring[0]], centre, area: size, length: +(4 * Math.sqrt(l1)).toFixed(1), width: +(4 * Math.sqrt(Math.max(0.01, l2))).toFixed(1),
    heightRange: +(Math.max(...heights) - Math.min(...heights)).toFixed(2), meanScore: +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) });
}
console.log(`${candidates.length} flat mown decks of ${MIN_AREA}-${MAX_AREA} m²`);

/* attribution: route distance from the deck centre to the green, against the card */
const routeDistance = (h, p) => { const { t } = distToPolyline(p, h.line); return h.lineLen * (1 - t); };
const perHole = [];
for (const h of model.holes) {
  const cardMax = Math.max(...h.t), cardMin = Math.min(...h.t);
  const tee = h.line[0];
  const list = [];
  for (const cand of candidates) {
    const { d } = distToPolyline(cand.centre, h.line);
    if (d > 45) continue;
    const toGreen = routeDistance(h, cand.centre);
    const behind = dist(cand.centre, tee) < 60 && toGreen > h.lineLen - 5;    /* behind the current back mark */
    if (!behind && (toGreen < cardMin - 40 || toGreen > cardMax + 60)) continue;
    const matches = h.t.map((len, i) => ({ tee: i, len, err: +(toGreen - len).toFixed(0) })).filter(m => Math.abs(m.err) <= 40);
    list.push({ ...cand, offLine: +d.toFixed(1), toGreen: +toGreen.toFixed(0), matches });
  }
  list.sort((a, b) => b.toGreen - a.toGreen);
  const observed = h.tees.pads.map(p => ({ id: p.sourceFeatureId, centre: ringCentroid(p.ring), toGreen: +routeDistance(h, ringCentroid(p.ring)).toFixed(0), area: Math.round(ringArea(p.ring)) }));
  perHole.push({ hole: h.n, par: h.par, card: h.t, lineLen: Math.round(h.lineLen), observed, candidates: list });
  console.log(`hole ${String(h.n).padStart(2)} card ${h.t.join('/')} line ${Math.round(h.lineLen)} m | observed: ${observed.map(o => `${o.toGreen} m (${o.area} m²)`).join(', ') || 'none'} | decks: ${list.map(c => `${c.id} ${c.toGreen} m ${c.area} m² ${c.length}x${c.width} off ${c.offLine}${c.matches.length ? ' ~' + c.matches.map(m => `${['Gul', 'Blå', 'Röd', 'Orange'][m.tee]}${m.err >= 0 ? '+' : ''}${m.err}`).join('/') : ''}`).join('; ')}`);
}

/* review pictures at native 0.16 m: the first 200 m of every hole with the decks, the observed pads and the card distances */
const REVIEW = path.join(HERE, 'cache', 'review');
fs.mkdirSync(REVIEW, { recursive: true });
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');
for (const rec of perHole) {
  const h = model.holes[rec.hole - 1];
  const a = h.line[0], b = h.line[1], L = dist(a, b), F = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const span = Math.max(...h.t) - Math.min(...h.t);
  const cx = a[0] + F[0] * Math.min(L / 2, span / 2 + 20), cz = a[1] + F[1] * Math.min(L / 2, span / 2 + 20);
  const size = Math.max(140, Math.min(260, span + 110));
  const w = await fetchWindow({ cx, cz, size, metres: 0.16 });
  const overlays = { decks: rec.candidates.map(c => ({ ring: c.ring.map(p => w.px(...p)), label: `${c.id} ${c.toGreen}m`, at: w.px(...c.centre) })),
    observed: h.tees.pads.map(p => ({ ring: p.ring.map(q => w.px(...q)), label: p.sourceFeatureId.replace('tortuna-', '') })),
    line: h.line.map(p => w.px(...p)), marks: h.tees.marks.map(m => w.px(...m.c)),
    cardMarks: h.t.map((len, i) => { const along = h.lineLen - len; const q = pointAlong(h.line, Math.max(0, along)); return { at: w.px(...q), label: `${['Gul', 'Blå', 'Röd', 'Orange'][i]} ${len}` }; }) };
  const dataUrl = await page.evaluate(async ({ pieces, W, H, overlays }) => {
    const canvas = document.getElementById('c'); canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    for (const piece of pieces) { const img = new Image(); img.src = 'data:image/jpeg;base64,' + piece.b64; await img.decode(); g.drawImage(img, piece.column0, piece.row0); }
    const poly = (points, close) => { g.beginPath(); points.forEach(([x, y], index) => index ? g.lineTo(x, y) : g.moveTo(x, y)); if (close) g.closePath(); g.stroke(); };
    g.lineWidth = 2; g.font = 'bold 14px sans-serif';
    g.strokeStyle = 'rgba(255,255,255,0.7)'; poly(overlays.line, false);
    g.strokeStyle = 'rgba(255,60,255,0.9)'; g.fillStyle = 'magenta'; for (const o of overlays.observed) { poly(o.ring, true); g.fillText(o.label, o.ring[0][0] + 4, o.ring[0][1] - 4); }
    g.strokeStyle = 'rgba(60,255,60,0.95)'; g.fillStyle = '#7fff7f'; for (const d of overlays.decks) { poly(d.ring, true); g.fillText(d.label, d.at[0] + 6, d.at[1] + 5); }
    g.strokeStyle = 'rgba(255,220,0,0.95)'; g.fillStyle = '#ffdc00';
    for (const m of overlays.cardMarks) { g.beginPath(); g.arc(m.at[0], m.at[1], 6, 0, Math.PI * 2); g.stroke(); g.fillText(m.label, m.at[0] + 8, m.at[1] - 8); }
    g.strokeStyle = 'rgba(255,0,0,0.9)'; for (const m of overlays.marks) { g.beginPath(); g.moveTo(m[0] - 8, m[1]); g.lineTo(m[0] + 8, m[1]); g.moveTo(m[0], m[1] - 8); g.lineTo(m[0], m[1] + 8); g.stroke(); }
    return canvas.toDataURL('image/png');
  }, { pieces: w.pieces, W: w.W, H: w.H, overlays });
  fs.writeFileSync(path.join(REVIEW, `tees-${String(rec.hole).padStart(2, '0')}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
}
await browser.close();

function pointAlong(line, metres) {
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], len = dist(a, b);
    if (acc + len >= metres) { const t = (metres - acc) / len; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
    acc += len;
  }
  return line.at(-1);
}

const out = { type: 'FeatureCollection', name: 'tortuna-tee-deck-candidates-2026', crs: { type: 'name', properties: { name: 'EPSG:3006' } },
  rule: { flatRangeMetres5x5: FLAT_RANGE_METRES, minAreaM2: MIN_AREA, maxAreaM2: MAX_AREA, texture: 'boxed SD of brightness < 5.5 at 0.32 m', score: 'mown score > -0.6', canopy: '2021 CHM < 2 m', excluded: 'water, greens, bunkers, buildings, parking, mapped facilities, the range, within 2.5 m of a mapped way' },
  perHole, features: candidates.map(c => ({ type: 'Feature', id: c.id, properties: { kind: 'tee-candidate', areaSquareMetres: c.area, lengthMetres: c.length, widthMetres: c.width, heightRangeMetres: c.heightRange, meanMownScore: c.meanScore, centreLocal: c.centre.map(v => +v.toFixed(1)) },
    geometry: { type: 'Polygon', coordinates: [c.ring.map(p => toEpsg(p).map(v => Math.round(v * 100) / 100))] } })) };
fs.writeFileSync(path.join(HERE, 'mapping', 'tee-candidates-2026.geojson'), JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${candidates.length} candidates and 18 review pictures`);
