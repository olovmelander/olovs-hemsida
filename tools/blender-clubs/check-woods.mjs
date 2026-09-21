/* Capture refined woods or --hybrid. Start check-clubs --serve first. */
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { browserArgs } from '../browser-args.mjs';
const hybrid=process.argv.includes('--hybrid'),before=process.argv.includes('--before');
const ids=hybrid?['hybrid-4']:['driver','wood-3','wood-5'];
const mobileId=ids[0],prefix=before?'before-':'';
const out=fileURLToPath(new URL(`../../docs/graphics/clubs/${hybrid?'hybrid':'wood'}-refinement/`,import.meta.url));
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.BANVY_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:browserArgs()});
const errors=[];
const framing=[];
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:2});
  page.on('pageerror',e=>errors.push(e.message));
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('http://127.0.0.1:5187/');
  await page.locator('#clubCanvas[data-state=ready]').waitFor({timeout:60000});
  async function checkFraming(id,view,full=false){
    if(before)return;
    const limits=await page.evaluate(({full,id})=>{
      const {scene,camera}=clubReview;const point=camera.position.clone();let x=0,y=0,vertices=0;
      scene.traverse(object=>{
        const positions=object.geometry?.attributes.position;if(!positions)return;
        for(let i=0;i<positions.count;i++){
          point.fromBufferAttribute(positions,i).applyMatrix4(object.matrixWorld);
          if(!full&&point.y>(id==='driver'?.068:.045))continue;
          point.project(camera);x=Math.max(x,Math.abs(point.x));y=Math.max(y,Math.abs(point.y));vertices++;
        }
      });
      return {x,y,vertices};
    },{full,id});
    assert.ok(limits.vertices>1000,`${id}/${view}: inspected model vertices`);
    assert.ok(limits.x<.95&&limits.y<.95,`${id}/${view}: geometry clipped: ${JSON.stringify(limits)}`);
    framing.push({id,view,...limits});
  }
  for(const id of ids){
    await page.locator(`[data-club-id="${id}"] .bag-preview`).click();
    await page.locator('#clubCanvas[data-state=ready]').waitFor();
    for(const pose of ['hero','face','sole']){
      await page.locator(`[data-club-pose=${pose}]`).click();await page.waitForTimeout(200);
      await checkFraming(id,pose);
      await page.locator('.club-studio').screenshot({path:out+`${prefix}${id}-${pose}.png`});
    }
    for(const [name,direction] of [['crown',[.05,1,.1]],['toe',[-1,.18,.02]]]){
      await page.locator('[data-club-pose=hero]').click();
      await page.evaluate(({direction,id})=>{
        const {camera}=clubReview;const length=Math.hypot(...direction),distance=id==='driver'?.22:.18;
        camera.position.set(direction[0]/length*distance,.031+direction[1]/length*distance,-.012+direction[2]/length*distance);
      },{direction,id});
      await page.waitForTimeout(200);
      await page.locator('.club-studio').screenshot({path:out+`${prefix}${id}-${name}.png`});
    }
    await page.locator('[data-club-mode=full]').click();await page.waitForTimeout(200);
    await checkFraming(id,'full',true);
    await page.locator('.club-studio').screenshot({path:out+`${prefix}${id}-full.png`});
    await page.locator('[data-club-mode=head]').click();
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator(`[data-club-id=${mobileId}] .bag-preview`).click();
  await page.locator('#clubCanvas[data-state=ready]').waitFor();
  await page.locator('.bag-workspace').evaluate(el=>el.scrollTop=0);
  await page.waitForTimeout(200);await page.screenshot({path:out+`${prefix}${mobileId}-mobile.png`});
  await checkFraming(mobileId,'mobile');
  assert.deepEqual(errors,[]);
  await fs.writeFile(out+prefix+'browser-audit.json',JSON.stringify({models:ids,views:['hero','face','sole','crown','toe','full','mobile'],framing,errors},null,2)+'\n');
  console.log(`${ids.join(', ')} captured from seven views; no browser errors.`);
}finally{await browser.close();}
