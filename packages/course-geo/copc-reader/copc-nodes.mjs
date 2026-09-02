/* The pure half of the COPC reader: which nodes a window needs, under the
   item's own subdivision, plus the decode cache. No network, no WASM, so the
   suite can test it without the copc dependency installed.

   Node footprints follow the HEADER EXTENT per axis, not the specification's
   cube: Lantmäteriet's Untwine-built half-tile items subdivide the 5 km data
   half in Y and the point heights in Z, and only X coincides with the cube.
   Verified node by node on all three Puttom items
   (verify-octree-convention.mjs); a reader that prunes by the cube reads the
   wrong ground, which is what the 52-point PDAL window was.                  */

export function safeCopcUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'dl1.lantmateriet.se' ||
      !url.pathname.startsWith('/hojd/data/pointcloud/sls/') || !url.pathname.endsWith('.copc.laz') ||
      url.search || url.hash || url.username || url.password) {
    throw new Error('refusing a data URL that is not a Laserdata Skog COPC asset');
  }
  return url;
}

export function nodeFootprint(dataBounds, entry) {
  const [minX, minY, maxX, maxY] = dataBounds;
  const sizeX = (maxX - minX) / 2 ** entry.d;
  const sizeY = (maxY - minY) / 2 ** entry.d;
  const x0 = minX + entry.x * sizeX;
  const y0 = minY + entry.y * sizeY;
  return [x0, y0, x0 + sizeX, y0 + sizeY];
}

function intersects(a, b) {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

/**
 * Entries whose footprint, padded by `padMetres`, touches the window. The
 * pad covers the writer's boundary rounding (measured at 0.01 m) with room to
 * spare; a whole-node dilation decoded three times the bytes for nothing.
 */
export function nodesForWindow(dataBounds, entries, bbox, { padMetres = 2 } = {}) {
  const out = [];
  for (const entry of entries) {
    const footprint = nodeFootprint(dataBounds, entry);
    const padded = [footprint[0] - padMetres, footprint[1] - padMetres, footprint[2] + padMetres, footprint[3] + padMetres];
    if (intersects(padded, bbox)) out.push(entry);
  }
  return out;
}

export function nodeKey(entry) {
  return `${entry.d}-${entry.x}-${entry.y}-${entry.z}`;
}

/** A bounded decode cache so neighbouring windows share nodes; oldest out first. */
export function createNodeCache({ maxPoints = 12_000_000 } = {}) {
  const map = new Map();
  let points = 0;
  return {
    get: key => map.get(key) || null,
    set(key, value) {
      if (map.has(key)) return;
      map.set(key, value);
      points += value.count;
      while (points > maxPoints && map.size > 1) {
        const [oldest, entry] = map.entries().next().value;
        map.delete(oldest);
        points -= entry.count;
      }
    },
    get size() { return map.size; },
    get points() { return points; },
  };
}
