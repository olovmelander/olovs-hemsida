/* The land-cover record: what the ground IS, out to the far ring, read off
   the orthophoto by tools/build-landcover.mjs and served beside the pack as
   courses/<slug>/landcover.json.

   One class per 12 m cell, four bits each, the nibble stream raw-deflated and
   base64'd (the pack's own codec inflates it). The record is an APPEARANCE
   mask for ground no survey reaches -- the far tint, the far cones, the
   planted ring's satellite authority beyond the 3 m raster -- and never a
   statement about a played surface: anything inside the tree-cover raster's
   own box keeps that raster's word, and the runtime consults this only where
   that finer record is silent. */
export const LANDCOVER = Object.freeze({
  UNKNOWN: 0, WATER: 1, OPEN_GREEN: 2, TREES: 3, OPEN_PALE: 4, LIGHT_TREES: 5, HARD: 6,
});
export const LANDCOVER_NAMES = Object.freeze(['unknown', 'water', 'open-green', 'trees', 'open-pale', 'light-trees', 'hard']);

export const isTreeClass = c => c === LANDCOVER.TREES || c === LANDCOVER.LIGHT_TREES;
export const isOpenClass = c => c === LANDCOVER.OPEN_GREEN || c === LANDCOVER.OPEN_PALE;

/** Two cells per byte, low nibble first. */
export function packNibbles(cells) {
  const out = new Uint8Array(Math.ceil(cells.length / 2));
  for (let k = 0; k < cells.length; k++) {
    if (cells[k] > 15 || cells[k] < 0) throw new RangeError(`landcover class ${cells[k]} at ${k} does not fit a nibble`);
    out[k >> 1] |= (cells[k] & 15) << ((k & 1) * 4);
  }
  return out;
}
export function unpackNibbles(bytes, n) {
  if (bytes.length !== Math.ceil(n / 2)) throw new RangeError(`landcover raster holds ${bytes.length} bytes for ${n} cells`);
  const out = new Uint8Array(n);
  for (let k = 0; k < n; k++) out[k] = (bytes[k >> 1] >> ((k & 1) * 4)) & 15;
  return out;
}

function checkLattice(record) {
  const { x0, z0, nx, nz, cell } = record || {};
  if (![x0, z0, cell].every(Number.isFinite) || cell <= 0 ||
      !Number.isSafeInteger(nx) || !Number.isSafeInteger(nz) || nx < 1 || nz < 1 || nx * nz > 16_777_216)
    throw new TypeError('Invalid landcover lattice');
}

/** Decode the record's cells with the codec's inflate (async: DecompressionStream). */
export async function decodeLandcover(record, inflate) {
  checkLattice(record);
  if (record.enc !== 'deflate-raw+b64' || typeof record.b64 !== 'string') throw new TypeError(`landcover encoding ${record.enc} is not deflate-raw+b64`);
  const cells = unpackNibbles(await inflate(record.b64), record.nx * record.nz);
  return { ...record, cells };
}

/** Cell-centred lookup; outside the lattice is UNKNOWN, never extrapolated. */
export function landcoverSampler(decoded) {
  if (!decoded) return () => LANDCOVER.UNKNOWN;
  checkLattice(decoded);
  const { x0, z0, nx, nz, cell, cells } = decoded;
  if (!(cells instanceof Uint8Array) || cells.length !== nx * nz) throw new RangeError('landcover cells do not match the lattice');
  const at = (x, z) => {
    const i = Math.floor((x - x0) / cell), j = Math.floor((z - z0) / cell);
    if (!Number.isFinite(i + j) || i < 0 || j < 0 || i >= nx || j >= nz) return LANDCOVER.UNKNOWN;
    return cells[j * nx + i];
  };
  at.bounds = { x0, z0, x1: x0 + nx * cell, z1: z0 + nz * cell };
  at.cell = cell;
  return at;
}

/** The fraction of the classes' cells in a square window that are trees --
 *  what a cone loop or a floor tint wants, rather than one cell's verdict. */
export function treeFraction(sample, x, z, radius) {
  const step = Math.max(sample.cell || radius, 1);
  let hit = 0, n = 0;
  for (let dz = -radius; dz <= radius; dz += step) for (let dx = -radius; dx <= radius; dx += step) {
    const c = sample(x + dx, z + dz);
    if (c === LANDCOVER.UNKNOWN) continue;
    n++; if (isTreeClass(c)) hit++;
  }
  return n ? hit / n : -1;
}
