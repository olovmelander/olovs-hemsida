#!/usr/bin/env node
/* Source-preservation and browser smoke evidence for the provisional Visby
 * course. Serve apps/golf/dist; BANVY_GPU=1 node visbybuild/check-runtime.mjs
 * http://127.0.0.1:8642 [--gl] [--mobile] [--fallback]. --source-only starts
 * no browser. A graph-resource outage is distinct from a fully offline app. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs } from '../tools/browser-args.mjs';
import { VISBY_FRAME as FRAME } from './frame.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'visbybuild/cache/runtime-review');
fs.mkdirSync(OUT, { recursive: true });
const read = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const hash = p => createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
const gl = process.argv.includes('--gl');
const mobile = process.argv.includes('--mobile');
const fallback = process.argv.includes('--fallback');
const offline = process.argv.includes('--offline');
const sourceOnly = process.argv.includes('--source-only');
const variant = sourceOnly ? 'source' : offline ? 'offline' : fallback ? 'fallback' : mobile ? 'mobile' : gl ? 'webgl' : 'webgpu';
const BASE = (process.argv.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:8642').replace(/\/$/, '');
const sourcePath = 'visbybuild/cache/terrain-review/terrain-1m.f32';
const waterPath = 'geo_data/course-v2/visby/mapping/water-breakgeometry-epsg3006.geojson';
const simpleWaterPath = 'geo_data/course-v2/visby/mapping/water-breakgeometry-simple-epsg3006.geojson';
const standsPath = 'visbybuild/cache/vegetation/stands-stage/layer-index.json';
const source = fs.readFileSync(path.join(ROOT, sourcePath));
const model = read('visbybuild/course-model.json');
const water = read(waterPath), simpleWater = read(simpleWaterPath);
const stands = read(standsPath);
const published = read('apps/golf/public/visby-ground-graph-report.json');
const routes = read('visbybuild/mapping/route-reference.json');
const checks = [];
const gate = (ok, message, details) => checks.push({ ok: !!ok, message, ...(details === undefined ? {} : { details }) });
const finitePair = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const local = ([e, n]) => [e - FRAME.easting, FRAME.northing - n];
const bbox = ring => [Math.min(...ring.map(p => p[0])), Math.min(...ring.map(p => p[1])), Math.max(...ring.map(p => p[0])), Math.max(...ring.map(p => p[1]))];
const inside = (p, ring) => {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i], [u, v] = ring[j];
    if ((y > p[1]) !== (v > p[1]) && p[0] < (u-x)*(p[1]-y)/(v-y)+x) result = !result;
  }
  return result;
};
function interiorPoint(ring) {
  const [x0,y0,x1,y1] = bbox(ring);
  // Centre-first grid search stays away from island edges and handles concavity.
  const candidates = [];
  for (let row=1; row<20; row++) for (let col=1; col<20; col++) {
    const p=[x0+(x1-x0)*col/20,y0+(y1-y0)*row/20];
    if (inside(p,ring)) candidates.push(p);
  }
  candidates.sort((a,b) => Math.hypot(a[0]-(x0+x1)/2,a[1]-(y0+y1)/2)-Math.hypot(b[0]-(x0+x1)/2,b[1]-(y0+y1)/2));
  if (!candidates.length) throw new Error('Could not locate a source island interior sample');
  return candidates[0];
}
const sourceWater = simpleWater.features.flatMap(f => (f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]).map((poly,i) => ({
  id:`${f.id}-part-${i+1}`, level:f.properties.heightRH2000, ring:poly[0].map(local), bounds:bbox(poly[0].map(local)),
})));
const islands = water.features.flatMap(f => (f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]).flatMap((poly,i) => poly.slice(1).map((ring,j) => ({
  id:`${f.id}-polygon-${i+1}-island-${j+1}`, point:local(interiorPoint(ring)),
}))));
gate(source.length === 4097*4097*4, 'Retained native-metre source contains the complete 4097 by 4097 sample window');
gate(model.holes.length === 18 && model.holes.every((h,i) => h.n === i+1 && h.line.length >= 2 && finitePair(h.green.c)), 'All18 authored hole routes have finite green navigation targets');
gate(model.holes.reduce((n,h) => n+h.tees.pads.length,0) === 17 && model.holes[11].tees.pads.length === 0 && model.holes[11].tees.status === 'unresolved-physical-platform', '17 observed physical tee pads and the explicit unresolved hole12 platform survive the authored model');
gate(published.graph.tiles === 469 && published.graph.finestTiles === 256 && stands.assets.length === 256, 'Published graph contains the 469-tile ring quadtree, all 256 native-metre tiles and 256 stand chunks');
gate(sourceWater.length === model.water.length && islands.length === 10 && islands.every(i => model.water.every(w => !inside(i.point,w.ring))), 'Compatibility water preserves all10 source island interiors', { sourceFeatures:water.features.length, compatibilityPieces:sourceWater.length, islands:islands.length });
const points = [];
for (let row=0;row<8;row++) for(let col=0;col<8;col++) points.push({label:`frontier-${row}-${col}`,x:-896+256*col,z:-1152+256*row});
for(const h of model.holes) for(const [label,p] of [['green',h.green.c],['start',h.line[0]]]) points.push({label:`hole-${h.n}-${label}`,x:Math.round(p[0]),z:Math.round(p[1])});
for(const p of points) p.expectedRH2000=source.readFloatLE(((p.z+2048)*4097+p.x+2048)*4);
const sources = { sourceTerrainSha256:hash(sourcePath), courseModelSha256:hash('visbybuild/course-model.json'), routeReferenceSha256:hash('visbybuild/mapping/route-reference.json'), waterSha256:hash(waterPath), compatibilityWaterSha256:hash(simpleWaterPath), standIndexSha256:hash(standsPath), graph:published.graph, frame:FRAME };
const startedAt = new Date().toISOString();
const errors=[], logs=[], requests=[], screenshots=[];
let report={};
let browser;
async function offlineProof() {
  // Own this helper, so stopping it cannot interrupt another agent's server.
  const port=Number(process.env.VISBY_OFFLINE_PORT||8643), base=`http://127.0.0.1:${port}`;
  try { await fetch(base,{signal:AbortSignal.timeout(750)}); throw new Error(`Offline-test port ${port} is already serving; choose VISBY_OFFLINE_PORT`); }
  catch(error) { if(error.message.includes('already serving'))throw error; }
  const server=spawn(process.execPath,[path.join(ROOT,'tools/serve.mjs'),path.join(ROOT,'apps/golf/dist'),String(port)],{stdio:'ignore',windowsHide:true});
  const stopped=new Promise(resolve=>server.once('exit',resolve));
  let context;
  const profile=fs.mkdtempSync(path.join(OUT,'offline-profile-'));
  const launch=()=>chromium.launchPersistentContext(profile,{channel:'chrome',args:browserArgs(),viewport:{width:1000,height:800}});
  const boot=async(page,url)=>{await page.goto(url,{waitUntil:'load',timeout:120000});await page.waitForSelector('#boot.done',{timeout:420000});await page.waitForFunction(()=>window.V3D?.settled(),null,{timeout:120000});};
  const url=`${base}/?bana=visby&v2=0&gl=1&det=1&ljus=dag`;
  try {
    let ready=false;
    for(let attempt=0;attempt<100&&!ready;attempt++) {
      try {ready=(await fetch(base,{signal:AbortSignal.timeout(1000)})).ok;} catch {}
      if(!ready)await new Promise(r=>setTimeout(r,100));
    }
    if(!ready)throw new Error('Owned offline test server did not become ready');
    context=await launch();
    const page=context.pages()[0]||await context.newPage();
    page.on('pageerror',e=>errors.push(String(e).slice(0,500)));
    await boot(page,url);
    await page.evaluate(()=>navigator.serviceWorker.ready);
    await page.reload({waitUntil:'load'});
    await page.waitForSelector('#boot.done',{timeout:420000});
    await page.waitForFunction(async()=>Boolean(await (await caches.open('banvy-packs')).match(new URL('courses/visby/pack.bin',location.href),{ignoreSearch:true})),null,{timeout:30000});
    const cachesBefore=await page.evaluate(async()=>{const out={};for(const name of await caches.keys())out[name]=(await(await caches.open(name)).keys()).length;return out;});
    gate((cachesBefore['banvy-packs']??0)>=1,'Visited Visby pack is cached under a controlling service worker',cachesBefore);
    await context.close();context=null;
    server.kill();await stopped;
    let serving=false;
    try {serving=(await fetch(base,{signal:AbortSignal.timeout(1000)})).ok;}catch{}
    gate(!serving,'Owned origin server is stopped before offline browser relaunch');
    context=await launch();
    const reopened=context.pages()[0]||await context.newPage();
    reopened.on('pageerror',e=>errors.push(String(e).slice(0,500)));
    await boot(reopened,url);
    const state=await reopened.evaluate(()=>({course:window.V3D.course(),holes:window.V3D.M.holes.map(h=>({n:h.n,par:h.par,pads:h.tees.pads.length})),terrain:window.V3D.v2Terrain(),camera:window.V3D.cameraInfo()}));
    gate(state.course.slug==='visby'&&state.holes.length===18&&state.holes.reduce((sum,h)=>sum+h.par,0)===72&&state.holes[11].pads===0,'Persistent offline relaunch restores the real18-hole Visby card and geometry from cache',state);
    const relative='visbybuild/cache/runtime-review/offline-overview.png';
    await reopened.screenshot({path:path.join(ROOT,relative)});screenshots.push(relative);
    const missing=await context.newPage();
    await missing.goto(`${base}/?bana=puttom&v2=0&gl=1&det=1`,{waitUntil:'load',timeout:30000});
    await missing.waitForFunction(()=>/inte nedladdad/i.test(document.querySelector('#bmsg')?.textContent||''),null,{timeout:30000});
    const message=await missing.locator('#bmsg').innerText();
    gate(/inte nedladdad/i.test(message)&&!/TypeError|Uncaught/i.test(message),'A never-downloaded course reports the useful offline message',message);
    gate(errors.length===0,'Offline relaunch has no uncaught browser exceptions',errors);
    return {url,offlineState:state,cachesBefore,serverStopped:true,profile:path.relative(ROOT,profile)};
  }finally{if(context)await context.close();if(server.exitCode===null){server.kill();await stopped;}}
}
try {
  if(offline) report=await offlineProof();
  else if (!sourceOnly) {
    browser=await chromium.launch({channel:'chrome',args:browserArgs()});
    const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},deviceScaleFactor:1,hasTouch:mobile,isMobile:mobile,serviceWorkers:'block'});
    if(fallback) await context.route('**/v2-index.json*',route=>route.abort('internetdisconnected'));
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(String(e).slice(0,500)));
    page.on('console',m=>{if(m.type()==='error'||/v2 water|v2 vegetation|provisional/i.test(m.text())) logs.push(m.text().slice(0,500));});
    page.on('response',r=>{if(/v2-index|grounds\/visby|courses\/visby|visby-ground-graph/.test(r.url())) requests.push({url:r.url(),status:r.status()});});
    const url=`${BASE}/?bana=visby&det=1&ljus=dag${fallback?'':'&v2=require'}${gl||fallback?'&gl=1':''}`;
    await page.goto(url,{waitUntil:'load',timeout:120000});
    await page.waitForSelector('#boot.done',{timeout:420000});
    await page.waitForFunction(()=>window.V3D?.settled(),null,{timeout:120000});
    console.log(`Visby ${variant} boot completed.`);
    const state=await page.evaluate(({points,islands})=>{
      const V=window.V3D;
      return {terrain:V.v2Terrain(),objects:V.v2Objects(),trees:V.legacyTrees(),water:V.waterLevels(),sheets:V.waterSheets(),flatWater:V.flatWater(),carvedGpuTiles:V.carvedGpuTiles(),
        samples:points.map(p=>({...p,height:V.probeH(p.x,p.z),inspected:V.heightSample(p.x,p.z),waterBed:V.waterBedAt(p.x,p.z)})),
        islands:islands.map(p=>({...p,waterRings:V.probeGround(...p.point).rings,waterBed:V.waterBedAt(...p.point)})),
        renderer:V.rendererInfo(),quality:V.quality(),course:V.course(),camera:V.cameraInfo(),stats:V.stats,
        holes:V.M.holes.map(h=>({n:h.n,green:h.green.c,lineStart:h.line[0],teePads:h.tees.pads.length,teeStatus:h.tees.status})),
        viewport:{width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth}};
    },{points,islands});
    report={url,state};
    gate(errors.length===0,'No uncaught browser exceptions',errors);
    gate(state.holes.length===18 && state.holes[11].teePads===0 && state.holes[11].teeStatus==='unresolved-physical-platform','Loaded pack retains all18 holes and hole12 has no fabricated physical pad');
    gate(state.islands.length===10 && state.islands.every(p=>p.waterRings.length===0),'Runtime water polygons leave every sampled source island uncovered');
    if(fallback){
      gate(!state.terrain.ready && state.terrain.selection.mode==='fallback','Graph-index network outage selects explicit GPK1 terrain fallback',state.terrain);
      gate(state.samples.every(p=>Number.isFinite(p.height)),'Fallback terrain supplies finite heights across the active course');
    } else {
      const expectedBackend=gl?'webgl2':'webgpu';
      gate(state.terrain.backend===expectedBackend,'Requested graphics backend is active',{expected:expectedBackend,actual:state.terrain.backend});
      gate(state.terrain.ready&&state.terrain.status==='ready'&&state.terrain.renderer.meshResolutionMetres===1,'Source v2 terrain is ready with one-metre mesh resolution');
      gate(requests.some(r=>r.url.includes(published.graph.courseManifestSha256))&&requests.some(r=>r.url.includes(published.graph.groundManifestSha256)),'Browser loaded the current published course and ground manifest hashes');
      const expectedStandBytes=stands.assets.reduce((s,a)=>s+a.reference.bytes,0);
      const missingStands=stands.assets.filter(a=>!requests.some(r=>r.status===200&&r.url.includes(a.reference.sha256))).map(a=>a.tileId);
      gate(state.objects.loaded?.bytes===expectedStandBytes&&state.objects.loaded?.records===0&&missingStands.length===0,'All final stand chunk identities loaded with no individual records',{expectedChunks:stands.assets.length,missingChunks:missingStands,expectedBytes:expectedStandBytes,loadedBytes:state.objects.loaded?.bytes});
      const maximumHeightErrorMetres=Math.max(...state.samples.map(p=>Math.abs(p.height-p.expectedRH2000)));
      gate(Number.isFinite(maximumHeightErrorMetres)&&maximumHeightErrorMetres<=0.01001,'100 source-grid probes preserve RH2000 within centimetre quantization',{samples:state.samples.length,maximumHeightErrorMetres});
      const waterChecks=state.water.map(w=>{
        const bounds=[w.bb.x0,w.bb.z0,w.bb.x1,w.bb.z1];
        const match=sourceWater.map(s=>({s,error:Math.max(...s.bounds.map((v,i)=>Math.abs(v-bounds[i])))})).sort((a,b)=>a.error-b.error)[0];
        return {sourceId:match.s.id,boundsErrorMetres:match.error,expectedRH2000:match.s.level,actualRH2000:w.level};
      });
      gate(waterChecks.length===sourceWater.length&&new Set(waterChecks.map(w=>w.sourceId)).size===sourceWater.length&&waterChecks.every(w=>w.boundsErrorMetres<0.011&&Math.abs(w.expectedRH2000-w.actualRH2000)<1e-6),'Every compatibility water piece retains its source bounds and documented RH2000 representative level',{pieces:waterChecks.length,maximumBoundsErrorMetres:Math.max(...waterChecks.map(w=>w.boundsErrorMetres)),maximumLevelErrorMetres:Math.max(...waterChecks.map(w=>Math.abs(w.expectedRH2000-w.actualRH2000)))});
      gate(state.flatWater===null&&state.carvedGpuTiles===null&&state.samples.every(p=>p.waterBed===null),'No inferred flat-water field or carved bathymetry is active');
      gate(state.objects.coverageTiles===256&&state.objects.graphStandTiles===256&&state.trees.legacyInsideCoverage===0,'All256 measured stand fields suppress extra legacy vegetation inside coverage');
      gate(state.trees.total>0&&state.trees.reasons.v2Stand===state.trees.total&&Object.entries(state.trees.reasons).every(([key,value])=>key==='v2Stand'||value===0)&&state.objects.planned?.individuals===0,'Every rendered tree is a measured-stand representative; no individual, OSM, fairway-row or extra legacy trees are generated',state.trees.reasons);
    }
    const cameras=[];
    for(let hole=1;hole<=18;hole++){
      await page.evaluate(n=>{window.V3D.goHole(n,false,true);window.V3D.setCam('green',true);},hole);
      // Instant camera changes update controls.target immediately, whereas
      // orientation is applied by the next render. settled() alone can already
      // be true before that first frame and falsely report an offscreen target.
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await page.waitForFunction(()=>window.V3D.settled(),null,{timeout:120000});
      cameras.push(await page.evaluate(n=>{const V=window.V3D,h=V.M.holes[n-1],c=V.cameraInfo(),g=h.green.c;return{hole:n,active:V.flightState().hole,position:c.position,greenProjected:V.project(g[0],V.probeH(...g),g[1]),groundBelow:V.probeH(c.position[0],c.position[2])};},hole));
      if([3,9,12,16,18].includes(hole)&&!fallback){
        const relative=`visbybuild/cache/runtime-review/${variant}-hole-${hole}.png`;
        await page.screenshot({path:path.join(ROOT,relative)});screenshots.push(relative);
      }
      if(hole===16&&!mobile&&!fallback){
        report.treeReview16=await page.evaluate(()=>{
          const V=window.V3D,h=V.M.holes[15];
          return V.legacyTrees({instances:true}).instances.filter(t=>Math.abs(t[0]-h.pin[0])<90&&t[2]>20&&t[2]<160).map(t=>({instance:t,projectedBase:V.project(t[0],t[1],t[2]),easting:687748.5+t[0],northing:6370951.5-t[2],sourcePixel:[(687748.5+t[0]-686900.25)*2,(6372149.75-6370951.5+t[2])*2]}));
        });
      }
    }
    gate(cameras.length===18&&cameras.every(c=>c.active===c.hole&&c.position.every(Number.isFinite)&&Number.isFinite(c.groundBelow)&&c.position[1]>=c.groundBelow-0.02&&c.greenProjected.visible),'All18 goHole green cameras settle above terrain and show their finite green target',cameras);
    if(mobile) gate(state.viewport.width===390&&state.viewport.scrollWidth<=391,'390px mobile viewport has no horizontal page overflow',state.viewport);
    await page.evaluate(()=>{window.V3D.setPreset('noon');window.V3D.setView(800,1000,1100,0,5,-250);});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.waitForFunction(()=>window.V3D.settled(),null,{timeout:120000});
    const overview=`visbybuild/cache/runtime-review/${variant}-overview.png`;
    await page.screenshot({path:path.join(ROOT,overview)});screenshots.push(overview);
    report.cameras=cameras;
    gate(errors.length===0,'All camera navigation completed without uncaught browser exceptions',errors);
  }
} catch(error){ report.failed=true;report.error=error.stack; }
finally { if(browser)await browser.close(); }
report={schemaVersion:1,groundId:'visby',variant,startedAt,completedAt:new Date().toISOString(),...report,sources,checks,errors,logs,requests,screenshots,
  limitations:['Provisional source preservation and rendering review, not survey approval or current-course validation.','2022 interpreted playing surfaces and unnamed representative tees; hole12 uses a virtual fairway start without physical pad geometry.','2024 canopy stand representatives are not measured stem positions.','Source water levels may be representative medians of nonconstant source Z; bathymetry is unknown.',...(fallback?['Only the graph index request was made unavailable; HTML, scripts and the GPK1 pack stayed available. This is a graph-resource outage fallback test, not a fully offline installation.']:[]),...(offline?['Offline mode explicitly requests the cached GPK1 fallback with v2=0; no claim that the complete v2 terrain graph is cached. The owned origin server was stopped before browser relaunch.']:[])]};
const status=report.failed||checks.some(c=>!c.ok)?'failed':'passed';
fs.writeFileSync(path.join(OUT,`${variant}.json`),JSON.stringify(report,null,2)+'\n');
const compact={schemaVersion:1,groundId:'visby',variant,status,startedAt,completedAt:report.completedAt,url:report.url,sources,checks,
  backend:report.state?.terrain.backend??null,vegetation:report.state?{coverageTiles:report.state.objects.coverageTiles,loadedRecords:report.state.objects.loaded?.records,renderedStandRepresentatives:report.state.trees.reasons.v2Stand,legacyInsideCoverage:report.state.trees.legacyInsideCoverage}:null,
  screenshots,detailedReport:`visbybuild/cache/runtime-review/${variant}.json`,limitations:report.limitations,error:report.error};
fs.writeFileSync(path.join(ROOT,`visbybuild/mapping/3d-validation-${variant}.json`),JSON.stringify(compact,null,2)+'\n');
console.log(JSON.stringify({status,variant,checks:checks.map(({ok,message,details})=>({ok,message,...(!ok?{details}:{})})),error:report.error,report:`visbybuild/cache/runtime-review/${variant}.json`},null,2));
if(status!=='passed')process.exitCode=1;
