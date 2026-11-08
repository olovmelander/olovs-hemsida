#!/usr/bin/env node
/* Publish the house kit exported by house_kit.py: a hash-named GLB in
   apps/golf/public/models/props/, its JSON record (every mesh and its triangles),
   and the HOUSE_KIT_ASSET constant in apps/golf/src/engine/house-kit.mjs.
   usage: node tools/blender-props/publish-house-kit.mjs <house-kit.glb> */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const src = process.argv[2];
if (!src) { console.error('usage: node tools/blender-props/publish-house-kit.mjs <house-kit.glb>'); process.exit(2); }
const bytes = fs.readFileSync(src), sha = createHash('sha256').update(bytes).digest('hex');
const dir = 'apps/golf/public/models/props', url = `models/props/house-kit-${sha}.glb`;
const old = fs.existsSync(`${dir}/house-kit.json`) ? JSON.parse(fs.readFileSync(`${dir}/house-kit.json`, 'utf8')) : null;
if (old && old.asset.sha256 !== sha && fs.existsSync(`apps/golf/public/${old.asset.url}`)) fs.rmSync(`apps/golf/public/${old.asset.url}`);
fs.writeFileSync(`apps/golf/public/${url}`, bytes);
/* the GLB's own JSON chunk: every mesh's name and its triangles */
const jsonLength = bytes.readUInt32LE(12), gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
const meshes = {};
for (const node of gltf.nodes) {
  if (node.mesh === undefined) continue;
  const prim = gltf.meshes[node.mesh].primitives[0];
  const count = prim.indices !== undefined ? gltf.accessors[prim.indices].count : gltf.accessors[prim.attributes.POSITION].count;
  meshes[node.name] = { triangles: count / 3, channel: node.name.split('__')[1] };
}
const record = { schemaVersion: 1, kind: 'banvy-prop-kit', id: 'house-kit',
  asset: { url, sha256: sha, bytes: bytes.length },
  meshes, triangles: Object.values(meshes).reduce((s, m) => s + m.triangles, 0),
  axes: "each part: x along the wall, y up, z out of the wall (its face at z = 0); metres",
  channels: 'wall, trim, roof and accent are white and take the house\'s colour per instance; fixed keeps its own; glass is the panes',
  source: 'tools/blender-props/house_kit.py, Blender 5.2.2 LTS, built headless (blender --background --factory-startup) on 8 November 2026',
  notes: 'Painted vertex colours. Laid on each footprint of the inner ring by apps/golf/src/engine/house-kit.mjs.' };
fs.writeFileSync(`${dir}/house-kit.json`, JSON.stringify(record, null, 2) + '\n');
const mod = 'apps/golf/src/engine/house-kit.mjs';
let m = fs.readFileSync(mod, 'utf8');
m = m.replace(/house-kit-[0-9a-f]{64}\.glb/, `house-kit-${sha}.glb`)
  .replace(/(HOUSE_KIT_ASSET = Object\.freeze\(\{[\s\S]*?sha256: ')[0-9a-f]{64}'/, `$1${sha}'`)
  .replace(/(HOUSE_KIT_ASSET = Object\.freeze\(\{[\s\S]*?bytes: )\d+/, `$1${bytes.length}`);
fs.writeFileSync(mod, m);
console.log(JSON.stringify({ sha: sha.slice(0, 12), bytes: bytes.length, meshes: Object.keys(meshes).length, triangles: record.triangles }));
