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
  const fineSteps = Math.round(coarse / fine);
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
