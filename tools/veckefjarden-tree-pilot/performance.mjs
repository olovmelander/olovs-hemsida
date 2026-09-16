// Serial, interleaved cold-context runs. Browser/GPU stays fixed; no concurrent captures.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {OUT,serve,save,json} from './preview.mjs';
const round='',work=OUT;
const argument=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1]};
const onlyScenario=argument('--scenario');
const reportPrefix=argument('--report-prefix')||'performance';
const repeats=Number(argument('--repeats')||3);
const slug=argument('--course')||'veckefjarden';
assert(['veckefjarden','veckefjarden-korthalsbanan'].includes(slug));
const hole=slug==='veckefjarden'?16:9;
assert(/^[a-z0-9-]+$/.test(reportPrefix));assert(Number.isInteger(repeats)&&repeats>=3&&repeats<=10);
assert(!onlyScenario||['webgpu-high','webgl-high','webgl-low'].includes(onlyScenario));
const servers={before:await serve(round==='round3'?'round2':round?'after':'before'),after:await serve(round||'after')};
const browser=await chromium.launch({channel:'chrome',args:['--no-sandbox','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
const runs=[];
try{
 for(const scenario of [{name:'webgpu-high',query:'q=hi',backend:'webgpu'},{name:'webgl-high',query:'gl=1&q=hi',backend:'webgl2'},{name:'webgl-low',query:'gl=1&q=lo',backend:'webgl2'}].filter(s=>!onlyScenario||s.name===onlyScenario))
 for(let repeat=0;repeat<repeats;repeat++)for(const mode of repeat%2?['after','before']:['before','after']){
  const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,serviceWorkers:'block'});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));const start=Date.now();
  await page.goto(servers[mode].url+`/?bana=${slug}&v2=require&det=1&qualitylock=1&ghibli=1&ljus=dag&`+scenario.query,{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>window.V3D?.settled()&&document.querySelector('#boot')?.classList.contains('done'),null,{timeout:240000});
  const bootMs=Date.now()-start;
  await page.evaluate(hole=>{V3D.setPreset('noon');V3D.goHole(hole,true,true);V3D.setCam('tee',true)},hole);
  await page.waitForFunction(()=>V3D.settled(),null,{timeout:60000});await page.waitForTimeout(1000);
  const state=await page.evaluate(()=>{
   const trees=V3D.legacyTrees({instances:true});const residuals=trees.instances.filter((a,i)=>i%31===0).map(a=>Math.abs(a[1]+.25-V3D.terrainH(a[0],a[2]))).sort((a,b)=>a-b);
   return {backend:V3D.stats.backend,quality:V3D.quality(),perf:V3D.perf(),objects:V3D.v2Objects(),audit:V3D.treeTierAudit(),catalogue:V3D.treeCatalogue(),
    drawn:trees.total,groundResidual:{sampleCount:residuals.length,median:residuals[Math.floor(residuals.length/2)],p95:residuals[Math.floor(residuals.length*.95)],max:residuals.at(-1)}};
  });
  assert.equal(state.backend,scenario.backend);assert.equal(state.quality.lowq,scenario.name==='webgl-low');assert(state.audit.ok);assert.equal(errors.length,0);
  assert.equal(state.perf.courseData.fallbackReasons.length,0,'Startup generation mismatch');
  const frames=await page.evaluate(()=>new Promise(resolve=>{let prev;const a=[];function tick(t){if(prev!==undefined)a.push(t-prev);prev=t;if(a.length<180)requestAnimationFrame(tick);else{a.sort((x,y)=>x-y);resolve({medianMs:a[90],p95Ms:a[171]})}}requestAnimationFrame(tick)}));
  runs.push({slug,hole,mode,scenario:scenario.name,repeat,bootMs,frames,state,errors});save(path.join(work,reportPrefix+'-runs.json'),{browser:browser.version(),runs});
  console.log(mode,scenario.name,repeat,'boot',bootMs,'frame',frames.medianMs.toFixed(2));await context.close();
 }
}finally{await browser.close();for(const s of Object.values(servers))await new Promise(resolve=>s.server.close(resolve))}
const median=a=>[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];
const comparison=[];
for(const scenario of [...new Set(runs.map(r=>r.scenario))]){
 const summary={scenario};for(const mode of ['before','after']){const a=runs.filter(r=>r.scenario===scenario&&r.mode===mode);
  summary[mode]={bootMs:median(a.map(r=>r.bootMs)),frameMedianMs:median(a.map(r=>r.frames.medianMs)),frameP95Ms:median(a.map(r=>r.frames.p95Ms)),
    vegetationPlanMs:median(a.map(r=>r.state.perf.spans.find(s=>s.name==='v2 vegetation: plan individuals + stand trees').ms)),
    networkBytes:median(a.map(r=>r.state.perf.courseData.networkBytes)),networkRequests:median(a.map(r=>r.state.perf.courseData.networkRequests)),
    vegetationBytes:a[0].state.objects.loaded.bytes,drawn:a[0].state.drawn,groundResidual:a[0].state.groundResidual};}
 summary.percentChange=Object.fromEntries(['bootMs','frameMedianMs','frameP95Ms','vegetationPlanMs','networkBytes','vegetationBytes'].map(k=>[k,(summary.after[k]/summary.before[k]-1)*100]));comparison.push(summary);
}
save(path.join(work,reportPrefix+'-summary.json'),{browser:browser.version(),repeats,slug,hole,camera:'tee',viewport:[1440,900],comparison,
 comparisonModes:round==='round3'?{before:'round two',after:'round three'}:round?{before:'first pilot',after:'round two'}:{before:'production baseline',after:'first pilot'},
 limitation:'Local machine, serial cold contexts, interleaved order. RAF intervals include browser scheduling and are not isolated GPU timings.'});
