/* A georeferenced satellite crop with a labelled metre grid, for tracing by
   eye without Python: Esri World Imagery tiles (orthorectified, so a tile's
   coordinates ARE its georeference) composed in Chrome, with the build's own
   water rings, hole lines, clubhouse and range drawn on top and a grid every
   100 m (250 m past 1.5 km) in the build's legacy metres.

   usage: node tools/sat-mosaic.mjs --build puttombuild <name> <cx> <cz> <sizeMetres> [zoom]
   Tiles cache under <build>/cache/sat-mosaic/; the PNG lands in
   tools/goldens/<slug>-sat/. z18 is the usable maximum in Sweden. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
const argv = process.argv.slice(2);
const bi = argv.indexOf("--build");
const BUILD = bi >= 0 ? argv.splice(bi, 2)[1] : "puttombuild";
const [name, cxs, czs, sizes, zs] = argv;
if (!name || !Number.isFinite(+cxs) || !Number.isFinite(+czs) || !(+sizes > 0)) { console.error("usage: node tools/sat-mosaic.mjs --build <dir> <name> <cx> <cz> <sizeMetres> [zoom]"); process.exit(2); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lib = await import(pathToFileURL(path.join(ROOT, BUILD, "lib.mjs")).href);
const cx = +cxs, cz = +czs, size = +sizes, Z = +(zs || 18);
const ORIGIN = lib.ORIGIN;
const M_PER_LAT = lib.M_PER_LAT ?? 111320, M_PER_LON = lib.M_PER_LON ?? 111320 * Math.cos(ORIGIN.lat * Math.PI / 180);
const CACHE = path.join(ROOT, BUILD, "cache", "sat-mosaic"); fs.mkdirSync(CACHE, { recursive: true });
const OUT = path.join(ROOT, "tools", "goldens", BUILD.replace(/build$/, "") + "-sat"); fs.mkdirSync(OUT, { recursive: true });
const toLonLat = (x, z) => [ORIGIN.lon + x / M_PER_LON, ORIGIN.lat - z / M_PER_LAT];
const n = 2 ** Z;
const tileOf = (lon, lat) => [(lon + 180) / 360 * n, (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n];
const [lon0, lat0] = toLonLat(cx - size / 2, cz - size / 2), [lon1, lat1] = toLonLat(cx + size / 2, cz + size / 2);
const [tx0, ty0] = tileOf(lon0, lat0), [tx1, ty1] = tileOf(lon1, lat1);
const X0 = Math.floor(tx0), Y0 = Math.floor(ty0), X1 = Math.floor(tx1), Y1 = Math.floor(ty1);
const tiles = [];
for (let ty = Y0; ty <= Y1; ty++) for (let tx = X0; tx <= X1; tx++) {
  const file = path.join(CACHE, `${Z}_${tx}_${ty}.jpg`);
  if (!fs.existsSync(file)) {
    const r = await fetch(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${ty}/${tx}`);
    if (!r.ok) throw new Error(`tile ${Z}/${ty}/${tx} ${r.status}`);
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  }
  tiles.push({ tx, ty, b64: fs.readFileSync(file).toString("base64") });
}
const W = Math.round((tx1 - tx0) * 256), H = Math.round((ty1 - ty0) * 256);
/* legacy metres -> pixel in the crop */
const px = (x, z) => { const [lon, lat] = toLonLat(x, z); const [tx, ty] = tileOf(lon, lat); return [(tx - tx0) * 256, (ty - ty0) * 256]; };
const model = JSON.parse(fs.readFileSync(path.join(ROOT, BUILD, "course-model.json"), "utf8"));
const overlays = { holes: model.holes.map(h => ({ n: h.n, line: h.line, green: h.green?.c })), clubhouse: (model.infra.buildings || []).filter(b => /klubb/i.test(b.name || "")).map(b => b.ring),
  water: (model.water || []).filter(w => w.ring).map(w => w.ring), range: (model.scenery && model.scenery.range) || [],
  roads: (model.infra.roads || []).map(r => r.line), tracks: (model.infra.tracks || []).map(t => t.line), paths: (model.infra.paths || []).map(t => t.line),
  buildings: (model.infra.buildings || []).map(b => b.ring), parking: (model.infra.parking || []).map(q => q.ring),
  nets: (model.scenery && model.scenery.rangeFacilities && model.scenery.rangeFacilities.nets) || [], bays: (model.scenery && model.scenery.rangeFacilities && model.scenery.rangeFacilities.bays) ? [model.scenery.rangeFacilities.bays] : [] };
