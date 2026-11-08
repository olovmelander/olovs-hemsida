/* Review panels and cached layers for the tree pipeline (from the
   Johannesberg pilot's panels.mjs): the canopy rasters and orthophoto mosaics
   loaded from the ignored cache, and north-up PNG panels with crown markers,
   numbered labels and a metric grid. Pictures are review material, never
   evidence of correctness on their own.                                     */
import fs from 'node:fs';
import path from 'node:path';
import { encodePNG } from '../../geobuild/png.mjs';
import { openPack, readMosaic } from './ortho-store.mjs';

const TYPED = { float32: Float32Array, uint16: Uint16Array, uint8: Uint8Array, int32: Int32Array, float64: Float64Array };

export function loadRaster(ctx, name) {
  const dir = ctx.paths.rasters;
  const sidecar = JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));
  const bytes = fs.readFileSync(path.join(dir, `${name}.bin`));
  const Type = TYPED[sidecar.dtype];
  const values = new Type(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return {
    sidecar,
    grid: { minEasting: sidecar.originEasting, maxNorthing: sidecar.originNorthing, width: sidecar.width, height: sidecar.height, sampleSpacingMetres: sidecar.sampleSpacingMetres },
    values,
  };
}

export function loadMosaic(ctx, key) {
  const dir = path.join(ctx.paths.ortho, key);
  const sidecar = JSON.parse(fs.readFileSync(path.join(dir, `mosaic-${key}-032.json`), 'utf8'));
  const data = new Uint8Array(fs.readFileSync(path.join(dir, `mosaic-${key}-032.rgbi`)));
  return { ...sidecar, data };
}

/** The packs (verified compressed tiles) of one campaign, opened for native reads. */
export function openCampaignPacks(ctx, key) {
  const dir = path.join(ctx.paths.ortho, key);
  return fs.readdirSync(dir).filter(f => f.endsWith('.index.json')).sort().map(f => openPack(path.join(dir, f)));
}

/**
 * A campaign's RGBI at its native 0.16 m over a bbox (the same shape as
 * loadMosaic, so renderLayer, mosaicAt and photoDisc read it unchanged). The
 * 0.32 m analysis mosaic halves the detail a crown top needs; this reads the
 * cached tiles themselves. Pass `packs` to reuse open packs across calls.
 */
export function loadNativeMosaic(ctx, key, bbox, { packs = null, factor = 1 } = {}) {
  const own = packs || openCampaignPacks(ctx, key);
  try {
    const m = readMosaic(own, bbox, { factor });
    return { campaign: key, ...m };
  } finally {
    if (!packs) for (const p of own) p.close();
  }
}

/** Bilinear RGBI at a point, with an optional registration shift (photo = laser + shift). */
export function mosaicAt(mosaic, easting, northing, out = new Float64Array(4), shift = null) {
  const e = easting + (shift ? shift.dE : 0);
  const n = northing + (shift ? shift.dN : 0);
  const fx = (e - mosaic.minEasting) / mosaic.pixelMetres - 0.5;
  const fy = (mosaic.maxNorthing - n) / mosaic.pixelMetres - 0.5;
  const c = Math.floor(fx);
  const r = Math.floor(fy);
  if (c < 0 || r < 0 || c + 1 >= mosaic.width || r + 1 >= mosaic.height) { out.fill(Number.NaN); return out; }
  const tx = fx - c;
  const ty = fy - r;
  const w = mosaic.width;
  for (let b = 0; b < 4; b++) {
    const v00 = mosaic.data[(r * w + c) * 4 + b], v10 = mosaic.data[(r * w + c + 1) * 4 + b];
    const v01 = mosaic.data[((r + 1) * w + c) * 4 + b], v11 = mosaic.data[((r + 1) * w + c + 1) * 4 + b];
    out[b] = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
  }
  return out;
}

export function rasterAt(raster, easting, northing) {
  const { grid, values } = raster;
  const c = Math.floor((easting - grid.minEasting) / grid.sampleSpacingMetres);
  const r = Math.floor((grid.maxNorthing - northing) / grid.sampleSpacingMetres);
  if (c < 0 || r < 0 || c >= grid.width || r >= grid.height) return Number.NaN;
  return values[r * grid.width + c];
}

