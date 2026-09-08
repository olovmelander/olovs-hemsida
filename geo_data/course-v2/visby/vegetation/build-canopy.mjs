#!/usr/bin/env node
/* Bounded, resumable Visby 2024 COPC canopy intake, before graph publication.
   node --env-file=.env geo_data/course-v2/visby/vegetation/build-canopy.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { authorizationHeaders, lantmaterietCredentials } from '../../../../packages/course-geo/acquisition/credentials.mjs';
import { createNodeCache, openItem, readWindow } from '../../../../packages/course-geo/copc-reader/copc-window.mjs';
import { blitInterior, canopyHeightModel, fillGround, gridSpec, groundGrid, smoothGround, windowStatistics } from '../../../../packages/course-geo/copc-reader/canopy-build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const OUT = path.join(ROOT, 'visbybuild/cache/vegetation');
const EVIDENCE = path.join(ROOT, 'geo_data/course-v2/visby/vegetation/canopy-evidence.json');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const rel = file => path.relative(ROOT,file).split(path.sep).join('/');
const round = value => Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
const quantile = (a,q) => a.length ? a[Math.floor((a.length-1)*q)] : null;
const LAYERS = ['chm', 'ground', 'allReturns', 'firstReturns'];
export const VISBY_CANOPY_CONFIG = Object.freeze({
  groundId:'visby', campaignId:'24e002', width:2048, height:2048, sampleSpacingMetres:2,
  originEasting:685700.5, originNorthing:6372999.5, tileMetres:256, haloMetres:64,
  groundFillRadiusCells:30, heightCeilingMetres:40,
  terrainSha256:'deb6ce495470335a7778da55485ca63ec46386bdfd2bdf9d0a8ddf90a4e4e898',
  frameFingerprint:'d7631b5ee1a936044fc4f03d7ee13971438b65653cc23a4dd9676b563123f511',
  sources:Object.freeze([
    {id:'24e002-636_68',sha256:'e43ecb61cddbe4aa4033e973df70bf4a504fe6260eb682ce4ea208a7fa51a1b1',bytes:89316475,points:13769262,bounds:[685000,6365000,690000,6370000]},
    {id:'24e002-637_68',sha256:'2a25c67a111b6230d498e02fe5277bb288c71e9282a143f93334c3916b9e8c6a',bytes:278815413,points:47387337,bounds:[685000,6370000,690000,6375000]},
  ]),
});
const C = VISBY_CANOPY_CONFIG;
const configHash = sha256(Buffer.from(JSON.stringify(C)));

export function sampleVisbyDtm(heights,easting,northing) {
  if (!(heights instanceof Float32Array) || heights.length !== 4097**2) throw new Error('Complete 4097-square Visby DTM required');
  const fx=easting-C.originEasting, fy=C.originNorthing-northing;
  if(fx<0 || fy<0 || fx>4096 || fy>4096) return NaN;
  const x=Math.min(4095,Math.floor(fx)), y=Math.min(4095,Math.floor(fy)), tx=fx-x,ty=fy-y;
  return (heights[y*4097+x]*(1-tx)+heights[y*4097+x+1]*tx)*(1-ty)+(heights[(y+1)*4097+x]*(1-tx)+heights[(y+1)*4097+x+1]*tx)*ty;
}

function mergePoints(parts) {
  const count=parts.reduce((sum,p)=>sum+p.count,0);
  const combined={count};
  for (const [key,Type] of Object.entries({x:Float64Array,y:Float64Array,z:Float32Array,classification:Uint8Array,returnNumber:Uint8Array,numberOfReturns:Uint8Array,intensity:Uint16Array})) {
    combined[key]=new Type(count); let offset=0;
    for(const p of parts){combined[key].set(p[key],offset);offset+=p.count;}
  }
  return combined;
}

async function main() {
  const discovery=json('geo_data/course-v2/visby/acquisition/d2-discovery.json');
  const acquired=json('geo_data/course-v2/visby/acquisition/terrain-window.json');
  const dtmBytes=fs.readFileSync(path.join(ROOT,acquired.raster.path));
  const frame=json('geo_data/course-v2/visby/acquisition/terrain-compile.json').frame;
  if(sha256(dtmBytes)!==C.terrainSha256 || acquired.raster.sha256!==C.terrainSha256 || frame.fingerprint!==C.frameFingerprint) throw new Error('Pinned Visby terrain/frame changed');
  const dtm=new Float32Array(dtmBytes.buffer.slice(dtmBytes.byteOffset,dtmBytes.byteOffset+dtmBytes.byteLength));
  const credentials=lantmaterietCredentials(); if(!credentials) throw new Error('Lantmäteriet account required');
  const headers=authorizationHeaders(credentials);
  fs.mkdirSync(path.join(OUT,'tiles'),{recursive:true});
  const opened=[];
  for(const source of C.sources){
    const item=discovery.laser.items.find(i=>i.id===source.id);
    if(!item || item.assets.data.sha256!==source.sha256 || item.assets.data.bytes!==source.bytes || item.pointCount!==source.points || item.projCode!=='EPSG:5845' || JSON.stringify(item.projBbox)!==JSON.stringify(source.bounds))throw new Error(`Pinned laser source changed:${source.id}`);
    const head=await fetch(item.assets.data.href,{method:'HEAD',headers,signal:AbortSignal.timeout(45000)});
    if(!head.ok || Number(head.headers.get('content-length'))!==source.bytes)throw new Error(`Laser HEAD mismatch:${source.id}:${head.status}`);
    const reader=await openItem({url:item.assets.data.href,headers,timeoutMs:45000});
    if(reader.header.pointCount!==source.points)throw new Error(`LAS/hierarchy count changed:${source.id}`);
    opened.push({item,source,reader,cache:createNodeCache(),etag:head.headers.get('etag')});
  }
  const target=gridSpec({minEasting:C.originEasting,maxNorthing:C.originNorthing,width:C.width,height:C.height,sampleSpacingMetres:C.sampleSpacingMetres});
  const rasters=Object.fromEntries(LAYERS.map(name=>[name,new Float32Array(C.width*C.height).fill(NaN)]));
  const perTile=[]; const tileCells=C.tileMetres/C.sampleSpacingMetres,haloCells=C.haloMetres/C.sampleSpacingMetres;
  const started=performance.now();
  for(let tileRow=0;tileRow<16;tileRow++)for(let tileColumn=0;tileColumn<16;tileColumn++){
    const west=C.originEasting+tileColumn*C.tileMetres,north=C.originNorthing-tileRow*C.tileMetres;
    const bbox=[west,north-C.tileMetres,west+C.tileMetres,north];
    const window=[bbox[0]-C.haloMetres,bbox[1]-C.haloMetres,bbox[2]+C.haloMetres,bbox[3]+C.haloMetres];
    const tileId=`l0/${tileColumn}/${tileRow}`;
    const checkpoint=path.join(OUT,'tiles',`${tileColumn}-${tileRow}.json`);
    const grid=gridSpec({minEasting:window[0],maxNorthing:window[3],width:tileCells+2*haloCells,height:tileCells+2*haloCells,sampleSpacingMetres:2});
    let record;
    const local={};
    if(fs.existsSync(checkpoint)){
      record=JSON.parse(fs.readFileSync(checkpoint));
      if(record.configHash!==configHash)throw new Error('Cached canopy config changed; use a new generation directory');
      for(const name of LAYERS){const bytes=fs.readFileSync(path.join(ROOT,record.files[name].path));if(sha256(bytes)!==record.files[name].sha256)throw new Error(`Canopy checkpoint changed:${tileId}/${name}`);local[name]=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));}
    }else{
      const reads=[];
      for(const source of opened){
        const b=source.source.bounds;
        const bounded=[Math.max(window[0],b[0]),Math.max(window[1],b[1]),Math.min(window[2],b[2]),Math.min(window[3],b[3])];
        if(bounded[0]>=bounded[2] || bounded[1]>=bounded[3])continue;
        const read=await readWindow(source.reader,bounded,{cache:source.cache});
        reads.push({...read,itemId:source.item.id,bbox:bounded});
      }
      const points=mergePoints(reads.map(r=>r.points));
      const measured=groundGrid(grid,points);
      const filled=fillGround(grid,measured.mean,{radiusCells:C.groundFillRadiusCells});
      const smoothed=smoothGround(grid,filled.ground);
      const model=canopyHeightModel(grid,points,smoothed,{ceilingMetres:C.heightCeilingMetres});
      const interior=[],differences=[];
      let measuredGround=0,filledGround=0,unknownGround=0;
      for(let r=haloCells;r<haloCells+tileCells;r++)for(let c=haloCells;c<haloCells+tileCells;c++){
        const i=r*grid.width+c;interior.push(i);
        if(filled.fillDistance[i]===0)measuredGround++;else if(filled.fillDistance[i]>0)filledGround++;else unknownGround++;
        if((r&1)||(c&1)||!measured.count[i])continue;
        const h=sampleVisbyDtm(dtm,grid.minEasting+(c+.5)*2,grid.maxNorthing-(r+.5)*2);
        if(Number.isFinite(h))differences.push(measured.mean[i]-h);
      }
      differences.sort((a,b)=>a-b);
      const stats=windowStatistics(grid,model,{interior});
      const interiorGrid=gridSpec({minEasting:west,maxNorthing:north,width:tileCells,height:tileCells,sampleSpacingMetres:2});
      record={tileId,configHash,interiorBboxEpsg3006:bbox,windowBboxEpsg3006:window,
        reads:reads.map(r=>({itemId:r.itemId,bboxEpsg3006:r.bbox,...r.statistics})),interior:stats,
        groundCells:{measured:measuredGround,filled:filledGround,unknown:unknownGround},
        cloudGroundMinusDtm:{samples:differences.length,meanMetres:round(differences.reduce((a,b)=>a+b,0)/differences.length),medianMetres:round(quantile(differences,.5)),p05Metres:round(quantile(differences,.05)),p95Metres:round(quantile(differences,.95))},files:{}};
      for(const [name,values]of Object.entries({chm:model.chm,ground:smoothed,allReturns:Float32Array.from(model.allReturns),firstReturns:Float32Array.from(model.firstReturns)})){
        local[name]=new Float32Array(tileCells**2).fill(NaN);
        if(blitInterior(values,grid,local[name],interiorGrid,bbox)!==tileCells**2)throw new Error(`Incomplete interior:${tileId}`);
        const bytes=Buffer.from(local[name].buffer),file=path.join(OUT,'tiles',`${tileColumn}-${tileRow}-${name}.f32`);
        fs.writeFileSync(file,bytes);record.files[name]={path:rel(file),bytes:bytes.length,sha256:sha256(bytes)};
      }
      fs.writeFileSync(checkpoint,JSON.stringify(record,null,2)+'\n');
    }
    const tileGrid=gridSpec({minEasting:west,maxNorthing:north,width:tileCells,height:tileCells,sampleSpacingMetres:2});
    for(const name of LAYERS)if(blitInterior(local[name],tileGrid,rasters[name],target,bbox)!==tileCells**2)throw new Error(`Incomplete destination:${tileId}`);
    perTile.push(record);
    if(perTile.length%8===0 || perTile.length===1)console.log(`${perTile.length}/256 windows; ${tileId} canopy${record.interior.canopyCells}, void${(record.interior.voidFraction*100).toFixed(1)}%, ground-DTM${record.cloudGroundMinusDtm.medianMetres}m`);
  }
  const files={};
  for(const [layer,values]of Object.entries(rasters)){
    const dataPath=path.join(OUT,`${layer}-24e002.f32`),sidecarPath=path.join(OUT,`${layer}-24e002.json`),bytes=Buffer.from(values.buffer);
    fs.writeFileSync(dataPath,bytes);
    fs.writeFileSync(sidecarPath,JSON.stringify({width:C.width,height:C.height,sampleSpacingMetres:2,originEasting:C.originEasting,originNorthing:C.originNorthing,
      horizontalCrs:'EPSG:3006',verticalCrs:layer==='ground'?'EPSG:5613':null,compoundCrs:layer==='ground'?'EPSG:5845':null,
      originConvention:'northwest pixel edge; centres +1m east,-1m north',noData:null,campaignId:C.campaignId,groundId:C.groundId,
      frameFingerprint:frame.fingerprint,layer,measure:layer==='chm'?'height-above-cloud-ground-metres':layer==='ground'?'height-RH2000-metres':'returns-per-4-square-metre-cell'},null,2)+'\n');
    files[layer]={data:rel(dataPath),sidecar:rel(sidecarPath),bytes:bytes.length,sha256:sha256(bytes)};
  }
  const totals=perTile.reduce((sum,t)=>{for(const k of ['cells','squareMetres','allReturns','firstReturns','groundReturns','voidCells','measuredCells','canopyCells'])sum[k]+=t.interior[k];return sum;},{cells:0,squareMetres:0,allReturns:0,firstReturns:0,groundReturns:0,voidCells:0,measuredCells:0,canopyCells:0});
  const sources=opened.map(({item,source,reader,etag})=>({itemId:item.id,href:item.assets.data.href,catalogueSha256:source.sha256,etag,contentLength:source.bytes,pointCount:source.points,captureStart:item.captureStart,captureEnd:item.captureEnd,sourceBoundsEpsg3006:source.bounds,dataBounds:reader.dataBounds,hierarchyPages:reader.hierarchyPages,hierarchyNodes:reader.entries.length,transferThisRun:{...reader.transfer},fullAssetSha256Verified:false}));
  const evidence={schemaVersion:1,groundId:C.groundId,observedOn:new Date().toISOString().slice(0,10),state:'canopy-rasters-built',frameFingerprint:frame.fingerprint,
    config:C,configHash,method:'COPC/laz-perf complete-node bounded reads; 2 m mean class 2/9 ground; nearest-ground fill 60 m and 3x3 smoothing; bilinear HAG; highest non-noise return per 2 m cell; unknown remains NaN; ceiling 40 m.',
    terrainEvidence:'geo_data/course-v2/visby/acquisition/terrain-window.json',terrainSha256:C.terrainSha256,sourceIdentity:sources,
    campaigns:[{campaignId:C.campaignId,captureStart:'2024-02-03T00:00:00Z',captureEnd:'2024-04-28T00:00:00Z',tiles:perTile.length,elapsedMilliseconds:round(performance.now()-started),totals:{...totals,allReturnDensityPerSquareMetre:round(totals.allReturns/totals.squareMetres),pulseDensityPerSquareMetre:round(totals.firstReturns/totals.squareMetres),voidFraction:round(totals.voidCells/totals.cells),canopyFractionOfMeasured:round(totals.canopyCells/totals.measuredCells)},files,perTile}],
    limitations:['Two 2024 campaign source items are joined by actual coordinates; their half-open extents meet at N6370000 without overlapping ownership.',
      '2 m canopy cells are measured area evidence; no stem positions, species, individual-tree counts or independent vertical accuracy are asserted.',
      'NaN canopy cells are unknown, not clearings; source density is not uniform over sea.',
      'Building, water, played-surface and infrastructure exclusions are required before stand compilation.',
      'Cloud-ground versus DTM uses related source families and is diagnostic, not an independent accuracy test.',
      'Complete source asset SHA256 is pinned from STAC but not verified from bounded reads; every decoded node count and full hierarchy count are checked.',
      'Per-tile resumable derived caches preserve source input/config identity; current-run transfer excludes cached tile acquisitions.']};
  fs.writeFileSync(EVIDENCE,JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({evidence:rel(EVIDENCE),totals:evidence.campaigns[0].totals,sources,files},null,2));
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
