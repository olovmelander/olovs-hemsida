#!/usr/bin/env node
/* A georeferenced Lantmäteriet orthophoto crop of the Tortuna frame, with the
   model drawn on top and a labelled metre grid, for tracing and review by eye.
 *
 * Visby's ortho-crop.mjs, carried to this frame. Tortuna is authored directly
 * in EPSG:3006 about E597400.5 N6614899.5 (tortunabuild/frame.mjs), so local
 * metres ARE grid metres and there is no projection step. The national
 * orthophoto over this block is the 2026-05-02 flight at 0.16 m RGBI
 * (geo_data/course-v2/tortuna/acquisition/orthophoto-review.json); its pixels
 * are servable with no credentials through the viewing service Min karta
 * proxies, which is the same flight the retained private review windows were
 * cut from (checked against the retained native crop of the 1st tee before
 * this tool was used for anything: tortunabuild/cache/ortho-verify.json).
 *
 * The imagery is a TRACING SOURCE and never a runtime texture, which is the
 * policy this ground already states: nothing fetched here is redistributed.
 *
 *   node tortunabuild/ortho-crop.mjs <name> <cx> <cz> <sizeMetres> [--plain]
 *     --plain     no overlay, for tracing a feature the overlay would hide
 *     --metres N  ground sampling to render at (default 0.16, the native one)
 *     --marks "x,z[,label];..."  extra points to check by eye
 *
 * Tiles cache in tortunabuild/cache/ortho/; PNGs land in tortunabuild/cache/crops/.
 *
 * Two request conventions that cost a blank image if got wrong, both measured
 * at Visby: WMS 1.3.0 with EPSG:3006 wants the bbox NORTHING FIRST and returns
 * pure white with easting first, so this speaks 1.1.1 with SRS= and easting
 * first; and the service caps a request at 4096 x 4096, so a larger view is
 * mosaicked rather than asked for in one go.                                  */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { TORTUNA_FRAME } from './frame.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = 'lm-0.16';
const CACHE = path.join(HERE, 'cache', 'ortho', SOURCE);
const OUT = path.join(HERE, 'cache', 'crops');

/** One WMS piece (at most 4096 px a side), cached by its exact ground extent. */
export async function fetchPiece(minE, maxN, columns, rows, metresPerPixel) {
  fs.mkdirSync(CACHE, { recursive: true });
  const w0 = minE, w1 = w0 + columns * metresPerPixel;
  const n1 = maxN, n0 = n1 - rows * metresPerPixel;
  const key = `${SOURCE}_${metresPerPixel}_${w0.toFixed(2)}_${n0.toFixed(2)}_${columns}x${rows}.jpg`;
  const file = path.join(CACHE, key);
  if (!fs.existsSync(file)) {
    const url = `https://minkarta.lantmateriet.se/map/ortofoto?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=Ortofoto_0.16&STYLES=&SRS=EPSG:3006&BBOX=${w0},${n0},${w1},${n1}&WIDTH=${columns}&HEIGHT=${rows}&FORMAT=image/jpeg`;
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36' };
    /* the proxy answers 504 now and then under load; three tries before giving up */
    let response = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      response = await fetch(url, { headers });
      if (response.ok) break;
      if (attempt === 3) throw new Error(`${SOURCE} piece ${columns}x${rows} at ${w0},${n0} returned HTTP ${response.status}`);
      await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 2048) throw new Error(`${SOURCE} piece is ${bytes.length} bytes, which is a service exception rather than imagery`);
    fs.writeFileSync(file, bytes);
  }
  return file;
}

