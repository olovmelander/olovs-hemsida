/* Two holes may use one physical tee. Keep each hole's marker associations,
 * while submitting identical physical ground only once to rendering/indexing. */
function ringKey(input) {
  if (!Array.isArray(input) || input.length < 3 || input.some(p =>
    !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) return null;
  // Subtracting a million-metre CRS origin introduces ~1e-9 m cancellation
  // noise. Normalize only the identity key to 1e-7 m; source geometry is never
  // rounded or moved, and no cartographic overlap tolerance is used.
  const ring = input.map(point => point.map(value => Math.round(value * 1e7) / 1e7));
  if (ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) ring.pop();
  if (ring.length < 3) return null;
  let first = 0;
  for (let i = 1; i < ring.length; i++) {
    if (ring[i][0] < ring[first][0] || (ring[i][0] === ring[first][0] && ring[i][1] < ring[first][1])) first = i;
  }
  const forward = JSON.stringify(ring.map((_, i) => ring[(first + i) % ring.length]));
  const reverse = JSON.stringify(ring.map((_, i) => ring[(first - i + ring.length) % ring.length]));
  return forward < reverse ? forward : reverse;
}

export function teePadSurfaceOwners(holes) {
  const owners = new Set(), seen = new Set();
  // Lowest numbered playing hole owns shared ground independently of array
  // order. No buffering or cartographic overlap threshold merges nearby tees.
  const ordered = (holes || []).map((hole, index) => ({ hole, index })).sort((a, b) =>
    (Number.isSafeInteger(a.hole?.n) ? a.hole.n : a.index) -
    (Number.isSafeInteger(b.hole?.n) ? b.hole.n : b.index));
  for (const { hole } of ordered) {
    for (const pad of hole?.tees?.pads || []) {
      const key = ringKey(pad?.ring);
      if (key === null || !seen.has(key)) owners.add(pad);
      if (key !== null) seen.add(key);
    }
  }
  return owners;
}
