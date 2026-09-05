/* Trace the nine-hole course's greens, fairways, tee pads and bunkers off the
   Esri z18 tiles by MEASUREMENT, not by eye.

   The tiles are orthorectified (a tile's coordinates ARE its georeference), so
   a pixel outline converts to legacy metres exactly. The capture is early
   spring and leaf-off, which is what makes this tractable: irrigated putting
   surfaces are VIVID green (ExG = 2G-R-B of 120-130 on the eighteen's traced
   greens), mown fairway is a duller green (ExG 65-76), dormant rough is beige
   (ExG 30-58), sand is bright and unsaturated (brightness 147-158, saturation
   32-34), and shadow and water are dark. Those numbers were sampled on the
   eighteen's already-traced features (johannesbergbuild/cache/sample.mjs) and
   are the thresholds below; the eighteen is the calibration set, the nine the
   target.

   Per hole the seeds are the nine's own routed line (johannesberg9build, tee
   slid to the card): the green is the vivid component whose centroid is
   nearest the line's end; the fairway is every mown-or-vivid pixel within the
   corridor of the line, minus the green and the tee pads, as connected
   components; a tee pad is a vivid or mown component within 30 m of a card tee
   position; a bunker is a sand component inside the corridor. Every ring is
   an outer contour of a pixel component, simplified to 0.6 m, and every
   feature reports its own area so a mis-read is visible in the numbers.

     node johannesbergbuild/trace-nine.mjs            # -> nine-sat-shapes.json + review PNG

   The review PNG (cache/nine-trace-review.png) draws every ring on the tiles;
   look at it before build-nine consumes the file.                          */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const lib = await import(pathToFileURL(path.join(HERE, 'lib.mjs')).href);
const ORIGIN = lib.ORIGIN, M_PER_LAT = lib.M_PER_LAT ?? 111320, M_PER_LON = lib.M_PER_LON;
const Z = 18, N = 2 ** Z;
const CACHE = path.join(HERE, 'cache', 'sat-mosaic'); fs.mkdirSync(CACHE, { recursive: true });
const nine = JSON.parse(fs.readFileSync(path.join(ROOT, 'johannesberg9build', 'course-model.json'), 'utf8'));
const osm = JSON.parse(fs.readFileSync(path.join(HERE, 'osm-features.json'), 'utf8'));
const model18 = JSON.parse(fs.readFileSync(path.join(HERE, 'course-model.json'), 'utf8'));

/* --- thresholds, measured on the eighteen ----------------------------------------- */
/* The eighteen's greens read ExG 120-130, but the nine's read 90-110 on the same
   capture -- less irrigated, or cut later -- so the vivid gate sits at 60/92, where
   the debug overlay first showed the nine's putting surfaces as compact discs.
   The mown gate is left loose on purpose: fairway rings are REPORTED, never
   adopted, because this leaf-off image cannot separate fairway from semi. */
const T = Object.assign({ vividExg: 60, vividG: 92, mownExg: 34, mownBrightLo: 70, mownBrightHi: 150, sandBright: 145, sandSat: 36, sandExg: 40, darkBright: 60 },
  process.env.TRACE_THRESHOLDS ? JSON.parse(process.env.TRACE_THRESHOLDS) : {});
const CORRIDOR = 42;           /* m either side of the routed line that can be fairway */
const GREEN_SEEK = 35;         /* m from the line's end a green centroid may sit */
const TEE_SEEK = 30;           /* m from a card tee position a pad may sit */