/** The pieces covering a local-metre window at a given sampling, ready to draw. */
export async function fetchWindow({ cx, cz, size, metres = 0.16 }) {
  const east = x => TORTUNA_FRAME.easting + x;
  const north = z => TORTUNA_FRAME.northing - z;
  const minEasting = east(cx - size / 2), maxNorthing = north(cz - size / 2);
  const W = Math.round(size / metres), H = Math.round(size / metres);
  const MAX = 4096;
  const pieces = [];
  for (let row0 = 0; row0 < H; row0 += MAX) {
    for (let column0 = 0; column0 < W; column0 += MAX) {
      const columns = Math.min(MAX, W - column0), rows = Math.min(MAX, H - row0);
      const file = await fetchPiece(minEasting + column0 * metres, maxNorthing - row0 * metres, columns, rows, metres);
      pieces.push({ column0, row0, columns, rows, b64: fs.readFileSync(file).toString('base64') });
    }
  }
  return { pieces, W, H, minEasting, maxNorthing, metres,
    px: (x, z) => [(east(x) - minEasting) / metres, (maxNorthing - north(z)) / metres] };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const has = flag => argv.includes(`--${flag}`);
  const value = (flag, fallback) => { const i = argv.indexOf(`--${flag}`); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback; };
  const plain = has('plain');
  const valued = new Set(['--metres', '--marks']);
  const positional = argv.filter((item, index) => !item.startsWith('--') && !(index > 0 && valued.has(argv[index - 1])));
  const [name, cxs, czs, sizes] = positional;
  if (!name || !Number.isFinite(+cxs) || !Number.isFinite(+czs) || !(+sizes > 0)) {
    console.error('usage: node tortunabuild/ortho-crop.mjs <name> <cx> <cz> <sizeMetres> [--plain] [--metres 0.16] [--marks "x,z,label;..."]');
    process.exit(2);
  }
  const cx = +cxs, cz = +czs, size = +sizes;
  const metres = +value('metres', 0.16);
  fs.mkdirSync(OUT, { recursive: true });
  const win = await fetchWindow({ cx, cz, size, metres });
  const { pieces, W, H, px } = win;

  const model = JSON.parse(fs.readFileSync(path.join(HERE, 'course-model.json'), 'utf8'));
  const mapPx = points => points.map(([x, z]) => px(x, z));
  const overlays = {
    holes: model.holes.map(hole => ({ n: hole.n, line: mapPx(hole.line), green: px(...hole.green.c) })),
    greens: model.holes.map(hole => mapPx(hole.green.ring)),
    fairways: [...model.holes.flatMap(hole => (hole.fairway?.rings || []).map(mapPx)), ...(model.scenery.fairways || []).map(mapPx)],
    teePads: model.holes.flatMap(hole => (hole.tees?.pads || []).map(pad => mapPx(pad.ring))),
    teeMarks: model.holes.flatMap(hole => (hole.tees?.marks || []).map((mark, tee) => ({ p: px(...mark.c), label: `${hole.n}:${tee}` }))),
    bunkers: [...model.holes.flatMap(hole => (hole.bunkers || []).map(b => mapPx(b.ring))), ...(model.scenery.bunkers || []).map(b => mapPx(b.ring || b))],
    water: model.water.map(item => mapPx(item.ring)),
    buildings: (model.infra.buildings || []).map(b => mapPx(b.ring)),
    roads: (model.infra.roads || []).map(r => mapPx(r.line)),
    paths: [...(model.infra.paths || []), ...(model.infra.tracks || [])].map(r => mapPx(r.line)),
    range: (model.scenery.range || []).map(mapPx),
    mapped: (model.scenery.mappedFeatures || []).flatMap(f => (f.rings || []).map(mapPx)),
    marks: [],
  };
  for (const spec of value('marks', '').split(';').filter(Boolean)) {
    const [x, z, label] = spec.split(',');
    overlays.marks.push({ p: px(+x, +z), label: label || '' });
  }
  const grid = [];
  const step = size > 1600 ? 500 : size > 700 ? 200 : size > 300 ? 100 : size > 120 ? 50 : 20;
  for (let x = Math.ceil((cx - size / 2) / step) * step; x <= cx + size / 2; x += step) grid.push([...px(x, cz - size / 2), `x${x}`, true, mapPx([[x, cz - size / 2], [x, cz + size / 2]])]);
  for (let z = Math.ceil((cz - size / 2) / step) * step; z <= cz + size / 2; z += step) grid.push([...px(cx - size / 2, z), `z${z}`, false, mapPx([[cx - size / 2, z], [cx + size / 2, z]])]);

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.setContent('<canvas id=c></canvas>');
  const dataUrl = await page.evaluate(async ({ pieces, W, H, grid, overlays, plain, lineScale }) => {
    const canvas = document.getElementById('c');
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    for (const piece of pieces) {
      const img = new Image();
      img.src = 'data:image/jpeg;base64,' + piece.b64;
      await img.decode();
      g.drawImage(img, piece.column0, piece.row0);
    }
    if (!plain) {
      const poly = (points, close) => { g.beginPath(); points.forEach(([x, y], index) => index ? g.lineTo(x, y) : g.moveTo(x, y)); if (close) g.closePath(); g.stroke(); };
      g.lineWidth = lineScale;
      g.strokeStyle = 'rgba(255,255,0,0.30)'; g.fillStyle = 'yellow'; g.font = `bold ${12 * lineScale}px sans-serif`;
      for (const [x, y, label, vertical, line] of grid) { poly(line, false); g.fillText(label, x + 3 * lineScale, y + (vertical ? 14 : -4) * lineScale); }
      g.lineWidth = 1.6 * lineScale;
      g.strokeStyle = 'rgba(0,180,255,0.9)'; for (const ring of overlays.water) poly(ring, true);
      g.strokeStyle = 'rgba(255,80,80,0.9)'; for (const ring of overlays.buildings) poly(ring, true);
      g.strokeStyle = 'rgba(255,160,40,0.8)'; for (const line of overlays.roads) poly(line, false);
      g.strokeStyle = 'rgba(255,160,40,0.45)'; for (const line of overlays.paths) poly(line, false);
      g.strokeStyle = 'rgba(120,255,120,0.55)'; for (const ring of overlays.fairways) poly(ring, true);
      g.strokeStyle = 'rgba(120,255,120,0.8)'; for (const ring of overlays.range) poly(ring, true);
      g.strokeStyle = 'rgba(200,200,255,0.6)'; for (const ring of overlays.mapped) poly(ring, true);
      g.strokeStyle = 'rgba(60,255,60,0.95)'; for (const ring of overlays.greens) poly(ring, true);
      g.strokeStyle = 'rgba(255,60,255,0.9)'; for (const ring of overlays.teePads) poly(ring, true);
      g.strokeStyle = 'rgba(255,255,120,0.9)'; for (const ring of overlays.bunkers) poly(ring, true);
      g.strokeStyle = 'rgba(255,255,255,0.95)'; g.fillStyle = 'white'; g.font = `bold ${16 * lineScale}px sans-serif`;
      for (const hole of overlays.holes) { poly(hole.line, false); g.fillText(String(hole.n), hole.green[0] + 4 * lineScale, hole.green[1] - 4 * lineScale); }
      g.font = `bold ${11 * lineScale}px sans-serif`;
      for (const mark of overlays.teeMarks) {
        g.strokeStyle = 'rgba(255,0,255,0.95)'; g.beginPath(); g.arc(mark.p[0], mark.p[1], 4 * lineScale, 0, Math.PI * 2); g.stroke();
        g.fillStyle = 'magenta'; g.fillText(mark.label, mark.p[0] + 5 * lineScale, mark.p[1] - 3 * lineScale);
      }
      g.font = `bold ${13 * lineScale}px sans-serif`;
      for (const mark of overlays.marks) {
        g.strokeStyle = 'rgba(255,0,0,0.95)'; g.beginPath();
        g.moveTo(mark.p[0] - 9 * lineScale, mark.p[1]); g.lineTo(mark.p[0] + 9 * lineScale, mark.p[1]);
        g.moveTo(mark.p[0], mark.p[1] - 9 * lineScale); g.lineTo(mark.p[0], mark.p[1] + 9 * lineScale); g.stroke();
        g.fillStyle = 'red'; g.fillText(mark.label, mark.p[0] + 11 * lineScale, mark.p[1] - 5 * lineScale);
      }
    }
    return canvas.toDataURL('image/png');
  }, { pieces, W, H, grid, overlays, plain, lineScale: Math.max(1, Math.round(0.32 / metres)) });
  await browser.close();
  const file = path.join(OUT, `${name}${plain ? '-plain' : ''}.png`);
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  const receipt = { name, file, centreLocal: [cx, cz], sizeMetres: size, metresPerPixel: metres,
    boundsEpsg3006: [win.minEasting, win.maxNorthing - H * metres, win.minEasting + W * metres, win.maxNorthing], width: W, height: H,
    pixelMeaning: 'pixel edge; E=minEasting+px*metres, N=maxNorthing-py*metres; local x=E-597400.5, z=6614899.5-N',
    source: 'minkarta.lantmateriet.se/map/ortofoto Ortofoto_0.16 (orto-n2-2026, flown 2026-05-02)' };
  fs.writeFileSync(path.join(OUT, `${name}${plain ? '-plain' : ''}.json`), JSON.stringify(receipt, null, 2) + '\n');
  console.log(`${file} ${W}x${H}px at ${metres} m/px, ${pieces.length} service request${pieces.length === 1 ? '' : 's'} (${SOURCE})`);
}
