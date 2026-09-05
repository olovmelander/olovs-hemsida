#!/usr/bin/env node
/* Measure the bunkers instead of placing them by formula.

   Sand is the one played-surface feature that is genuinely separable in Esri
   z18 imagery: bright, low-saturation, slightly warm pixels against grass. This
   composes the tiles over the course at native resolution (~0.3 m/px), classifies
   sand pixels, grows connected components, and converts each component's
   centroid, area and principal axes to frame metres through the exact per-pixel
   georeference (tile -> WGS84 -> EPSG:3006 -> local, the repo's Krüger series).

   Candidates are then filtered to the played ground (near a hole line or green,
   not inside water) and written for review; the eye decides sand from dry grass
   on the overlay, the pixels decide WHERE it is.

   usage:
     node ribbingsforsbuild/detect-sand.mjs --probe "x,z;x,z;…"    # mean RGB at world points
     node ribbingsforsbuild/detect-sand.mjs                         # -> cache/sand-candidates.json + overlay
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { sweref99TmToLatLon, latLonToSweref99Tm } from '../packages/course-geo/chmv2/projection.mjs';
import { distToLine, pointInPoly } from '../geobuild/lib.mjs';
import { FRAME } from './frame.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache', 'sat');
const OUT_DIR = path.join(HERE, 'cache');
const Z = 18;
/* One window over every hole: x -380..760, z -500..440 */
const WINDOW = { x0: -380, x1: 760, z0: -500, z1: 440 };
const argv = process.argv.slice(2);
const probeArg = argv.includes('--probe') ? argv[argv.indexOf('--probe') + 1] : null;

const n = 2 ** Z;
const toLatLon = (x, z) => sweref99TmToLatLon(FRAME.easting + x, FRAME.northing - z);
const tileOf = (lat, lon) => [(lon + 180) / 360 * n,
  (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n];
const fromTile = (tx, ty) => {
  const lon = tx / n * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * ty / n))) * 180 / Math.PI;
  return [lat, lon];
};
const corners = [[WINDOW.x0, WINDOW.z0], [WINDOW.x1, WINDOW.z0], [WINDOW.x0, WINDOW.z1], [WINDOW.x1, WINDOW.z1]]
  .map(([x, z]) => tileOf(...toLatLon(x, z)));
const tx0 = Math.min(...corners.map(c => c[0])), tx1 = Math.max(...corners.map(c => c[0]));
const ty0 = Math.min(...corners.map(c => c[1])), ty1 = Math.max(...corners.map(c => c[1]));
const X0 = Math.floor(tx0), X1 = Math.floor(tx1), Y0 = Math.floor(ty0), Y1 = Math.floor(ty1);
const W = (X1 - X0 + 1) * 256, H = (Y1 - Y0 + 1) * 256;
const px = (x, z) => { const [tx, ty] = tileOf(...toLatLon(x, z)); return [(tx - X0) * 256, (ty - Y0) * 256]; };
const world = (pxx, pxy) => {
  const [lat, lon] = fromTile(X0 + pxx / 256, Y0 + pxy / 256);
  const [e, nn] = latLonToSweref99Tm(lat, lon);
  return [e - FRAME.easting, FRAME.northing - nn];
};
/* ground metres per pixel at the window centre, measured through the mapping */
const [ax, az] = px(0, 0), [bx] = px(10, 0);
const M_PER_PX = 10 / (bx - ax);

