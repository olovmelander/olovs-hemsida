/* Extract an actual RH2000 terrain foundation from verified published 1 m tiles. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readChunk } from '../../packages/course-v2/chunk-node.mjs';
import { decodeTerrainGrid } from '../../packages/course-v2/terrain-grid.mjs';
import { latLonToSweref99Tm } from '../../packages/course-geo/chmv2/projection.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const HERE=path.join(ROOT,'geobuild/facilities');
const PUBLIC=path.join(ROOT,'apps/golf/public');
const CACHE=path.join(ROOT,'geobuild/cache/facilities-model-2026-09-10');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const rel=p=>path.relative(ROOT,p).replaceAll('\\','/');
const json=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const input=path.join(HERE,'inventory.json'), inventory=json(input);
const origin=[inventory.frame.originE,inventory.frame.originN];
const selected=inventory.features.filter(f=>!f.id.startsWith('N'));
const points=selected.flatMap(f=>f.ringBlenderXY);
const step=2;
const x0=Math.floor((Math.min(...points.map(p=>p[0]))-24)/step)*step;
const y0=Math.floor((Math.min(...points.map(p=>p[1]))-24)/step)*step;
const x1=Math.ceil((Math.max(...points.map(p=>p[0]))+24)/step)*step;
const y1=Math.ceil((Math.max(...points.map(p=>p[1]))+24)/step)*step;
const width=(x1-x0)/step+1,height=(y1-y0)/step+1;
const index=json(path.join(PUBLIC,'courses/v2-index.json'));
function verified(reference) {
  const filename=path.join(PUBLIC,reference.url), bytes=fs.readFileSync(filename);
  if(sha(bytes)!==reference.sha256) throw Error('SHA mismatch '+filename);
  return {filename,bytes};
}
const courseRef=index.courses.find(c=>c.slug==='veckefjarden').manifest;
const course=JSON.parse(verified(courseRef).bytes);
const groundFile=verified(course.groundManifest), ground=JSON.parse(groundFile.bytes);
if(ground.frame.horizontalCrs!=='EPSG:3006'||ground.frame.verticalCrs!=='EPSG:5613')throw Error('Wrong terrain frame');
const sources=[];
const tiles=ground.tiles.filter(t=>t.lod===0&&t.bounds.maxEasting>=origin[0]+x0&&t.bounds.minEasting<=origin[0]+x1&&t.bounds.maxNorthing>=origin[1]+y0&&t.bounds.minNorthing<=origin[1]+y1).map(t=>{
  const file=verified(t.layers.terrain), chunk=readChunk(file.bytes);
  if(chunk.header.grid.sampleSpacingMetres!==1)throw Error('Expected native metre grid');
  sources.push({id:t.id,path:rel(file.filename),sha256:t.layers.terrain.sha256,bounds:t.bounds,grid:chunk.header.grid});
  return {...t,grid:chunk.header.grid,heights:decodeTerrainGrid(chunk.payload,chunk.header.grid)};
});
function sample(x,y){
  const E=origin[0]+x,N=origin[1]+y;
  const t=tiles.find(t=>E>=t.bounds.minEasting&&E<=t.bounds.maxEasting&&N>=t.bounds.minNorthing&&N<=t.bounds.maxNorthing);
  if(!t)throw Error('Terrain missing '+[E,N]);
  const fx=(E-t.bounds.minEasting),fy=(t.bounds.maxNorthing-N),c=Math.floor(fx),r=Math.floor(fy);
  const tx=fx-c,ty=fy-r, c1=Math.min(c+1,t.grid.width-1),r1=Math.min(r+1,t.grid.height-1);
  const at=(cc,rr)=>t.heights[rr*t.grid.width+cc];
  const h=(at(c,r)*(1-tx)+at(c1,r)*tx)*(1-ty)+(at(c,r1)*(1-tx)+at(c1,r1)*tx)*ty;
  if(!Number.isFinite(h))throw Error('Nonfinite terrain');
  return h;
}
const originHeightRH2000=Math.round(sample(0,0)*1000)/1000;
const heights=[];
for(let row=0;row<height;row++)for(let col=0;col<width;col++)heights.push(Math.round((sample(x0+col*step,y0+row*step)-originHeightRH2000)*1000)/1000);
const features=selected.map(f=>{
  const h=f.ringBlenderXY.map(p=>sample(...p)).sort((a,b)=>a-b);
  const c=[0,1].map(i=>f.ringBlenderXY.reduce((s,p)=>s+p[i],0)/f.ringBlenderXY.length);
  return {id:f.id,centroidBlenderXY:c,centroidHeightRH2000:sample(...c),vertexMinimumRH2000:h[0],vertexMedianRH2000:h[Math.floor(h.length/2)],vertexMaximumRH2000:h.at(-1)};
});
const modelFile=path.join(ROOT,'geobuild/course-model.json'),model=json(modelFile),access=[];
for(const group of ['roads','paths','tracks'])for(const [index,item] of (model.infra[group]||[]).entries()){
  const line=item.line.map(([x,z])=>{
    const [E,N]=latLonToSweref99Tm(model.origin.lat-z/model.mPerLat,model.origin.lon+x/model.mPerLon);
    return [E-origin[0],N-origin[1]];
  });
  const segments=[];
  for(let i=1;i<line.length;i++){
    const a=line[i-1],b=line[i],count=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/1.5));
    for(let j=0;j<count;j++){
      const p=a.map((v,k)=>v+(b[k]-v)*j/count),q=a.map((v,k)=>v+(b[k]-v)*(j+1)/count);
      if([p,q].every(([x,y])=>x>x0+6&&x<x1-6&&y>y0+6&&y<y1-6))segments.push([p,q]);
    }
  }
  if(segments.length)access.push({id:group+'-'+index,sourceModelPath:'/infra/'+group+'/'+index,
    kind:item.kind,widthEstimateMetres:group==='roads'?4.2:group==='tracks'?3:1.7,segments,
    status:'existing mapped access context; width estimated, not orthophoto-reviewed'});
}
fs.mkdirSync(CACHE,{recursive:true});
const gridPath=path.join(CACHE,'model-ground-grid.json');
fs.writeFileSync(gridPath,JSON.stringify({x0,y0,step,width,height,heights})+'\n');
const report={schemaVersion:1,originEPSG3006:origin,originHeightRH2000,verticalCrs:'EPSG:5613',horizontalCrs:'EPSG:3006',axisContract:'X east, Y north, Z=heightRH2000-originHeightRH2000',
  gridPath:rel(gridPath),gridSha256:sha(fs.readFileSync(gridPath)),grid:{x0,y0,step,width,height},sourceNativeSpacingMetres:1,
  inventory:{path:rel(input),sha256:sha(fs.readFileSync(input))},groundManifest:{path:rel(groundFile.filename),sha256:sha(groundFile.bytes)},sources,features,access,
  accessSourceModel:{path:rel(modelFile),sha256:sha(fs.readFileSync(modelFile))},
  limits:['DTM is bare-earth terrain, not building heights.','Building floor levels require leveling/interpretation of terrain around each footprint.','2 m modeling mesh sampled bilinearly from verified 1 m published terrain.','Source vertical accuracy is not established by this extraction.']};
fs.writeFileSync(path.join(HERE,'model-ground.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({originHeightRH2000,grid:report.grid,tiles:tiles.length,features:features.length,allFinite:true}));
