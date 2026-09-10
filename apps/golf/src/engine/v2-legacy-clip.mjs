import { BufferAttribute, InterleavedBuffer, InterleavedBufferAttribute } from 'three';

/* Subtract the verified rectangle from the legacy mesh, in the rectangle's
   own grid frame. Discarding a crossing triangle by its centroid also discards
   its part OUTSIDE the rectangle: the resulting missing wedges cannot be
   covered by a vertical terrain skirt. Here each half-plane emits its exterior
   polygon and passes only its interior to the next plane. Those exterior
   pieces partition the original triangle without overlap. */
export function clipLegacyTerrainGeometry(geometry, bounds, bridge, { heightAt, boundarySpacing = 0 } = {}) {
  const position = geometry?.getAttribute('position');
  const source = geometry?.getIndex()?.array;
  if (!position || !source) throw new TypeError('legacy terrain needs indexed positions');
  if (!bounds || !['x0', 'x1', 'z0', 'z1'].every(key => Number.isFinite(bounds[key])) ||
      !(bounds.x1 > bounds.x0 && bounds.z1 > bounds.z0)) {
    throw new TypeError('legacy terrain clip needs finite ordered bounds');
  }
  if (typeof bridge?.toGrid !== 'function') throw new TypeError('legacy terrain clip needs a grid bridge');
  if (heightAt !== undefined && typeof heightAt !== 'function') throw new TypeError('heightAt must be a function');
  if (!Number.isFinite(boundarySpacing) || boundarySpacing < 0) throw new TypeError('boundarySpacing must be finite and non-negative');
  if (source.length % 3 !== 0 || position.itemSize !== 3) throw new TypeError('legacy terrain must contain triangles');
  if (Object.keys(geometry.morphAttributes).length) throw new TypeError('legacy terrain clip does not support morph attributes');
  if (geometry.drawRange.start !== 0 || (geometry.drawRange.count !== Infinity && geometry.drawRange.count !== source.length)) {
    throw new TypeError('legacy terrain clip requires the complete draw range');
  }

  const originalVertices = position.count;
  const coordinates = new Float64Array(originalVertices * 2);
  for (let index = 0; index < originalVertices; index++) {
    const [x, z] = bridge.toGrid(position.getX(index), position.getZ(index));
    if (!Number.isFinite(x + z)) throw new TypeError('legacy terrain bridge returned non-finite coordinates');
    coordinates[index * 2] = x;
    coordinates[index * 2 + 1] = z;
  }
  const storage = new Map();
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if (attribute.count !== originalVertices || attribute.isInstancedBufferAttribute || attribute.data?.isInstancedInterleavedBuffer) {
      throw new TypeError(`legacy terrain attribute ${name} is not per vertex`);
    }
    const owner = attribute.isInterleavedBufferAttribute ? attribute.data : attribute;
    if (!storage.has(owner)) storage.set(owner, {
      owner, array: owner.array,
      stride: attribute.isInterleavedBufferAttribute ? owner.stride : attribute.itemSize,
      attributes: [],
    });
    storage.get(owner).attributes.push({ name, attribute });
  }

  const planes = [
    { axis: 'x', boundary: bounds.x0, sign: 1 },
    { axis: 'x', boundary: bounds.x1, sign: -1 },
    { axis: 'z', boundary: bounds.z0, sign: 1 },
    { axis: 'z', boundary: bounds.z1, sign: -1 },
  ];
  const distance = (node, plane) => (node[plane.axis] - plane.boundary) * plane.sign;
  const nodeFor = index => ({
    x: coordinates[index * 2], z: coordinates[index * 2 + 1],
    key: `v${index}`, index, weights: [[index, 1]],
  });
  const intersections = new Map();
  function intersect(a, b, plane, planeIndex) {
    const da = distance(a, plane), db = distance(b, plane);
    if (da === 0) return a;
    if (db === 0) return b;
    const key = a.key < b.key ? `${planeIndex}:${a.key}|${b.key}` : `${planeIndex}:${b.key}|${a.key}`;
    const cached = intersections.get(key);
    if (cached) return cached;
    const t = da / (da - db);
    const weights = new Map();
    for (const [index, weight] of a.weights) weights.set(index, weight * (1 - t));
    for (const [index, weight] of b.weights) weights.set(index, (weights.get(index) || 0) + weight * t);
    const node = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, key, weights: [...weights] };
    node[plane.axis] = plane.boundary;
    intersections.set(key, node);
    return node;
  }
  function split(polygon, plane, planeIndex) {
    const inside = [], outside = [];
    let a = polygon.at(-1), da = distance(a, plane);
    for (const b of polygon) {
      const db = distance(b, plane);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const crossing = intersect(a, b, plane, planeIndex);
        inside.push(crossing); outside.push(crossing);
      }
      if (db >= 0) inside.push(b);
      if (db <= 0) outside.push(b);
      a = b; da = db;
    }
    return { inside, outside };
  }
  const output = [], additions = [];
  const groups = geometry.groups.map(group => ({ ...group, start: null, count: 0 }));
  let removedTriangles = 0, addedTriangles = 0, fullyRemovedTriangles = 0, clippedTriangles = 0;
  const area2 = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  function vertexIndex(node) {
    if (node.index === undefined) {
      node.index = originalVertices + additions.length;
      additions.push(node);
    }
    return node.index;
  }
  function sampleBoundary(polygon, exteriorPlane) {
    if (!boundarySpacing) return polygon;
    const sampled = [];
    for (let index = 0; index < polygon.length; index++) {
      const a = polygon[index], b = polygon[(index + 1) % polygon.length];
      sampled.push(a);
      let axis, lower, upper;
      if (a.x === b.x && (a.x === bounds.x0 || a.x === bounds.x1)) {
        axis = 'z'; lower = bounds.z0; upper = bounds.z1;
      } else if (a.z === b.z && (a.z === bounds.z0 || a.z === bounds.z1)) {
        axis = 'x'; lower = bounds.x0; upper = bounds.x1;
      } else continue;
      const lo = Math.max(lower, Math.min(a[axis], b[axis]));
      const hi = Math.min(upper, Math.max(a[axis], b[axis]));
      const values = [];
      for (let step = Math.max(0, Math.ceil((lo - lower) / boundarySpacing)); lower + step * boundarySpacing <= hi; step++) {
        const value = lower + step * boundarySpacing;
        if (value > Math.min(a[axis], b[axis]) + 1e-10 && value < Math.max(a[axis], b[axis]) - 1e-10) values.push(value);
      }
      if (upper > Math.min(a[axis], b[axis]) + 1e-10 && upper < Math.max(a[axis], b[axis]) - 1e-10 && !values.includes(upper)) values.push(upper);
      if (a[axis] > b[axis]) values.reverse();
      for (const value of values) {
        const t = (value - a[axis]) / (b[axis] - a[axis]);
        const weights = new Map();
        for (const [vertex, weight] of a.weights) weights.set(vertex, weight * (1 - t));
        for (const [vertex, weight] of b.weights) weights.set(vertex, (weights.get(vertex) || 0) + weight * t);
        const node = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, weights: [...weights] };
        node[axis] = value;
        sampled.push(node);
      }
    }
    // A fan rooted on the clipped edge would drop its collinear samples even
    // though their measured heights vary. Root it strictly outside instead.
    const root = sampled.findIndex(node => distance(node, exteriorPlane) < -1e-10);
    return root > 0 ? [...sampled.slice(root), ...sampled.slice(0, root)] : sampled;
  }
  function emit(originalPolygon, exteriorPlane) {
    const polygon = sampleBoundary(originalPolygon, exteriorPlane);
    let emitted = 0;
    for (let index = 1; index + 1 < polygon.length; index++) {
      const a = polygon[0], b = polygon[index], c = polygon[index + 1];
      // Exact boundary contacts can repeat a vertex. They do not form a face.
      if (Math.abs(area2(a, b, c)) <= 1e-12) continue;
      output.push(vertexIndex(a), vertexIndex(b), vertexIndex(c));
      emitted++;
    }
    return emitted;
  }
  for (let offset = 0; offset < source.length; offset += 3) {
    const before = output.length;
    const a = source[offset], b = source[offset + 1], c = source[offset + 2];
    if (a >= originalVertices || b >= originalVertices || c >= originalVertices) throw new RangeError('legacy terrain index exceeds its vertices');
    const ax = coordinates[a * 2], az = coordinates[a * 2 + 1];
    const bx = coordinates[b * 2], bz = coordinates[b * 2 + 1];
    const cx = coordinates[c * 2], cz = coordinates[c * 2 + 1];
    // Most triangles need no polygon objects or attribute interpolation.
    const outside = (ax <= bounds.x0 && bx <= bounds.x0 && cx <= bounds.x0) ||
      (ax >= bounds.x1 && bx >= bounds.x1 && cx >= bounds.x1) ||
      (az <= bounds.z0 && bz <= bounds.z0 && cz <= bounds.z0) ||
      (az >= bounds.z1 && bz >= bounds.z1 && cz >= bounds.z1);
    const inside = ax >= bounds.x0 && ax <= bounds.x1 && az >= bounds.z0 && az <= bounds.z1 &&
      bx >= bounds.x0 && bx <= bounds.x1 && bz >= bounds.z0 && bz <= bounds.z1 &&
      cx >= bounds.x0 && cx <= bounds.x1 && cz >= bounds.z0 && cz <= bounds.z1;
    if (outside) {
      // A shared rectangle edge belongs to the exterior too; preserve it.
      output.push(a, b, c);
    } else if (inside) {
      removedTriangles++; fullyRemovedTriangles++;
    } else {
      let remaining = [nodeFor(a), nodeFor(b), nodeFor(c)];
      const exterior = [];
      for (let planeIndex = 0; planeIndex < planes.length && remaining.length >= 3; planeIndex++) {
        const part = split(remaining, planes[planeIndex], planeIndex);
        if (part.outside.length >= 3) exterior.push({ polygon: part.outside, plane: planes[planeIndex] });
        remaining = part.inside;
      }
      let emitted = 0;
      for (const { polygon, plane } of exterior) emitted += emit(polygon, plane);
      removedTriangles++;
      addedTriangles += emitted;
      if (emitted) clippedTriangles++; else fullyRemovedTriangles++;
    }
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const original = geometry.groups[groupIndex], group = groups[groupIndex];
      if (offset >= original.start && offset < original.start + original.count) {
        if (group.start === null) group.start = before;
        group.count += output.length - before;
      }
    }
  }

  const extraHeights = heightAt ? additions.map(node => {
    let x = 0, z = 0;
    for (const [index, weight] of node.weights) { x += position.getX(index) * weight; z += position.getZ(index) * weight; }
    const height = heightAt(x, z);
    return Number.isFinite(height) ? height : null;
  }) : null;
  // Build every replacement before touching geometry: a rejected callback or
  // malformed input leaves the original attributes, indices and metadata intact.
  const replacementAttributes = [];
  for (const entry of storage.values()) {
    const array = new entry.array.constructor((originalVertices + additions.length) * entry.stride);
    array.set(entry.array);
    for (let addition = 0; addition < additions.length; addition++) {
      const node = additions[addition], target = (originalVertices + addition) * entry.stride;
      for (let component = 0; component < entry.stride; component++) {
        let value = 0;
        for (const [index, weight] of node.weights) value += entry.array[index * entry.stride + component] * weight;
        array[target + component] = value;
      }
      if (extraHeights && extraHeights[addition] !== null) {
        const found = entry.attributes.find(({ name }) => name === 'position');
        if (found) array[target + (found.attribute.offset || 0) + 1] = extraHeights[addition];
      }
    }
    const interleaved = entry.attributes[0].attribute.isInterleavedBufferAttribute;
    const buffer = interleaved ? new InterleavedBuffer(array, entry.stride).setUsage(entry.owner.usage) : null;
    for (const { name, attribute } of entry.attributes) {
      const replacement = interleaved
        ? new InterleavedBufferAttribute(buffer, attribute.itemSize, attribute.offset, attribute.normalized)
        : new BufferAttribute(array, attribute.itemSize, attribute.normalized).setUsage(attribute.usage);
      replacement.name = attribute.name;
      if (attribute.gpuType !== undefined) replacement.gpuType = attribute.gpuType;
      replacementAttributes.push([name, replacement]);
    }
  }
  const IndexArray = originalVertices + additions.length > 65_535 ? Uint32Array : source.constructor;
  for (const [name, attribute] of replacementAttributes) geometry.setAttribute(name, attribute);
  geometry.setIndex(new BufferAttribute(new IndexArray(output), 1));
  geometry.clearGroups();
  for (const group of groups) if (group.count) geometry.addGroup(group.start, group.count, group.materialIndex);
  if (geometry.drawRange.count !== Infinity) geometry.setDrawRange(0, output.length);
  if (geometry.boundingBox) geometry.computeBoundingBox();
  if (geometry.boundingSphere) geometry.computeBoundingSphere();
  return Object.freeze({
    removedTriangles, fullyRemovedTriangles, clippedTriangles, addedTriangles,
    triangleDelta: addedTriangles - removedTriangles,
    addedVertices: additions.length,
    originalTriangles: source.length / 3,
    retainedTriangles: output.length / 3,
  });
}