fs.mkdirSync(CACHE, { recursive: true });
const tiles = [];
for (let ty = Y0; ty <= Y1; ty++) for (let tx = X0; tx <= X1; tx++) {
  const file = path.join(CACHE, `${Z}_${tx}_${ty}.jpg`);
  if (!fs.existsSync(file)) {
    const response = await fetch(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${ty}/${tx}`);
    if (!response.ok) throw new Error(`tile ${Z}/${ty}/${tx} ${response.status}`);
    fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  tiles.push({ tx, ty, b64: fs.readFileSync(file).toString('base64') });
}

const model = JSON.parse(fs.readFileSync(path.join(HERE, 'course-model.json'), 'utf8'));
const LINUX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  ...(fs.existsSync(LINUX_CHROME) ? { executablePath: LINUX_CHROME } : { channel: 'chrome' }), headless: true,
});
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');
await page.evaluate(async ({ tiles, W, H, X0, Y0 }) => {
  const canvas = document.getElementById('c'); canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  for (const tile of tiles) {
    const img = new Image(); img.src = 'data:image/jpeg;base64,' + tile.b64; await img.decode();
    g.drawImage(img, (tile.tx - X0) * 256, (tile.ty - Y0) * 256);
  }
  window.__g = g; window.__data = g.getImageData(0, 0, W, H).data;
}, { tiles, W, H, X0, Y0 });

const findArg = argv.includes('--find') ? argv[argv.indexOf('--find') + 1] : null;
if (findArg) {
  /* For each hypothesised bunker, find the brightest 5x5 patch within 18 m and
     report where it really is and what colour it has — the calibration the
     eyeballed coordinates cannot give. */
  const points = findArg.split(';').map(pair => pair.split(',').map(Number));
  const radiusPx = Math.round(18 / M_PER_PX);
  const pixels = points.map(([x, z]) => px(x, z).map(Math.round));
  const result = await page.evaluate(({ pixels, W, H, radiusPx }) => pixels.map(([cx, cy]) => {
    let best = null;
    for (let dy = -radiusPx; dy <= radiusPx; dy += 2) for (let dx = -radiusPx; dx <= radiusPx; dx += 2) {
      const x = cx + dx, y = cy + dy;
      if (x < 3 || y < 3 || x >= W - 3 || y >= H - 3) continue;
      let r = 0, g = 0, b = 0;
      for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
        const k = ((y + j) * W + (x + i)) * 4; r += window.__data[k]; g += window.__data[k + 1]; b += window.__data[k + 2];
      }
      r /= 25; g /= 25; b /= 25;
      const score = Math.min(r, g, b);
      if (!best || score > best.score) best = { score, x, y, rgb: [Math.round(r), Math.round(g), Math.round(b)] };
    }
    return best;
  }), { pixels, W, H, radiusPx });
  points.forEach((p, i) => {
    const b = result[i];
    const [wx, wz] = world(b.x, b.y);
    console.log(`(${p[0]},${p[1]}) -> brightest at (${wx.toFixed(1)},${wz.toFixed(1)}) [${Math.hypot(wx - p[0], wz - p[1]).toFixed(1)} m away] rgb ${b.rgb.join(',')} min ${b.score.toFixed(0)} R-B ${b.rgb[0] - b.rgb[2]} G-R ${b.rgb[1] - b.rgb[0]}`);
  });
  await browser.close();
  process.exit(0);
}

if (probeArg) {
  const points = probeArg.split(';').map(pair => pair.split(',').map(Number));
  const pixels = points.map(([x, z]) => px(x, z).map(Math.round));
  const result = await page.evaluate(({ pixels, W }) => pixels.map(([cx, cy]) => {
    let r = 0, g = 0, b = 0, k = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const i = ((cy + dy) * W + (cx + dx)) * 4; r += window.__data[i]; g += window.__data[i + 1]; b += window.__data[i + 2]; k++;
    }
    return [Math.round(r / k), Math.round(g / k), Math.round(b / k)];
  }), { pixels, W });
  points.forEach((p, i) => console.log(`(${p[0]},${p[1]}) rgb ${result[i].join(',')}  min ${Math.min(...result[i])} R-B ${result[i][0] - result[i][2]} G-R ${result[i][1] - result[i][0]}`));
  await browser.close();
  process.exit(0);
}

/* Sand classifier — thresholds calibrated with --probe (see the dossier §17):
   bright (min channel high), low saturation, warm-neutral (R >= G >= B, small
   spread). Grass fails on G-R; dry grass fails on min channel and spread;
   gravel/asphalt fails on warmth (R-B ~ 0) or brightness. */
/* Calibrated with --find on 19 known bunkers (2026-09-05): sand reads
   rgb 183–214 / 170–193 / 136–161 (min channel 136–161, R-B 42–54, G-R -9…-22);
   the dry-grass mound at (533,-409) reads 166,162,127 with G-R -4; the yard roof
   192,195,181 has G>R; the white house roof 222,219,208 has R-B 14. Warmth and
   brightness together are the separator. */
const SAND = {
  minChannel: +(process.env.SAND_MIN || 132),
  maxSpread: 75,
  minRB: +(process.env.SAND_MINRB || 30),
  maxGR: +(process.env.SAND_MAXGR || -6),
};
const components = await page.evaluate(({ W, H, SAND }) => {
  const d = window.__data;
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
    if (mn >= SAND.minChannel && (mx - mn) <= SAND.maxSpread && (r - b) >= SAND.minRB && (g - r) <= SAND.maxGR) mask[i] = 1;
  }
  const seen = new Uint8Array(W * H);
  const out = [];
  const stack = new Int32Array(W * H);
  for (let start = 0; start < W * H; start++) {
    if (!mask[start] || seen[start]) continue;
    let sp = 0; stack[sp++] = start; seen[start] = 1;
    let count = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sr = 0, sg = 0, sb = 0;
    let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    while (sp) {
      const i = stack[--sp];
      const x = i % W, y = (i / W) | 0;
      count++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      sr += d[i * 4]; sg += d[i * 4 + 1]; sb += d[i * 4 + 2];
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
      const nb = [i - 1, i + 1, i - W, i + W];
      for (const j of nb) if (j >= 0 && j < W * H && mask[j] && !seen[j] && Math.abs((j % W) - x) <= 1) { seen[j] = 1; stack[sp++] = j; }
    }
    if (count < 40) continue;
    const cx = sx / count, cy = sy / count;
    const vxx = sxx / count - cx * cx, vyy = syy / count - cy * cy, vxy = sxy / count - cx * cy;
    out.push({ count, cx, cy, vxx, vyy, vxy, bbox: [minx, miny, maxx, maxy],
      rgb: [Math.round(sr / count), Math.round(sg / count), Math.round(sb / count)] });
  }
  return out;
}, { W, H, SAND });

/* Convert to world; filter to the played ground */
const holeLines = model.holes.map(h => ({ n: h.n, line: h.line, green: h.green.c }));
const water = model.water.map(w => w.ring);
/* Built ground can be bright and warm too (pantile, gravel hardstanding) */
const builtRings = [
  ...model.infra.buildings.map(b => b.ring),
  ...model.infra.parking.map(p => p.ring),
  ...(model.surround.yard ? [model.surround.yard] : []),
  ...(model.scenery.greens || []),
];
const roadLines = [...model.infra.roads, ...model.infra.tracks].map(r => r.line);
const nearRing = (x, z, ring, margin) => pointInPoly(x, z, ring) ||
  ring.some(([rx, rz]) => Math.hypot(rx - x, rz - z) < margin);
const candidates = [];
for (const c of components) {
  const [x, z] = world(c.cx, c.cy);
  const area = c.count * M_PER_PX * M_PER_PX;
  if (area < 8 || area > 700) continue;
  if (water.some(ring => pointInPoly(x, z, ring))) continue;
  if (builtRings.some(ring => nearRing(x, z, ring, 6))) continue;
  if (roadLines.some(line => distToLine(x, z, line) < 7)) continue;
  let best = null;
  for (const h of holeLines) {
    const dLine = distToLine(x, z, h.line);
    const dGreen = Math.hypot(x - h.green[0], z - h.green[1]);
    const d = Math.min(dLine, dGreen);
    if (!best || d < best.d) best = { n: h.n, d, dGreen };
  }
  if (best.d > 75) continue;
  /* principal axes from the pixel covariance */
  const tr = c.vxx + c.vyy, det = c.vxx * c.vyy - c.vxy * c.vxy;
  const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(1e-6, tr / 2 - disc);
  const angle = 0.5 * Math.atan2(2 * c.vxy, c.vxx - c.vyy); /* image axes: +y down */
  candidates.push({
    hole: best.n, distToPlay: +best.d.toFixed(1), distToGreen: +best.dGreen.toFixed(1),
    c: [+x.toFixed(1), +z.toFixed(1)], area: +area.toFixed(0),
    major: +(4 * Math.sqrt(l1) * M_PER_PX).toFixed(1), minor: +(4 * Math.sqrt(l2) * M_PER_PX).toFixed(1),
    /* image angle -> world: image +x = east, image +y = south (= +z), so the angle carries over */
    angleDeg: +(angle * 180 / Math.PI).toFixed(0),
    rgb: c.rgb,
    pxBBox: c.bbox,
  });
}
candidates.sort((a, b) => a.hole - b.hole || b.area - a.area);

/* Overlay for review: candidates in cyan with an id, model bunkers in yellow */
const modelBunkers = model.holes.flatMap(h => h.bunkers.map(b => b.ring.map(([x, z]) => px(x, z))));
const dataUrl = await page.evaluate(({ candidates, modelBunkers }) => {
  const g = window.__g;
  g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,60,0.9)';
  for (const ring of modelBunkers) { g.beginPath(); ring.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.stroke(); }
  g.strokeStyle = 'rgba(0,255,255,0.95)'; g.fillStyle = 'cyan'; g.font = 'bold 22px sans-serif';
  candidates.forEach((c, i) => {
    const [x0, y0, x1, y1] = c.pxBBox;
    g.strokeRect(x0 - 3, y0 - 3, x1 - x0 + 6, y1 - y0 + 6);
    g.fillText(String(i), x1 + 6, y0 + 8);
  });
  return g.canvas.toDataURL('image/png');
}, { candidates, modelBunkers });
/* Zoomed review crops of the annotated canvas, one per hole group, so the eye
   can judge sand against dry grass at native resolution. */
const groups = { north: [490, -290, 520], east: [520, 20, 520], south: [470, 270, 560], west: [-150, 120, 620] };
for (const [name, [cx, cz, size]] of Object.entries(groups)) {
  const [px0, py0] = px(cx - size / 2, cz - size / 2), [px1, py1] = px(cx + size / 2, cz + size / 2);
  const sx = Math.max(0, Math.round(Math.min(px0, px1))), sy = Math.max(0, Math.round(Math.min(py0, py1)));
  const sw = Math.min(W - sx, Math.round(Math.abs(px1 - px0))), sh = Math.min(H - sy, Math.round(Math.abs(py1 - py0)));
  const crop = await page.evaluate(({ sx, sy, sw, sh }) => {
    const c2 = document.createElement('canvas'); c2.width = sw; c2.height = sh;
    c2.getContext('2d').drawImage(window.__g.canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    return c2.toDataURL('image/png');
  }, { sx, sy, sw, sh });
  fs.writeFileSync(path.join(OUT_DIR, `sand-review-${name}.png`), Buffer.from(crop.split(',')[1], 'base64'));
}
await browser.close();

fs.writeFileSync(path.join(OUT_DIR, 'sand-overlay.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
fs.writeFileSync(path.join(OUT_DIR, 'sand-candidates.json'), JSON.stringify({
  window: WINDOW, zoom: Z, metresPerPixel: +M_PER_PX.toFixed(4), classifier: SAND, candidates,
}, null, 1));
console.log(`${W}x${H} px, ${M_PER_PX.toFixed(3)} m/px, ${components.length} sand components, ${candidates.length} candidates on the played ground`);
for (const [i, c] of candidates.entries()) {
  console.log(`#${String(i).padStart(2)} hole ${c.hole}  c=(${c.c}) area ${c.area} m²  ${c.major}x${c.minor} m @${c.angleDeg}°  toGreen ${c.distToGreen} m  toPlay ${c.distToPlay} m  rgb ${c.rgb.join(',')}`);
}
