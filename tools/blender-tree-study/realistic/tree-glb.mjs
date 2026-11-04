/* The realistic catalogues' GLB writer: geometry only, a `crown` and a `trunk` node. */
/* a GLB of named meshes: { name, attributes: { POSITION: [Float32Array, 'VEC3'], ... }, index: Uint32Array } */
export function glb(meshes) {
  const views = [], accessors = [], nodes = [], gltfMeshes = [], parts = [];
  let offset = 0;
  const push = (bytes, target) => {
    const pad = (4 - bytes.length % 4) % 4;
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
    parts.push(bytes, Buffer.alloc(pad)); offset += bytes.length + pad;
    return views.length - 1;
  };
  for (const m of meshes) {
    const attributes = {};
    for (const [name, [array, type]] of Object.entries(m.attributes)) {
      const n = { VEC2: 2, VEC3: 3 }[type], count = array.length / n;
      const acc = { bufferView: push(Buffer.from(array.buffer, array.byteOffset, array.byteLength), 34962), componentType: 5126, count, type };
      if (name === 'POSITION') {
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], array[i * 3 + k]); max[k] = Math.max(max[k], array[i * 3 + k]); }
        acc.min = min; acc.max = max;
      }
      accessors.push(acc); attributes[name] = accessors.length - 1;
    }
    accessors.push({ bufferView: push(Buffer.from(m.index.buffer, m.index.byteOffset, m.index.byteLength), 34963), componentType: 5125, count: m.index.length, type: 'SCALAR' });
    gltfMeshes.push({ name: m.name, primitives: [{ attributes, indices: accessors.length - 1 }] });
    nodes.push({ name: m.name, mesh: gltfMeshes.length - 1 });
  }
  const json = { asset: { version: '2.0', generator: 'banvy realistic_trees.py + pack_catalogue.mjs' }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }],
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
