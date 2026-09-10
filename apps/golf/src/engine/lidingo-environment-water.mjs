/* Measured water outside Lidingö's original course crop. Rings include islands
 * and the course-window exclusion. Keep every source vertex and its RH2000
 * elevation; neither a sea rectangle nor a terrain-derived flood mask is used. */
import { ShapeUtils, Vector2 } from 'three/webgpu';

export const LIDINGO_ENVIRONMENT_WATER = Object.freeze({
  url: 'courses/lidingo/environment-water-22d904c63d31ccb7a331e1a0f4f177398f26632c20edb31cbc56774a475e14e3.geojson',
  sha256: '22d904c63d31ccb7a331e1a0f4f177398f26632c20edb31cbc56774a475e14e3',
  bytes: 1326369, features: 144,
  originEasting: 677700.5, originNorthing: 6586399.5,
});

/* The Lantmäteriet items are 10 km squares, and every polygon was clipped to
   its own item: the sea is one sheet in the world and four polygons in the
   file, abutting along E 680000, N 6580000 and N 6590000. */
const ITEM_METRES = 10000;
const SEAM_EPSILON = 1e-6;
const onItemSeam = value => Math.abs(value / ITEM_METRES - Math.round(value / ITEM_METRES)) * ITEM_METRES < SEAM_EPSILON;

/**
 * The vertices every polygon puts ON a seam, keyed by that seam line
 * (`E:680000`, `N:6590000`), for the weld below. Read from the whole
 * collection so a polygon can take up its neighbour's vertices. The item
 * seams are found by arithmetic; `extraSeams` names other straight cuts a
 * neighbour geometry shares -- the course window's four edges, along which
 * the pack's own sea rings meet these polygons -- each as
 * `{ axis: 'E' | 'N', value, points: [[along, height], ...] }`.
 */
export function collectSeamVertices(collection, extraSeams = []) {
  const seams = new Map();
  const lines = { E: new Map(), N: new Map() };
  const take = (key, along, height) => {
    const list = seams.get(key) || [];
    list.push([along, height]);
    seams.set(key, list);
  };
  for (const seam of extraSeams) {
    if (!['E', 'N'].includes(seam?.axis) || !Number.isFinite(seam.value)) throw new TypeError('an extra seam needs an axis and a finite value');
    const key = `${seam.axis}:${seam.value}`;
    lines[seam.axis].set(seam.value, key);
    for (const [along, height] of seam.points ?? []) take(key, along, height);
  }
  const keyFor = (axis, value) => {
    if (onItemSeam(value)) return `${axis}:${Math.round(value)}`;
    for (const [seamValue, key] of lines[axis]) if (Math.abs(value - seamValue) < SEAM_EPSILON) return key;
    return null;
  };
  for (const feature of collection.features) {
    if (feature?.geometry?.type !== 'Polygon') continue;
    for (const ring of feature.geometry.coordinates) for (const [e, n, h] of ring) {
      const ke = keyFor('E', e), kn = keyFor('N', n);
      if (ke) take(ke, n, h);
      if (kn) take(kn, e, h);
    }
  }
  /* sorted along the line and unique: a ring's closing copy of its first
     vertex and the neighbour's copy of a shared corner are one point */
  for (const [key, list] of seams) {
    list.sort((a, b) => a[0] - b[0]);
    seams.set(key, list.filter((point, i) => !i || point[0] - list[i - 1][0] >= SEAM_EPSILON));
  }
  seams.keyFor = keyFor;
  return seams;
}

/* An edge lying along a seam takes up every seam vertex its neighbour placed
   strictly inside it, in order. The outline is unchanged -- the points are
   collinear -- but the two triangulations now share vertices, so there is no
   T-junction to open into a hairline through which the ground behind shows.
   Heights are interpolated along the edge, which on the sea is 0.1 to 0.1. */
function weldRing(ring, seams) {
  if (!seams?.size) return ring;
  const keyFor = seams.keyFor ?? ((axis, value) => onItemSeam(value) ? `${axis}:${Math.round(value)}` : null);
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    out.push(p);
    let key = null, axis = -1;
    const ke = keyFor('E', p[0]), kn = keyFor('N', p[1]);
    if (ke && ke === keyFor('E', q[0]) && Math.abs(p[0] - q[0]) < SEAM_EPSILON) { key = ke; axis = 1; }
    else if (kn && kn === keyFor('N', q[1]) && Math.abs(p[1] - q[1]) < SEAM_EPSILON) { key = kn; axis = 0; }
    if (!key) continue;
    const list = seams.get(key);
    if (!list) continue;
    const a = p[axis], b = q[axis], lo = Math.min(a, b) + SEAM_EPSILON, hi = Math.max(a, b) - SEAM_EPSILON;
    const inside = list.filter(([along]) => along > lo && along < hi);
    if (!inside.length) continue;
    if (b < a) inside.reverse();
    let last = a;
    for (const [along] of inside) {
      if (Math.abs(along - last) < SEAM_EPSILON) continue;
      const t = (along - a) / (b - a);
      const point = axis === 1 ? [p[0], along, p[2] + (q[2] - p[2]) * t] : [along, p[1], p[2] + (q[2] - p[2]) * t];
      out.push(point);
      last = along;
    }
  }
  return out;
}