/* ---------- a tiny bitmap font (3x5) for numbers and a few letters ---------- */
const GLYPHS = {
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'], 2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '010', '010', '010'], 8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'], '-': ['000', '000', '111', '000', '000'], '.': ['000', '000', '000', '000', '010'],
  E: ['111', '100', '111', '100', '111'], N: ['101', '111', '111', '111', '101'], C: ['111', '100', '100', '100', '111'],
  B: ['110', '101', '110', '101', '110'], R: ['110', '101', '110', '101', '101'], H: ['101', '101', '111', '101', '101'],
  A: ['010', '101', '111', '101', '101'], D: ['110', '101', '101', '101', '110'], O: ['111', '101', '101', '101', '111'],
  L: ['100', '100', '100', '100', '111'], P: ['111', '101', '111', '100', '100'], ' ': ['000', '000', '000', '000', '000'],
  T: ['111', '010', '010', '010', '010'], I: ['111', '010', '010', '010', '111'], F: ['111', '100', '111', '100', '100'],
  G: ['111', '100', '101', '101', '111'], S: ['111', '100', '111', '001', '111'], W: ['101', '101', '111', '111', '101'],
  V: ['101', '101', '101', '101', '010'], X: ['101', '101', '010', '101', '101'], Y: ['101', '101', '010', '010', '010'],
  K: ['101', '110', '100', '110', '101'], M: ['101', '111', '111', '101', '101'], U: ['101', '101', '101', '101', '111'],
};

export class Canvas {
  constructor(width, height, fill = [0, 0, 0]) {
    this.width = width; this.height = height;
    this.rgb = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i++) { this.rgb[i * 3] = fill[0]; this.rgb[i * 3 + 1] = fill[1]; this.rgb[i * 3 + 2] = fill[2]; }
  }
  set(x, y, color, alpha = 1) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const o = (y * this.width + x) * 3;
    for (let k = 0; k < 3; k++) this.rgb[o + k] = Math.round(this.rgb[o + k] * (1 - alpha) + color[k] * alpha);
  }
  circle(cx, cy, radius, color, { thickness = 1, alpha = 1 } = {}) {
    const steps = Math.max(24, Math.ceil(radius * 8));
    for (let t = 0; t < thickness; t++) for (let i = 0; i < steps; i++) {
      const a = (i / steps) * 2 * Math.PI;
      this.set(cx + (radius + t - (thickness - 1) / 2) * Math.cos(a), cy + (radius + t - (thickness - 1) / 2) * Math.sin(a), color, alpha);
    }
  }
  dot(cx, cy, radius, color) {
    for (let dy = -Math.ceil(radius); dy <= Math.ceil(radius); dy++) for (let dx = -Math.ceil(radius); dx <= Math.ceil(radius); dx++) if (dx * dx + dy * dy <= radius * radius) this.set(cx + dx, cy + dy, color);
  }
  cross(cx, cy, size, color) { for (let k = -size; k <= size; k++) { this.set(cx + k, cy + k, color); this.set(cx + k, cy - k, color); } }
  square(cx, cy, size, color) { for (let k = -size; k <= size; k++) { this.set(cx + k, cy - size, color); this.set(cx + k, cy + size, color); this.set(cx - size, cy + k, color); this.set(cx + size, cy + k, color); } }
  line(x0, y0, x1, y1, color, alpha = 1) {
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) + 1;
    for (let i = 0; i <= n; i++) this.set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, color, alpha);
  }
  text(x, y, text, color, scale = 2, shadow = [0, 0, 0]) {
    let cx = x;
    for (const ch of String(text).toUpperCase()) {
      const glyph = GLYPHS[ch] || GLYPHS[' '];
      for (const [pass, col] of [[1, shadow], [0, color]]) {
        if (!col) continue;
        for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) if (glyph[gy][gx] === '1') {
          for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) this.set(cx + gx * scale + sx + pass, y + gy * scale + sy + pass, col);
        }
      }
      cx += 4 * scale;
    }
  }
  blit(other, ox, oy) {
    for (let y = 0; y < other.height; y++) for (let x = 0; x < other.width; x++) {
      const tx = ox + x, ty = oy + y;
      if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) continue;
      const s = (y * other.width + x) * 3, t = (ty * this.width + tx) * 3;
      this.rgb[t] = other.rgb[s]; this.rgb[t + 1] = other.rgb[s + 1]; this.rgb[t + 2] = other.rgb[s + 2];
    }
  }
  png() { return encodePNG(this.width, this.height, this.rgb); }
}

