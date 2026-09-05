#!/usr/bin/env node
/* Read-only, course-independent pond survey. No model or published asset writes.
 * node pond-survey.mjs --repo /path/to/repo --build upsalabuild --ground upsala --out /tmp/upsala-pond-review
 * BUILD and GROUND are accepted instead of their options. Output is candidate
 * evidence only: a flat DTM plate does not establish water identity or today's edge.
 * No morphology, smoothing, largest-component selection, or fixed lake level.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const finitePair = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const area2 = r => r.reduce((s,p,i) => { const q=r[(i+1)%r.length]; return s+p[0]*q[1]-q[0]*p[1]; },0);
const inRing = (x,y,r) => { let yes=false; for(let i=0,j=r.length-1;i<r.length;j=i++) if((r[i][1]>y)!==(r[j][1]>y) && x<(r[j][0]-r[i][0])*(y-r[i][1])/(r[j][1]-r[i][1])+r[i][0])yes=!yes; return yes; };
const quant = (sorted,q) => sorted[Math.min(sorted.length-1,Math.floor(sorted.length*q))] ?? null;
const round = x => Number.isFinite(x) ? +x.toFixed(3) : null;
const roundRing = r => r.map(p=>p.map(round));
const collinear = r => r.filter((p,i)=>{const a=r[(i+r.length-1)%r.length],b=r[(i+1)%r.length];return (p[0]-a[0])*(b[1]-p[1]) !== (p[1]-a[1])*(b[0]-p[0]);});

/** Exact boundary of occupied raster cells; 4-connectivity, explicit inner loops.
 * Directed edge/right-turn convention follows geobuild/laser-water.mjs traceMask.
 * Return open rings in [column,row] coordinates; corners are half-integers.
 */
export function traceCellPolygons(mask,width,height) {
  assert.equal(mask.length,width*height);
  const at=(x,y)=>x>=0&&y>=0&&x<width&&y<height&&mask[y*width+x]===1;
  const key=(x,y)=>y*(width+1)+x,edges=new Map();
  const add=(x,y,xx,yy,dir)=>{const k=key(x,y);if(!edges.has(k))edges.set(k,[]);edges.get(k).push({to:key(xx,yy),dir,used:false});};
  let occupied=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(at(x,y)){
    occupied++;
    if(!at(x,y-1))add(x,y,x+1,y,0);
    if(!at(x+1,y))add(x+1,y,x+1,y+1,1);
    if(!at(x,y+1))add(x+1,y+1,x,y+1,2);
    if(!at(x-1,y))add(x,y+1,x,y,3);
  }
  const loops=[];
  for(const [start,choices]of edges)for(const first of choices){
    if(first.used)continue;const pts=[];let current=start,e=first;
    while(e&&!e.used){e.used=true;pts.push([current%(width+1)-.5,Math.floor(current/(width+1))-.5]);current=e.to;if(current===start)break;const next=edges.get(current)||[];e=next.find(a=>!a.used&&a.dir===(e.dir+1)%4)||next.find(a=>!a.used);}
    assert.equal(current,start,'open raster boundary');
    const ring=collinear(pts);assert(ring.length>=4&&area2(ring)!==0,'degenerate raster loop');loops.push(ring);
  }
  const outer=loops.filter(r=>area2(r)>0).map(r=>({rings:[r],cellArea:area2(r)/2}));
  for(const hole of loops.filter(r=>area2(r)<0)){
    const [a,b]=hole,dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
    const p=[(a[0]+b[0])/2+dy/length*.25,(a[1]+b[1])/2-dx/length*.25];
    const candidates=outer.filter(o=>inRing(...p,o.rings[0])).sort((a,b)=>a.cellArea-b.cellArea);
    assert(candidates.length,'unowned interior boundary');candidates[0].rings.push(hole);
  }
  const net=loops.reduce((s,r)=>s+area2(r)/2,0);assert.equal(net,occupied,'boundary does not preserve raster area');
  return {polygons:outer.map(o=>o.rings),occupiedCells:occupied,outerCount:outer.length,holeCount:loops.length-outer.length};
}