export function sourceWaterPolygon(feature, origin = LIDINGO_ENVIRONMENT_WATER, seams = null) {
  if (feature?.geometry?.type !== 'Polygon' || !feature.geometry.coordinates.length) throw new Error('Source water requires a polygon with all its rings');
  const rings = feature.geometry.coordinates.map(source => {
    if (!Array.isArray(source) || source.length < 4 || source.some(p => p.length !== 3 || !p.every(Number.isFinite))) {
      throw new Error('Source water requires finite EPSG3006/RH2000 triples');
    }
    const first = source[0], last = source.at(-1);
    if (first.some((v, i) => v !== last[i])) throw new Error('Source water ring is not closed');
    return weldRing(source.slice(0, -1), seams).map(([e, n, h]) => [e - origin.originEasting, origin.originNorthing - n, h]);
  });
  const vectors = rings.map(r => r.map(p => new Vector2(p[0], p[1])));
  const faces = ShapeUtils.triangulateShape(vectors[0], vectors.slice(1));
  if (!faces.length) throw new Error(`Source water ${feature.id} could not be triangulated`);
  const vertices = rings.flat(), positions = [], indices = [];
  for (const [x, z, h] of vertices) positions.push(x, h, z);
  for (const [a, b, c] of faces) {
    const p = vertices[a], q = vertices[b], r = vertices[c];
    const up = (q[1]-p[1])*(r[0]-p[0]) - (q[0]-p[0])*(r[1]-p[1]);
    if (up === 0) continue;
    indices.push(...(up > 0 ? [a, b, c] : [a, c, b]));
  }
  return { positions, indices, interiorRings: rings.length - 1 };
}

export async function loadLidingoEnvironmentWater({ baseUrl, fetchFn = fetch } = {}) {
  const response = await fetchFn(new URL(LIDINGO_ENVIRONMENT_WATER.url, baseUrl), { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Lidingö surrounding water HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== LIDINGO_ENVIRONMENT_WATER.bytes) throw new Error('Lidingö surrounding water size differs');
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
  if (digest !== LIDINGO_ENVIRONMENT_WATER.sha256) throw new Error('Lidingö surrounding water checksum differs');
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (data.type !== 'FeatureCollection' || data.crs?.properties?.name !== 'EPSG:3006' || data.features?.length !== LIDINGO_ENVIRONMENT_WATER.features) {
    throw new Error('Lidingö surrounding water source contract differs');
  }
  return data;
}

// At most nine batches, grouped by measured source item. Bounds are calculated
// from real vertices by the caller so each batch can be culled independently.
// The item seams are welded first (collectSeamVertices), so the batches meet
// vertex for vertex along E 680000 and the two northing lines.
export async function buildLidingoWaterBatches(collection, yieldWork = async () => {}, { extraSeams = [] } = {}) {
  const groups = new Map();
  const seams = collectSeamVertices(collection, extraSeams);
  for (const feature of collection.features) {
    const key = feature.properties.sourceItemId;
    if (!/^65[789]_6[678]$/.test(key)) throw new Error('Unexpected surrounding water source item');
    const group = groups.get(key) || { sourceItemId: key, positions: [], indices: [], features: [], interiorRings: 0 };
    const polygon = sourceWaterPolygon(feature, LIDINGO_ENVIRONMENT_WATER, seams), offset = group.positions.length / 3;
    for (const p of polygon.positions) group.positions.push(p);
    for (const i of polygon.indices) group.indices.push(i + offset);
    group.features.push(feature.id);
    group.interiorRings += polygon.interiorRings;
    groups.set(key, group);
    await yieldWork();
  }
  return [...groups.values()];
}

/** A polygon's stated level: its single height, or the top of its measured range. */
export function sourceWaterLevel(feature) {
  const p = feature.properties || {};
  if (Number.isFinite(p.heightRH2000)) return p.heightRH2000;
  const range = p.heightRangeRH2000;
  return Array.isArray(range) && range.every(Number.isFinite) ? Math.max(...range) : Number.NaN;
}

/* even-odd scanline fill of one polygon (outer ring and its holes together)
   into a cell raster; a cell is inside when its CENTRE is */
function fillPolygon(rings, coverage, { width, height, spacing, x0, z0 }) {
  let minRow = height, maxRow = -1;
  for (const ring of rings) for (const [, z] of ring) {
    const row = Math.floor((z - z0) / spacing);
    if (row < minRow) minRow = row; if (row > maxRow) maxRow = row;
  }
  minRow = Math.max(0, minRow); maxRow = Math.min(height - 1, maxRow);
  const crossings = [];
  for (let row = minRow; row <= maxRow; row++) {
    const zc = z0 + (row + 0.5) * spacing;
    crossings.length = 0;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, zi] = ring[i], [xj, zj] = ring[j];
        if ((zi > zc) !== (zj > zc)) crossings.push(xi + (zc - zi) * (xj - xi) / (zj - zi));
      }
    }
    if (crossings.length < 2) continue;
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((crossings[k] - x0) / spacing - 0.5));
      const c1 = Math.min(width - 1, Math.floor((crossings[k + 1] - x0) / spacing - 0.5));
      for (let c = c0; c <= c1; c++) coverage[row * width + c] = 1;
    }
  }
}

