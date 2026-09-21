/* Production bag markup/editor in a small Vite fixture; no course download. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from '../apps/golf/node_modules/vite/dist/node/index.js';
import { browserArgs } from './browser-args.mjs';
const ROOT = fileURLToPath(new URL('../',import.meta.url)), APP = path.join(ROOT,'apps/golf');
const OUT = path.join(ROOT,'docs/graphics/clubs');
const html = (await fs.readFile(path.join(APP,'index.html'),'utf8')).replace('<script type="module" src="/src/entry.js"></script>','<script type="module" src="/src/__club-review.mjs"></script>');
const entry = path.join(APP,'src/__club-review.mjs').replaceAll('\\','/');
const fixture = `import {createBagEditor} from './ui/bag-editor.mjs';
import {DEFAULT_BAG,parseBag} from './engine/caddie.js';
import {WebGPURenderer} from 'three/webgpu';
const render=WebGPURenderer.prototype.render;window.clubRenders=0;
WebGPURenderer.prototype.render=function(...args){window.clubRenders++;window.clubReview={renderer:this,scene:args[0],camera:args[1]};return render.apply(this,args);};
let bag=parseBag(localStorage.getItem('club-review'));
window.savedBag=null;
window.bagEditor=createBagEditor({getBag:()=>bag,onSave:clubs=>{bag=clubs;window.savedBag=clubs;localStorage.setItem('club-review',JSON.stringify(clubs));}});
window.bagEditor.open();`;
const serveOnly=process.argv.includes('--serve');
const server = await createServer({root:APP,cacheDir:serveOnly ? 'node_modules/.vite-clubs' : 'node_modules/.vite-clubs-check',configFile:false,server:{host:'127.0.0.1',port:serveOnly ? 5187 : 5186,strictPort:true},plugins:[{
  name:'club-review',configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);}else next();});},
  resolveId(id){if(id==='/src/__club-review.mjs'||id===entry)return entry;},load(id){if(id===entry)return fixture;},
}]});
await server.listen();
if(serveOnly){console.log('Club review: http://127.0.0.1:5187/');await new Promise(()=>{});}
let browser;
const errors=[]; const report={};
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.BANVY_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',args:browserArgs()});
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',msg=>{if(msg.type()==='error') errors.push(msg.text());});
  await page.goto('http://127.0.0.1:5186/');
  await page.locator('#clubCanvas[data-state=ready]').waitFor({timeout:60000});
  await page.locator('#clubSpin').click();
  await page.waitForTimeout(700);
  await page.screenshot({path:path.join(OUT,'bag-desktop.png')});
  const ids=await page.locator('.bag-row').evaluateAll(rows=>rows.map(r=>r.dataset.clubId));
  for(const id of ids){
    await page.locator(`[data-club-id="${id}"] .bag-preview`).click();
    await page.locator('#clubCanvas[data-state=ready]').waitFor({timeout:30000});
    await page.waitForTimeout(150);
    if(['driver','wood-3','iron-7','sw','putter'].includes(id)) await page.locator('.club-studio').screenshot({path:path.join(OUT,`${id}.png`)});
  }
  report.models=ids;
  await page.locator('[data-club-id="iron-7"] .bag-preview').click();
  await page.locator('#clubCanvas[data-state=ready]').waitFor();
  await page.locator('[data-club-pose=face]').click(); await page.waitForTimeout(700);
  await page.locator('.club-studio').screenshot({path:path.join(OUT,'iron-face.png')});
  await page.locator('[data-club-mode=full]').click(); await page.waitForTimeout(700);
  await page.locator('.club-studio').screenshot({path:path.join(OUT,'full-club.png')});
  await page.locator('[data-club-pose=sole]').click();await page.waitForTimeout(700);
  assert.equal(await page.locator('[data-club-mode=head]').getAttribute('aria-pressed'),'true');
  await page.locator('.club-studio').screenshot({path:path.join(OUT,'iron-sole.png')});
  const canvas=page.locator('#clubCanvas canvas');
  const before=await canvas.screenshot();
  await canvas.focus(); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250);
  assert.notDeepEqual(await canvas.screenshot(),before,'keyboard rotation changes rendering');
  const bounds=await canvas.boundingBox();
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();
  await page.mouse.move(bounds.x+bounds.width/2+100,bounds.y+bounds.height/2+30,{steps:15});await page.mouse.up();
  await page.waitForTimeout(400);
  assert.notDeepEqual(await canvas.screenshot(),before,'drag rotation changes rendering');
  await page.locator('[data-club-id="iron-7"] .bag-distance').fill('147');
  await page.locator('.bag-save').click();
  assert.equal(await page.evaluate(()=>savedBag.find(c=>c.id==='iron-7').carry),147);
  await page.evaluate(()=>bagEditor.open());
  await page.locator('[data-club-id="iron-7"] .bag-distance').fill('170');
  await page.keyboard.press('Escape');await page.evaluate(()=>bagEditor.open());
  assert.equal(await page.locator('[data-club-id="iron-7"] .bag-distance').inputValue(),'147');
  await page.locator('[data-club-id="iron-7"] .bag-remove').click();
  await page.locator('#bagAddBtn').click();
  await page.locator('.bag-row:last-child .bag-name').fill('Min wedge');
  await page.locator('#clubKind').selectOption('wedge');
  await page.locator('.bag-save').click();
  assert.equal(await page.evaluate(()=>savedBag.find(c=>c.name==='Min wedge').kind),'wedge');
  await page.evaluate(()=>bagEditor.open());await page.locator('#bagResetBtn').click();
  assert.equal(await page.locator('.bag-row').count(),14);
  assert.equal(await page.locator('[data-club-id=putter] .bag-distance').isDisabled(),true);
  await page.locator('[data-club-id="iron-7"] .bag-preview').click();await page.locator('[data-club-mode=head]').click();
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('#clubSpin').getAttribute('aria-pressed'),'false');
  await page.setViewportSize({width:390,height:844});
  await page.locator('.bag-workspace').evaluate(el=>el.scrollTop=0);
  await page.waitForTimeout(750);await page.screenshot({path:path.join(OUT,'bag-mobile.png')});
  assert.ok(await page.locator('#bagDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'no mobile horizontal overflow');
  await page.locator('.bag-save').click();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#bagDialog').evaluate(el=>el.open),false);
  const closedFrames=await page.evaluate(()=>clubRenders);
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(()=>clubRenders),closedFrames,'closed viewer stops rendering');
  report.interactions=['all 14 models','head and full views','face preset','sole preset returns to head view','keyboard rotation','drag rotation','save','cancel','add/remove','model type persistence','reset','putter carry excluded','reduced motion','mobile layout'];
  // A fresh viewer has an empty model cache. An unavailable asset must never
  // leave the old club shown under a new name or prevent editing distances.
  await page.setViewportSize({width:1440,height:1000});
  await page.route('**/models/clubs/wood-3-*.glb',route=>route.fulfill({status:503,body:'Unavailable'}));
  const errorsBeforeFailure=errors.length;
  await page.reload();await page.locator('#clubCanvas[data-state=ready]').waitFor();
  await page.locator('[data-club-id="wood-3"] .bag-preview').click();
  await page.locator('#clubCanvas[data-state=error]').waitFor();
  assert.ok(await page.locator('#clubRetry').isVisible());
  await page.locator('[data-club-id="wood-3"] .bag-distance').fill('193');
  await page.unroute('**/models/clubs/wood-3-*.glb');
  await page.locator('#clubRetry').click();await page.locator('#clubCanvas[data-state=ready]').waitFor();
  await page.locator('.bag-save').click();
  assert.equal(await page.evaluate(()=>savedBag.find(c=>c.id==='wood-3').carry),193);
  const expectedErrors=errors.splice(errorsBeforeFailure);
  assert.ok(expectedErrors.every(e=>/503/.test(e)),JSON.stringify(expectedErrors));
  report.interactions.push('closed render loop stops','asset error fallback','asset retry','editing survives asset failure');
  report.errors=errors;
  await fs.writeFile(path.join(OUT,'browser-audit.json'),JSON.stringify(report,null,2)+'\n');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify(report,null,2));
}finally{await browser?.close();await server.close();}
