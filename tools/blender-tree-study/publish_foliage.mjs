// Promote the approved study to immutable production meshes and shared atlases.
// Geometry-only GLBs retain UVs; one atlas per species serves both mesh tiers.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Box3,Matrix4,Quaternion,Vector3} from '../../apps/golf/node_modules/three/build/three.module.js';
const root=path.resolve('apps/golf/public/models/trees');
const source=path.join(root,'foliage-study');const out=path.join(root,'ghibli-fluffy');fs.mkdirSync(out,{recursive:true});
const study=JSON.parse(fs.readFileSync(path.join(source,'species-study.json')));
const hash=b=>createHash('sha256').update(b).digest('hex');
function geometryOnly(bytes){
  const jsonLength=bytes.readUInt32LE(12);const j=JSON.parse(bytes.subarray(20,20+jsonLength));
  const bin=bytes.subarray(28+jsonLength);const imageViews=new Set((j.images||[]).map(i=>i.bufferView));
  const remap=new Map(),views=[],parts=[];let offset=0;
  j.bufferViews.forEach((v,i)=>{
    if(imageViews.has(i))return;
    remap.set(i,views.length);views.push({...v,buffer:0,byteOffset:offset});
    const part=bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);parts.push(part);
    const padding=(4-part.length%4)%4;parts.push(Buffer.alloc(padding));offset+=part.length+padding;
  });
  for(const a of j.accessors){if(a.sparse)throw Error('Unexpected sparse accessor');if(a.bufferView!=null)a.bufferView=remap.get(a.bufferView);}
  j.bufferViews=views;j.buffers=[{byteLength:offset}];
  for(const key of ['images','textures','samplers','materials'])delete j[key];
  for(const m of j.meshes)for(const p of m.primitives)delete p.material;
  const raw=Buffer.from(JSON.stringify(j));const header=Buffer.alloc(20);
  const data=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]),binary=Buffer.concat(parts),bh=Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+data.length+binary.length,8);
  header.writeUInt32LE(data.length,12);header.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(binary.length,0);bh.writeUInt32LE(0x004e4942,4);
  return {bytes:Buffer.concat([header,data,bh,binary]),json:j};
}
function bounds(j){
  const box=new Box3();
  function visit(index,parent){
    const n=j.nodes[index];const matrix=n.matrix?new Matrix4().fromArray(n.matrix):new Matrix4().compose(new Vector3(...(n.translation||[0,0,0])),new Quaternion(...(n.rotation||[0,0,0,1])),new Vector3(...(n.scale||[1,1,1])));
    matrix.premultiply(parent);
    if(n.mesh!=null)for(const p of j.meshes[n.mesh].primitives){const a=j.accessors[p.attributes.POSITION];box.union(new Box3(new Vector3(...a.min),new Vector3(...a.max)).applyMatrix4(matrix));}
    for(const c of n.children||[])visit(c,matrix);
  }
  for(const i of j.scenes[j.scene||0].nodes)visit(i,new Matrix4());
  return {templateHeight:box.max.y,templateRadius:Math.max(Math.abs(box.min.x),box.max.x,Math.abs(box.min.z),box.max.z)};
}
function writeAsset(bytes,extension){
  const sha256=hash(bytes),file=`ghibli-fluffy/${sha256}.${extension}`;fs.writeFileSync(path.join(root,file),bytes);return {file,bytes:bytes.length,sha256};
}
const manifest={schemaVersion:1,kind:'ghibli-trees',design:'fluffy-2026-09',budgets:study.budgets,species:[]};
for(const s of study.species){
  const tiers={};let shape;
  for(const [tier,r] of Object.entries(s.tiers)){
    const input=fs.readFileSync(path.join(source,r.file));if(hash(input)!==r.sha256)throw Error(`Study asset changed: ${r.file}`);
    const {bytes,json}=geometryOnly(input);tiers[tier]={...writeAsset(bytes,'glb'),tris:r.triangles};if(tier==='hero')shape=bounds(json);
  }
  const foliage={key:s.key,atlas:writeAsset(fs.readFileSync(path.join(source,s.atlas)),'png')};
  manifest.species.push({key:s.key==='bjork'?'björk':s.key,name:s.name,foliage,variants:[{seed:s.seed||9000,...shape,tiers}]});
}
fs.writeFileSync(path.join(root,'ghibli-fluffy.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`Published ${manifest.species.length} species, 15 meshes and 5 shared atlases.`);
