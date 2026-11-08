/* Relief displacement of treetops in Lantmäteriet's orthophotos.

   A standard orthophoto is rectified on the ground model, so anything above
   the ground is drawn displaced away from the image nadir by about
   height x (ground distance from nadir / flying height). Over a stand that
   is a vector field k (metres of horizontal displacement per metre of
   height): the photo shows a crown top of height h at (E + kx h, N + ky h).
   At Johannesberg |k| is 0.3-0.7 (2021 and 2025 flights), so a 20 m spruce is
   drawn 6-14 m from its laser apex, more than the spacing of the trees.

   k is estimated per block, never assumed: the photo, resampled onto the
   laser lattice for a candidate k, is correlated with a hillshade of the
   pit-free CHM lit from the flight's own sun (sunlit flanks bright, far
   flanks dark), over canopy cells only. A coarse search (+-0.9 by 0.05) is
   refined (+-0.05 by 0.01). The peak and its lead over the k = 0
   correlation are returned so that a caller can refuse a weak estimate.
   Ground features were registered separately (verify stage); this aligns the
   CANOPY, which ground registration cannot. Nothing here is a detector.   */
import { smoothChm } from '../../packages/course-v2/vegetation/pit-free-chm.mjs';

/** Unit vector toward the sun: x east, y north, z up. */
export function sunVector({ azimuthDegrees, elevationDegrees }) {
  const az = (azimuthDegrees * Math.PI) / 180, el = (elevationDegrees * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
}

/** Lambertian hillshade of a CHM grid lit from `sun` (NaN below `minimumHeight`). */
export function canopyHillshade(grid, chm, sun, { sigmaMetres = 0.5, minimumHeight = 3 } = {}) {
  const smooth = smoothChm(grid, chm, sigmaMetres);
  const { width, height, sampleSpacingMetres: s } = grid;
  const L = sunVector(sun);
  const out = new Float32Array(width * height).fill(Number.NaN);
  for (let r = 1; r < height - 1; r++) for (let c = 1; c < width - 1; c++) {
    const i = r * width + c;
    if (!(chm[i] >= minimumHeight)) continue;
    const dzdx = (smooth[i + 1] - smooth[i - 1]) / (2 * s);
    const dzdy = (smooth[i - width] - smooth[i + width]) / (2 * s);
    const norm = Math.hypot(dzdx, dzdy, 1);
    out[i] = Math.max(0, (-dzdx * L[0] - dzdy * L[1] + L[2]) / norm);
  }
  return out;
}

/** Photo brightness for canopy matching: near infrared plus half the visible mean. */
export function photoBrightness(photo, easting, northing) {
  const c = Math.floor((easting - photo.minEasting) / photo.pixelMetres);
  const r = Math.floor((photo.maxNorthing - northing) / photo.pixelMetres);
  if (c < 0 || r < 0 || c >= photo.width || r >= photo.height) return Number.NaN;
  const o = (r * photo.width + c) * 4;
  return photo.data[o + 3] + (photo.data[o] + photo.data[o + 1] + photo.data[o + 2]) / 6;
}

/**
 * k for one block. `grid`/`chm` are a CHM crop covering the block (unsmoothed
 * heights), `photo` a native mosaic covering it plus the largest displacement
 * (0.9 x the tallest tree), `sun` the flight's sun. Returns { kx, ky,
 * correlation, zeroCorrelation, cells } (kx, ky null when there is too little
 * canopy).
 */
export function estimateDisplacement(grid, chm, photo, sun, { minimumCells = 400, range = 0.9, coarse = 0.05, fine = 0.01, stride = 1 } = {}) {
  const shade = canopyHillshade(grid, chm, sun);
  const { width, height, sampleSpacingMetres: s } = grid;
  const cells = [];
  for (let r = 0; r < height; r += stride) for (let c = 0; c < width; c += stride) {
    const i = r * width + c;
    if (!Number.isNaN(shade[i])) cells.push(i);
  }
  if (cells.length < minimumCells) return { kx: null, ky: null, correlation: null, zeroCorrelation: null, cells: cells.length };
  const xs = new Float64Array(cells.length), ys = new Float64Array(cells.length), hs = new Float64Array(cells.length), zs = new Float64Array(cells.length);
  cells.forEach((i, j) => {
    const r = Math.floor(i / width), c = i - r * width;
    xs[j] = grid.minEasting + (c + 0.5) * s; ys[j] = grid.maxNorthing - (r + 0.5) * s;
    hs[j] = shade[i]; zs[j] = chm[i];
  });
  const correlate = (kx, ky) => {
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let j = 0; j < xs.length; j++) {
      const v = photoBrightness(photo, xs[j] + kx * zs[j], ys[j] + ky * zs[j]);
      if (Number.isNaN(v)) continue;
      const h = hs[j];
      n++; sx += h; sy += v; sxx += h * h; syy += v * v; sxy += h * v;
    }
    if (n < minimumCells / 2) return -1;
    const den = Math.sqrt((sxx - (sx * sx) / n) * (syy - (sy * sy) / n));
    return den > 0 ? (sxy - (sx * sy) / n) / den : -1;
  };
  let best = { kx: 0, ky: 0, correlation: -Infinity };
  const steps = Math.round(range / coarse);
  for (let a = -steps; a <= steps; a++) for (let b = -steps; b <= steps; b++) {
    const kx = a * coarse, ky = b * coarse;
    const value = correlate(kx, ky);
    if (value > best.correlation) best = { kx, ky, correlation: value };
  }
  const centre = { ...best };
  /* refine over +-half a coarse step (at least +-0.05) */
  const fineSteps = Math.round(Math.max(coarse / 2, 0.05) / fine);
  for (let a = -fineSteps; a <= fineSteps; a++) for (let b = -fineSteps; b <= fineSteps; b++) {
    const kx = centre.kx + a * fine, ky = centre.ky + b * fine;
    const value = correlate(kx, ky);
    if (value > best.correlation) best = { kx, ky, correlation: value };
  }
  const r3 = v => Math.round(v * 1000) / 1000;
  return { kx: r3(best.kx), ky: r3(best.ky), correlation: r3(best.correlation), zeroCorrelation: r3(correlate(0, 0)), cells: cells.length };
}

