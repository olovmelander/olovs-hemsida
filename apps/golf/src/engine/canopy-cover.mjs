/* The pack's two-bit, cell-centred canopy record. Unknown/outside cells never
 * acquire canopy. This is an appearance mask, not an individual-tree survey. */
export function canopySampler(cover) {
  if (!cover) return () => 0;
  const { x0, z0, nx, nz, cell, b64 } = cover;
  if (![x0, z0, cell].every(Number.isFinite) || cell <= 0 ||
      !Number.isSafeInteger(nx) || !Number.isSafeInteger(nz) || nx < 1 || nz < 1 ||
      nx * nz > 16_777_216 || typeof b64 !== 'string') throw new TypeError('Invalid canopy lattice');
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  if (bytes.length !== Math.ceil(nx * nz / 4)) throw new RangeError('Incomplete canopy raster');
  return (x, z) => {
    const i = Math.floor((x - x0) / cell), j = Math.floor((z - z0) / cell);
    if (!Number.isFinite(i + j) || i < 0 || j < 0 || i >= nx || j >= nz) return 0;
    const k = j * nx + i;
    return (bytes[k >> 2] >> ((k & 3) * 2)) & 3;
  };
}
