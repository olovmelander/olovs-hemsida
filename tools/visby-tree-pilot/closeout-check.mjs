// Verify the delivered review and retained graph; no runtime or source edits.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {ROOT, OUT, serve, json, save, sha} from './round6-preview.mjs';

const work=path.join(OUT,'closeout');
const doc=path.join(ROOT,'geo_data/course-v2/visby/vegetation/pilot/closeout');
const status=json(path.join(doc,'closeout.json'));
const {server,url}=await serve('round6');
const browser=await chromium.launch({channel:'chrome'});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(url+'/pilot-review/closeout/index.html',{waitUntil:'networkidle'});
  assert.equal(await page.locator('#case-select option').count(),6);
  assert.equal(await page.locator('#cells').innerText(),'156');
  assert.equal(await page.locator('#individuals').innerText(),'3,516');
  assert.equal(await page.locator('#case-rows tr').count(),27);
  assert.equal(await page.locator('#facility-map circle').count(),27);
  assert.equal(await page.locator('#root').textContent(),status.rootSha256);
  const selected=await page.evaluate(()=>VISBY_CLOSEOUT.detailedOrder);
  for(const id of selected){
    await page.selectOption('#case-select',id);
    assert.match(await page.locator('#case-board').getAttribute('src'),new RegExp(id+'-board.png$'));
    await page.locator('#case-board').evaluate(im=>im.decode());
    assert.match(await page.locator('#case-note').innerText(),/crown|tree/i);
  }
  // A map selection outside the priority list must expose the selected case.
  await page.locator('#facility-map circle[aria-label^="gap-024,"]').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#case-filter').inputValue(),'all');
  assert.equal(await page.locator('#case-select').inputValue(),'gap-024');
  assert.match(await page.locator('#case-required').innerText(),/tree-visby-003535/);
  assert.equal(await page.locator('#case-select option').count(),27);
  await page.selectOption('#case-select','gap-041');
  assert.match(await page.locator('#case-required').innerText(),/tee and path exclusion/);
  await page.selectOption('#case-filter','priority');
  assert.equal(await page.locator('#case-select').inputValue(),'gap-009');
  assert.match(await page.locator('#case-context').innerText(),/outside/);
  const files=await page.evaluate(async()=>{
    const urls=new Set([...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')).filter(h=>!h.startsWith('#')));
    for(const c of VISBY_CLOSEOUT.conflicts.cases)urls.add(c.board);
    for(const href of urls){const r=await fetch(href,{method:'HEAD'});if(!r.ok)throw Error(href+' '+r.status)}
    return urls.size;
  });
  const body=await page.locator('body').innerText();
  for(const text of ['71.4%','62.5%','95.17%','unchanged from the sixth pass','Production retains its baseline'])assert.ok(body.includes(text),text);
  const rootBytes=Buffer.from(await (await page.request.get(url+'/courses/v2-index.json')).body());
  assert.equal(sha(rootBytes),status.rootSha256);
  assert.equal(sha(fs.readFileSync(path.join(OUT,'round6/after/courses/v2-index.json'))),status.rootSha256);
  const before={data:sha(fs.readFileSync(path.join(work,'data.js'))),html:sha(fs.readFileSync(path.join(work,'index.html')))};
  await page.locator('#case-board').evaluate(im=>im.decode());
  await page.screenshot({path:path.join(work,'viewer-check.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.selectOption('#case-select','gap-064');
  await page.locator('#case-board').evaluate(im=>im.decode());
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile horizontal overflow');
  await page.screenshot({path:path.join(work,'viewer-check-mobile.png'),fullPage:true});
  assert.equal(errors.length,0);
  const report={status:'passed',cases:27,detailedExamples:6,facilityCells:156,sourceBoardsChecked:27,
    detailedImagesDecoded:6,assetsChecked:files,keyboardMapSelection:true,reservedIdentityVisible:true,
    mobileWidth:390,mobileHorizontalOverflow:false,actualServedRootSha256:sha(rootBytes),
    runtimeChanged:false,evidence:'Review-page check and served-root identity; runtime/performance results are inherited from the unchanged round-six graph.',
    payloadSha256:before,errors};
  save(path.join(doc,'viewer-check.json'),report);console.log(JSON.stringify(report));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
