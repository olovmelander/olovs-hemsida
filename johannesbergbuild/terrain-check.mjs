/* Check every traced ring against the 1 m laser terrain the app actually drapes.

   The published l0 tiles of the Johannesberg ground (Lantmäteriet Markhöjdmodell,
   read at overview factor 1) are decoded through the same reader the loader
   uses, assembled into one 2048 x 2048 m raster in EPSG:3006, and every ring of
   both courses -- taken from the committed EPSG:3006 migration, so the frame
   conversion is cs2cs's and not this file's -- is measured against it:

     green / tee pad   raise  = mean height inside the ring minus the mean over a
                                4-10 m collar outside it; a built green is a
                                plateau, so raise > 0 and a small std inside
     bunker            depth  = mean over a 2-6 m rim minus the mean inside; a
                                bunker is a pit in the laser surface
     water             the laser DTM carries open water as a FLAT surface, so a
                                ring that sits on real water has a small std inside
                                and banks that rise over a 3-10 m collar
     registration      the shift (in 1 m steps, +/- 8 m) that maximises a
                                bunker's depth, a green's raise or a pond's bank,
                                or minimises a green's interior std; only maxima
                                INSIDE the search window count (an edge hit says
                                the objective has no peak, not where it is), and
                                the median over those is the horizontal offset
                                between the imagery traces and the laser terrain

   The terrain never entered a trace, so agreement here is independent evidence.
   Writes johannesbergbuild/terrain-check.json (the numbers) and, under
   cache/terrain-check/, a hillshade of the window with every ring drawn and a
   contact sheet of every green at 4x.
     node johannesbergbuild/terrain-check.mjs                                    */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { readChunk } from '../packages/course-v2/chunk-node.mjs';
import { decodeTerrainGrid } from '../packages/course-v2/terrain-grid.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PUB = path.join(ROOT, 'apps/golf/public');
const read = url => fs.readFileSync(path.join(PUB, url));
const root = JSON.parse(read('courses/v2-index.json').toString('utf8'));
const entry = root.courses.find(c => c.slug === 'johannesberg');
const course = JSON.parse(read(entry.manifest.url).toString('utf8'));
const ground = JSON.parse(read(course.groundManifest.url).toString('utf8'));
const l0 = ground.tiles.filter(t => t.lod === 0);
const E0 = Math.min(...l0.map(t => t.bounds.minEasting)), E1 = Math.max(...l0.map(t => t.bounds.maxEasting));
const N0 = Math.min(...l0.map(t => t.bounds.minNorthing)), N1 = Math.max(...l0.map(t => t.bounds.maxNorthing));
const W = Math.round(E1 - E0) + 1, H = Math.round(N1 - N0) + 1;
const Hgt = new Float32Array(W * H).fill(NaN);
for (const t of l0) {
  const chunk = readChunk(read(t.layers.terrain.url));
  const g = chunk.header.grid, hs = decodeTerrainGrid(chunk.payload, g);
  const x0 = Math.round(t.bounds.minEasting - E0), y0 = Math.round(N1 - t.bounds.maxNorthing);
  for (let r = 0; r < g.height; r++) for (let c = 0; c < g.width; c++) {
    const X = x0 + Math.round(c * g.sampleSpacingMetres), Y = y0 + Math.round(r * g.sampleSpacingMetres);
    if (X >= 0 && Y >= 0 && X < W && Y < H) Hgt[Y * W + X] = hs[r * g.width + c];
  }
}
const at = (e, n) => { const x = e - E0, y = N1 - n; const c = Math.floor(x), r = Math.floor(y); if (c < 0 || r < 0 || c >= W - 1 || r >= H - 1) return NaN; const fx = x - c, fy = y - r; const h = (rr, cc) => Hgt[rr * W + cc]; return (h(r, c) * (1 - fx) + h(r, c + 1) * fx) * (1 - fy) + (h(r + 1, c) * (1 - fx) + h(r + 1, c + 1) * fx) * fy; };
console.log(`window E ${E0}..${E1} N ${N0}..${N1}: ${W}x${H} samples from ${l0.length} l0 tiles; finite ${Array.from(Hgt).filter(Number.isFinite).length}`);

