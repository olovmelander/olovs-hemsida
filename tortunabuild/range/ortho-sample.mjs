/* Sample the retained 2026 native orthophoto in EPSG:3006 metres.
 * Chrome is the only PNG decoder available in this environment, so the tile is
 * drawn to a canvas and read back; no pixel is resampled on the way out --
 * requests are clipped to whole source pixels and returned at native scale. */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const TILE = {
  path: resolve(HERE, '../cache/orthophoto/north.png'),
  boundsEpsg3006: [596880, 6614880, 598160, 6616160],
  width: 4000, height: 4000, metresPerPixel: 0.32,
};
export const toPixel = ([e, n]) => [(e - TILE.boundsEpsg3006[0]) / TILE.metresPerPixel,
  (TILE.boundsEpsg3006[3] - n) / TILE.metresPerPixel];
export const toWorld = ([px, py]) => [TILE.boundsEpsg3006[0] + px * TILE.metresPerPixel,
  TILE.boundsEpsg3006[3] - py * TILE.metresPerPixel];

/** RGBA bytes for a whole-pixel window, plus the window's own georeference. */
export async function sampleWindow({ x, y, w, h }) {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage({ viewport: { width: 32, height: 32 } });
    const html = resolve(HERE, '../cache/range/_sample.html');
    writeFileSync(html, '<!doctype html><img id="im" src="file:///'
      + TILE.path.split(String.fromCharCode(92)).join('/') + '">');
    await page.goto('file:///' + html.split(String.fromCharCode(92)).join('/'), { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => { const i = document.getElementById('im'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 120000 });
    const data = await page.evaluate(({ x, y, w, h }) => {
      const image = document.getElementById('im');
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.imageSmoothingEnabled = false;
      context.drawImage(image, x, y, w, h, 0, 0, w, h);
      return Array.from(context.getImageData(0, 0, w, h).data);
    }, { x, y, w, h });
    return { rgba: Uint8ClampedArray.from(data), x, y, w, h };
  } finally { await browser.close(); }
}

export const luminance = (s, i, j) => {
  const o = (j * s.w + i) * 4;
  return 0.2126 * s.rgba[o] + 0.7152 * s.rgba[o + 1] + 0.0722 * s.rgba[o + 2];
};
export const rgb = (s, i, j) => { const o = (j * s.w + i) * 4; return [s.rgba[o], s.rgba[o + 1], s.rgba[o + 2]]; };
