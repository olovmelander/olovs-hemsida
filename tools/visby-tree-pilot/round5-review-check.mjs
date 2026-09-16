// Check the facility viewer, all source assets, pixel extents and comparisons.
import assert from 'node:assert/strict';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {OUT,serve,save} from './round5-preview.mjs';
const {server,url}=await serve('round5');
const browser=await chromium.launch({channel:'chrome'});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1100},serviceWorkers:'block'}),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 const prefix=url+'/pilot-review/round5/';await page.goto(prefix+'review.html',{waitUntil:'networkidle'});
 assert.equal(await page.locator('#scene option').count(),278);
 assert.equal(await page.locator('#map').getAttribute('viewBox'),'0 0 130 130');
 assert.equal(await page.locator('#accepted').innerText(),'156');
 assert.equal(await page.locator('#extension').isChecked(),false);
 assert.equal(await page.evaluate(()=>PILOT5.coverage.features.length),156);
 for(const layer of ['cir','chm','2022','rgb']){
  await page.selectOption('#layer',layer);
  assert((await page.locator('#map image').getAttribute('href')).endsWith('-'+layer+'.png'));
  assert(Math.abs(Number(await page.locator('#map image').getAttribute('width'))-(['rgb','cir'].includes(layer)?129.92:130))<1e-7);
 }
 await page.check('#extension');assert(await page.locator('#map path title').allTextContents().then(t=>t.includes('new-review-area')));
 await page.check('#woodland');await page.check('#height-gaps');
 await page.locator('#map path').evaluateAll(paths=>paths.find(p=>p.querySelector('title')?.textContent?.startsWith('r5-010/'))?.dispatchEvent(new MouseEvent('click')));
 assert((await page.locator('#detail').innerText()).includes('candidateId'));
 await page.locator('#facility-map path').first().dispatchEvent('click');
 assert.equal(await page.locator('#scene').inputValue(),'r5-001');
 await page.selectOption('#scene','suppressed-000284');assert.equal(await page.locator('#map').getAttribute('viewBox'),'0 0 30 30');
 await page.selectOption('#renderer','webgl-low');assert.equal(await page.locator('#hole').inputValue(),'16');assert(await page.locator('#camera').isDisabled());
 await page.selectOption('#renderer','webgpu-high');await page.selectOption('#hole','1');await page.selectOption('#scene','r5-010');
 await page.uncheck('#extension');await page.uncheck('#height-gaps');await page.uncheck('#woodland');
 const assets=await page.evaluate(()=>[...PILOT5.scenes.flatMap(s=>['rgb','cir','chm','2022'].map(l=>`${s.sourcePrefix}${s.id}-${l}.png`)),...Array.from(document.querySelectorAll('a[href^="exports/"]'),a=>a.getAttribute('href'))]);
 for(const file of assets){const response=await page.request.get(prefix+file);assert(response.ok(),file)}
 await page.waitForFunction(()=>[...document.querySelectorAll('.compare img')].every(i=>i.complete&&i.naturalWidth===1440));
 assert.equal(errors.length,0);await page.screenshot({path:path.join(OUT,'round5/review-page.png'),fullPage:true});
 save(path.join(OUT,'round5/review-page-check.json'),{status:'passed',browser:browser.version(),facilityCells:156,scenes:278,sourceLayers:4,checkedLocalAssets:assets.length,placementPanelMetres:130,suppressionPanelMetres:30,errors});
 console.log('Facility review page passed:',assets.length,'assets; 278 scenes.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
