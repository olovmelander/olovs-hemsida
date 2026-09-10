/* Actual browser checks of the authored asset, fallback, and source inspection. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {ringSD} from '../../apps/golf/src/engine/geom.js';
import {createPracticeSurfaceFeatures} from '../../apps/golf/src/engine/scenery/lidingo-practice-surfaces.mjs';
const base=process.argv.find(v=>/^https?:/.test(v))||'http://localhost:5173/';
const out='lidingobuild/cache/facilities-model-2026-09-10';
const manifest=JSON.parse(fs.readFileSync('apps/golf/public/models/lidingo/facilities-v1.json'));
const surfaceProbes=createPracticeSurfaceFeatures().map(feature=>{
  const ring=feature.rings[0],xs=ring.map(p=>p[0]),zs=ring.map(p=>p[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
  let best={distance:Infinity};
  for(let j=1;j<30;j++)for(let i=1;i<30;i++){
    const x=minX+(maxX-minX)*i/30,z=minZ+(maxZ-minZ)*j/30;
    const distance=Math.max(ringSD(x,z,ring),...feature.rings.slice(1).map(hole=>-ringSD(x,z,hole)));
    if(distance<best.distance)best={x,z,distance};
  }
  assert.ok(best.distance<-.25,'No clear interior surface probe: '+feature.id);
  return {id:feature.id,kind:feature.kind,x:best.x,z:best.z,expectedSurface:feature.kind==='practice_green'?4:6};
});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,
  args:['--no-sandbox','--use-angle=d3d11','--enable-gpu','--force_high_performance_gpu','--ignore-gpu-blocklist']});
const checks=[],screenshots=[];
const cases=process.argv.includes('--quick')?['webgpu']:['webgpu','webgl','source','fallback'];
try {
  for(const mode of cases){
    console.log(JSON.stringify({stage:'opening',mode}));
    const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});
    const errors=[];
    page.on('pageerror',error=>errors.push(String(error)));
    if(mode==='fallback')await page.route('**/models/lidingo/facilities-v1.json',route=>route.fulfill({status:404,body:'deliberate fallback check'}));
    const url=new URL(base);
    url.search='bana=lidingo&hal=1&vy=fritt&ljus=dag&skylt=0'+(mode==='webgl'?'&gl=1':'')+(mode==='source'?'&buildingGeometry=source':'');
    await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>window.V3D?.stats&&window.V3D?.settled(),null,{timeout:240000});
    const state=await page.evaluate(()=>({stats:V3D.stats,geometry:V3D.facilityGeometry(),terrain:V3D.v2Terrain(),
      storedRoofTriangles:V3D.M.infra.buildings.reduce((n,b)=>n+(b.roofSurface?.triangleIndices.length||0)/3,0)}));
    assert.equal(errors.length,0,errors.join('\n'));
    assert.equal(state.storedRoofTriangles,7069,'Source roof evidence must survive unchanged');
    const practice=await page.evaluate(probes=>probes.map(probe=>({...probe,
      present:V3D.M.scenery.mappedFeatures.some(f=>f.id===probe.id),
      sample:V3D.groundSample(probe.x,probe.z)})),surfaceProbes);
    for(const probe of practice){
      assert.equal(probe.present,mode!=='source','Practice surface source policy: '+probe.id);
      if(mode!=='source')assert.equal(probe.sample?.surface,probe.expectedSurface,'Wrong ground material: '+probe.id);
    }
    if(mode==='source'){
      assert.equal(state.stats.measuredRoofBuildings,5);
      assert.equal(state.stats.measuredRoofTriangles,7069);
      assert.equal(state.geometry,null);
      assert.equal(state.stats.authoredFacilityBuildings,0);
    }else if(mode==='fallback'){
      assert.equal(state.stats.facilities.status,'fallback');
      assert.equal(state.stats.architecturalBuildings,5);
      assert.equal(state.stats.authoredFacilityBuildings,0);
      assert.equal(state.geometry,null);
      assert.ok(state.stats.courtyardDetails);
    }else{
      assert.equal(state.stats.facilities.status,'loaded',state.stats.facilities.reason);
      assert.equal(state.stats.facilities.assetSha256,manifest.asset.sha256);
      assert.equal(state.stats.backend,mode==='webgl'?'webgl2':'webgpu');
      const replaced=manifest.facilities.flatMap(f=>f.sourceBuildingIds);
      assert.equal(state.stats.authoredFacilityBuildings,replaced.length);
      for(const id of replaced)assert.ok(!state.stats.sourceBuildingBatchIds.includes(id),'Duplicate generic building '+id);
      assert.equal(state.stats.authoredRangeFacilities,true);
      assert.equal(state.stats.courtyardDetails,null);
      assert.equal(state.geometry.facilities.length,manifest.facilities.length);
      assert.equal(state.geometry.assetSha256,manifest.asset.sha256);
      for(const facility of manifest.facilities){
        const actual=state.geometry.facilities.find(f=>f.id===facility.id);
        const placed=state.stats.facilities.facilities.find(f=>f.id===facility.id);
        assert.ok(actual&&placed,facility.id);
        for(const key of ['min','max'])for(let k=0;k<3;k++)
          assert.ok(Math.abs(actual[key][k]-facility.boundsLocalRh2000[key][k]-(k===1?placed.shift:0))<.16,'Placement mismatch '+facility.id);
      }
      if(mode==='webgpu'){
        const views=[
          {id:'clubhouse-environment',eye:[67,82,40],target:[-45,32,-92]},
          {id:'courtyard-environment',eye:[-1,47,-60],target:[-46,34,-110]},
          {id:'range-environment',eye:[-175,78,242],target:[-62,29,147]},
          {id:'south-range-environment',eye:[-65,50,300],target:[-125,25,244]},
          {id:'cafe-9-environment',eye:[-289,43,74],target:[-309,27,55]},
          {id:'toilet-15-environment',eye:[-65,41,-223],target:[-83,24,-244]},
        ];
        surfaceProbes.filter(p=>p.kind==='practice_green').forEach((p,i)=>views.push({
          id:`practice-${i+1}-environment`,eye:[p.x+40,76,p.z+48],target:[p.x,28,p.z]}));
        for(const view of views){
          await page.evaluate(v=>{V3D.setPreset('noon');V3D.setView(...v.eye,...v.target);},view);
          await page.waitForFunction(()=>V3D.settled(),null,{timeout:90000});
          await page.screenshot({path:`${out}/${view.id}.png`});
          screenshots.push(`${out}/${view.id}.png`);
        }
      }
    }
    checks.push({mode,status:'passed',stats:state.stats,sourceRoofTriangles:state.storedRoofTriangles,practiceSurfaces:practice,errors});
    await page.close();
    console.log(JSON.stringify({stage:'passed',mode,facilities:state.stats.facilities?.status}));
  }
}catch(error){
  checks.push({status:'failed',error:String(error)});
  process.exitCode=1;
}finally{
  await browser.close();
}
const report={status:checks.every(c=>c.status==='passed')?'passed':'failed',baseUrl:base,assetSha256:manifest.asset.sha256,checks,screenshots};
fs.writeFileSync('lidingobuild/facilities/environment-validation.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,modes:checks.map(c=>({mode:c.mode,status:c.status,error:c.error})),screenshots}));