/** A quantile (default the median) of the canopy heights (>= minimum) of a CHM crop inside a bbox. */
export function medianCanopyHeight(grid, chm, bbox, minimum = 3, quantile = 0.5) {
  const s = grid.sampleSpacingMetres, values = [];
  for (let r = 0; r < grid.height; r++) for (let c = 0; c < grid.width; c++) {
    const e = grid.minEasting + (c + 0.5) * s, n = grid.maxNorthing - (r + 0.5) * s;
    if (e < bbox[0] || e >= bbox[2] || n < bbox[1] || n >= bbox[3]) continue;
    const h = chm[r * grid.width + c];
    if (h >= minimum) values.push(h);
  }
  values.sort((a, b) => a - b);
  return values.length ? values[Math.floor(quantile * (values.length - 1))] : null;
}

/* ---------- the field over a whole window, and the photo valley ---------- */

/**
 * k per square block over `bbox` (EPSG:3006) from a photo mosaic (any
 * resolution; the 0.32 m analysis mosaic suffices for k). Each block is
 * matched over itself plus `marginMetres`. A block is `measured` when its
 * peak correlation is at least `minimumCorrelation` and leads the k = 0
 * correlation by at least `minimumLead`; a block that is not takes the
 * nearest measured block within `fillBlocks` (Chebyshev; recorded as
 * `filled`), else it has no k and the photo cannot referee there.
 */
