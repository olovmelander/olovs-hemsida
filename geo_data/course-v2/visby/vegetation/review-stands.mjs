#!/usr/bin/env node
/* Verify planned representative positions against source geometry and use
   the exact staged terrain chunks for their bases. No runtime publication. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readChunk } from '../../../../packages/course-v2/chunk-node.mjs';
import { decodeStandField, STAND_FLAG_MEASURED, STAND_FLAG_EXCLUDED } from '../../../../packages/course-v2/stand-field.mjs';
import { createGroundHeightLookup } from '../../../../packages/course-v2/vegetation/ground-sampler.mjs';
import { planV2Vegetation } from '../../../../apps/golf/src/engine/v2-vegetation.mjs';
import { assertVisbyStandInputs, visbyExclusionFeatures } from './compile-stands.mjs';
import { sampleVisbyDtm } from './build-canopy.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');
const STAGE='visbybuild/cache/vegetation/stands-stage';
const read=p=>fs.readFileSync(path.join(ROOT,p));
const json=p=>JSON.parse(read(p));
const sha256=b=>createHash('sha256').update(b).digest('hex');
const index=json(`${STAGE}/layer-index.json`);
assertVisbyStandInputs(index,read);
const features=visbyExclusionFeatures(index.inputs.map(s=>json(s.path))).map(f=>{
  const points=[...f.polygons.flat(2),...f.lines.flat()];
  return {...f,bbox:[Math.min(...points.map(p=>p[0]))-1,Math.min(...points.map(p=>p[1]))-1,Math.max(...points.map(p=>p[0]))+1,Math.max(...points.map(p=>p[1]))+1]};
});
function inRing(x,y,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
function distanceToLine(x,y,line){let best=Infinity;for(let i=0;i+1<line.length;i++){const[ax,ay]=line[i],[bx,by]=line[i+1],dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy||1)));best=Math.min(best,Math.hypot(x-ax-t*dx,y-ay-t*dy));}return best;}
const hits=[],counts={eligibleStandCells:0,plannedRepresentatives:0,cellSourceHits:0,representativeSourceHits:0};
function check(x,y,kind){let count=0;for(const f of features){if(x<f.bbox[0]||x>f.bbox[2]||y<f.bbox[1]||y>f.bbox[3])continue;const inside=f.polygons.some(r=>inRing(x,y,r[0])&&!r.slice(1).some(h=>inRing(x,y,h)));const near=f.lines.some(l=>distanceToLine(x,y,l)<=(f.kind==='path'?.5:1));if(inside||near){count++;if(hits.length<100)hits.push({easting:x,northing:y,test:kind,sourceId:f.id,kind:f.kind});}}return count;}
const loaded={tiles:[]},samples=[];
for(const[tileId,reference]of Object.entries(index.standLayers)){
  const bytes=read(`${STAGE}/${reference.url}`);if(sha256(bytes)!==reference.sha256)throw new Error(`Changed stand chunk:${tileId}`);
  const chunk=readChunk(bytes),field=decodeStandField(chunk.payload,chunk.header.standField);
  loaded.tiles.push({id:tileId,bounds:chunk.header.bounds,objects:[],stands:field});
  for(let row=0;row<field.height;row++)for(let col=0;col<field.width;col++){
    const i=row*field.width+col;if(!(field.flags[i]&STAND_FLAG_MEASURED)||(field.flags[i]&STAND_FLAG_EXCLUDED)||field.fraction[i]<=0)continue;
    const e=chunk.header.bounds.minEasting+(col+.5)*field.cellMetres,n=chunk.header.bounds.maxNorthing-(row+.5)*field.cellMetres;
    counts.eligibleStandCells++;counts.cellSourceHits+=check(e,n,'cell-centre');
    if(e>686900&&e<688650&&n>6370350&&n<6372150)samples.push([e,n,field.fraction[i],field.p95Height[i]]);
  }
}
const terrainStage=json(index.terrainStageSource.path),terrainRoot=path.posix.dirname(index.terrainStageSource.path);
const references=new Map(terrainStage.tiles.map(t=>[t.layers.terrain.url,t.layers.terrain]));
const lookup=await createGroundHeightLookup(terrainStage,url=>{const b=read(`${terrainRoot}/${url}`);if(sha256(b)!==references.get(url)?.sha256)throw new Error('Terrain chunk changed');return b;});
const origin=terrainStage.frame.origin;
const mapper={toWorld:(e,n)=>[e-origin.easting,origin.northing-n],toEpsg:(x,z)=>[origin.easting+x,origin.northing-z]};
const groundHeightAt=(x,z)=>{const[e,n]=mapper.toEpsg(x,z);return lookup.heightAt(e,n);};
const plan=planV2Vegetation(loaded,{mapper,groundHeightAt});
const terrainAcquired=json('geo_data/course-v2/visby/acquisition/terrain-window.json'),dtmBytes=read(terrainAcquired.raster.path);
if(sha256(dtmBytes)!==terrainAcquired.raster.sha256)throw new Error('Source DTM changed');
const dtm=new Float32Array(dtmBytes.buffer.slice(dtmBytes.byteOffset,dtmBytes.byteOffset+dtmBytes.byteLength));
let maximumSourceDtmDelta=0,nonfiniteBases=0;
const representatives=[];
for(const tree of plan.instances){
  const[e,n]=mapper.toEpsg(tree.x,tree.z);counts.plannedRepresentatives++;
  counts.representativeSourceHits+=check(e,n,'runtime-representative');
  if(!Number.isFinite(tree.y))nonfiniteBases++;
  const source=sampleVisbyDtm(dtm,e,n);maximumSourceDtmDelta=Math.max(maximumSourceDtmDelta,Math.abs(tree.y-source));
  if(e>686900&&e<688650&&n>6370350&&n<6372150)representatives.push([e,n,tree.y,tree.height]);
}
const out=path.join(ROOT,'visbybuild/cache/vegetation/review');fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'stand-samples.json'),JSON.stringify(samples)+'\n');
fs.writeFileSync(path.join(out,'stand-representatives.json'),JSON.stringify(representatives)+'\n');
const report={schemaVersion:1,groundId:'visby',observedOn:new Date().toISOString().slice(0,10),state:hits.length||nonfiniteBases?'source-exclusion-review-failed':'source-exclusion-check-passed',
  sourceLayerIndex:{path:`${STAGE}/layer-index.json`,sha256:sha256(read(`${STAGE}/layer-index.json`))},
  counts,protectedSourceFeatures:features.length,hits,
  terrainBases:{frameFingerprint:terrainStage.frame.fingerprint,sourceTerrainSha256:terrainAcquired.raster.sha256,nonfiniteBases,maximumDifferenceFromUnquantizedDtmMetres:maximumSourceDtmDelta,method:'Representative bases sampled from the exact staged finest terrain chunks; independently compared against the retained unquantized 1m source samples.'},
  runtimePlanning:{...plan.stats,note:'Runtime representative count and display species are visualization output, not measured stem counts or species observations.'},
  method:'All eligible 4m stand-cell centres and actual deterministic runtime representative positions checked independently against polygon interiors with holes and 1m road /0.5m path centre-line corridors.',
  limitations:['These checks concern retained source geometry and planned placements, not current field accuracy.',
    '2024 laser and 2022 orthophoto are different vintages; source panels cannot confirm later changes.',
    'Representative stand positions are not measured individual tree stems.']};
fs.writeFileSync(path.join(ROOT,'geo_data/course-v2/visby/vegetation/stand-source-review.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(hits.length||nonfiniteBases||maximumSourceDtmDelta>.006)process.exitCode=1;
