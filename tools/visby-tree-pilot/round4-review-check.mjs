// Verify the source-map coordinate extent and real local review assets in Chrome.
import assert from 'node:assert/strict';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {OUT,serve,save} from './round4-preview.mjs';
const {server,url}=await serve('round4');
const browser=await chromium.launch({channel:'chrome'});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1100},serviceWorkers:'block'}),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 const prefix=url+'/pilot-review/round4/';await page.goto(prefix+'review.html',{waitUntil:'networkidle'});
 assert.equal(await page.locator('#scene option').count(),125);
 assert.equal(await page.locator('#map').getAttribute('viewBox'),'0 0 130 130');
 assert(Math.abs(Number(await page.locator('#map image').getAttribute('width'))-129.92)<1e-7);
 assert.equal(await page.locator('#accepted').innerText(),'138');
 for(const layer of ['cir','chm','2022','rgb']){
  await page.selectOption('#layer',layer);assert((await page.locator('#map image').getAttribute('href')).endsWith('-'+layer+'.png'));
  assert(Math.abs(Number(await page.locator('#map image').getAttribute('width'))-(['rgb','cir'].includes(layer)?129.92:130))<1e-7);
 }
 await page.locator('#map path').evaluateAll(paths=>paths.find(p=>p.querySelector('title')?.textContent?.startsWith('tree-visby-'))?.dispatchEvent(new MouseEvent('click')));
 assert((await page.locator('#detail').innerText()).includes('candidateId'));
 await page.selectOption('#scene','suppressed-000284');assert.equal(await page.locator('#map').getAttribute('viewBox'),'0 0 30 30');
 await page.selectOption('#renderer','webgl-low');assert.equal(await page.locator('#hole').inputValue(),'16');assert(await page.locator('#camera').isDisabled());
 await page.selectOption('#renderer','webgpu-high');await page.selectOption('#hole','1');await page.selectOption('#scene','r4-26');
 const assets=await page.evaluate(()=>[...PILOT4.scenes.flatMap(s=>['rgb','cir','chm','2022'].map(l=>`${s.sourcePrefix||'review/'}${s.id}-${l}.png`)),
  ...document.querySelectorAll('a[href^="exports/"]')].map(x=>typeof x==='string'?x:x.getAttribute('href')));
 for(const file of assets){const r=await page.request.get(prefix+file);assert(r.ok(),file);}
 await page.waitForFunction(()=>[...document.querySelectorAll('.compare img')].every(i=>i.complete&&i.naturalWidth===1440));
 assert.equal(errors.length,0);await page.screenshot({path:path.join(OUT,'round4/review-page.png'),fullPage:true});
 save(path.join(OUT,'round4/review-page-check.json'),{status:'passed',browser:browser.version(),scenes:125,sourceLayers:4,checkedLocalAssets:assets.length,placementPanelMetres:130,suppressionPanelMetres:30,errors});
 console.log('Review page passed:',assets.length,'assets; 125 scenes; source extents and comparisons verified.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