/** Pure candidate measurement in absolute EPSG3006; terrain samples are RH2000.
 * NoData cannot seed or extend a flood. A clipped/incomplete source is reported
 * with a measured level when possible, but produces no replacement geometry.
 */
export function measureBody(body,grid,{band=.075,floodBand=.10,minFraction=.60,margin=60,maxCells=4_000_000}={}) {
  const {width,height,e0,n1,heights}=grid;
  assert.equal(heights.length,width*height);assert(band>0&&floodBand>=band&&minFraction>0&&minFraction<=1&&margin>=1);
  const rings=body.rings;assert(Array.isArray(rings)&&rings.length&&rings.every(r=>r.length>=3&&r.every(finitePair)),'body requires finite EPSG3006 polygon rings');
  const rasterRings=rings.map(r=>r.map(([e,n])=>[e-e0,n1-n]));
  const outer=rasterRings[0],xs=outer.map(p=>p[0]),ys=outer.map(p=>p[1]);
  const minX=Math.floor(Math.min(...xs)),maxX=Math.ceil(Math.max(...xs)),minY=Math.floor(Math.min(...ys)),maxY=Math.ceil(Math.max(...ys));
  const record={id:body.id,sourceLevelLegacyM:body.level??null,levelRH2000M:null,decision:'review-required',geometry:null,sourceRingCount:rings.length,samples:0,missingSamples:0};
  if(maxX<0||maxY<0||minX>=width||minY>=height)return {...record,decision:'outside-published-terrain'};
  const x0=Math.max(0,minX),x1=Math.min(width-1,maxX),y0=Math.max(0,minY),y1=Math.min(height-1,maxY);
  if((x1-x0+1)*(y1-y0+1)>maxCells)return {...record,decision:'source-window-exceeds-budget'};
  const samples=[],seeds=[];
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    if(!inRing(x,y,outer)||rasterRings.slice(1).some(r=>inRing(x,y,r)))continue;
    const z=heights[y*width+x];if(!Number.isFinite(z)){record.missingSamples++;continue;}samples.push(z);seeds.push([x,y,z]);
  }
  samples.sort((a,b)=>a-b);record.samples=samples.length;
  if(samples.length<20)return {...record,decision:'insufficient-finite-samples'};
  const med=quant(samples,.5),fraction=samples.filter(h=>Math.abs(h-med)<=band).length/samples.length;
  Object.assign(record,{levelRH2000M:round(med),p05RH2000M:round(quant(samples,.05)),p95RH2000M:round(quant(samples,.95)),fractionWithinBand:round(fraction)});
  if(minX<1||minY<1||maxX>width-2||maxY>height-2)return {...record,decision:'partial-terrain-coverage-level-only'};
  if(record.missingSamples)return {...record,decision:'source-has-nodata-level-only'};
  if(fraction<minFraction)return {...record,decision:'no-dominant-flat-plate'};
  const bx0=Math.max(0,minX-margin),by0=Math.max(0,minY-margin),bx1=Math.min(width-1,maxX+margin),by1=Math.min(height-1,maxY+margin);
  const bw=bx1-bx0+1,bh=by1-by0+1;
  if(bw*bh>maxCells)return {...record,decision:'flood-window-exceeds-budget'};
  const mask=new Uint8Array(bw*bh),queue=[];let cursor=0,hitBoundary=false,touchedNoData=false;
  for(const[x,y,z]of seeds)if(Math.abs(z-med)<=band){const j=(y-by0)*bw+x-bx0;if(!mask[j]){mask[j]=1;queue.push(j);}}
  while(cursor<queue.length){
    const i=queue[cursor++],x=i%bw,y=Math.floor(i/bw);
    if(!x||!y||x===bw-1||y===bh-1)hitBoundary=true;
    for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){
      const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=bw||yy>=bh)continue;const j=yy*bw+xx;if(mask[j])continue;
      const z=heights[(yy+by0)*width+xx+bx0];if(!Number.isFinite(z)){touchedNoData=true;continue;}if(Math.abs(z-med)>floodBand)continue;mask[j]=1;queue.push(j);
    }
  }
  const result=traceCellPolygons(mask,bw,bh);
  Object.assign(record,{floodCells:result.occupiedCells,outerCount:result.outerCount,holeCount:result.holeCount,hitSearchBoundary:hitBoundary,touchedNoData,removedByMorphologyCells:0});
  if(hitBoundary||touchedNoData)return {...record,decision:hitBoundary?'flood-reaches-search-boundary-level-only':'flood-touches-nodata-level-only'};
  const polygons=result.polygons.map(poly=>poly.map(r=>{const p=roundRing(r.map(([x,y])=>[e0+bx0+x,n1-by0-y]));return [...p,p[0]];}));
  record.geometry={type:'MultiPolygon',coordinates:polygons};
  record.decision='candidate-needs-dated-imagery-and-topology-review';
  return record;
}

