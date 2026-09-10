import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { browserArgs } from '../tools/browser-args.mjs';
import { PUTTOM_PREVIEW_CONFIG as config } from '../apps/golf/src/engine/v2-puttom-preview.mjs';
import { withInferredTeePads } from '../apps/golf/src/engine/tee-pads.mjs';
import { teeMarkerPositions } from '../apps/golf/src/engine/tee-marker-placement.mjs';
import { inRing, ringSD } from '../apps/golf/src/engine/geom.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base=process.argv[2]||'http://127.0.0.1:8746';
const model=JSON.parse(fs.readFileSync(path.join(root,'puttombuild/course-model.json'),'utf8'));
const review=JSON.parse(fs.readFileSync(path.join(root,'puttombuild/mapping/orthophoto-review.json'),'utf8'));
const expectedRuntime=withInferredTeePads(model.holes);
const expectedMarkers=model.infra?.objectPlacement==='mapped-only'?[]:expectedRuntime.flatMap(h=>h.tees.marks.flatMap((mark,index)=>{
  const pair=teeMarkerPositions(h,mark);
  if(!pair.length)return [];
  const pad=h.tees.pads.find(p=>(mark.sourcePadId===undefined||[p.id,p.reviewId].includes(mark.sourcePadId))&&
    inRing(...mark.c,p.ring)&&pair.every(c=>ringSD(...c,p.ring)<=-.15+1e-7));
  assert.ok(pad,`hole ${h.n}/${index}: helper marker pair has no owning platform`);
  return pair.map(position=>({hole:h.n,teeIndex:index,position,pad}));
}));
const packSha=createHash('sha256').update(fs.readFileSync(path.join(root,'apps/golf/public/courses/puttom/pack.bin'))).digest('hex');
const readPublic=p=>JSON.parse(fs.readFileSync(path.join(root,'apps/golf/public',p),'utf8'));
const publishedCourse=readPublic(readPublic('courses/v2-index.json').courses.find(c=>c.slug==='puttom').manifest.url);
const publishedGround=readPublic(publishedCourse.groundManifest.url);
const out=path.join(root,'puttombuild/cache/runtime-review');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:browserArgs()});
const reports=[];
try {
  for(const mode of ['default','off']) {
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${base}/?bana=puttom&det=1&q=lo&hal=1&vy=ovan${mode==='off'?'&v2=0':''}`,{waitUntil:'load',timeout:120000});
    await page.waitForSelector('#boot.done',{timeout:420000});
    const state=await page.evaluate(()=>({terrain:V3D.v2Terrain(),stats:V3D.stats,
      holes:V3D.HOLES.map(h=>({n:h.n,t:h.t,par:h.par,idx:h.idx,green:h.green.ring,
        pads:h.tees.pads.map(p=>p.ring),marks:h.tees.marks.map(m=>m.c),
        greenClass:V3D.groundSample(...h.green.c)?.surface})),
      preserve:V3D.M.infra.preserveMappedBoundaries,
      markerGeometry:V3D.teeMarkerGeometry().map(m=>({...m,terrainHeight:V3D.terrainH(m.position[0],m.position[2])}))}));
    fs.writeFileSync(path.join(out,`${mode}-state.json`),JSON.stringify(state,null,2)+'\n');
    assert.deepEqual(errors,[],'app page errors');
    assert.equal(state.preserve,true);
    for(const h of state.holes) {
      const expected=model.holes.find(v=>v.n===h.n);
      assert.deepEqual(h.t,expected.t);assert.equal(h.par,expected.par);assert.equal(h.idx,expected.idx);
      assert.deepEqual(h.green,expected.green.ring,`green ${h.n} boundary changed at boot`);
      assert.deepEqual(h.pads,expected.tees.pads.map(p=>p.ring),`hole ${h.n} invented or moved a pad`);
      assert.deepEqual(h.marks,expected.tees.marks.map(m=>m.c),`hole ${h.n} marker changed at boot`);
      assert.equal(h.greenClass,4,`green ${h.n} classification`);
    }
    // Compare actual instance matrices to the expected pair and check the
    // sphere footprint against that reference's own source platform. Checking
    // only the virtual reference centre misses narrow-platform regressions.
    assert.equal(state.markerGeometry.length,expectedMarkers.length,'rendered decorative marker inventory differs');
    let maximumMarkerPositionError=0,minimumMarkerEdgeClearance=Infinity;
    for(let i=0;i<expectedMarkers.length;i++) {
      const expected=expectedMarkers[i],actual=state.markerGeometry[i],p=[actual.position[0],actual.position[2]];
      const error=Math.hypot(p[0]-expected.position[0],p[1]-expected.position[1]);
      maximumMarkerPositionError=Math.max(maximumMarkerPositionError,error);
      const clearance=-ringSD(...p,expected.pad.ring);
      minimumMarkerEdgeClearance=Math.min(minimumMarkerEdgeClearance,clearance);
      assert.ok(error<.001,`hole ${expected.hole}/${expected.teeIndex}: GPU marker centre differs by ${error} m`);
      assert.ok(actual.radius>0&&actual.radius<=.150001,'unexpected decorative marker radius');
      assert.ok(clearance>=actual.radius-1e-4,`hole ${expected.hole}/${expected.teeIndex}: marker sphere leaves its source platform`);
      assert.ok(Math.abs(actual.position[1]-actual.terrainHeight-.11)<.01,`hole ${expected.hole}/${expected.teeIndex}: rendered marker height differs from terrain sample`);
    }
    // Exercise the real selection handler and named-view camera for every tee,
    // with instant moves to read the unrounded pose before animation/clamping.
    const cameraSamples=await page.evaluate(()=>{
      const samples=[];
      for(const h of V3D.HOLES) {
        V3D.goHole(h.n,false,true);
        for(let index=0;index<h.tees.marks.length;index++) {
          const button=document.querySelectorAll('#tees .tee')[index];
          if(!button)throw new Error(`Missing tee selector ${h.n}/${index}`);
          button.click();V3D.setCam('tee',true);
          const pose=V3D.camExact(),mark=h.tees.marks[index];
          samples.push({hole:h.n,index,reference:mark.c,position:pose.pos,ground:pose.ground,eye:V3D.groundClamp().eye,
            rangefinderOrigin:V3D.rangefinder().origin});
        }
      }
      return samples;
    });
    assert.equal(cameraSamples.length,72);
    for(const sample of cameraSamples) {
      const expected=model.holes.find(h=>h.n===sample.hole).tees.marks[sample.index].c;
      assert.deepEqual([sample.position[0],sample.position[2]],expected,`hole ${sample.hole}/${sample.index}: actual tee camera moved horizontally`);
      assert.ok(Math.abs(sample.position[1]-sample.ground-sample.eye)<1e-8,`hole ${sample.hole}/${sample.index}: camera samples another terrain position`);
      assert.deepEqual(sample.rangefinderOrigin,expected,`hole ${sample.hole}/${sample.index}: rangefinder uses another tee reference`);
    }
    fs.writeFileSync(path.join(out,`${mode}-tee-coordinates.json`),JSON.stringify({cameraSamples,markerGeometry:state.markerGeometry},null,2)+'\n');
    if(mode==='default') {
      assert.equal(state.terrain.ready,true);assert.equal(state.terrain.status,'ready');
      assert.equal(state.terrain.selection.graphError,null);
      assert.equal(state.terrain.surface.sourcePackSha256,packSha);
      assert.equal(state.terrain.surface.tileCount,config.expectedSurfaceTileCount);
      assert.equal(state.terrain.surfaceRepresentation,'class-sdf-v1');
      assert.equal(state.terrain.renderer.status,'ready');
      assert.equal(state.terrain.renderer.fallbackRebuilt,false);
      if(state.terrain.renderer.kind==='graph') {
        assert.equal(state.terrain.renderer.tiles,publishedGround.tiles.length);
        assert.equal(state.terrain.renderer.meshResolutionMetres,1);
        assert.ok(state.terrain.renderer.drawCalls>0);
      }
      if(state.terrain.renderer.skippedBasePoints !== undefined) {
        assert.equal(state.terrain.renderer.skippedBasePoints,config.legacyCoreCutout.expectedSkippedBasePoints);
        assert.equal(state.terrain.renderer.fallbackRebuilt,false);
      }
      assert.equal(state.stats.surfaceOverlays,0);
      // Full platform traces certify tee turf. Standalone visible-interior
      // references certify position only; all marker positions were checked above.
      const corrected=review.holes.flatMap(h=>(h.tees??[]).flatMap(t=>Object.keys(t.cameraReferencesPixels??{}).map(key=>({n:h.n,index:['tee-61','tee-57','tee-48','tee-41'].indexOf(key)}))));
      const samples=await page.evaluate(refs=>refs.map(ref=>{const h=V3D.HOLES.find(h=>h.n===ref.n);return { ...ref,surface:V3D.groundSample(...h.tees.marks[ref.index].c)?.surface};}),corrected);
      assert.ok(samples.every(s=>s.surface===5),`corrected tee references leave tee turf: ${JSON.stringify(samples.filter(s=>s.surface!==5))}`);
      for(const n of [1,10,12,16,18]) {
        await page.evaluate(n=>{V3D.goHole(n,true,true);V3D.setCam('top',true);},n);
        await page.waitForTimeout(500);
        await page.screenshot({path:path.join(out,`hole-${String(n).padStart(2,'0')}.png`)});
      }
    } else assert.equal(state.terrain.requested,false);
    reports.push({mode,passed:true,backend:state.stats.backend,holes:state.holes.length,
      checkedCameraPositions:state.holes.reduce((n,h)=>n+h.marks.length,0),
      checkedActualTeeCameras:cameraSamples.length,checkedRenderedMarkers:state.markerGeometry.length,
      maximumMarkerPositionErrorMetres:maximumMarkerPositionError,
      minimumMarkerEdgeClearanceMetres:Number.isFinite(minimumMarkerEdgeClearance)?minimumMarkerEdgeClearance:null,
      standaloneReviewedReferences:review.holes.reduce((n,h)=>n+(h.cameraReferences?.length??0),0),
      sourcePackSha256:packSha,terrainReady:state.terrain.ready,classes:state.holes.map(h=>h.greenClass),
      terrainStatus:state.terrain.status,coreGrid:state.terrain.renderer?.coreGrid,errors});
    console.log(JSON.stringify(reports.at(-1)));
    await page.close();
  }
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:true,reports},null,2)+'\n');
} finally { await browser.close(); }
