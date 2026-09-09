/* Export the exact architecture batches and a bounded 1 m terrain fixture.
 * python lidingobuild/render-architecture.py draws the diagnostic views. */
import fs from 'node:fs';
import { loadArchitectureFixture } from './architecture-fixture.mjs';
import { buildingArchitecture,courtyardArchitecture,BUILDING_IDS } from '../apps/golf/src/engine/scenery/lidingo-architecture.js';
import { measuredRoofGeometry } from '../apps/golf/src/engine/measured-roof.mjs';
const {model,terrainH:H,terrainChunkSha256}=loadArchitectureFixture();
const out='lidingobuild/cache/architecture-review';fs.mkdirSync(out,{recursive:true});
function inside(x,z,r){let hit=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
const scenery=model.scenery.mappedFeatures,paved=scenery.find(f=>f.id==='lidingo-courtyard-hardstanding-2019');
const allBuildings=model.infra.buildings.filter(b=>Object.values(BUILDING_IDS).includes(b.id));
const targets=allBuildings.filter(b=>!b.id.startsWith('way/264'));
const terrain=[];
for(let x=-105;x<18;x++)for(let z=-160;z<12;z++) {
 const ps=[[x,H(x,z),z],[x+1,H(x+1,z),z],[x+1,H(x+1,z+1),z+1],[x,H(x,z+1),z+1]];
 let color=0x6e8551;const xx=x+.5,zz=z+.5;
 if([...model.scenery.greens,...scenery.filter(f=>f.kind==='practice_green').map(f=>f.rings[0])].some(r=>inside(xx,zz,r)))color=0x6d933e;
 if(model.infra.parking.some(f=>inside(xx,zz,f.ring)))color=0x636761;
 if(inside(xx,zz,paved.rings[0])&&!paved.rings.slice(1).some(r=>inside(xx,zz,r)))color=0x51585b;
 for(const points of [[ps[0],ps[1],ps[2]],[ps[0],ps[2],ps[3]]]) terrain.push({points,color,part:'terrain'});
}
const old=[],current=[],counts=[];
for(const b of targets) {
 const g=measuredRoofGeometry(b.roofSurface,H);
 for(const points of g.triangles)old.push({points,color:0x3c4141,part:'old-roof'});
 for(const [a,b,c,d]of g.walls)for(const points of [[a,b,c],[a,c,d]])old.push({points,color:0xe4e2d9,part:'old-wall'});
 const t=performance.now(),detail=buildingArchitecture(b,H);current.push(...detail.triangles);counts.push({id:b.id,triangles:detail.triangles.length,ms:performance.now()-t,parts:detail.parts});
}
const court=courtyardArchitecture(scenery,model.infra.buildings,H);current.push(...court.triangles);
fs.writeFileSync(`${out}/geometry.json`,JSON.stringify({terrain,old,current}));
fs.writeFileSync(`${out}/validation.json`,JSON.stringify({terrainSpacing:1,terrainChunkSha256,buildings:counts,courtyardTriangles:court.triangles.length},null,2));
console.log(JSON.stringify({buildings:counts.map(b=>({id:b.id,triangles:b.triangles,ms:Math.round(b.ms)})),courtyardTriangles:court.triangles.length,terrainTriangles:terrain.length}));