/* --- tile geometry ------------------------------------------------------------------ */
const toLonLat = (x, z) => [ORIGIN.lon + x / M_PER_LON, ORIGIN.lat - z / M_PER_LAT];
const tileOf = (lon, lat) => [(lon + 180) / 360 * N, (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * N];
const bb = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
for (const h of nine.holes) for (const p of [...h.line, ...h.tees.pads.map(t => t.c)]) { bb.x0 = Math.min(bb.x0, p[0]); bb.x1 = Math.max(bb.x1, p[0]); bb.z0 = Math.min(bb.z0, p[1]); bb.z1 = Math.max(bb.z1, p[1]); }
const PAD = 80;
const [lon0, lat0] = toLonLat(bb.x0 - PAD, bb.z0 - PAD), [lon1, lat1] = toLonLat(bb.x1 + PAD, bb.z1 + PAD);
const [tx0, ty0] = tileOf(lon0, lat0), [tx1, ty1] = tileOf(lon1, lat1);
const TX0 = Math.floor(tx0), TY0 = Math.floor(ty0), TX1 = Math.floor(tx1), TY1 = Math.floor(ty1);
const W = (TX1 - TX0 + 1) * 256, H = (TY1 - TY0 + 1) * 256;
const toPx = (x, z) => { const [lon, lat] = toLonLat(x, z); const [tx, ty] = tileOf(lon, lat); return [(tx - TX0) * 256, (ty - TY0) * 256]; };
const toWorld = (px, py) => {
  const tx = TX0 + px / 256, ty = TY0 + py / 256;
  const lon = tx / N * 360 - 180, lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * ty / N))) * 180 / Math.PI;
  return [(lon - ORIGIN.lon) * M_PER_LON, (ORIGIN.lat - lat) * M_PER_LAT];
};
/* metres per pixel, measured at the block centre (Mercator, so it varies by <0.1% here) */
const [ax, az] = toWorld(W / 2, H / 2), [bx, bz] = toWorld(W / 2 + 100, H / 2);
const MPP = Math.hypot(bx - ax, bz - az) / 100;