/* --- the rings, in EPSG:3006 from the committed migration ------------------------------ */
const mig18 = JSON.parse(fs.readFileSync(path.join(ROOT, 'geo_data/course-v2/johannesberg/migration/course-model.epsg3006.json'), 'utf8')).geometry;
const mig9 = JSON.parse(fs.readFileSync(path.join(ROOT, 'geo_data/course-v2/johannesberg/migration/nine-course-model.epsg3006.json'), 'utf8')).geometry;
const pip = (x, y, ring) => { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside; } return inside; };
const dRing = (x, y, ring) => { let d = Infinity; for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; const dx = b[0] - a[0], dy = b[1] - a[1]; const L2 = dx * dx + dy * dy || 1; let t = ((x - a[0]) * dx + (y - a[1]) * dy) / L2; t = Math.max(0, Math.min(1, t)); d = Math.min(d, Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t)); } return d; };
const cen = r => [r.reduce((a, p) => a + p[0], 0) / r.length, r.reduce((a, p) => a + p[1], 0) / r.length];
/* sample sets around a ring at a given shift of the RING (positive = ring moved east/north) */
function stats(ring, shiftE, shiftN, inner, outer) {
  const R = ring.map(([e, n]) => [e + shiftE, n + shiftN]);
  const es = R.map(p => p[0]), ns = R.map(p => p[1]);
  const e0 = Math.floor(Math.min(...es) - outer - 1), e1 = Math.ceil(Math.max(...es) + outer + 1), n0 = Math.floor(Math.min(...ns) - outer - 1), n1 = Math.ceil(Math.max(...ns) + outer + 1);
  const ins = [], col = [];
  for (let n = n0; n <= n1; n++) for (let e = e0; e <= e1; e++) {
    const h = at(e + 0.5, n + 0.5); if (!Number.isFinite(h)) continue;
    if (pip(e + 0.5, n + 0.5, R)) ins.push(h); else { const d = dRing(e + 0.5, n + 0.5, R); if (d >= inner && d <= outer) col.push(h); }
  }
  const mean = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);
  const mi = mean(ins), mc = mean(col);
  const sd = Math.sqrt(mean(ins.map(v => (v - mi) ** 2)));
  return { n: ins.length, inside: mi, collar: mc, sd, delta: mi - mc };
}
function bestShift(ring, inner, outer, sign, key = 'delta') {
  let best = { d: -Infinity, se: 0, sn: 0 };
  for (let se = -8; se <= 8; se++) for (let sn = -8; sn <= 8; sn++) { const s = stats(ring, se, sn, inner, outer); const v = sign * s[key]; if (v > best.d) best = { d: v, se, sn }; }
  best.interior = Math.abs(best.se) < 8 && Math.abs(best.sn) < 8;
  return best;
}
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const medShift = shifts => { const s = shifts.filter(x => x.interior); return { n: s.length, of: shifts.length, east: med(s.map(x => x.se)), north: med(s.map(x => x.sn)) }; };
const r2 = v => Math.round(v * 100) / 100;
const out = { checkedOn: new Date().toISOString().slice(0, 10), window: { E0, E1, N0, N1 }, courses: {} };
for (const [slug, mig] of [['johannesberg', mig18], ['johannesberg-9', mig9]]) {
  const holes = [];
  for (const h of mig.holes) {
    const g = stats(h.green.ring, 0, 0, 4, 10), gb = bestShift(h.green.ring, 4, 10, +1), gf = bestShift(h.green.ring, 4, 10, -1, 'sd');
    const tees = h.tees.pads.map(p => { const s = stats(p.ring, 0, 0, 3, 8); return { raise: r2(s.delta), sd: r2(s.sd), n: s.n }; });
    const bunkers = h.bunkers.map(b => { const s = stats(b.ring, 0, 0, 2, 6), bs = bestShift(b.ring, 2, 6, -1); return { depth: r2(-s.delta), n: s.n, area: b.ring.length ? Math.round(Math.abs(b.ring.reduce((a, p, i) => { const q = b.ring[(i + 1) % b.ring.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2)) : 0, bestShift: [bs.se, bs.sn], depthAtBest: r2(bs.d), _bs: bs }; });
    const tee = h.line[0], gc = h.green.c;
    holes.push({ n: h.n, prov: h.green.prov, green: { raise: r2(g.delta), sd: r2(g.sd), n: g.n, bestShift: [gb.se, gb.sn], raiseAtBest: r2(gb.d), flattestShift: [gf.se, gf.sn], sdAtFlattest: r2(-gf.d), _gb: gb, _gf: gf },
      elevTee: r2(at(tee[0], tee[1])), elevGreen: r2(at(gc[0], gc[1])), tees, bunkers });
  }
  const gRaise = medShift(holes.map(h => h.green._gb)), gFlat = medShift(holes.map(h => h.green._gf)), bPit = medShift(holes.flatMap(h => h.bunkers.map(b => b._bs)));
  for (const h of holes) { delete h.green._gb; delete h.green._gf; for (const b of h.bunkers) delete b._bs; }
  out.courses[slug] = { holes,
    summary: { greens: holes.length, greenRaiseMedian: r2(med(holes.map(h => h.green.raise))), greenRaised: holes.filter(h => h.green.raise > 0.1).length,
      greenSdMedian: r2(med(holes.map(h => h.green.sd))), greenRaiseShift: gRaise, greenFlattestShift: gFlat,
      bunkers: holes.flatMap(h => h.bunkers).length, bunkerDepthMedian: r2(med(holes.flatMap(h => h.bunkers.map(b => b.depth)))), bunkersAsPits: holes.flatMap(h => h.bunkers).filter(b => b.depth > 0.15).length,
      bunkerPitShift: bPit,
      teePads: holes.flatMap(h => h.tees).length, teeSdMedian: r2(med(holes.flatMap(h => h.tees.map(t => t.sd)))) } };
  console.log(`\n${slug}: ${JSON.stringify(out.courses[slug].summary)}`);
  if (slug === 'johannesberg') {
    /* water: every ring of the model that lies in the window */
    const water = [];
    for (const w of mig.water) {
      const es = w.ring.map(p => p[0]), ns = w.ring.map(p => p[1]);
      const inWin = Math.min(...es) > E0 && Math.max(...es) < E1 && Math.min(...ns) > N0 && Math.max(...ns) < N1;
      if (!inWin) { water.push({ id: w.id, name: w.name, inWindow: false }); continue; }
      const s = stats(w.ring, 0, 0, 3, 10), bs = bestShift(w.ring, 3, 10, -1);
      water.push({ id: w.id, name: w.name, area: w.area, modelLevel: w.level, inWindow: true, laserInside: r2(s.inside), laserSd: r2(s.sd), bankRise: r2(-s.delta), n: s.n, bestShift: [bs.se, bs.sn], bankAtBest: r2(bs.d), _bs: bs });
    }
    const wIn = water.filter(w => w.inWindow);
    out.water = { rings: water.map(w => { const c = { ...w }; delete c._bs; return c; }), summary: { inWindow: wIn.length, flat: wIn.filter(w => w.laserSd < 0.15).length, banked: wIn.filter(w => w.bankRise > 0.2).length, sdMedian: r2(med(wIn.map(w => w.laserSd))), bankShift: medShift(wIn.map(w => w._bs)), modelMinusLaserMedian: r2(med(wIn.filter(w => w.modelLevel != null).map(w => w.modelLevel - w.laserInside))) } };
    console.log(`water: ${JSON.stringify(out.water.summary)}`);
    for (const w of wIn) console.log(`  ${String(w.id).padEnd(16)} ${String(w.name || '').padEnd(8)} ${String(w.area).padStart(7)} m²  laser ${w.laserInside} m sd ${w.laserSd}  bank +${w.bankRise} m  best shift ${w.bestShift} (${w.bankAtBest})  model level ${w.modelLevel}`);
  }
  for (const h of holes) console.log(`  hole ${String(h.n).padStart(2)} ${h.prov.padEnd(5)} green raise ${String(h.green.raise).padStart(5)} m sd ${h.green.sd} best shift ${h.green.bestShift} (${h.green.raiseAtBest}) | tee->green ${h.elevTee}->${h.elevGreen} | bunkers ${h.bunkers.map(b => `${b.depth}m@${b.bestShift}`).join(' ') || '-'}`);
}
fs.writeFileSync(path.join(HERE, 'terrain-check.json'), JSON.stringify(out, null, 1) + '\n');

/* --- hillshade + rings, and a green contact sheet --------------------------------------- */
const shade = new Uint8ClampedArray(W * H);
const az = 315 * Math.PI / 180, alt = 45 * Math.PI / 180;
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  const i = y * W + x; const dzdx = (Hgt[i + 1] - Hgt[i - 1]) / 2, dzdy = (Hgt[i + W] - Hgt[i - W]) / 2;
  if (!Number.isFinite(dzdx + dzdy)) { shade[i] = 0; continue; }
  const slope = Math.atan(2.0 * Math.hypot(dzdx, dzdy)), aspect = Math.atan2(dzdy, -dzdx);
  const v = Math.sin(alt) * Math.cos(slope) + Math.cos(alt) * Math.sin(slope) * Math.cos(az - aspect);
  shade[i] = Math.max(0, Math.min(255, 255 * v));
}
const OUT = path.join(HERE, 'cache', 'terrain-check'); fs.mkdirSync(OUT, { recursive: true });
const toPx = ([e, n]) => [e - E0, N1 - n];
const rings = { greens: [...mig18.holes, ...mig9.holes].map(h => ({ n: h.n, slug: h.n, ring: h.green.ring.map(toPx), c: toPx(h.green.c) })), tees: [...mig18.holes, ...mig9.holes].flatMap(h => h.tees.pads.map(p => p.ring.map(toPx))), bunkers: [...mig18.holes, ...mig9.holes].flatMap(h => h.bunkers.map(b => b.ring.map(toPx))), fair: [...mig18.holes, ...mig9.holes].flatMap(h => h.fairway.rings.map(r => r.map(toPx))), lines: [...mig18.holes, ...mig9.holes].map(h => h.line.map(toPx)) };
const browser = await chromium.launch({ executablePath: process.env.BANVY_CHROME || undefined, headless: true });
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas><canvas id=s></canvas>');
let b64 = ''; for (let i = 0; i < shade.length; i += 0x8000) b64 += String.fromCharCode.apply(null, shade.subarray(i, i + 0x8000));
const pngs = await page.evaluate(async ({ W, H, shade64, rings, labels18 }) => {
  const c = document.getElementById('c'); c.width = W; c.height = H; const g = c.getContext('2d');
  const sh = atob(shade64); const img = g.createImageData(W, H); for (let i = 0; i < W * H; i++) { const v = sh.charCodeAt(i); img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  const poly = (r, stroke, w = 1.2) => { g.beginPath(); r.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.lineWidth = w; g.strokeStyle = stroke; g.stroke(); };
  for (const r of rings.fair) poly(r, 'rgba(120,220,120,0.8)');
  for (const r of rings.tees) poly(r, 'rgba(255,230,0,0.95)');
  for (const gr of rings.greens) poly(gr.ring, 'rgba(0,230,255,1)', 1.6);
  for (const r of rings.bunkers) poly(r, 'rgba(255,80,255,1)', 1.6);
  g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 0.8; for (const l of rings.lines) { g.beginPath(); l.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke(); }
  const whole = c.toDataURL('image/png');
  /* contact sheet: 70 m crops at 4x, six per row */
  const S = 70, Z = 4, cols = 6, n = rings.greens.length, rows = Math.ceil(n / cols);
  const s = document.getElementById('s'); s.width = cols * S * Z; s.height = rows * S * Z; const gs = s.getContext('2d'); gs.imageSmoothingEnabled = false;
  rings.greens.forEach((gr, k) => {
    const [cx, cy] = gr.c; const ox = (k % cols) * S * Z, oy = Math.floor(k / cols) * S * Z;
    gs.drawImage(c, cx - S / 2, cy - S / 2, S, S, ox, oy, S * Z, S * Z);
    gs.fillStyle = 'white'; gs.font = 'bold 20px sans-serif'; gs.fillText(labels18[k], ox + 6, oy + 24);
    gs.strokeStyle = 'rgba(255,255,255,0.5)'; gs.strokeRect(ox, oy, S * Z, S * Z);
  });
  return { whole, sheet: s.toDataURL('image/png') };
}, { W, H, shade64: btoa(b64), rings, labels18: [...mig18.holes.map(h => `18: ${h.n}`), ...mig9.holes.map(h => `9: ${h.n}`)] });
await browser.close();
fs.writeFileSync(path.join(OUT, 'hillshade-rings.png'), Buffer.from(pngs.whole.split(',')[1], 'base64'));
fs.writeFileSync(path.join(OUT, 'greens-sheet.png'), Buffer.from(pngs.sheet.split(',')[1], 'base64'));
console.log(`\nwrote johannesbergbuild/terrain-check.json, cache/terrain-check/hillshade-rings.png (${W}x${H}) and greens-sheet.png`);
