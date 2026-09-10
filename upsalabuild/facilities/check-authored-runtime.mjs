/* Actual built-app proof. Run after Blender export and npm --prefix apps/golf run build.
 * $env:BANVY_GPU='1'; node upsalabuild/facilities/check-authored-runtime.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { browserArgs } from '../../tools/browser-args.mjs';
import { validateUpsalaMeshPackage } from '../../apps/golf/src/engine/scenery/upsala-architecture.mjs';

const ROOT=path.resolve('.');
const CACHE='upsalabuild/cache/authored-facilities-runtime-2026-09-10';
const QUICK=process.env.UPSALA_ARCHITECTURE_QUICK==='1';
const DIST=path.resolve(ROOT,process.env.UPSALA_ARCHITECTURE_DIST||'apps/golf/dist');
const REPORT=QUICK?`${CACHE}/prototype-report.json`:'upsalabuild/facilities/models-2026-09-10/runtime-validation.json';
const ASSET='apps/golf/src/engine/scenery/upsala-authored-meshes.json';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytes=file=>fs.readFileSync(path.join(ROOT,file));
const read=file=>JSON.parse(bytes(file));
const packet=validateUpsalaMeshPackage(read(ASSET));
const base=process.env.UPSALA_ARCHITECTURE_URL||'http://127.0.0.1:8636';
const report={schemaVersion:1,reviewedAt:new Date().toISOString(),url:base,passed:false,
  completeProtocol:!QUICK,dist:DIST,
  method:'Actual built app: both routing slugs and terrain modes on WebGL2 plus Stora required-v2 on WebGPU, guarded replacements, source preservation, exact served mesh identity, roof ray intersections, source view and optional-chunk failure.',
  asset:{path:ASSET,sha256:sha(bytes(ASSET)),assets:packet.assets.length,triangles:packet.authoredTriangles},
  performanceEvidence:false,runs:[]};
fs.mkdirSync(path.join(ROOT,CACHE),{recursive:true});
const write=()=>fs.writeFileSync(path.join(ROOT,REPORT),JSON.stringify(report,null,2)+'\n');

// Broad, elevated triangles provide interior roof targets, without requiring
// authoring object names or introducing another coordinate transform.
function roofTargets(asset) {
  const floor=Math.max(...asset.foundations.map(f=>f.topHeightRH2000));
  const candidates=[];
  for(const part of asset.parts)for(let i=0;i<part.indices.length;i+=3) {
    const t=part.indices.slice(i,i+3).map(index=>part.positions.slice(index*3,index*3+3));
    const [a,b,c]=t,area=Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))/2;
    const centre=[0,1,2].map(k=>t.reduce((sum,p)=>sum+p[k]/3,0));
    if(area>1&&centre[1]>floor+1)candidates.push({part:part.name,point:centre,projectedArea:area});
  }
  return candidates.sort((a,b)=>b.projectedArea-a.projectedArea).slice(0,5);
}

const browser=await chromium.launch({channel:'chrome',args:browserArgs()});
try {
  const htmlResponse=await fetch(base);assert(htmlResponse.ok);
  const html=await htmlResponse.text();
  const modulePath=html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/)?.[1];
  assert(modulePath,'built module script missing');
  const moduleUrl=new URL(modulePath,base);
  const moduleBytes=Buffer.from(await(await fetch(moduleUrl)).arrayBuffer());
  const localModule=path.join(DIST,moduleUrl.pathname.replace(/^\//,''));
  assert.equal(sha(moduleBytes),sha(fs.readFileSync(localModule)),'served app bundle is stale');
  report.servedModule={url:moduleUrl.href,sha256:sha(moduleBytes)};

  let scenarios=[...['upsala','upsala-mellanbanan'].flatMap(slug=>['require','0'].map(mode=>({slug,mode,kind:'authored',backend:'webgl2'}))),
    {slug:'upsala',mode:'require',kind:'authored',backend:'webgpu'},
    {slug:'upsala',mode:'0',kind:'source',backend:'webgl2'},
    {slug:'upsala',mode:'0',kind:'missing-chunk',backend:'webgl2'}];
  if(QUICK)scenarios=scenarios.slice(0,1);
  for(const scenario of scenarios) {
    const {slug,mode,kind,backend}=scenario;
    const row={...scenario,errors:[],expectedResourceFailures:[],captures:[]};report.runs.push(row);
    const model=read(`${slug==='upsala'?'upsalabuild':'upsalamellanbuild'}/course-model.json`);
    const packFile=`courses/${slug}/pack.bin`,pack=bytes(`apps/golf/public/${packFile}`);
    assert.equal(sha(pack),sha(fs.readFileSync(path.join(DIST,packFile))),'dist pack is stale');
    const servedPack=await fetch(`${base}/${packFile}`);assert(servedPack.ok);
    assert.equal(sha(pack),sha(Buffer.from(await servedPack.arrayBuffer())),'served pack is stale');
    row.packSha256=sha(pack);
    const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1,serviceWorkers:'block'});
    await page.route('**/favicon.svg',route=>route.fulfill({status:204}));
    if(kind==='missing-chunk')await page.route(/upsala-authored-meshes-[^/]+\.js(?:\?.*)?$/,route=>{
      row.expectedResourceFailures.push(route.request().url());return route.abort('failed');
    });
    page.on('pageerror',error=>row.errors.push(String(error)));
    page.on('console',message=>{
      if(message.type()!=='error')return;
      if(kind==='missing-chunk'&&/Failed to load resource|Failed to fetch dynamically imported module/.test(message.text()))return;
      row.errors.push(message.text());
    });
    const meshResponse = kind==='missing-chunk' ? null : page.waitForResponse(
      response=>/upsala-authored-meshes-[^/]+\.js(?:\?.*)?$/.test(response.url()), {timeout:120000});
    const source=kind==='source'?'&buildingGeometry=source':'';
    const backendQuery=backend==='webgl2'?'&gl=1':'';
    console.log(`Boot ${slug} v2=${mode} ${kind} ${backend}`);
    await page.goto(`${base}/?bana=${slug}&v2=${mode}&det=1&q=lo&qualitylock=1&graphics=1${backendQuery}${source}`,{timeout:120000});
    await page.waitForSelector('#boot.done',{state:'attached',timeout:300000});
    if(meshResponse) {
      const response=await meshResponse;
      assert(response.ok(),'optional mesh chunk did not load');
      const servedChunk=await response.body(),chunkUrl=new URL(response.url());
      const localChunk=fs.readFileSync(path.join(DIST,chunkUrl.pathname.replace(/^\//,'')));
      assert.equal(sha(servedChunk),sha(localChunk),'served authored mesh chunk is stale');
      // The Vite JSON chunk is a standalone ESM data module. Comparing its
      // decoded package proves all vertices/materials match the authoring
      // export, even when a visual change leaves roof sample points unchanged.
      const compiled=await import(`data:text/javascript;base64,${servedChunk.toString('base64')}`);
      assert.deepEqual(validateUpsalaMeshPackage(compiled.default),packet,
        'built authored meshes differ from the current Blender export');
      row.servedMesh={url:chunkUrl.href,sha256:sha(servedChunk),sourcePackageMatches:true};
    }
    row.boot=await page.evaluate(()=>({stats:V3D.stats,terrain:V3D.v2Terrain(),renderer:V3D.rendererInfo()}));
    assert.equal(row.boot.terrain.backend,backend,'requested renderer backend was not exercised');
    if(mode==='require')assert(row.boot.terrain.ready&&row.boot.terrain.selection.requestMode==='require','required-v2 unavailable');
    else assert.equal(row.boot.terrain.requested,false,'GPK1 opt-out requested v2');
    row.sourceBuildingsUnchanged=await page.evaluate(expected=>JSON.stringify(V3D.M.infra.buildings)===JSON.stringify(expected),model.infra.buildings);
    assert(row.sourceBuildingsUnchanged,'authored appearance modified source buildings');
    const stats=row.boot.stats;
    if(kind==='authored') {
      assert.equal(stats.architectureAssets.state,'ready');
      assert.equal(stats.architectureAssets.authoredTriangles,packet.authoredTriangles);
      assert.equal(stats.architectureAssets.emittedAssetCount,packet.assets.length);
      const authored=stats.clubhouseDetails.filter(d=>d.disposition==='authored');
      assert.equal(authored.length,packet.assets.length);
      assert.equal(new Set(authored.map(d=>d.assetId)).size,packet.assets.length,'asset emitted twice');
      const replaced=packet.assets.flatMap(a=>a.replaces.map(r=>r.id));
      assert.deepEqual(stats.clubhouseDetails.map(d=>d.buildingId).sort(),replaced.sort(),'replacement IDs differ');
      assert.equal(stats.architecturalBuildings,replaced.length);
      assert(authored.every(d=>d.sourceGeometryPreserved&&d.roofHeightsPreserved));
      row.roofChecks=[];
      for(const asset of packet.assets) {
        const attempts=[];
        for(const target of roofTargets(asset)) {
          const hit=await page.evaluate(async point=>{
            V3D.placeCamera([point[0],point[1]+1,point[2]+.002],point);
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            return {pick:V3D.pick(0,0),camera:V3D.camExact()};
          },target.point);
          const distance=hit.pick?Math.hypot(...hit.pick.point.map((v,i)=>v-target.point[i])):null;
          attempts.push({...target,...hit,errorMetres:distance});
          if(distance!==null&&distance<.12)break;
        }
        const passed=attempts.some(a=>a.errorMetres!==null&&a.errorMetres<.12);
        row.roofChecks.push({assetId:asset.id,passed,attempts});
        assert(passed,`${asset.id}: exported roof point was not hit in the actual scene`);
      }
    } else {
      assert.equal(stats.architecturalBuildings,0,'fallback/source view suppressed source buildings');
      assert.equal(stats.architecturalTriangles,0);
      assert.equal(stats.clubhouseDetails.length,0);
      if(kind==='missing-chunk') {
        assert(row.expectedResourceFailures.length>0,'mesh chunk failure was not exercised');
        assert.equal(stats.architectureAssets.state,'fallback');
      } else assert(stats.architectureAssets.sourceView);
    }
    const captures=kind==='authored'?[{id:'clubhouse-front',position:[12,42,-222],target:[17,39,-278]},
      {id:'campus-overview',position:[160,135,-145],target:[10,37,-280]},
      {id:'range-front',position:[-108,48,-116],target:[-112,36,-192]}]:
      [{id:kind,position:[12,42,-222],target:[17,39,-278]}];
    for(const capture of captures) {
      await page.evaluate(({position,target})=>{V3D.setPreset('noon');V3D.placeCamera(position,target);},capture);
      await page.waitForFunction(mode=>{
        if(!V3D.settled())return false;
        if(mode==='0')return true;
        const state=V3D.v2Terrain().adapter;
        return state?.phase==='ready'&&state.stream?.loadingTiles===0&&state.stream.failedTiles===0;
      },mode,{timeout:300000,polling:100});
      const file=`${slug}-${mode}-${capture.id}${backend==='webgpu'?'-webgpu':''}.png`,filename=path.join(ROOT,CACHE,file);
      const image=await page.screenshot({path:filename,animations:'disabled',timeout:60000});
      row.captures.push({path:`${CACHE}/${file}`,sha256:sha(image),camera:await page.evaluate(()=>V3D.camExact())});
    }
    assert.equal(row.errors.length,0,'unexpected browser errors');
    row.passed=true;await page.close();write();
    console.log(`PASS ${slug} v2=${mode} ${kind} ${backend}`);
  }
  const authored=report.runs.find(r=>r.kind==='authored'&&r.slug==='upsala'&&r.mode==='0');
  for(const row of report.runs.filter(r=>r.kind!=='authored')) {
    assert.equal(row.boot.stats.genericRoofBuildings-authored.boot.stats.genericRoofBuildings,
      packet.assets.reduce((count,asset)=>count+asset.replaces.length,0),'generic fallback count does not restore the exact replaced buildings');
  }
  report.passed=true;
} catch(error) {
  report.error=String(error.stack||error);process.exitCode=1;
} finally {await browser.close();write();}
console.log(report.passed?'PASS authored facilities runtime':report.error);