const clamp255 = v => Math.max(0, Math.min(255, Math.round(v)));

/** Colour for a CHM height: grey ramp to 30 m, dark blue void. */
export function chmColour(h) {
  if (Number.isNaN(h)) return [12, 18, 48];
  if (h < 0.5) return [24, 24, 24];
  const t = Math.min(1, h / 30);
  /* green-yellow ramp so crowns read against grey ground */
  return [clamp255(30 + 225 * t), clamp255(60 + 195 * Math.sqrt(t)), clamp255(30 + 60 * t)];
}

/**
 * Render one layer over a bbox at `metresPerPixel`.
 * kind: 'chm' (raster), 'rgb'/'cir' (mosaic), 'hill' (CHM hillshade).
 */
export function renderLayer({ kind, raster = null, mosaic = null, bbox, metresPerPixel, shift = null, stretch = null }) {
  const [minE, minN, maxE, maxN] = bbox;
  const width = Math.round((maxE - minE) / metresPerPixel);
  const height = Math.round((maxN - minN) / metresPerPixel);
  const canvas = new Canvas(width, height);
  const px = new Float64Array(4);
  const s = stretch || (kind === 'cir' ? { lo: [10, 10, 10, 10], hi: [180, 170, 160, 230] } : { lo: [15, 15, 15, 15], hi: [200, 200, 190, 230] });
  for (let y = 0; y < height; y++) {
    const n = maxN - (y + 0.5) * metresPerPixel;
    for (let x = 0; x < width; x++) {
      const e = minE + (x + 0.5) * metresPerPixel;
      let colour;
      if (kind === 'chm') colour = chmColour(rasterAt(raster, e, n));
      else if (kind === 'hill') {
        const h = rasterAt(raster, e, n);
        if (Number.isNaN(h)) colour = [12, 18, 48];
        else {
          const d = raster.grid.sampleSpacingMetres;
          const hx = (rasterAt(raster, e + d, n) - rasterAt(raster, e - d, n)) / (2 * d);
          const hy = (rasterAt(raster, e, n + d) - rasterAt(raster, e, n - d)) / (2 * d);
          const shade = Number.isFinite(hx) && Number.isFinite(hy) ? Math.max(0, (-hx * -0.6 + -hy * 0.6 + 1) / Math.sqrt(hx * hx + hy * hy + 1)) : 0.6;
          const base = chmColour(h);
          colour = base.map(v => clamp255(v * (0.35 + 0.75 * shade)));
        }
      } else {
        mosaicAt(mosaic, e, n, px, shift);
        if (Number.isNaN(px[0])) colour = [0, 0, 0];
        else if (kind === 'rgb') colour = [0, 1, 2].map(b => clamp255(((px[b] - s.lo[b]) / (s.hi[b] - s.lo[b])) * 255));
        else colour = [3, 0, 1].map(b => clamp255(((px[b] - s.lo[b]) / (s.hi[b] - s.lo[b])) * 255));
      }
      const o = (y * width + x) * 3;
      canvas.rgb[o] = colour[0]; canvas.rgb[o + 1] = colour[1]; canvas.rgb[o + 2] = colour[2];
    }
  }
  return canvas;
}

/** Project a coordinate into a panel. */
export function toPixel(bbox, metresPerPixel, easting, northing) {
  return [(easting - bbox[0]) / metresPerPixel, (bbox[3] - northing) / metresPerPixel];
}

/** Grid lines every `step` metres with easting/northing labels relative to bbox origin. */
export function drawGrid(canvas, bbox, metresPerPixel, step, { color = [255, 255, 255], alpha = 0.35, labels = true } = {}) {
  const [minE, minN, maxE, maxN] = bbox;
  for (let e = Math.ceil(minE / step) * step; e <= maxE; e += step) {
    const [x] = toPixel(bbox, metresPerPixel, e, maxN);
    canvas.line(x, 0, x, canvas.height - 1, color, alpha);
    if (labels) canvas.text(x + 2, 2, String(Math.round(e - minE)), [255, 255, 0], 1);
  }
  for (let n = Math.ceil(minN / step) * step; n <= maxN; n += step) {
    const [, y] = toPixel(bbox, metresPerPixel, minE, n);
    canvas.line(0, y, canvas.width - 1, y, color, alpha);
    if (labels) canvas.text(2, y + 2, String(Math.round(n - minN)), [255, 255, 0], 1);
  }
}
