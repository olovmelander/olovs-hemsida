/* Pack the realistic catalogue (treeset v2): the Blender trees (realistic_trees.py's JSON) as
   geometry-only GLBs with a `crown` and a `trunk` node, the leaf atlases (make_leaf_atlas.mjs),
   all hash-named under apps/golf/public/models/trees/realistic-v2/, and the manifest
   apps/golf/public/models/trees/realistic-v2.json in the approved catalogue's schema.

   The template height and radius are the APPROVED catalogue's (ghibli-fluffy.json), not the new
   meshes' own: the loader fits every tier to them (fitFoliageTier), so a v2 tree stands exactly
   as tall and wide as the tree it replaces and placements and shadows still match.

   node tools/blender-tree-study/realistic/pack_catalogue.mjs <trees-json-dir> <atlas-dir>     */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const [treeDir, atlasDir] = process.argv.slice(2);
const root = path.resolve('apps/golf/public/models/trees');
const outDir = path.join(root, 'realistic-v2');
fs.mkdirSync(outDir, { recursive: true });
const approved = JSON.parse(fs.readFileSync(path.join(root, 'ghibli-fluffy.json')));
const atlasRecord = JSON.parse(fs.readFileSync(path.join(atlasDir, 'atlas.json')));
const sha = b => createHash('sha256').update(b).digest('hex');
export const REVISION = 'realistic-v2-2026-11-03';

/* a GLB of named meshes: { name, attributes: { POSITION: [Float32Array, 'VEC3'], ... }, index: Uint32Array } */
function glb(meshes) {
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

const write = (bytes, ext) => {
  const h = sha(bytes), file = `realistic-v2/${h}.${ext}`;
  fs.writeFileSync(path.join(root, file), bytes);
  return { file, bytes: bytes.length, sha256: h };
};

const species = [];
for (const old of approved.species) {
  const key = old.key, a = atlasRecord.species[key];
  if (!a) throw new Error(`no atlas for ${key}`);
  const atlasBytes = fs.readFileSync(path.join(atlasDir, `${key}.png`));
  if (sha(atlasBytes) !== a.sha256) throw new Error(`atlas ${key} does not match its record`);
  const atlas = write(atlasBytes, 'png');
  const variant = old.variants[0];
  const tiers = {};
  for (const tier of ['hero', 'full']) {
    const t = JSON.parse(fs.readFileSync(path.join(treeDir, `${key}-${tier}.json`)));
    const crownCount = t.crown.position.length / 3, trunkCount = t.trunk.position.length / 3;
    const bytes = glb([
      { name: 'crown', attributes: { POSITION: [Float32Array.from(t.crown.position), 'VEC3'], NORMAL: [Float32Array.from(t.crown.normal), 'VEC3'],
        TEXCOORD_0: [Float32Array.from(t.crown.uv), 'VEC2'], COLOR_0: [new Float32Array(crownCount * 3).fill(1), 'VEC3'] }, index: Uint32Array.from(t.crown.index) },
      { name: 'trunk', attributes: { POSITION: [Float32Array.from(t.trunk.position), 'VEC3'], NORMAL: [Float32Array.from(t.trunk.normal), 'VEC3'],
        COLOR_0: [Float32Array.from(t.trunk.color), 'VEC3'] }, index: Uint32Array.from(t.trunk.index) },
    ]);
    tiers[tier] = { ...write(bytes, 'glb'), tris: (t.crown.index.length + t.trunk.index.length) / 3 };
    void trunkCount;
  }
  species.push({ key, name: old.name, foliage: { key: old.foliage.key, atlas, mean: a.mean },
    variants: [{ seed: variant.seed, templateHeight: variant.templateHeight, templateRadius: variant.templateRadius, tiers }] });
}
const manifest = { schemaVersion: 1, kind: 'ghibli-trees', design: 'realistic-v2', revision: REVISION,
  budgets: { hero: Math.max(...species.map(s => s.variants[0].tiers.hero.tris)), full: Math.max(...species.map(s => s.variants[0].tiers.full.tris)) },
  source: { geometry: 'tools/blender-tree-study/realistic/realistic_trees.py', atlas: 'tools/blender-tree-study/realistic/make_leaf_atlas.mjs',
    pack: 'tools/blender-tree-study/realistic/pack_catalogue.mjs', fittedTo: 'ghibli-fluffy.json (approved hero heights and radii)' },
  species };
fs.writeFileSync(path.join(root, 'realistic-v2.json'), JSON.stringify(manifest, null, 2) + '\n');
for (const s of species) console.log(s.key, Object.entries(s.variants[0].tiers).map(([t, r]) => `${t} ${r.tris} tris ${r.bytes} B`).join(', '), 'atlas', s.foliage.atlas.bytes, 'B');