export function displacementField(chm, mosaic, sun, bbox, {
  blockMetres = 64, marginMetres = 16, minimumCells = 400, minimumCorrelation = 0.2, minimumLead = 0.1, fillBlocks = 2, coarse = 0.1, stride = 2,
} = {}) {
  const g = chm.grid, s = g.sampleSpacingMetres;
  const columns = Math.ceil((bbox[2] - bbox[0]) / blockMetres), rows = Math.ceil((bbox[3] - bbox[1]) / blockMetres);
  const blocks = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const e0 = bbox[0] + i * blockMetres - marginMetres, n1 = bbox[3] - j * blockMetres + marginMetres;
    const e1 = e0 + blockMetres + 2 * marginMetres, n0 = n1 - blockMetres - 2 * marginMetres;
    const c0 = Math.max(0, Math.floor((e0 - g.minEasting) / s)), c1 = Math.min(g.width, Math.ceil((e1 - g.minEasting) / s));
    const r0 = Math.max(0, Math.floor((g.maxNorthing - n1) / s)), r1 = Math.min(g.height, Math.ceil((g.maxNorthing - n0) / s));
    const width = c1 - c0, height = r1 - r0;
    const values = new Float32Array(width * height);
    for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) values[r * width + c] = chm.values[(r0 + r) * g.width + c0 + c];
    const grid = { minEasting: g.minEasting + c0 * s, maxNorthing: g.maxNorthing - r0 * s, width, height, sampleSpacingMetres: s };
    const k = estimateDisplacement(grid, values, mosaic, sun, { minimumCells: Math.ceil(minimumCells / (stride * stride)), coarse, stride });
    const measured = k.kx !== null && k.correlation >= minimumCorrelation && k.correlation - k.zeroCorrelation >= minimumLead;
    blocks.push({ i, j, ...k, measured });
  }
  for (const b of blocks) {
    if (b.measured) continue;
    let best = null;
    for (const o of blocks) {
      if (!o.measured) continue;
      const d = Math.max(Math.abs(o.i - b.i), Math.abs(o.j - b.j));
      if (d > fillBlocks) continue;
      const dd = Math.hypot(o.i - b.i, o.j - b.j);
      if (!best || dd < best.dd) best = { o, dd };
    }
    b.filled = best ? { kx: best.o.kx, ky: best.o.ky, from: [best.o.i, best.o.j] } : null;
  }
  return {
    bbox, blockMetres, marginMetres, columns, rows,
    rule: { minimumCorrelation, minimumLead, fillBlocks, coarse, stride, minimumCells },
    blocks: blocks.map(b => ({ i: b.i, j: b.j, kx: b.measured ? b.kx : b.filled?.kx ?? null, ky: b.measured ? b.ky : b.filled?.ky ?? null, correlation: b.correlation, zeroCorrelation: b.zeroCorrelation, cells: b.cells, state: b.measured ? 'measured' : b.filled ? 'filled' : 'none' })),
  };
}

/** k at a point from a field (its block's, or null). */
export function fieldAt(field, easting, northing) {
  const i = Math.floor((easting - field.bbox[0]) / field.blockMetres), j = Math.floor((field.bbox[3] - northing) / field.blockMetres);
  if (i < 0 || j < 0 || i >= field.columns || j >= field.rows) return null;
  const b = field.blocks[j * field.columns + i];
  return b && b.kx !== null ? { kx: b.kx, ky: b.ky } : null;
}

/** Brightness (relief.mjs photoBrightness) at a point from open orthophoto packs at their native resolution, as the mean of a 3 x 3 pixel patch. */
export function nativeBrightness(packs) {
  const p = packs[0].layout.pixelMetres;
  const pixel = (e, n) => {
    for (const pack of packs) {
      const l = pack.layout;
      const v = pack.pixel(Math.floor((e - l.originEasting) / p), Math.floor((l.originNorthing - n) / p));
      if (v) return v[3] + (v[0] + v[1] + v[2]) / 6;
    }
    return Number.NaN;
  };
  return (e, n) => {
    let sum = 0, count = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const v = pixel(e + dx * p, n + dy * p);
      if (!Number.isNaN(v)) { sum += v; count++; }
    }
    return count ? sum / count : Number.NaN;
  };
}

/**
 * The relative brightness valley between two tops in one photo: each top is
 * seen at its position plus k x fraction x its height (relief displacement);
 * the photo is sampled along the straight line between the two from 20% to
 * 80% of the way, and the valley is (dimmer top - darkest sample) / dimmer
 * top. Null where the field has no k.
 */
export function photoValley(field, brightness, top, other, fraction) {
  const k = fieldAt(field, top.easting, top.northing);
  if (!k) return null;
  const a = [top.easting + k.kx * fraction * top.height, top.northing + k.ky * fraction * top.height];
  const b = [other.easting + k.kx * fraction * other.height, other.northing + k.ky * fraction * other.height];
  const ba = brightness(a[0], a[1]), bb = brightness(b[0], b[1]);
  if (Number.isNaN(ba) || Number.isNaN(bb)) return null;
  let low = Infinity;
  for (let t = 0.2; t <= 0.8001; t += 0.05) {
    const v = brightness(a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]));
    if (v < low) low = v;
  }
  const dim = Math.min(ba, bb);
  return (dim - low) / Math.max(1, dim);
}
