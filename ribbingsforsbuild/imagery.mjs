/* Esri World Imagery over the Ribbingsfors frame as one mosaic in Node.

   A tile's coordinates ARE its georeference (orthorectified web-mercator),
   so the mapping local (x, z) -> EPSG:3006 -> WGS 84 -> tile pixel is exact
   per point through the repo's own Krüger series; no registration step
   exists. Chromium decodes the JPEGs (Node has no decoder) and writes the
   composed mosaic as a PNG beside a sidecar with its pixel frame; the PNG is
   decoded here with geobuild's pure-JS reader. Everything lands in the
   gitignored cache: the imagery is migration-only under Esri's licence and
   is never committed. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { latLonToSweref99Tm, sweref99TmToLatLon } from '../packages/course-geo/chmv2/projection.mjs';
import { decodePNG } from '../geobuild/png.mjs';
import { FRAME } from './frame.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache', 'sat');
const LINUX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/* Esri World Imagery live tiles, or a dated Wayback release (`release` is the
   Wayback "M" id, e.g. 57965 = the 2023-02-23 release, which over this course
   carries the 2019-06-02 WorldView-2 capture; the live layer is 2023-04-28). */
export const tileUrlFor = release => release
  ? (zoom, ty, tx) => `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${release}/${zoom}/${ty}/${tx}`
  : (zoom, ty, tx) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`;

export async function loadMosaic(window, { zoom = 18, name = 'course', release = null } = {}) {
  const tileUrl = tileUrlFor(release);
  const tilePrefix = release ? `wb${release}_` : '';
  const n = 2 ** zoom;
  const toLatLon = (x, z) => sweref99TmToLatLon(FRAME.easting + x, FRAME.northing - z);
  const tileOf = (lat, lon) => [(lon + 180) / 360 * n,
    (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n];
  const fromTile = (tx, ty) => [Math.atan(Math.sinh(Math.PI * (1 - 2 * ty / n))) * 180 / Math.PI, tx / n * 360 - 180];
  const corners = [[window.x0, window.z0], [window.x1, window.z0], [window.x0, window.z1], [window.x1, window.z1]]
    .map(([x, z]) => tileOf(...toLatLon(x, z)));
  const X0 = Math.floor(Math.min(...corners.map(c => c[0]))), X1 = Math.floor(Math.max(...corners.map(c => c[0])));
  const Y0 = Math.floor(Math.min(...corners.map(c => c[1]))), Y1 = Math.floor(Math.max(...corners.map(c => c[1])));
  const W = (X1 - X0 + 1) * 256, H = (Y1 - Y0 + 1) * 256;
  const px = (x, z) => { const [tx, ty] = tileOf(...toLatLon(x, z)); return [(tx - X0) * 256, (ty - Y0) * 256]; };
  const world = (pxx, pxy) => {
    const [lat, lon] = fromTile(X0 + pxx / 256, Y0 + pxy / 256);
    const [e, nn] = latLonToSweref99Tm(lat, lon);
    return [e - FRAME.easting, FRAME.northing - nn];
  };
  const [ax] = px(0, 0), [bx] = px(10, 0);
  const metresPerPixel = 10 / (bx - ax);
  fs.mkdirSync(CACHE, { recursive: true });
  const mosaicFile = path.join(CACHE, `mosaic-${name}-z${zoom}.png`);
  const sideFile = mosaicFile.replace(/\.png$/, '.json');
  const side = { zoom, X0, X1, Y0, Y1, W, H, window, release };
  const fresh = fs.existsSync(mosaicFile) && fs.existsSync(sideFile) && JSON.stringify(JSON.parse(fs.readFileSync(sideFile, 'utf8'))) === JSON.stringify(side);
  if (!fresh) {
    const tiles = [];
    for (let ty = Y0; ty <= Y1; ty++) for (let tx = X0; tx <= X1; tx++) {
      const file = path.join(CACHE, `${tilePrefix}${zoom}_${tx}_${ty}.jpg`);
      if (!fs.existsSync(file)) {
        const response = await fetch(tileUrl(zoom, ty, tx));
        if (!response.ok) throw new Error(`tile ${zoom}/${ty}/${tx} ${response.status}`);
        fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
      }
      tiles.push({ tx, ty, b64: fs.readFileSync(file).toString('base64') });
    }
    const browser = await chromium.launch({ ...(fs.existsSync(LINUX_CHROME) ? { executablePath: LINUX_CHROME } : { channel: 'chrome' }), headless: true });
    const page = await browser.newPage();
    await page.setContent('<canvas id=c></canvas>');
    const dataUrl = await page.evaluate(async ({ tiles, W, H, X0, Y0 }) => {
      const canvas = document.getElementById('c'); canvas.width = W; canvas.height = H;
      const g = canvas.getContext('2d');
      for (const tile of tiles) { const img = new Image(); img.src = 'data:image/jpeg;base64,' + tile.b64; await img.decode(); g.drawImage(img, (tile.tx - X0) * 256, (tile.ty - Y0) * 256); }
      return canvas.toDataURL('image/png');
    }, { tiles, W, H, X0, Y0 });
    await browser.close();
    fs.writeFileSync(mosaicFile, Buffer.from(dataUrl.split(',')[1], 'base64'));
    fs.writeFileSync(sideFile, JSON.stringify(side));
  }
  const png = decodePNG(fs.readFileSync(mosaicFile));
  if (png.width !== W || png.height !== H) throw new Error('mosaic PNG does not match its sidecar');
  const { data, channels } = png;
  const rgbAt = (x, z) => {
    const [pxx, pxy] = px(x, z);
    const c = Math.floor(pxx), r = Math.floor(pxy);
    if (c < 0 || r < 0 || c >= W || r >= H) return null;
    const i = (r * W + c) * channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const rgbAtPx = (c, r) => { const i = (r * W + c) * channels; return [data[i], data[i + 1], data[i + 2]]; };
  return { W, H, X0, Y0, zoom, release, metresPerPixel, px, world, rgbAt, rgbAtPx, data, channels, file: mosaicFile };
}

/** 2G - R - B: excess green, the mown-turf discriminator on leaf-off imagery. */
export const excessGreen = rgb => 2 * rgb[1] - rgb[0] - rgb[2];
export const brightness = rgb => (rgb[0] + rgb[1] + rgb[2]) / 3;
