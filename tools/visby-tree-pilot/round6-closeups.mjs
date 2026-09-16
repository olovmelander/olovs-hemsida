// Matched low-angle views of every resized crown, with unchanged terrain/assets.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {OUT,ROOT,serve,json,save,sha} from './round6-preview.mjs';
const work=path.join(OUT,'round6'),directory=path.join(work,'closeups');fs.mkdirSync(directory,{recursive:true});
const selected=process.argv.includes('--scene')?process.argv[process.argv.indexOf('--scene')+1]:null;
const edits=json(path.join(ROOT,'geo_data/course-v2/visby/vegetation/pilot/round6/corrections.json')).edits.filter(e=>!selected||e.scene===selected);
const origin=json(path.join(OUT,'baseline.json')).ground.frame.origin;
const browser=await chromium.launch({channel:'chrome',args:['--no-sandbox','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
const pairs=selected?json(path.join(work,'closeups.json')).pairs.filter(p=>p.scene!==selected):[],servers={before:await serve('round5'),after:await serve('round6')};
try{
 for(const scenario of [{name:'webgpu-high',query:'q=hi'},{name:'webgl-high',query:'gl=1&q=hi'},{name:'webgl-low',query:'gl=1&q=lo'}]){
  for(const mode of ['before','after']){
   const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,serviceWorkers:'block'}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(String(e)));
   await page.goto(servers[mode].url+'/?bana=visby&v2=require&det=1&qualitylock=1&ghibli=1&ljus=dag&'+scenario.query,{waitUntil:'domcontentloaded',timeout:120000});
   await page.waitForFunction(()=>window.V3D?.settled()&&document.querySelector('#boot')?.classList.contains('done'),null,{timeout:240000});
   for(const edit of edits){
    const r=edit.before;
    const view=await page.evaluate(({r,origin})=>{
      const x=r.easting-origin.easting,z=origin.northing-r.northing,y=V3D.terrainH(x,z);
      const west=['tree-visby-000357','tree-visby-000259'].includes(r.id);
      const dx=west?-28:12,dz=r.id==='tree-visby-000259'?0:west?8:30;
      V3D.setPreset('noon');V3D.setCam('tee',true);
      const camera=[x+dx,V3D.terrainH(x+dx,z+dz)+1.7,z+dz,x,y+r.objectHeightMetres*.48,z];V3D.setView(...camera);return camera;
    },{r,origin});
    await page.waitForFunction(()=>V3D.settled(),null,{timeout:60000});await page.waitForTimeout(400);
    const actual=await page.evaluate(()=>({camera:V3D.camInfo(),backend:V3D.stats.backend,audit:V3D.treeTierAudit()}));assert(actual.audit.ok);
    const file=`${scenario.name}-${edit.scene}-${mode}.png`;await page.screenshot({path:path.join(directory,file),animations:'disabled'});
    if(mode==='before')pairs.push({scenario:scenario.name,scene:edit.scene,id:edit.id,requestedCamera:view,camera:actual.camera,before:file,beforeSha256:sha(fs.readFileSync(path.join(directory,file)))});
    else{const p=pairs.find(p=>p.scenario===scenario.name&&p.id===edit.id);assert.deepEqual(p.camera,actual.camera);assert.deepEqual(p.requestedCamera,view);Object.assign(p,{after:file,afterSha256:sha(fs.readFileSync(path.join(directory,file))),backend:actual.backend});}
    console.log(scenario.name,mode,edit.scene);
   }
   assert.equal(errors.length,0);await context.close();
  }
 }
}finally{await browser.close();for(const s of Object.values(servers))await new Promise(resolve=>s.server.close(resolve));}
assert.equal(pairs.length,18);save(path.join(work,'closeups.json'),{pairs,meaning:'Low-angle matched views; bases, terrain, lighting and assets retained. Crown radius changes only.'});
