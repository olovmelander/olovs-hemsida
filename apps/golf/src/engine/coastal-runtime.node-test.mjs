import test from 'node:test';
import assert from 'node:assert/strict';
import {coastalWorldBounds,seaLevelInWorld,excludeOceanFromFlatWater} from './coastal-runtime.mjs';
test('RH2000 ocean receives the same single datum offset as the terrain',()=>{
 assert.equal(seaLevelInWorld(0,{verticalDatumOffsetMetres:20.3432}),20.3432);
 assert.equal(seaLevelInWorld(.23,{verticalDatumOffsetMetres:0}),.23);
 assert.throws(()=>seaLevelInWorld(NaN,{}),/finite/);
});
test('dry low skerries never acquire flat lake sheets or carved beds',()=>{
 const flat={width:2,height:1,spacing:4,x0:0,z0:0,mask:new Uint8Array([1,1]),label:new Int32Array([1,2]),
 components:[{id:1,cells:1,knownCells:0,uncoveredCells:1,level:20.6},{id:2,cells:1,knownCells:0,uncoveredCells:1,level:30}]};
 const result=excludeOceanFromFlatWater(flat,{seaLevel:20.3132,isSeaAt:()=>false,isIslandAt:()=>true},(x,z)=>[x,z]);
 assert.deepEqual([...result.mask],[0,1]);assert.deepEqual(result.components.map(c=>c.id),[2]);
});
test('coastal extent encloses all rotated world corners',()=>{
 const angle=.055,c=Math.cos(angle),s=Math.sin(angle),bridge={toLegacy:(x,z)=>[x*c-z*s,x*s+z*c]};
 const b=coastalWorldBounds({minEasting:100,maxEasting:200,minNorthing:300,maxNorthing:500},{easting:150,northing:400},bridge);
 assert(b.x0 < -55 && b.x1 > 55);
 for(const x of [-50,50])for(const z of [-100,100]){const p=bridge.toLegacy(x,z);assert(p[0]>=b.x0&&p[0]<=b.x1&&p[1]>=b.z0&&p[1]<=b.z1);}
});
test('connected sea is removed from lake sheets/carving without dropping inland water',()=>{
 const flat={width:4,height:1,spacing:4,x0:0,z0:0,mask:new Uint8Array([1,1,0,1]),label:new Int32Array([1,1,1,2]),
 components:[{id:1,cells:3,knownCells:1,uncoveredCells:2,level:20},{id:2,cells:1,knownCells:0,uncoveredCells:1,level:30}]};
 const result=excludeOceanFromFlatWater(flat,{isSeaAt:x=>x<12},(x,z)=>[x,z]);
 assert.deepEqual([...result.label],[0,0,0,2]);assert.deepEqual([...result.mask],[0,0,0,1]);
 assert.equal(result.isWaterAt(1,1),false);assert.equal(result.isFlatAt(1,1),false);
 assert.equal(result.isWaterAt(14,1),true);assert.equal(result.components.length,1);
 assert.deepEqual([...flat.mask],[1,1,0,1]);
});
test('tiny remnants of an ocean component cannot become shoreline lake patches',()=>{
 const flat={width:4,height:1,spacing:4,x0:0,z0:0,mask:new Uint8Array([1,1,1,1]),label:new Int32Array([1,1,1,2]),
 components:[{id:1,cells:3,knownCells:0,uncoveredCells:3,level:20},{id:2,cells:1,knownCells:0,uncoveredCells:1,level:30}]};
 const ocean={seaLevel:20,isSeaAt:x=>x<8};
 const result=excludeOceanFromFlatWater(flat,ocean,(x,z)=>[x,z]);
 assert.deepEqual([...result.mask],[0,0,0,1]);
 assert.equal(result.isFlatAt(10,2),false);
 assert.deepEqual(result.components.map(c=>c.id),[2]);
 // A surviving sample supported by a known water body keeps that component.
 flat.mask[2]=0;flat.components[0].knownCells=1;flat.components[0].uncoveredCells=2;
 const known=excludeOceanFromFlatWater(flat,ocean,(x,z)=>[x,z]);
 assert.equal(known.isFlatAt(10,2),true);
 assert.equal(known.components[0].knownCells,1);
});
