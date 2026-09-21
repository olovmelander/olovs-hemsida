// Production browser proof, including unchanged roots and offline asset caching.
// First build with build_preview.mjs output/visby-martall-build.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import {VISBY_PINE_REVISION} from '../../apps/golf/src/engine/ghibli-trees.mjs';

const dist=path.resolve(process.argv[2]||'output/visby-martall-build');
const assets=path.resolve('apps/golf/public');
const reviewDir=process.argv.find(arg=>arg.startsWith('--review-dir='))?.slice('--review-dir='.length);
const doc=path.resolve(reviewDir||'docs/graphics/visby-martall-2026-09-21');
const cacheOnly=process.argv.includes('--cache-only');
const capturesOnly=process.argv.includes('--captures-only');
// Runtime checks must not overwrite the retained before/after proposal.
const outputDoc=(capturesOnly||reviewDir)?doc:path.join(dist,'pine-validation');
fs.mkdirSync(outputDoc,{recursive:true});
const original=JSON.parse(fs.readFileSync(path.join(doc,'previous-catalogue.json')));
const standard=JSON.parse(fs.readFileSync(path.join(assets,'models/trees/ghibli-fluffy.json')));
const coastal=JSON.parse(fs.readFileSync(capturesOnly?path.join(doc,'candidate-catalogue.json'):path.join(assets,'models/trees/ghibli-visby.json')));
const report={revision:coastal.revision,errors:[],checks:[],scenarios:[]};
const pinePalette=coastal.species.find(s=>s.key==='tall').foliage.key;
const productionFiles=coastal.species.reduce((n,s)=>n+1+Math.min(4,s.variants.length),0);
const studyFiles=coastal.species.reduce((n,s)=>n+1+s.variants.reduce((n,v)=>n+Object.keys(v.tiers).length,0),0);
const views=[['close',[-573,7,-37]],['middle',[-576,10,-65]],['distant',[-583,16,-135]]];
report.pineAssets=coastal.species.find(s=>s.key==='tall').variants.map(v=>v.tiers.hero.sha256);
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css',
  '.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml',
  '.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/pine-cache-check'){
    res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><title>Pine cache proof</title><link rel="icon" href="/favicon.svg">');return;
  }
  const relative=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname).slice(1);
  const file=[dist,assets].map(root=>({root,file:path.resolve(root,relative)}))
    .find(({root,file})=>file.startsWith(root+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())?.file;
  if(!file){console.error('Missing resource:',url.pathname);res.writeHead(404);res.end('not found');return;}
  res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-cache'});
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',args:['--no-sandbox','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function settled(page){await page.waitForFunction(()=>window.V3D?.settled()&&document.querySelector('#boot')?.classList.contains('done'),undefined,{timeout:180000});}
async function cleanCapture(page){
  await page.evaluate(async()=>{
    const strategy=document.querySelector('#strategyBtn');
    if(strategy?.getAttribute('aria-pressed')==='true')strategy.click();
    V3D.setSky(0,true);
    await V3D.prepareCapture();
    const canvas=[...document.querySelectorAll('canvas')].sort((a,b)=>b.width*b.height-a.width*a.height)[0];
    canvas.setAttribute('data-pine-review','');
  });
  await page.addStyleTag({content:'body *{visibility:hidden!important} canvas[data-pine-review]{visibility:visible!important}'});
}
async function captureViews(page,prefix){
  await cleanCapture(page);
  const captures=[];
  for(const [name,position] of views){
    await page.evaluate(p=>V3D.setView(...p,-569.89,6.5,-7.08),position);await settled(page);
    await page.evaluate(()=>V3D.prepareCapture());
    assert(await page.evaluate(()=>V3D.treeTierAudit().ok));
    const file=`${prefix}-pine-${name}.png`;
    await page.screenshot({path:path.join(outputDoc,file)});
    captures.push({name,file,camera:await page.evaluate(()=>V3D.cameraInfo()),
      sha256:createHash('sha256').update(fs.readFileSync(path.join(outputDoc,file))).digest('hex')});
  }
  return captures;
}
function watch(page){
  page.on('pageerror',e=>report.errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error'||/ghibli trees unavailable/i.test(m.text()))report.errors.push(m.text());});
}
async function state(page){return page.evaluate(()=>{
  const trees=V3D.legacyTrees({instances:true});
  return {catalogue:V3D.treeCatalogue(),backend:V3D.stats.backend,audit:V3D.treeTierAudit(),species:trees.species,
    total:trees.total,roots:trees.instances.map(t=>[t[0],t[1],t[2],t[4],t[5],t[6]]),triangles:V3D.treeTriangles()};
});}
try{
 if(!cacheOnly){
  const context=await browser.newContext({viewport:{width:1600,height:1000},deviceScaleFactor:1,serviceWorkers:'block'});
  const page=await context.newPage();watch(page);
  const pattern='**/models/trees/ghibli-visby.json*';
  await page.route(pattern,r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(original)}));
  const url=origin+'/?bana=visby&hal=1&vy=tee&ghibli=1&ljus=dag&skylt=0&ren=1&q=hi&qualitylock=1&det=1&vind=270,6,8';
  await page.goto(url,{waitUntil:'domcontentloaded'});await settled(page);
  const before=await state(page);
  console.log('Baseline loaded:',before.total,'trees');
  const previousCaptures=await captureViews(page,'previous');
  await page.unroute(pattern);
  if(capturesOnly)await page.route(pattern,r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(coastal)}));
  await page.goto(url,{waitUntil:'domcontentloaded'});await settled(page);
  const after=await state(page);
  assert.equal(after.catalogue.revision,coastal.revision);
  assert.equal(after.catalogue.files,productionFiles);assert.equal(after.backend,'webgpu');assert(after.audit.ok);
  assert.deepEqual(after.roots,before.roots,'Root positions, yaw and species must survive the template replacement');
  report.checks.push({check:'all root positions, yaw and species unchanged',trees:after.total,sha256:sha(after.roots)});
  delete before.roots;delete after.roots;
  report.scenarios.push({name:'desktop-webgpu',...after});
  console.log('Desktop WebGPU: coastal pine loaded; all roots unchanged');
  await page.screenshot({path:path.join(outputDoc,'production-hole1.png')});
  const paletteUse=await page.evaluate(key=>{const result=[];V3D.harness().scene.traverse(m=>{if(m.isMesh&&m.material?.userData?.foliageKey===key)result.push(m.name);});return result;},pinePalette);
  assert(paletteUse.some(n=>n.includes('crown'))&&paletteUse.some(n=>n.includes('impostor')),'Both close and distant pines must use the catalogue palette');
  report.checks.push({check:`${pinePalette} palette selected for crown and impostor`,meshes:paletteUse});
  const candidateCaptures=await captureViews(page,'production');
  const comparisons=previousCaptures.map((before,i)=>{
    const after=candidateCaptures[i];
    assert.deepEqual(after.camera,before.camera,`${before.name}: before/after camera mismatch`);
    return {name:before.name,before,after,matchingCamera:true};
  });
  const comparison={capturedAt:new Date().toISOString(),beforeRevision:original.revision,afterRevision:coastal.revision,
    viewport:{width:1600,height:1000},lighting:'noon',wind:'270 degrees, 6 m/s, gust 8 m/s',deterministic:true,
    sameApplicationBuild:true,rootPlacementSha256:report.checks[0].sha256,comparisons};
  fs.writeFileSync(path.join(outputDoc,'comparison-manifest.json'),JSON.stringify(comparison,null,2)+'\n');
  report.checks.push({check:'three before/after pairs have identical cameras, viewport, lighting and deterministic weather',views:comparisons.map(v=>v.name)});
  report.checks.push({check:'close, middle and distant camera views retain valid tree tiers'});
  await context.close();

  if(!capturesOnly){
  const mobile=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,serviceWorkers:'block'});
  const mp=await mobile.newPage();watch(mp);
  await mp.goto(url+'&gl=1&det=1',{waitUntil:'domcontentloaded'});await settled(mp);
  const mobileState=await state(mp);delete mobileState.roots;
  assert.equal(mobileState.backend,'webgl2');assert(mobileState.audit.ok);
  assert.equal(mobileState.catalogue.revision,VISBY_PINE_REVISION);
  await mp.screenshot({path:path.join(outputDoc,'production-mobile-webgl.png')});
  report.scenarios.push({name:'mobile-webgl',...mobileState});await mobile.close();
  console.log('Mobile WebGL: coastal pine loaded; tier audit passed');
  }
 }

 if(!capturesOnly){
  // Warm both catalogues and all Visby assets through the built service worker,
  // then confirm that switching catalogues cannot evict the Visby selection.
  const cacheContext=await browser.newContext();const cp=await cacheContext.newPage();watch(cp);
  await cp.goto(origin+'/pine-cache-check');
  await cp.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;});
  await cp.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const files=[`models/trees/ghibli-visby.json?v=${VISBY_PINE_REVISION}`,
    `models/trees/ghibli-fluffy.json?v=${standard.revision}`,
    ...coastal.species.flatMap(s=>[s.foliage.atlas.file,...s.variants.flatMap(v=>Object.values(v.tiers).map(r=>r.file))]).map(p=>'models/trees/'+p)];
  const checksums=await cp.evaluate(async files=>{
    const result=[];
    for(const file of files){const r=await fetch('/'+file);if(!r.ok)throw Error(file);
      const b=await r.arrayBuffer();result.push([...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(v=>v.toString(16).padStart(2,'0')).join(''));}
    return result;
  },files);
  await cp.waitForFunction(async expectedFiles=>{
    const names=await caches.keys();
    const manifests=await caches.open('banvy-ghibli-foliage-manifest');
    const assets=await caches.open('banvy-ghibli-foliage-assets');
    return names.length>0&&(await manifests.keys()).length>=2&&(await assets.keys()).length>=expectedFiles;
  },studyFiles);
  // Let Workbox finish its asynchronous expiration jobs before going offline.
  await cp.waitForTimeout(2000);
  await cacheContext.setOffline(true);
  const cached=await cp.evaluate(async files=>{
    const result=[];
    for(const file of files){const r=await fetch('/'+file);if(!r.ok)throw Error(file);
      const b=await r.arrayBuffer();result.push([...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(v=>v.toString(16).padStart(2,'0')).join(''));}
    return result;
  },files);
  assert.deepEqual(cached,checksums);
  report.checks.push({check:`both versioned manifests and all ${studyFiles} Visby meshes/atlases reopen offline with identical bytes`});
  await cacheContext.close();
 }
  assert.deepEqual(report.errors,[]);report.passed=true;
  console.log(JSON.stringify({passed:true,checks:report.checks,backends:report.scenarios.map(s=>s.backend)},null,2));
}catch(error){report.failure=String(error);report.passed=false;process.exitCode=1;console.error(error);}
finally{
  await browser.close();await new Promise(resolve=>server.close(resolve));
  fs.writeFileSync(path.join(outputDoc,capturesOnly?'capture-validation.json':cacheOnly?'cache-validation.json':'runtime-validation.json'),JSON.stringify(report,null,2)+'\n');
}
