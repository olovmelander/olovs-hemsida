/* Georeferenced review crops of the retained 2026 orthophoto, with an optional
 * overlay drawn in world metres. Pixel -> world is affine and stated in the
 * receipt beside every crop, so anything traced on one needs no registration.
 *   node tortunabuild/range/range-crop.mjs <name> <cE> <cN> <sizeM> [scale] [--plain]
 * Overlays come from range-overlay.json when present. */
import { chromium } from 'playwright-core';
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { TILE } from './ortho-sample.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../cache/range/crops');
const url = p => 'file:///' + p.split(String.fromCharCode(92)).join('/');

export async function crop({ name, centreEpsg3006: [cE, cN], sizeMetres, scale = 4, plain = false, overlay = [] }) {
  mkdirSync(OUT, { recursive: true });
  const half = sizeMetres / 2;
  const bounds = [cE - half, cN - half, cE + half, cN + half];
  const px = (bounds[0] - TILE.boundsEpsg3006[0]) / TILE.metresPerPixel;
  const py = (TILE.boundsEpsg3006[3] - bounds[3]) / TILE.metresPerPixel;
  const side = sizeMetres / TILE.metresPerPixel;                      /* source pixels */
  const out = Math.round(side * scale);
  const toCanvas = ([e, n]) => [(e - bounds[0]) / sizeMetres * out, (bounds[3] - n) / sizeMetres * out];

  const browser = await chromium.launch({ channel: 'chrome', args: ['--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage({ viewport: { width: Math.min(out, 3600), height: Math.min(out, 3600) } });
    const html = resolve(OUT, '_crop.html');
    writeFileSync(html, '<!doctype html><style>html,body{margin:0;overflow:hidden;background:#111}</style>'
      + '<canvas id="c" width="' + out + '" height="' + out + '"></canvas>'
      + '<img id="im" style="display:none" src="' + url(TILE.path) + '">');
    await page.goto(url(html), { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => { const i = document.getElementById('im'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 120000 });
    await page.evaluate(({ px, py, side, out, plain, overlay, gridStep, toCanvasArgs }) => {
      const c = document.getElementById('c'), g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(document.getElementById('im'), px, py, side, side, 0, 0, out, out);
      if (plain) return;
      const [b0, b1, b2, b3, size] = toCanvasArgs;
      const P = ([e, n]) => [(e - b0) / size * out, (b3 - n) / size * out];
      g.lineWidth = 1; g.font = '11px monospace'; g.textBaseline = 'top';
      for (let e = Math.ceil(b0 / gridStep) * gridStep; e <= b2; e += gridStep) {
        const [x] = P([e, b3]);
        g.strokeStyle = 'rgba(255,255,255,.28)'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, out); g.stroke();
        g.fillStyle = 'rgba(255,255,255,.85)'; g.fillText('E' + e, x + 3, 3);
      }
      for (let n = Math.ceil(b1 / gridStep) * gridStep; n <= b3; n += gridStep) {
        const [, y] = P([b0, n]);
        g.strokeStyle = 'rgba(255,255,255,.28)'; g.beginPath(); g.moveTo(0, y); g.lineTo(out, y); g.stroke();
        g.fillStyle = 'rgba(255,255,255,.85)'; g.fillText('N' + n, 3, y + 3);
      }
      for (const item of overlay) {
        g.strokeStyle = item.colour || '#ff3b30'; g.fillStyle = item.colour || '#ff3b30'; g.lineWidth = item.width || 2;
        if (item.ring || item.line) {
          const pts = (item.ring || item.line).map(P);
          g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
          if (item.ring) g.closePath();
          g.stroke();
        }
        if (item.point) {
          const [x, y] = P(item.point), r = item.radius || 4;
          g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
          if (item.label) { g.font = '12px monospace'; g.fillText(item.label, x + r + 2, y - 6); }
        }
      }
    }, { px, py, side, out, plain, overlay, gridStep: sizeMetres > 120 ? 25 : 10, toCanvasArgs: [...bounds, sizeMetres] });
    const file = resolve(OUT, name + '.png');
    await page.locator('#c').screenshot({ path: file, timeout: 120000 });
    const receipt = { name, file, boundsEpsg3006: bounds, outputPixels: out, metresPerOutputPixel: sizeMetres / out,
      sourceTile: TILE.path, sourceResolutionMetres: TILE.metresPerPixel,
      pixelMeaning: 'edge; E=bounds[0]+x*size/out, N=bounds[3]-y*size/out', resampling: 'nearest from 0.32 m tile' };
    writeFileSync(resolve(OUT, name + '.json'), JSON.stringify(receipt, null, 2) + '\n');
    return receipt;
  } finally { await browser.close(); }
}

if (import.meta.url === url(process.argv[1]) || process.argv[1].endsWith('range-crop.mjs')) {
  const [name, cE, cN, size, scale] = process.argv.slice(2);
  const plain = process.argv.includes('--plain');
  const overlayFile = resolve(HERE, 'range-overlay.json');
  const overlay = !plain && existsSync(overlayFile) ? JSON.parse(readFileSync(overlayFile, 'utf8')) : [];
  const r = await crop({ name, centreEpsg3006: [Number(cE), Number(cN)], sizeMetres: Number(size),
    scale: Number(scale || 4), plain, overlay });
  console.log(r.file, r.outputPixels + 'px', r.metresPerOutputPixel.toFixed(4) + ' m/px');
}