const browser = await chromium.launch({ executablePath: process.env.BANVY_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage();
await page.setContent("<canvas id=c></canvas>");
const dataUrl = await page.evaluate(async ({ tiles, W, H, X0, Y0, tx0, ty0, size, cx, cz, grid, overlays, plain }) => {
  const c = document.getElementById("c"); c.width = W; c.height = H; const g = c.getContext("2d");
  for (const t of tiles) { const img = new Image(); img.src = "data:image/jpeg;base64," + t.b64; await img.decode(); g.drawImage(img, (t.tx - tx0) * 256, (t.ty - ty0) * 256); }
  if (plain) return c.toDataURL("image/png");
  g.lineWidth = 1; g.font = "bold 13px sans-serif";
  for (const [x, z, label, vertical] of grid) {
    g.strokeStyle = "rgba(255,255,0,0.55)"; g.fillStyle = "yellow";
    g.beginPath();
    if (vertical) { g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); g.fillText(label, x + 2, 14); }
    else { g.moveTo(0, z); g.lineTo(W, z); g.stroke(); g.fillText(label, 2, z - 3); }
  }
  g.lineWidth = 2;
  for (const ring of overlays.water) { g.strokeStyle = "rgba(80,160,255,0.8)"; g.beginPath(); ring.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.stroke(); }
  for (const ring of overlays.clubhouse) { g.strokeStyle = "rgba(255,80,80,0.95)"; g.beginPath(); ring.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.stroke(); }
  for (const ring of overlays.range) { g.strokeStyle = "rgba(255,160,0,0.9)"; g.beginPath(); ring.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.stroke(); }
  const poly = (rings, colour, close) => { g.strokeStyle = colour; for (const ring of rings) { g.beginPath(); ring.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); if (close) g.closePath(); g.stroke(); } };
  g.lineWidth = 2;
  poly(overlays.roads, "rgba(255,0,255,0.9)", false); poly(overlays.tracks, "rgba(255,120,255,0.9)", false); poly(overlays.paths, "rgba(255,200,80,0.9)", false);
  poly(overlays.buildings, "rgba(255,60,60,0.95)", true); poly(overlays.parking, "rgba(0,255,255,0.9)", true); poly(overlays.nets, "rgba(255,255,255,0.95)", false); poly(overlays.bays, "rgba(0,255,0,0.95)", false);
  for (const h of overlays.holes) { g.strokeStyle = "rgba(255,255,255,0.7)"; g.beginPath(); h.line.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke();
    if (h.green) { g.fillStyle = "white"; g.font = "bold 16px sans-serif"; g.fillText(String(h.n), h.green[0] + 4, h.green[1] - 4); } }
  return c.toDataURL("image/png");
}, { tiles, W, H, X0, Y0, tx0, ty0, size, cx, cz, plain: process.env.SAT_PLAIN === "1",
  grid: (() => { const out = []; const step = size > 1500 ? 250 : 100; for (let x = Math.ceil((cx - size / 2) / step) * step; x <= cx + size / 2; x += step) { const [p] = px(x, cz); out.push([p, 0, `x ${x}`, true]); }
    for (let z = Math.ceil((cz - size / 2) / step) * step; z <= cz + size / 2; z += step) { const [, p] = px(cx, z); out.push([0, p, `z ${z}`, false]); } return out; })(),
  overlays: { water: overlays.water.map(r => r.map(([x, z]) => px(x, z))), clubhouse: overlays.clubhouse.map(r => r.map(([x, z]) => px(x, z))), range: (overlays.range || []).map(r => (r.ring || r).map(([x, z]) => px(x, z))),
    roads: overlays.roads.map(r => r.map(([x, z]) => px(x, z))), tracks: overlays.tracks.map(r => r.map(([x, z]) => px(x, z))), paths: overlays.paths.map(r => r.map(([x, z]) => px(x, z))),
    buildings: overlays.buildings.map(r => r.map(([x, z]) => px(x, z))), parking: overlays.parking.map(r => r.map(([x, z]) => px(x, z))), nets: overlays.nets.map(r => r.map(([x, z]) => px(x, z))), bays: overlays.bays.map(r => r.map(([x, z]) => px(x, z))),
    holes: overlays.holes.map(h => ({ n: h.n, line: h.line.map(([x, z]) => px(x, z)), green: h.green ? px(h.green[0], h.green[1]) : null })) } });
fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(dataUrl.split(",")[1], "base64"));
await browser.close();
console.log(`${name}.png ${W}x${H} px, ${(size / W).toFixed(2)} m/px, tiles ${tiles.length}, centre (${cx}, ${cz}) size ${size} m`);