const BUILD_GROUNDS={geobuild:'veckefjarden',upsalabuild:'upsala',upsalamellanbuild:'upsala-mellanbanan',puttombuild:'puttom',johannesbergbuild:'johannesberg',angsobuild:'angso',nvgkbuild:'norrfallsviken',ribbingsforsbuild:'ribbingsfors'};
export async function main(argv=process.argv.slice(2)) {
  const args={};for(let i=0;i<argv.length;i++){if(argv[i]==='--help'){console.log('node pond-survey.mjs --repo REPO --build BUILD --ground SLUG --out OUTPUT_PREFIX [--ids id1,id2]');return;}assert(/^--[a-z-]+$/.test(argv[i])&&i+1<argv.length,'options require values');args[argv[i].slice(2)]=argv[++i];}
  const repo=path.resolve(args.repo||process.env.COURSE_REPO||process.cwd()),build=args.build||process.env.BUILD,ground=args.ground||process.env.GROUND||BUILD_GROUNDS[build];
  assert(build&&ground&&args.out,'--build/BUILD, --ground/GROUND, and --out are required');
  const prefix=path.resolve(args.out),modelPath=path.resolve(repo,build,'course-model.json'),publicPath=path.join(repo,'apps/golf/public');
  assert.notEqual(prefix+'.json',modelPath,'output must not overwrite source model');
  const sourceBytes=fs.readFileSync(modelPath),model=JSON.parse(sourceBytes);
  assert(model.origin&&Number.isFinite(model.origin.lat)&&Number.isFinite(model.origin.lon)&&model.mPerLat>0&&model.mPerLon>0,'requires an explicit legacy flat-earth model frame');
  const imports=['packages/course-v2/chunk-node.mjs','packages/course-v2/terrain-grid.mjs','packages/course-geo/chmv2/projection.mjs'];
  const [{readChunk},{decodeTerrainGrid},{latLonToSweref99Tm}]=await Promise.all(imports.map(p=>import(pathToFileURL(path.join(repo,p)))));
  const publicFile=ref=>{const p=path.resolve(publicPath,ref.url);assert(p.startsWith(publicPath+path.sep),'asset URL escapes public directory');const bytes=fs.readFileSync(p);if(ref.sha256)assert.equal(hash(bytes),ref.sha256,`asset checksum ${ref.url}`);return bytes;};
  const index=JSON.parse(fs.readFileSync(path.join(publicPath,'courses/v2-index.json'))),entry=index.courses.find(x=>x.slug===ground);assert(entry,`no published course ${ground}`);
  const courseBytes=publicFile(entry.manifest),course=JSON.parse(courseBytes),groundBytes=publicFile(course.groundManifest),groundModel=JSON.parse(groundBytes);
  assert.equal(groundModel.frame.horizontalCrs,'EPSG:3006');assert.equal(groundModel.frame.verticalCrs,'EPSG:5613');
  const tiles=groundModel.tiles.filter(t=>t.lod===0||t.id.startsWith('l0/'));assert(tiles.length,'no published level-0 terrain');
  const e0=Math.min(...tiles.map(t=>t.bounds.minEasting)),n1=Math.max(...tiles.map(t=>t.bounds.maxNorthing)),e1=Math.max(...tiles.map(t=>t.bounds.maxEasting)),n0=Math.min(...tiles.map(t=>t.bounds.minNorthing));
  const width=Math.round(e1-e0)+1,height=Math.round(n1-n0)+1;assert(width*height<=25_000_000,'terrain window exceeds25 million samples');
  const heights=new Float32Array(width*height).fill(NaN),seen=new Uint8Array(width*height);const tileSources=[];
  for(const t of tiles){const ref=t.layers.terrain,bytes=publicFile(ref),chunk=readChunk(bytes),g=chunk.header.grid,z=decodeTerrainGrid(chunk.payload,g);assert(Math.abs((t.bounds.maxEasting-t.bounds.minEasting)/(g.width-1)-1)<1e-6&&Math.abs((t.bounds.maxNorthing-t.bounds.minNorthing)/(g.height-1)-1)<1e-6,'requires1m terrain');
    const cx=t.bounds.minEasting-e0,cy=n1-t.bounds.maxNorthing;assert(Number.isInteger(cx)&&Number.isInteger(cy),'unaligned terrain tile');
    for(let y=0;y<g.height;y++)for(let x=0;x<g.width;x++){const i=(cy+y)*width+cx+x,h=z[y*g.width+x];if(seen[i])assert((!Number.isFinite(h)&&!Number.isFinite(heights[i]))||Math.abs(heights[i]-h)<.011,'shared terrain samples disagree');heights[i]=h;seen[i]=1;}tileSources.push({id:t.id,url:ref.url,sha256:hash(bytes)});
  }
  const project=([x,z])=>latLonToSweref99Tm(model.origin.lat-z/model.mPerLat,model.origin.lon+x/model.mPerLon);
  const selected=args.ids?new Set(args.ids.split(',')):null;
  const water=(model.water||[]).filter(w=>!selected||selected.has(w.id));if(selected)assert.equal(water.length,selected.size,'requested body ID missing or duplicated');
  const originProjected=project([0,0]);assert(originProjected[0]>=e0-2000&&originProjected[0]<=e1+2000&&originProjected[1]>=n0-2000&&originProjected[1]<=n1+2000,'model frame is remote from selected ground; verify BUILD/GROUND');
  const rows=water.map(w=>measureBody({id:w.id,level:w.level,rings:[w.ring,...(w.holes||[])].map(r=>r.map(project))},{width,height,e0,n1,heights}));
  const provenance={sourceModel:{path:path.relative(repo,modelPath),sha256:hash(sourceBytes)},courseManifestSha256:hash(courseBytes),groundManifestSha256:hash(groundBytes),groundId:groundModel.groundId,frame:groundModel.frame,tiles:tileSources,modelLocalFrame:{origin:model.origin,mPerLat:model.mPerLat,mPerLon:model.mPerLon},transformation:'exact repository flat-earth inverse then SWEREF99TM projection; no fitted registration',outputCrs:'EPSG:3006',heightDatum:'RH2000',pixelSpacingIsNotAccuracy:true};
  const report={schemaVersion:1,ground,build,reviewRequired:true,automaticAdoption:false,method:{level:'per-body median of finite1m DTM interior samples',plateBandM:.075,plateFraction:.60,floodBandM:.10,searchMarginM:60,connectivity:4,morphology:'none; all necks, components and inner rings retained',boundary:'exact occupied-cell edges, collinear vertices removed only'},provenance,summary:{bodies:rows.length,candidates:rows.filter(r=>r.geometry).length},bodies:rows};
  const features=rows.filter(r=>r.geometry).map(({geometry,...properties})=>({type:'Feature',id:properties.id,properties:{...properties,automaticAdoption:false,sourceAbsoluteHorizontalAccuracyM:null},geometry}));
  const geojson={type:'FeatureCollection',name:`${ground} pond candidates EPSG3006`,crs:{type:'name',properties:{name:'EPSG:3006'}},features};
  fs.mkdirSync(path.dirname(prefix),{recursive:true});fs.writeFileSync(prefix+'.json',JSON.stringify(report,null,2)+'\n');fs.writeFileSync(prefix+'.epsg3006.geojson',JSON.stringify(geojson,null,2)+'\n');console.log(JSON.stringify({ground,...report.summary,report:prefix+'.json',candidateFile:prefix+'.epsg3006.geojson'}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
