import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { browserArgs } from '../../../tools/browser-args.mjs';

const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../..');
const out=path.join(root,'puttombuild/cache/facilities-model-2026-09-10');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'apps/golf/public/models/puttom/facilities-v1.json'),'utf8'));
const expected=manifest.facilities.flatMap(f=>f.sourceBuildingIds).sort();
const base=process.argv[2]||'http://localhost:5173';
const browser=await chromium.launch({channel:'chrome',headless:true,args:browserArgs()});
const report={checkedAt:new Date().toISOString(),assetSha256:manifest.asset.sha256,modes:[]};
try {
  for(const mode of ['default','legacy']) {
    const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[],failedAssets=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('response',r=>{if(r.url().includes('/models/puttom/')&&!r.ok())failedAssets.push({url:r.url(),status:r.status()});});
    console.log(`Loading ${mode} Puttom`);
    await page.goto(`${base}/?bana=puttom&det=1&q=lo&hal=1&vy=fritt&ljus=dag${mode==='legacy'?'&v2=0':''}`,{waitUntil:'load',timeout:120000});
    await page.waitForSelector('#boot.done',{timeout:420000});
    const state=await page.evaluate(facilities=>({terrain:V3D.v2Terrain(),stats:V3D.stats,geometry:V3D.facilityGeometry(),
      grounds:facilities.map(f=>({id:f.id,anchorTerrain:V3D.terrainH(...f.groundAnchorLocal),
        perimeter:f.footprintLocal.map(p=>[...p,V3D.terrainH(...p)])}))}),manifest.facilities);
    fs.writeFileSync(path.join(out,`app-${mode}-state.json`),JSON.stringify(state,null,2)+'\n');
    assert.deepEqual(errors,[],'Browser execution errors');
    assert.deepEqual(failedAssets,[],'Facility asset requests');
    assert.equal(state.stats.facilities?.status,'loaded',state.stats.facilities?.reason);
    assert.equal(state.geometry?.assetSha256,manifest.asset.sha256);
    assert.deepEqual(state.stats.facilities.replacedBuildingIds.toSorted(),expected,'Source ownership');
    assert.equal(state.stats.authoredRangeFacilities,true,'Old range geometry must be replaced');
    assert.equal(state.geometry.facilities.length,manifest.facilities.length);
    assert.deepEqual(state.stats.sourceBuildingBatchIds.filter(id=>expected.includes(id)),[],'No generic duplicate buildings');
    for(const f of manifest.facilities) {
      const live=state.geometry.facilities.find(v=>v.id===f.id),placement=state.stats.facilities.facilities.find(v=>v.id===f.id);
      assert(live&&placement,f.id);
      for(const axis of [0,2]) for(const bound of ['min','max'])
        assert(Math.abs(live[bound][axis]-f.boundsLocalRh2000[bound][axis])<.002,`${f.id} horizontal placement changed`);
      const contact=placement.groundContact;
      for(const bound of ['min','max']) {
        const expectedY=contact?.rigidVertices||contact?.drapedVertices
          ? contact.boundsAfterGroundContact[bound][1] : f.boundsLocalRh2000[bound][1]+placement.shift;
        assert(Math.abs(live[bound][1]-expectedY)<.002,`${f.id} height placement changed`);
      }
      if(mode==='legacy') assert(Math.abs(placement.groundResidualMetres)<.00001,`${f.id} legacy ground anchor`);
    }
    const apronContact=state.stats.facilities.facilities.find(f=>f.id==='site-range-apron').groundContact;
    const matContact=state.stats.facilities.facilities.find(f=>f.id==='site-range-mats').groundContact;
    assert(apronContact.drapedVertices>1000,'Dense paving must follow the active terrain');
    assert(matContact.rigidVertices>0,'Mats must follow their individual ground anchors');
    const captures=[];
    for(const [name,id,offset,targetHeight] of [
      ['clubhouse','clubhouse',[34,19,40],4],
      ['range','range-l-building',[53,34,57],2],
      ['maintenance','maintenance-long',[45,28,50],3],
      ['campus','clubhouse',[175,135,-140],1],
    ]) {
      const facility=manifest.facilities.find(f=>f.id===id);
      assert(facility,`Missing camera target ${id}`);
      await page.evaluate(({anchor,offset,targetHeight})=>{
        const [x,z]=anchor,h=V3D.terrainH(x,z);
        V3D.setCam('free',true);
        V3D.placeCamera([x+offset[0],h+offset[1],z+offset[2]],[x,h+targetHeight,z]);
      },{anchor:facility.groundAnchorLocal,offset,targetHeight});
      await page.waitForTimeout(1600);
      const filename=`app-${mode}-${name}.png`;
      await page.screenshot({path:path.join(out,filename)});captures.push(filename);
    }
    report.modes.push({mode,backend:state.stats.backend,terrainReady:state.terrain.ready,
      facilities:state.geometry.facilities.length,sourceCoverage:expected.length,
      meshes:state.stats.facilities.meshes,triangles:state.stats.facilities.triangles,
      replacesRangeFacilities:state.stats.authoredRangeFacilities,
      sourceBuildingDuplicates:0,errors,failedAssets,captures,
      siteGroundContact:{apron:apronContact,mats:matContact},
      anchorResiduals:state.stats.facilities.facilities.map(f=>({id:f.id,metres:f.groundResidualMetres}))});
    console.log(JSON.stringify(report.modes.at(-1)));
    await page.close();
  }
  report.passed=true;
} finally {
  await browser.close();
  fs.writeFileSync(path.join(here,'browser-audit.json'),JSON.stringify(report,null,2)+'\n');
}
