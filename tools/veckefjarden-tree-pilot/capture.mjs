import path from 'node:path';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';
import {OUT,SLUGS,serve,json,save,sha} from './preview.mjs';
const mode=process.argv[2]||'before',only=process.argv[3];
const {server,url}=await serve(mode);
const browser=await chromium.launch({channel:'chrome',args:['--no-sandbox','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
const directory=path.join(OUT,'captures',mode);fs.mkdirSync(directory,{recursive:true});
const report=path.join(directory,'report.json');const runs=only&&fs.existsSync(report)?json(report).runs.filter(r=>r.slug!==only):[];
try{
 for(const slug of SLUGS.filter(s=>!only||s===only))for(const scenario of [{id:'webgpu-high',query:'q=hi',backend:'webgpu'},{id:'webgl-high',query:'gl=1&q=hi',backend:'webgl2'},{id:'webgl-low',query:'gl=1&q=lo',backend:'webgl2'}]){
  const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,serviceWorkers:'block'});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`${url}/?bana=${slug}&v2=require&det=1&qualitylock=1&ghibli=1&ljus=dag&${scenario.query}`,{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>window.V3D?.settled()&&document.querySelector('#boot')?.classList.contains('done'),null,{timeout:240000});
  const state=await page.evaluate(()=>({trees:V3D.legacyTrees({instances:true}),objects:V3D.v2Objects(),stats:V3D.stats,quality:V3D.quality(),catalogue:V3D.treeCatalogue(),perf:V3D.perf(),audit:V3D.treeTierAudit(),terrain:V3D.v2Terrain()}));
  assert.equal(state.stats.backend,scenario.backend);assert.equal(errors.length,0);assert(state.audit.ok);assert.equal(state.objects.loaded.records,json(path.join(OUT,mode==='before'?'baseline-records.json':'pilot-records.json')).length);
  assert.equal(state.quality.lowq,scenario.id==='webgl-low');
  save(path.join(directory,slug+'-'+scenario.id+'-instances.json'),state.trees);delete state.trees.instances;
  const run={slug,scenario:scenario.id,state,errors,views:[]};
  const count=slug==='veckefjarden'?18:9;
  const holes=scenario.id==='webgpu-high'?Array.from({length:count},(_,i)=>i+1):slug==='veckefjarden'?[9,16]:[3,9];
  for(const hole of holes)for(const cam of scenario.id==='webgpu-high'?['tee','top']:['tee']){
   await page.evaluate(({hole,cam})=>{V3D.setPreset('noon');V3D.goHole(hole,true,true);V3D.setCam(cam,true)},{hole,cam});
   await page.waitForFunction(()=>V3D.settled(),null,{timeout:60000});await page.waitForTimeout(350);
   const file=`${slug}-${scenario.id}-h${String(hole).padStart(2,'0')}-${cam}.png`;
   await page.screenshot({path:path.join(directory,file),animations:'disabled'});
   run.views.push({hole,cam,file,sha256:sha(fs.readFileSync(path.join(directory,file))),camera:await page.evaluate(()=>V3D.camInfo())});
  }
  runs.push(run);save(report,{mode,runs});console.log(mode,slug,scenario.id,run.views.length,'views',state.trees.total,'trees');await context.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
