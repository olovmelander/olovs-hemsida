/* The realistic catalogues' GLB writer: geometry only, a `crown` and a `trunk` node, KHR_mesh_quantization.
   The catalogue was first written in 32-bit floats throughout, with a white colour attribute on every crown vertex
   and 32-bit indices: 50 bytes a vertex. Quantized it is 19 (load times, 4 November): positions in 16 bits of each
   mesh's own box (0.3 mm on a tree), normals in 8, leaf uvs in 16, 16-bit indices, and no colour on a crown, which
   the loader takes as white. The bark's uvs stay floats, since they repeat round the trunk past 1. The scale is the
   same on all three axes, as the loader carries a node's matrix into the normals. three's GLTFLoader reads all of
   it; ghibli-tree-assets.mjs toGeometry bakes it back to floats through getX and the node's matrix. */
const COMPONENT = new Map([[Float32Array, 5126], [Int16Array, 5122], [Uint16Array, 5123], [Int8Array, 5120], [Uint32Array, 5125]]);
const COMPONENTS = { VEC2: 2, VEC3: 3 };

/* a GLB of named meshes: { name, attributes: { POSITION: [typed array, 'VEC3', stride in elements], ... },
   index: typed array, translation, scale } */
export function glb(meshes) {
  const views = [], accessors = [], nodes = [], gltfMeshes = [], parts = [];
  let offset = 0;
  const push = (bytes, target, byteStride = 0) => {
    const pad = (4 - bytes.length % 4) % 4;
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(byteStride ? { byteStride } : {}), ...(target ? { target } : {}) });
    parts.push(bytes, Buffer.alloc(pad)); offset += bytes.length + pad;
    return views.length - 1;
  };
  for (const m of meshes) {
    const attributes = {};
    for (const [name, [array, type, stride = COMPONENTS[type]]] of Object.entries(m.attributes)) {
      const n = COMPONENTS[type], count = array.length / stride, normalized = !(array instanceof Float32Array);
      const byteStride = stride === n ? 0 : stride * array.BYTES_PER_ELEMENT;
      const acc = { bufferView: push(Buffer.from(array.buffer, array.byteOffset, array.byteLength), 34962, byteStride),
        componentType: COMPONENT.get(array.constructor), count, type, ...(normalized ? { normalized: true } : {}) };
      if (name === 'POSITION') {
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], array[i * stride + k]); max[k] = Math.max(max[k], array[i * stride + k]); }
        acc.min = min; acc.max = max;
      }
      accessors.push(acc); attributes[name] = accessors.length - 1;
    }
    accessors.push({ bufferView: push(Buffer.from(m.index.buffer, m.index.byteOffset, m.index.byteLength), 34963),
      componentType: COMPONENT.get(m.index.constructor), count: m.index.length, type: 'SCALAR' });
    gltfMeshes.push({ name: m.name, primitives: [{ attributes, indices: accessors.length - 1 }] });
    nodes.push({ name: m.name, mesh: gltfMeshes.length - 1, ...(m.translation ? { translation: m.translation, scale: [m.scale, m.scale, m.scale] } : {}) });
  }
  const json = { asset: { version: '2.0', generator: 'banvy realistic_trees.py + tree-glb.mjs' },
    extensionsUsed: ['KHR_mesh_quantization'], extensionsRequired: ['KHR_mesh_quantization'], scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes, meshes: gltfMeshes, accessors, bufferViews: views, buffers: [{ byteLength: offset }] };
  const raw = Buffer.from(JSON.stringify(json)), jpad = Buffer.alloc((4 - raw.length % 4) % 4, 32);
  const bin = Buffer.concat(parts);
  const header = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  const total = 12 + 8 + raw.length + jpad.length + 8 + bin.length;
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
  jh.writeUInt32LE(raw.length + jpad.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, raw, jpad, bh, bin]);
}

/* positions into 16 bits of the mesh's own box, each vertex padded to 8 bytes as glTF's alignment asks */
function quantizePositions(position) {
  const count = position.length / 3, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], position[i * 3 + k]); max[k] = Math.max(max[k], position[i * 3 + k]); }
  const translation = min.map((v, k) => (v + max[k]) / 2), scale = Math.max(...min.map((v, k) => (max[k] - v) / 2)) || 1;
  const out = new Int16Array(count * 4);
  for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.round((position[i * 3 + k] - translation[k]) / scale * 32767);
  return { out, translation, scale };
}
function quantizeNormals(normal) {
  const count = normal.length / 3, out = new Int8Array(count * 4);
  for (let i = 0; i < count; i++) {
    const L = Math.hypot(normal[i * 3], normal[i * 3 + 1], normal[i * 3 + 2]) || 1;
    for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.round(normal[i * 3 + k] / L * 127);
  }
  return out;
}
const indices = list => { const vertices = Math.max(...list) + 1; return vertices < 65536 ? Uint16Array.from(list) : Uint32Array.from(list); };

/** One tree's GLB, from realistic_trees.py's JSON. */
export function treeGlb(t) {
  const crown = quantizePositions(t.crown.position), trunk = quantizePositions(t.trunk.position);
  const colour = Uint16Array.from({ length: t.trunk.color.length / 3 * 4 }, (_, i) => i % 4 === 3 ? 0 : Math.round(Math.min(1, t.trunk.color[(i >> 2) * 3 + i % 4]) * 65535));
  return glb([
    { name: 'crown', translation: crown.translation, scale: crown.scale, index: indices(t.crown.index), attributes: {
      POSITION: [crown.out, 'VEC3', 4], NORMAL: [quantizeNormals(t.crown.normal), 'VEC3', 4],
      TEXCOORD_0: [Uint16Array.from(t.crown.uv, v => Math.round(Math.min(1, Math.max(0, v)) * 65535)), 'VEC2'] } },
    { name: 'trunk', translation: trunk.translation, scale: trunk.scale, index: indices(t.trunk.index), attributes: {
      POSITION: [trunk.out, 'VEC3', 4], NORMAL: [quantizeNormals(t.trunk.normal), 'VEC3', 4], COLOR_0: [colour, 'VEC3', 4],
      TEXCOORD_0: [Float32Array.from(t.trunk.uv), 'VEC2'] } },
  ]);
}
