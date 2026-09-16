// Production browser proof, including unchanged roots and offline asset caching.
// First build with build_preview.mjs output/visby-pine-build.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import {VISBY_PINE_REVISION} from '../../apps/golf/src/engine/ghibli-trees.mjs';

const dist=path.resolve(process.argv[2]||'output/visby-pine-build');
const assets=path.resolve('apps/golf/public');
const doc=path.resolve('docs/graphics/visby-coastal-pine-2026-09-16');
const cacheOnly=process.argv.includes('--cache-only');
const original=JSON.parse(fs.readFileSync(path.join(assets,'models/trees/ghibli-fluffy.json')));
const coastal=JSON.parse(fs.readFileSync(path.join(assets,'models/trees/ghibli-visby.json')));
const report={revision:VISBY_PINE_REVISION,errors:[],checks:[],scenarios:[]};
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
  const url=origin+'/?bana=visby&hal=1&vy=tee&ghibli=1&ljus=dag';
  await page.goto(url,{waitUntil:'domcontentloaded'});await settled(page);
  const before=await state(page);
  console.log('Baseline loaded:',before.total,'trees');
  await page.unroute(pattern);
  await page.reload({waitUntil:'domcontentloaded'});await settled(page);
  const after=await state(page);
  assert.equal(after.catalogue.revision,VISBY_PINE_REVISION);
  assert.equal(after.catalogue.files,26);assert.equal(after.backend,'webgpu');assert(after.audit.ok);
  assert.deepEqual(after.roots,before.roots,'Root positions, yaw and species must survive the template replacement');
  report.checks.push({check:'all root positions, yaw and species unchanged',trees:after.total,sha256:sha(after.roots)});
  delete before.roots;delete after.roots;
  report.scenarios.push({name:'desktop-webgpu',...after});
  console.log('Desktop WebGPU: coastal pine loaded; all roots unchanged');
  await page.screenshot({path:path.join(doc,'production-hole1.png')});
  await page.locator('#skyltBtn').click();
  // Ground-level pine by the northern end of the first hole, in its actual placement.
  for(const [name,position] of [['close',[-573,7,-37]],['middle',[-576,10,-65]],['distant',[-583,16,-135]]]){
    await page.evaluate(p=>V3D.setView(...p,-569.89,6.5,-7.08),position);await settled(page);
    assert(await page.evaluate(()=>V3D.treeTierAudit().ok));
    await page.screenshot({path:path.join(doc,`production-pine-${name}.png`)});
  }
  report.checks.push({check:'close, middle and distant camera views retain valid tree tiers'});
  await context.close();

  const mobile=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,serviceWorkers:'block'});
  const mp=await mobile.newPage();watch(mp);
  await mp.goto(url+'&gl=1&det=1',{waitUntil:'domcontentloaded'});await settled(mp);
  const mobileState=await state(mp);delete mobileState.roots;
  assert.equal(mobileState.backend,'webgl2');assert(mobileState.audit.ok);
  assert.equal(mobileState.catalogue.revision,VISBY_PINE_REVISION);
  await mp.screenshot({path:path.join(doc,'production-mobile-webgl.png')});
  report.scenarios.push({name:'mobile-webgl',...mobileState});await mobile.close();
  console.log('Mobile WebGL: coastal pine loaded; tier audit passed');
 }

  // Warm both catalogues and all Visby assets through the built service worker,
  // then confirm that switching catalogues cannot evict the Visby selection.
  const cacheContext=await browser.newContext();const cp=await cacheContext.newPage();watch(cp);
  await cp.goto(origin+'/pine-cache-check');
  await cp.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;});
  await cp.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const files=[`models/trees/ghibli-visby.json?v=${VISBY_PINE_REVISION}`,
    `models/trees/ghibli-fluffy.json?v=${original.revision}`,
    ...coastal.species.flatMap(s=>[s.foliage.atlas.file,...s.variants.flatMap(v=>Object.values(v.tiers).map(r=>r.file))]).map(p=>'models/trees/'+p)];
  const checksums=await cp.evaluate(async files=>{
    const result=[];
    for(const file of files){const r=await fetch('/'+file);if(!r.ok)throw Error(file);
      const b=await r.arrayBuffer();result.push([...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(v=>v.toString(16).padStart(2,'0')).join(''));}
    return result;
  },files);
  await cp.waitForFunction(async()=>{
    const names=await caches.keys();
    const manifests=await caches.open('banvy-ghibli-foliage-manifest');
    const assets=await caches.open('banvy-ghibli-foliage-assets');
    return names.length>0&&(await manifests.keys()).length>=2&&(await assets.keys()).length>=26;
  });
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
  report.checks.push({check:'both versioned manifests and all 26 Visby meshes/atlases reopen offline with identical bytes'});
  await cacheContext.close();
  assert.deepEqual(report.errors,[]);report.passed=true;
  console.log(JSON.stringify({passed:true,checks:report.checks,backends:report.scenarios.map(s=>s.backend)},null,2));
}catch(error){report.failure=String(error);report.passed=false;process.exitCode=1;console.error(error);}
finally{
  await browser.close();await new Promise(resolve=>server.close(resolve));
  fs.writeFileSync(path.join(doc,cacheOnly?'cache-validation.json':'runtime-validation.json'),JSON.stringify(report,null,2)+'\n');
}
