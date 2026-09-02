/* Exact Euclidean signed distance fields for the per-class surface compiler.

   The legacy atlas propagates a 3 x 3 chamfer (1, sqrt 2), which is cheap and
   directionally biased: along a diagonal edge it overestimates by up to 8%,
   and a class boundary drawn from it wobbles with the grid. The per-class
   representation exists to make boundaries continuous, so its distances must
   not carry the grid in them. This is the separable exact transform of
   Felzenszwalb and Huttenlocher ("Distance Transforms of Sampled Functions"):
   a lower envelope of parabolas per row, then per column, O(n) per line and
   exact to floating point.

   Everything here is pure typed-array work with no dependency, so it runs the
   same in Node (the compiler) and, if ever needed, in the browser. */

const INF = 1e20;

/* One-dimensional squared distance transform of f (Float64), in place into d.
   v and z are scratch arrays of length n and n + 1. */
function transform1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/**
 * Squared Euclidean distance from every pixel to the nearest pixel where
 * `isTarget(index)` is true, in pixels. Pixels with no target anywhere get INF.
 * Returns a Float32Array of width * height.
 */
export function squaredDistanceTransform(width, height, isTarget) {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw new RangeError('distance transform dimensions must be positive integers');
  }
  if (typeof isTarget !== 'function') throw new TypeError('isTarget must be a function');
  const grid = new Float32Array(width * height);
  const n = Math.max(width, height);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);

  /* rows: seed 0 at targets, INF elsewhere, and transform along x */
  for (let row = 0; row < height; row++) {
    const base = row * width;
    for (let column = 0; column < width; column++) f[column] = isTarget(base + column) ? 0 : INF;
    transform1d(f, width, d, v, z);
    for (let column = 0; column < width; column++) grid[base + column] = d[column];
  }
  /* columns: transform the row result along y */
  for (let column = 0; column < width; column++) {
    for (let row = 0; row < height; row++) f[row] = grid[row * width + column];
    transform1d(f, height, d, v, z);
    for (let row = 0; row < height; row++) grid[row * width + column] = d[row];
  }
  return grid;
}

/**
 * Signed distance in metres from every pixel to the boundary of the region
 * where mask[index] === 1: positive inside, negative outside.
 *
 * The value is sqrt(dOut^2) - sqrt(dIn^2): an inside pixel's distance to the
 * nearest outside pixel centre minus an outside pixel's distance to the
 * nearest inside pixel centre. For the two pixels either side of a boundary
 * that gives +1 and -1 pixel, so linear interpolation crosses zero exactly on
 * the shared pixel EDGE, which is where the boundary is. The magnitude is
 * overstated by at most half a pixel right at the edge and exact beyond it;
 * that bias is what puts the contour on the edge rather than half a pixel in.
 *
 * A region with no inside pixels saturates negative everywhere and a region
 * with no outside pixels saturates positive; with `clampMetres` those become
 * exactly the clamp, which is what a byte encoding needs.
 */
export function signedDistanceField(mask, width, height, { pixelMetres, clampMetres = null } = {}) {
  if (!(mask instanceof Uint8Array) || mask.length !== width * height) {
    throw new TypeError('mask must be a Uint8Array of width * height');
  }
  if (!(pixelMetres > 0)) throw new RangeError('pixelMetres must be positive');
  if (clampMetres !== null && !(clampMetres > 0)) throw new RangeError('clampMetres must be positive');
  const toOutside = squaredDistanceTransform(width, height, index => mask[index] === 0);
  const toInside = squaredDistanceTransform(width, height, index => mask[index] !== 0);
  const field = toOutside;
  for (let index = 0; index < field.length; index++) {
    const inside = mask[index] !== 0;
    let value = inside ? Math.sqrt(toOutside[index]) : -Math.sqrt(toInside[index]);
    value *= pixelMetres;
    if (clampMetres !== null) value = Math.max(-clampMetres, Math.min(clampMetres, value));
    field[index] = value;
  }
  return field;
}

/**
 * Cut a sub-window out of a row-major Uint8Array, clamped to the source.
 * Returns the copied window and where it sits in the source.
 */
export function extractWindow(source, sourceWidth, sourceHeight, { column0, row0, column1, row1 }) {
  const c0 = Math.max(0, column0), r0 = Math.max(0, row0);
  const c1 = Math.min(sourceWidth - 1, column1), r1 = Math.min(sourceHeight - 1, row1);
  if (c1 < c0 || r1 < r0) throw new RangeError('window does not intersect the source');
  const width = c1 - c0 + 1, height = r1 - r0 + 1;
  const data = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) {
    const from = (r0 + row) * sourceWidth + c0;
    data.set(source.subarray(from, from + width), row * width);
  }
  return Object.freeze({ data, width, height, column0: c0, row0: r0 });
}
