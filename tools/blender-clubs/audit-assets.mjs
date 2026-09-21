import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CLUB_ASSETS } from '../../apps/golf/src/engine/club-assets.mjs';
const root = fileURLToPath(new URL(process.argv.includes('--dist') ? '../../apps/golf/dist/' : '../../apps/golf/public/',import.meta.url));
const directory = path.join(root,'models/clubs');
const keep = new Set(Object.values(CLUB_ASSETS).map(asset => path.basename(asset.file)));
let bytes=0,triangles=0;
for(const [key,asset] of Object.entries(CLUB_ASSETS)) {
  const file=path.resolve(root,asset.file);
  assert.equal(path.dirname(file),directory);
  const buffer=await fs.readFile(file);
  assert.equal(buffer.toString('ascii',0,4),'glTF');
  const hash=createHash('sha256').update(buffer).digest('hex').slice(0,12);
  assert.ok(file.endsWith(`-${hash}.glb`));
  const gltf=JSON.parse(buffer.subarray(20,20+buffer.readUInt32LE(12)));
  assert.equal(gltf.scenes.length,1,`${key}: only the club scene is exported`);
  assert.equal(gltf.nodes.length,1,`${key}: only the selected club is exported`);
  assert.equal(gltf.nodes[0].name,`Club_${key}`);
  assert.equal(gltf.images,undefined,'no reference photos in model');
  assert.doesNotMatch(JSON.stringify(gltf),/wilson|dynapwr|dynapower|staff.model|d9.forged/i);
  for(const mesh of gltf.meshes)for(const primitive of mesh.primitives)triangles+=gltf.accessors[primitive.indices].count/3;
  bytes+=buffer.length;
}
if(process.argv.includes('--prune')) {
  for(const file of await fs.readdir(directory)) {
    if(!/^[a-z0-9-]+-[a-f0-9]{12}\.glb$/.test(file)||keep.has(file))continue;
    const target=path.resolve(directory,file);
    assert.equal(path.dirname(target),directory);
    await fs.unlink(target);
  }
}
console.log(JSON.stringify({models:keep.size,bytes,triangles,brands:false,externalImages:false}));
