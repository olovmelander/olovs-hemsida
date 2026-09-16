// Source viewer checks run after performance profiling, never concurrently.
import assert from 'node:assert/strict';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {OUT,ROOT,serve,json,save} from './round6-preview.mjs';
const {server,url}=await serve('round6'),browser=await chromium.launch({channel:'chrome'});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(url+'/pilot-review/round6/review.html',{waitUntil:'networkidle',timeout:120000});
 const counts=await page.evaluate(()=>({scenes:PILOT6.scenes.length,reviews:PILOT6.gapReviews.length,closeups:PILOT6.closeups.pairs.length,cells:PILOT6.coverage.features.length}));
 assert.deepEqual(counts,{scenes:357,reviews:79,closeups:18,cells:156});
 assert.equal(await page.locator('#accepted').innerText(),'6');assert.equal(await page.locator('#holds').innerText(),'27');
 await page.selectOption('#gap-review','gap-039');await page.click('#gap-map');assert.equal(await page.locator('#scene').inputValue(),'gap-039');
 for(const source of ['rgb','cir','chm','2022']){await page.selectOption('#layer',source);assert.match(await page.locator('#map image').getAttribute('href'),new RegExp(`gap-039-${source}.png$`));}
 for(const id of ['woodland','issues','height-gaps','extension'])await page.check('#'+id);
 await page.selectOption('#close-tree','tree-visby-000259');await page.selectOption('#close-renderer','webgl-low');
 assert.match(await page.locator('#close-after').getAttribute('src'),/webgl-low-gap-074-after/);
 await page.selectOption('#renderer','webgl-low');assert.equal(await page.locator('#camera').inputValue(),'tee');assert.equal(await page.locator('#hole').inputValue(),'16');
 const assets=await page.evaluate(async()=>{
  const urls=new Set();for(const s of PILOT6.scenes)for(const name of ['rgb','cir','chm','2022'])urls.add(s.sourcePrefix+s.id+'-'+name+'.png');
  for(const j of PILOT6.gapReviews)urls.add('review/'+j.id+'-board.png');
  for(const p of PILOT6.closeups.pairs)for(const mode of ['before','after'])urls.add('closeups/'+p[mode]);
  for(const a of document.querySelectorAll('a[href^="exports/"]'))urls.add(a.getAttribute('href'));
  for(const href of urls){const r=await fetch(href,{method:'HEAD'});if(!r.ok)throw Error(href+' '+r.status)}return urls.size;
 });
 await page.evaluate(()=>Promise.all([...document.images].map(im=>im.decode())));
 assert.equal(errors.length,0);await page.screenshot({path:path.join(OUT,'round6/viewer-check.png'),fullPage:true});
 const report={status:'passed',...counts,assetsChecked:assets,errors};save(path.join(ROOT,'geo_data/course-v2/visby/vegetation/pilot/round6/viewer-check.json'),report);console.log(report);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
