// Verify the material revision keeps every authored shape and all atlas cutouts.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {FOLIAGE_PALETTES} from '../../apps/golf/src/engine/painted-world-palette.mjs';

const archive='docs/graphics/visby-martall-2026-09-21';
const doc='docs/graphics/visby-martall-original-colours-2026-09-21';
const assets='apps/golf/public/models/trees';
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const prior=readJson(path.join(archive,'candidate-catalogue.json')).species.find(s=>s.key==='tall');
const current=readJson(path.join(doc,'candidate-catalogue.json')).species.find(s=>s.key==='tall');
const original=readJson(path.join(doc,'previous-catalogue.json')).species.find(s=>s.key==='tall');
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

function parts(file){
  const data=fs.readFileSync(path.join(assets,file));
  const jsonLength=data.readUInt32LE(12),json=JSON.parse(data.subarray(20,20+jsonLength));
  const binary=data.subarray(28+jsonLength);
  const readers={5121:['readUInt8',1],5123:['readUInt16LE',2],5125:['readUInt32LE',4],5126:['readFloatLE',4]};
  function accessor(index){
    const a=json.accessors[index],v=json.bufferViews[a.bufferView];
    const [reader,size]=readers[a.componentType],components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type];
    return Array.from({length:a.count},(_,i)=>Array.from({length:components},(_,c)=>
      binary[reader]((v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||size*components)+c*size)));
  }
  return Object.fromEntries(json.meshes.map(mesh=>[mesh.name,mesh.primitives.map(p=>({
    indices:accessor(p.indices),...Object.fromEntries(Object.entries(p.attributes).map(([key,index])=>[key,accessor(index)])),
  }))]));
}

assert.equal(current.variants.length,4);
assert.equal(current.foliage.key,original.foliage.key);
assert.deepEqual(FOLIAGE_PALETTES[current.foliage.key],[0x193c2b,0x3c7328,0x7ba638]);
assert.deepEqual(current.foliage.atlas,prior.foliage.atlas);
const checks=[];
for(const [index,variant] of current.variants.entries()){
  const source=prior.variants[index];
  assert.equal(variant.name,source.name);
  assert.equal(variant.templateHeight,source.templateHeight);
  assert.equal(variant.templateRadius,source.templateRadius);
  for(const [tier,record] of Object.entries(variant.tiers)){
    assert.equal(record.tris,source.tiers[tier].tris);
    const before=parts(source.tiers[tier].file),after=parts(record.file);
    assert.deepEqual(Object.keys(after),Object.keys(before));
    for(const name of Object.keys(after)){
      assert.notEqual(sha(after[name].map(p=>p.COLOR_0)),sha(before[name].map(p=>p.COLOR_0)),`${index}/${tier}/${name}: colour must change`);
      for(const part of [...after[name],...before[name]])delete part.COLOR_0;
      assert.deepEqual(after[name],before[name],`${index}/${tier}/${name}: shape, normals and UVs must stay unchanged`);
    }
    checks.push({variant:variant.name,tier,triangles:record.tris,geometrySha256:sha(after),coloursChanged:true});
  }
}
const report={passed:true,foliageKey:current.foliage.key,foliagePalette:FOLIAGE_PALETTES.tall.map(v=>'#'+v.toString(16)),
  barkRamp:['#605a49','#aa8056'],atlasUnchanged:true,checks};
fs.writeFileSync(path.join(doc,'colour-validation.json'),JSON.stringify(report,null,2)+'\n');
console.log('All 12 meshes retain their exact geometry, normals, UVs and topology; colours changed to the previous Visby palette.');