/**
 * Where the SEA verifiably is, as a cell raster the terrain material can
 * discard under -- the shape createCoastalTerrainMask reads. The laser DTM
 * carries the sea as a flat plate at its surface, and the measured sheet
 * sits a hand's width above it: at a kilometre the depth buffer cannot tell
 * them apart, terrain wins the tie, and land-coloured bands run across the
 * water. So the terrain is not drawn where a measured water polygon covers
 * it, exactly as the Norrfällsviken ocean does. No height is edited and no
 * shoreline is moved: a cell counts only when it and all eight neighbours
 * lie inside the water (a full cell of margin from every shore and island),
 * and the material still keeps any fragment above `maximumCoveredTerrainHeight`.
 *
 * @param collection  the acquired FeatureCollection (EPSG:3006 triples)
 * @param bounds      local-metre box to raster, {x0,z0,x1,z1}
 * @param bodies      [{ ring (local metres), level }] the model's own rings
 * @param seaLevelMaximum  polygons at or under this level are the sea
 */
export function buildSourceWaterCoverage(collection, {
  origin = LIDINGO_ENVIRONMENT_WATER, bounds, bodies = [], spacing = 16,
  seaLevelMaximum = 0.2, toleranceMetres = 0.15,
} = {}) {
  if (!bounds || !['x0', 'x1', 'z0', 'z1'].every(k => Number.isFinite(bounds[k])) || bounds.x1 <= bounds.x0 || bounds.z1 <= bounds.z0) {
    throw new TypeError('Source water coverage needs finite ordered bounds');
  }
  if (!(spacing > 0) || !Number.isFinite(seaLevelMaximum) || !Number.isFinite(toleranceMetres)) {
    throw new TypeError('Source water coverage needs a positive spacing and finite levels');
  }
  const width = Math.ceil((bounds.x1 - bounds.x0) / spacing), height = Math.ceil((bounds.z1 - bounds.z0) / spacing);
  if (width * height > 4e6) throw new RangeError('Source water coverage exceeds its boot budget');
  const grid = { width, height, spacing, x0: bounds.x0, z0: bounds.z0 };
  const inside = new Uint8Array(width * height);
  let polygons = 0, level = -Infinity;
  for (const feature of collection.features || []) {
    if (feature?.geometry?.type !== 'Polygon') continue;
    const h = sourceWaterLevel(feature);
    if (!Number.isFinite(h) || h > seaLevelMaximum) continue;
    const rings = feature.geometry.coordinates.map(ring => ring.map(([e, n]) => [e - origin.originEasting, origin.originNorthing - n]));
    fillPolygon(rings, inside, grid);
    polygons++; level = Math.max(level, h);
  }
  for (const body of bodies) {
    if (!Array.isArray(body?.ring) || body.ring.length < 3 || !Number.isFinite(body.level) || body.level > seaLevelMaximum) continue;
    fillPolygon([body.ring.map(p => [p[0], p[1]])], inside, grid);
    polygons++; level = Math.max(level, body.level);
  }
  const terrainCoverage = new Uint8Array(width * height);
  let cells = 0;
  for (let row = 1; row < height - 1; row++) for (let col = 1; col < width - 1; col++) {
    const i = row * width + col;
    if (!inside[i]) continue;
    if (!inside[i - 1] || !inside[i + 1] || !inside[i - width] || !inside[i + width] ||
        !inside[i - width - 1] || !inside[i - width + 1] || !inside[i + width - 1] || !inside[i + width + 1]) continue;
    terrainCoverage[i] = 1; cells++;
  }
  const cell = (x, z) => {
    const col = Math.floor((x - bounds.x0) / spacing), row = Math.floor((z - bounds.z0) / spacing);
    return col >= 0 && row >= 0 && col < width && row < height ? row * width + col : -1;
  };
  return Object.freeze({
    kind: 'source-water-coverage', width, height, spacing, cells, polygons,
    hectares: +(cells * spacing * spacing / 10000).toFixed(1),
    bounds: { x0: bounds.x0, z0: bounds.z0, x1: bounds.x0 + width * spacing, z1: bounds.z0 + height * spacing },
    terrainCoverage,
    seaLevel: Number.isFinite(level) ? level : seaLevelMaximum,
    maximumCoveredTerrainHeight: (Number.isFinite(level) ? level : seaLevelMaximum) + toleranceMetres,
    isSeaAt: (x, z) => { const i = cell(x, z); return i >= 0 && inside[i] === 1; },
    isCoveredAt: (x, z) => { const i = cell(x, z); return i >= 0 && terrainCoverage[i] === 1; },
  });
}