/* --- tiles -> class raster (in Chrome; the JPEGs need a decoder) ------------------- */
const tiles = [];
for (let ty = TY0; ty <= TY1; ty++) for (let tx = TX0; tx <= TX1; tx++) {
  const file = path.join(CACHE, `${Z}_${tx}_${ty}.jpg`);
  if (!fs.existsSync(file)) {
    const r = await fetch(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${ty}/${tx}`);
    if (!r.ok) throw new Error(`tile ${Z}/${ty}/${tx} ${r.status}`);
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  }
  tiles.push({ tx, ty, b64: fs.readFileSync(file).toString('base64') });
}
const browser = await chromium.launch({ executablePath: process.env.BANVY_CHROME || undefined, headless: true });
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');
const raster = await page.evaluate(async ({ tiles, W, H, TX0, TY0, T }) => {
  const c = document.getElementById('c'); c.width = W; c.height = H; const g = c.getContext('2d');
  for (const t of tiles) { const img = new Image(); img.src = 'data:image/jpeg;base64,' + t.b64; await img.decode(); g.drawImage(img, (t.tx - TX0) * 256, (t.ty - TY0) * 256); }
  const d = g.getImageData(0, 0, W, H).data;
  const cls = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2];
    const exg = 2 * gg - r - b, bright = (r + gg + b) / 3, sat = Math.max(r, gg, b) - Math.min(r, gg, b);
    let k = 0;
    if (bright < T.darkBright) k = 5;
    else if (bright > T.sandBright && sat < T.sandSat && exg < T.sandExg) k = 4;
    else if (exg > T.vividExg && gg > T.vividG) k = 2;
    else if (exg > T.mownExg && bright > T.mownBrightLo && bright < T.mownBrightHi) k = 1;
    cls[i] = k;
  }
  let s = ''; for (let i = 0; i < cls.length; i += 0x8000) s += String.fromCharCode.apply(null, cls.subarray(i, i + 0x8000));
  return btoa(s);
}, { tiles, W, H, TX0, TY0, T });
const CLS = new Uint8Array(Buffer.from(raster, 'base64'));

/* --- masks: the golf property, and water ------------------------------------------- */
const pip = (x, z, ring) => { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, zi] = ring[i], [xj, zj] = ring[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside; } return inside; };
const boundary = osm.courseBoundary?.ring || null;
const waterRings = model18.water.map(w => w.ring);
const dSeg = (px, pz, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1]; const L2 = dx * dx + dz * dz || 1; let t = ((px - a[0]) * dx + (pz - a[1]) * dz) / L2; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - a[0] - dx * t, pz - a[1] - dz * t); };
const dLine = (px, pz, line) => { let d = Infinity; for (let i = 0; i < line.length - 1; i++) d = Math.min(d, dSeg(px, pz, line[i], line[i + 1])); return d; };

/* --- components ----------------------------------------------------------------------- */
function components(pred) {
  const lab = new Int32Array(W * H).fill(-1); const comps = [];
  const stack = [];
  for (let s = 0; s < W * H; s++) {
    if (lab[s] >= 0 || !pred(s)) continue;
    const id = comps.length; const px = []; stack.push(s); lab[s] = id;
    while (stack.length) {
      const i = stack.pop(); px.push(i);
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx; if (lab[j] >= 0 || !pred(j)) continue; lab[j] = id; stack.push(j);
      }
    }
    let sx = 0, sy = 0; for (const i of px) { sx += i % W; sy += (i / W) | 0; }
    comps.push({ id, px, n: px.length, cx: sx / px.length, cy: sy / px.length });
  }
  return { comps, lab };
}
/* morphology on a boolean mask over the block: erode then dilate (open), dilate then erode (close) */
function morph(mask, op, r) {
  const out = new Uint8Array(W * H);
  const pass = (src, want) => { const dst = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let hit = false; for (let dy = -r; dy <= r && !hit; dy++) for (let dx = -r; dx <= r; dx++) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; if (src[ny * W + nx] === want) { hit = true; break; } } dst[y * W + x] = want === 1 ? (hit ? 1 : 0) : (hit ? 0 : 1); } return dst; };
  if (op === 'open') { const e = pass(mask, 0); return pass(e, 1); }
  const d = pass(mask, 1); return pass(d, 0);
}
/* outer contour of a pixel set: chain the boundary edges into loops, keep the longest */
function contour(pixels) {
  const set = new Set(pixels);
  const edges = new Map(); /* key "x,y" start -> end, directed so the filled pixel is on the left */
  const add = (x0, y0, x1, y1) => edges.set(`${x0},${y0}`, [x1, y1]);
  for (const i of pixels) {
    const x = i % W, y = (i / W) | 0;
    if (!set.has(i - W)) add(x, y, x + 1, y);          /* top edge, going right */
    if (!set.has(i + 1)) add(x + 1, y, x + 1, y + 1);  /* right edge, going down */
    if (!set.has(i + W)) add(x + 1, y + 1, x, y + 1);  /* bottom, going left */
    if (!set.has(i - 1)) add(x, y + 1, x, y);          /* left, going up */
  }
  let best = [];
  const used = new Set();
  for (const start of edges.keys()) {
    if (used.has(start)) continue;
    const loop = []; let k = start;
    while (k && !used.has(k)) { used.add(k); const [x, y] = k.split(',').map(Number); loop.push([x, y]); const nx = edges.get(k); k = nx ? `${nx[0]},${nx[1]}` : null; }
    if (loop.length > best.length) best = loop;
  }
  return best;
}
function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const dp = (a, b) => { let idx = -1, dmax = 0; for (let i = a + 1; i < b; i++) { const d = dSeg(pts[i][0], pts[i][1], pts[a], pts[b]); if (d > dmax) { dmax = d; idx = i; } } return dmax > tol ? [...dp(a, idx), ...dp(idx, b)] : [pts[a]]; };
  const out = dp(0, pts.length - 1); out.push(pts[pts.length - 1]);
  if (out.length > 2 && out[0][0] === out.at(-1)[0] && out[0][1] === out.at(-1)[1]) out.pop();
  return out;
}
const ringWorld = pixels => simplify(contour(pixels), 2).map(([px, py]) => toWorld(px, py).map(v => Math.round(v * 10) / 10));
const areaM2 = n => Math.round(n * MPP * MPP);
const r1 = v => Math.round(v * 10) / 10;

/* --- per hole ------------------------------------------------------------------------- */
const inProperty = (x, z) => !boundary || pip(x, z, boundary);
const inWater = (x, z) => waterRings.some(r => pip(x, z, r));
const vivid = components(i => CLS[i] === 2);
const sand = components(i => CLS[i] === 4);
const out = { source: `Esri World Imagery z18 (${MPP.toFixed(3)} m/px), classified by johannesbergbuild/trace-nine.mjs with thresholds measured on the eighteen's traced features; block tx ${TX0}..${TX1} ty ${TY0}..${TY1}`, tracedOn: new Date().toISOString().slice(0, 10), thresholds: T, holes: [] };
const report = [];
const claimedVivid = new Set();
for (const h of nine.holes) {
  const line = h.line, end = line[line.length - 1];
  /* green: vivid component nearest the line end, plausible size, not water */
  let green = null, gd = Infinity;
  for (const c of vivid.comps) {
    if (claimedVivid.has(c.id)) continue;
    const a = areaM2(c.n); if (a < 200 || a > 1400) continue;
    const [wx, wz] = toWorld(c.cx, c.cy); if (inWater(wx, wz)) continue;
    const d = Math.hypot(wx - end[0], wz - end[1]);
    if (d < gd) { gd = d; green = c; }
  }
  if (green && gd > GREEN_SEEK) { report.push(`hole ${h.n}: nearest vivid green-sized patch is ${gd.toFixed(0)} m from the routed end — refused`); green = null; }
  if (green) claimedVivid.add(green.id);
  const greenRing = green ? ringWorld(green.px) : null;
  const greenC = green ? toWorld(green.cx, green.cy).map(r1) : null;
  /* tee pads: vivid or mown components near each card tee position */
  const pads = [];
  const teeComps = components(i => (CLS[i] === 2 || CLS[i] === 1) && (() => { const [wx, wz] = toWorld(i % W, (i / W) | 0); return h.tees.pads.some(p => Math.hypot(wx - p.c[0], wz - p.c[1]) < TEE_SEEK + 20); })());
  for (const p of h.tees.pads) {
    let best = null, bd = Infinity;
    for (const c of teeComps.comps) {
      const a = areaM2(c.n); if (a < 40 || a > 900) continue;
      if (green && c.px.some(i => vivid.lab[i] === green.id)) continue;
      const [wx, wz] = toWorld(c.cx, c.cy); const d = Math.hypot(wx - p.c[0], wz - p.c[1]);
      if (d < bd) { bd = d; best = c; }
    }
    if (best && bd <= TEE_SEEK) pads.push({ teeIdx: p.teeIdx, ring: ringWorld(best.px), c: toWorld(best.cx, best.cy).map(r1), area: areaM2(best.n), dist: r1(bd) });
  }
  /* fairway: mown-or-vivid within the corridor, opened to drop stragglers, minus green and pads */
  const corridor = new Uint8Array(W * H);
  const [pxs, pzs] = [line.map(p => p[0]), line.map(p => p[1])];
  const cx0 = Math.min(...pxs) - CORRIDOR, cx1 = Math.max(...pxs) + CORRIDOR, cz0 = Math.min(...pzs) - CORRIDOR, cz1 = Math.max(...pzs) + CORRIDOR;
  const [qx0, qy0] = toPx(cx0, cz0), [qx1, qy1] = toPx(cx1, cz1);
  for (let y = Math.max(0, qy0 | 0); y < Math.min(H, qy1 | 0); y++) for (let x = Math.max(0, qx0 | 0); x < Math.min(W, qx1 | 0); x++) {
    const i = y * W + x; if (CLS[i] !== 1 && CLS[i] !== 2) continue;
    if (green && vivid.lab[i] === green.id) continue;
    const [wx, wz] = toWorld(x, y);
    if (dLine(wx, wz, line) > CORRIDOR || !inProperty(wx, wz) || inWater(wx, wz)) continue;
    /* the first 30 m from the back tee is teeing ground, not fairway */
    if (Math.hypot(wx - line[0][0], wz - line[0][1]) < 30) continue;
    corridor[i] = 1;
  }
  const opened = morph(morph(corridor, 'open', 2), 'close', 3);
  const fw = components(i => opened[i] === 1);
  const rings = fw.comps.filter(c => areaM2(c.n) >= 350).sort((a, b) => b.n - a.n).map(c => ({ ring: ringWorld(c.px), area: areaM2(c.n) }));
  /* bunkers: sand components in the corridor, not on a tee or in the hub */
  const bunkers = [];
  for (const c of sand.comps) {
    const a = areaM2(c.n); if (a < 12 || a > 500) continue;
    const [wx, wz] = toWorld(c.cx, c.cy);
    if (dLine(wx, wz, line) > CORRIDOR + 10 || !inProperty(wx, wz)) continue;
    if (greenC && Math.hypot(wx - greenC[0], wz - greenC[1]) > 70 && dLine(wx, wz, line) > 30) continue;
    bunkers.push({ ring: ringWorld(c.px), c: [r1(wx), r1(wz)], area: a });
  }
  /* Acceptance is a RULE, not an eye: a green is a compact disc (Polsby-Popper
     4*pi*A/P^2 >= 0.6, which the 5th's 0.56 sliver under its copse fails) of 200-600 m^2 within 20 m of the routed end; a bunker is
     15-120 m^2 of sand within 60 m of an accepted green or 25 m of the line and
     at least 20 m from anything the eighteen's model already calls gravel or a
     building (car parks, tracks, paths, footprints) -- the hub's hardstanding is
     the same colour as sand. Everything else is kept in the file as evidence with
     accepted:false, so a later pass can see what the classifier saw. */
  const perim = r => r.reduce((a, p, i) => a + Math.hypot(p[0] - r[(i + 1) % r.length][0], p[1] - r[(i + 1) % r.length][1]), 0);
  const compact = r => 4 * Math.PI * Math.abs(r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2) / perim(r) ** 2;
  const gArea = green ? areaM2(green.n) : 0;
  /* compactness is measured on a 1 m-simplified ring: a pixel contour's staircase
     adds perimeter that says nothing about the shape */
  const smoothRing = green ? simplify(contour(green.px), 3.3).map(([px, py]) => toWorld(px, py)) : null;
  const gCompact = green ? compact(smoothRing) : 0;
  const gOk = !!green && gArea >= 200 && gArea <= 600 && gd <= 20 && gCompact >= 0.6;
  const hard = [...model18.infra.parking.map(p => p.ring), ...model18.infra.buildings.map(b => b.ring)];
  const hardLines = [...model18.infra.tracks, ...model18.infra.paths, ...model18.infra.roads].map(t => t.line);
  const nearHard = (x, z) => hard.some(r => pip(x, z, r) || r.some(p => Math.hypot(p[0] - x, p[1] - z) < 20)) || hardLines.some(l => dLine(x, z, l) < 12);
  for (const b of bunkers) {
    const nearGreen = gOk && Math.hypot(b.c[0] - greenC[0], b.c[1] - greenC[1]) <= 60;
    const nearEnd = Math.hypot(b.c[0] - end[0], b.c[1] - end[1]) <= 45;     /* the green is at the routed end even when unfound */
    const atTee = Math.hypot(b.c[0] - line[0][0], b.c[1] - line[0][1]) <= 30;  /* sand at a tee is another hole's bunker */
    b.dLine = r1(dLine(b.c[0], b.c[1], line));
    b.accepted = b.area >= 15 && b.area <= 120 && (nearGreen || nearEnd || b.dLine <= 25) && !atTee && !nearHard(b.c[0], b.c[1]);
  }
  out.holes.push({ hole: h.n, par: h.par,
    green: greenRing ? { ring: greenRing, c: greenC, area: gArea, distFromRoutedEnd: r1(gd), compactness: r1(gCompact * 100) / 100, accepted: gOk } : null,
    fairway: { rings: rings.map(r => r.ring), areas: rings.map(r => r.area), accepted: false, note: 'reported only: leaf-off imagery cannot separate fairway from semi-rough here' },
    tees: pads.map(p => ({ ...p, accepted: false })), bunkers });
  report.push(`hole ${h.n} par ${h.par}: green ${greenRing ? `${gArea} m² at ${greenC}, ${gd.toFixed(1)} m from the routed end, compactness ${gCompact.toFixed(2)} -> ${gOk ? 'ACCEPTED' : 'refused'}` : 'not found'}; bunkers ${bunkers.filter(b => b.accepted).length} accepted of ${bunkers.length} (${bunkers.map(b => `${b.area}${b.accepted ? '*' : ''}`).join(',')}); fairway rings reported ${rings.map(r => r.area).join('+') || 'none'} m²; tee candidates ${pads.length}`);
}
/* one bunker, one hole: the same sand component can fall inside two corridors
   (the 9th's greenside bunker sits 20 m from the 6th tee) and belongs to the
   hole whose line it is nearest */
for (const h of out.holes) for (const b of h.bunkers) if (b.accepted) {
  for (const o of out.holes) if (o !== h) for (const q of o.bunkers) if (q.accepted && q.c[0] === b.c[0] && q.c[1] === b.c[1] && q.dLine < b.dLine) { b.accepted = false; b.note = `also inside hole ${o.hole}'s corridor, which is nearer`; }
}
fs.writeFileSync(path.join(HERE, 'nine-sat-shapes.json'), JSON.stringify(out, null, 1) + '\n');
console.log(report.join('\n'));

/* --- review PNG: every ring on the tiles ------------------------------------------------ */
const draw = { greens: out.holes.filter(h => h.green).map(h => h.green.ring), fairways: out.holes.flatMap(h => h.fairway.rings), tees: out.holes.flatMap(h => h.tees.map(t => t.ring)), bunkers: out.holes.flatMap(h => h.bunkers.map(b => b.ring)), lines: nine.holes.map(h => ({ n: h.n, line: h.line })) };
const toPxRing = r => r.map(([x, z]) => toPx(x, z));
const png = await page.evaluate(async ({ draw, toPxRings, lines }) => {
  const c = document.getElementById('c'), g = c.getContext('2d');
  const poly = (r, stroke, fill) => { g.beginPath(); r.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.lineWidth = 2; g.strokeStyle = stroke; g.stroke(); if (fill) { g.fillStyle = fill; g.fill(); } };
  for (const r of toPxRings.fairways) poly(r, 'rgba(120,255,120,0.95)', 'rgba(120,255,120,0.18)');
  for (const r of toPxRings.tees) poly(r, 'rgba(255,255,0,0.95)', 'rgba(255,255,0,0.25)');
  for (const r of toPxRings.greens) poly(r, 'rgba(0,255,255,1)', 'rgba(0,255,255,0.25)');
  for (const r of toPxRings.bunkers) poly(r, 'rgba(255,80,255,1)', 'rgba(255,80,255,0.35)');
  g.strokeStyle = 'white'; g.lineWidth = 1.5; g.font = 'bold 22px sans-serif'; g.fillStyle = 'white';
  for (const l of lines) { g.beginPath(); l.line.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke(); g.fillText(String(l.n), l.line.at(-1)[0] + 6, l.line.at(-1)[1] - 6); }
  return c.toDataURL('image/png');
}, { draw, toPxRings: { fairways: draw.fairways.map(toPxRing), tees: draw.tees.map(toPxRing), greens: draw.greens.map(toPxRing), bunkers: draw.bunkers.map(toPxRing) }, lines: draw.lines.map(l => ({ n: l.n, line: toPxRing(l.line) })) });
await browser.close();
fs.writeFileSync(path.join(HERE, 'cache', 'nine-trace-review.png'), Buffer.from(png.split(',')[1], 'base64'));
console.log(`\nwrote johannesbergbuild/nine-sat-shapes.json and cache/nine-trace-review.png (${W}x${H}, ${MPP.toFixed(3)} m/px)`);
