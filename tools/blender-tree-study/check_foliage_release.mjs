// Exercise the production service worker with an old catalogue already cached.
// The build supplies code; public assets are served directly to avoid copying
// the large course archive. All browser state belongs to this isolated check.
// Usage: node check_foliage_release.mjs <compiled-build-directory>
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {GHIBLI_FOLIAGE_REVISION} from '../../apps/golf/src/engine/ghibli-trees.mjs';

assert(process.argv[2], 'Pass a compiled application directory');
const dist=path.resolve(process.argv[2]),publicRoot=path.resolve('apps/golf/public');
const out=path.resolve('docs/graphics/canopy-refinement-2026-09-13');
assert(fs.existsSync(path.join(dist,'sw.js')), 'Production service worker is required');
const oldManifest=JSON.parse(fs.readFileSync(path.join(out,'before-manifest.json'),'utf8'));
const manifestPath='/models/trees/ghibli-fluffy.json';
const report={revision:GHIBLI_FOLIAGE_REVISION,errors:[],visits:[],manifestRequests:[],modelRequests:0,missingResources:[]};
let manifestMode='slow';
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css',
  '.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml',
  '.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.woff2':'font/woff2','.wasm':'application/wasm'};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/__foliage_check__'){
    res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><title>Foliage cache check</title><link rel="icon" href="/favicon.svg">');return;
  }
  if(url.pathname===manifestPath){
    report.manifestRequests.push({query:url.search,mode:manifestMode});
    if(manifestMode==='fail'){req.socket.destroy();return;}
  }
  if(/\/models\/trees\/ghibli-fluffy\/[a-f0-9]{64}\.(glb|png)$/.test(url.pathname))report.modelRequests++;
  const relative=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname).slice(1);
  const file=[dist,publicRoot].map(root=>({root,file:path.resolve(root,relative)}))
    .find(({root,file})=>file.startsWith(root+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())?.file;
  if(!file){report.missingResources.push(url.pathname);res.writeHead(404);res.end('not found');return;}
  const send=()=>{
    if(res.destroyed)return;
    res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream',
      'content-length':fs.statSync(file).size,'cache-control':'no-cache'});
    fs.createReadStream(file).pipe(res);
  };
  // Beyond NetworkFirst's four-second timeout: an old unversioned key can
  // fall back immediately, while the new version must wait for its own data.
  if(url.pathname===manifestPath&&manifestMode==='slow')setTimeout(send,6500);else send();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const appUrl=origin+'/?bana=norrfallsviken&hal=1&vy=tee&ljus=kvall';
const browser=await chromium.launch({channel:'chrome',args:['--no-sandbox','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
try{
  const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});
  page.on('pageerror',e=>report.errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error'||/ghibli trees unavailable/i.test(m.text()))report.errors.push(m.text());});
  await page.goto(origin+'/__foliage_check__');
  await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;});
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.evaluate(async({oldManifest,manifestPath})=>{
    const cache=await caches.open('banvy-ghibli-foliage-manifest');
    await cache.put(manifestPath,new Response(JSON.stringify(oldManifest),{headers:{'content-type':'application/json'}}));
  },{oldManifest,manifestPath});
  const stale=await page.evaluate(async manifestPath=>(await fetch(manifestPath)).json(),manifestPath);
  assert.notEqual(stale.revision,GHIBLI_FOLIAGE_REVISION);
  report.reproducedUnversionedStaleFallback=true;
  console.log('Reproduced an older catalogue from the unversioned cache key.');

  for(const visit of ['slow-network','cached-manifest-fallback']){
    if(visit==='cached-manifest-fallback')manifestMode='fail';
    const before=report.modelRequests;
    await page.goto(appUrl,{waitUntil:'domcontentloaded',timeout:240000});
    await page.waitForFunction(()=>window.V3D?.settled()&&document.querySelector('#boot')?.classList.contains('done'),undefined,{timeout:240000});
    await page.waitForTimeout(1200);
    const state=await page.evaluate(async()=>({catalogue:V3D.treeCatalogue(),backend:V3D.stats.backend,
      audit:V3D.treeTierAudit(),triangles:V3D.treeTriangles(),tiers:V3D.treeTiers(),quality:V3D.quality(),
      sw:!!navigator.serviceWorker.controller,
      manifestCacheKeys:(await(await caches.open('banvy-ghibli-foliage-manifest')).keys()).map(r=>r.url)}));
    report.visits.push({visit,networkModels:report.modelRequests-before,...state});
    assert.equal(state.catalogue.loaded,true);assert.equal(state.catalogue.look,'painted');
    assert.equal(state.catalogue.revision,GHIBLI_FOLIAGE_REVISION);assert.equal(state.catalogue.files,20);
    assert.equal(state.backend,'webgpu');assert(state.audit.ok);assert(state.sw);
    const networkModels=report.modelRequests-before;
    if(visit==='cached-manifest-fallback'){
      assert.equal(networkModels,0,'Cached immutable models should not hit the network');
      assert.deepEqual(state.triangles,report.visits[0].triangles);
    }
    await page.screenshot({path:path.join(out,`norrfallsviken-release-${visit}.png`)});
    console.log(`${visit}: ${state.catalogue.revision}, ${networkModels} model/texture network requests.`);
  }
  assert(report.manifestRequests.some(r=>r.query===`?v=${GHIBLI_FOLIAGE_REVISION}`));
  assert.deepEqual(report.errors,[]);
}catch(e){report.failure=String(e);process.exitCode=1;console.error(e);}
finally{
  await browser.close();await new Promise(resolve=>server.close(resolve));
  fs.writeFileSync(path.join(out,'foliage-release-validation.json'),JSON.stringify(report,null,2)+'\n');
}
