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

export function sourceWaterPolygon(feature, origin = LIDINGO_ENVIRONMENT_WATER) {
  if (feature?.geometry?.type !== 'Polygon' || !feature.geometry.coordinates.length) throw new Error('Source water requires a polygon with all its rings');
  const rings = feature.geometry.coordinates.map(source => {
    if (!Array.isArray(source) || source.length < 4 || source.some(p => p.length !== 3 || !p.every(Number.isFinite))) {
      throw new Error('Source water requires finite EPSG3006/RH2000 triples');
    }
    const first = source[0], last = source.at(-1);
    if (first.some((v, i) => v !== last[i])) throw new Error('Source water ring is not closed');
    return source.slice(0, -1).map(([e, n, h]) => [e - origin.originEasting, origin.originNorthing - n, h]);
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
export async function buildLidingoWaterBatches(collection, yieldWork = async () => {}) {
  const groups = new Map();
  for (const feature of collection.features) {
    const key = feature.properties.sourceItemId;
    if (!/^65[789]_6[678]$/.test(key)) throw new Error('Unexpected surrounding water source item');
    const group = groups.get(key) || { sourceItemId: key, positions: [], indices: [], features: [], interiorRings: 0 };
    const polygon = sourceWaterPolygon(feature), offset = group.positions.length / 3;
    for (const p of polygon.positions) group.positions.push(p);
    for (const i of polygon.indices) group.indices.push(i + offset);
    group.features.push(feature.id);
    group.interiorRings += polygon.interiorRings;
    groups.set(key, group);
    await yieldWork();
  }
  return [...groups.values()];
}
