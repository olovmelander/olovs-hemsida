/* Capture the production wedge viewer. Start check-clubs --serve first. */
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { browserArgs } from '../browser-args.mjs';
const before=process.argv.includes('--before'),prefix=before?'before-':'';
const ids=['pw','gw','sw','lw'];
const out=fileURLToPath(new URL('../../docs/graphics/clubs/wedge-refinement/',import.meta.url));
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.BANVY_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:browserArgs()});
const errors=[],framing=[];
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:2});
  page.on('pageerror',e=>errors.push(e.message));
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('http://127.0.0.1:5187/');
  await page.locator('#clubCanvas[data-state=ready]').waitFor({timeout:60000});
  async function checkFraming(id,view,full=false){
    if(before)return;
    const limits=await page.evaluate(full=>{
      const {scene,camera}=clubReview;const point=camera.position.clone();let x=0,y=0,vertices=0;
      scene.traverse(object=>{
        const positions=object.geometry?.attributes.position;if(!positions)return;
        for(let i=0;i<positions.count;i++){
          point.fromBufferAttribute(positions,i).applyMatrix4(object.matrixWorld);
          if(!full&&point.y>.072)continue;
          point.project(camera);x=Math.max(x,Math.abs(point.x));y=Math.max(y,Math.abs(point.y));vertices++;
        }
      });
      return {x,y,vertices};
    },full);
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
    if(id==='sw'){
      if(!before){
        await page.evaluate(()=>{
          const materials=new Set();clubReview.scene.traverse(o=>{for(const m of [o.material].flat().filter(Boolean))if(/steel|satin|milling/.test(m.name))materials.add(m);});
          window.wedgeMaterials=[...materials].map(m=>({m,color:m.color.clone(),metalness:m.metalness,roughness:m.roughness}));
          for(const {m} of wedgeMaterials){m.color.setRGB(.4,.4,.4);m.metalness=0;m.roughness=.85;}
        });
        for(const pose of ['face','hero']){
          await page.locator(`[data-club-pose=${pose}]`).click();await page.waitForTimeout(150);
          await page.locator('.club-studio').screenshot({path:out+`clay-${pose}.png`});
        }
        await page.evaluate(()=>{for(const {m,color,metalness,roughness} of wedgeMaterials){m.color.copy(color);m.metalness=metalness;m.roughness=roughness;}delete window.wedgeMaterials;});
      }
      for(const [name,direction] of [['toe',[-1,.12,.02]],['address',[.05,1,.1]]]){
        await page.locator('[data-club-pose=hero]').click();
        await page.evaluate(direction=>{
          const {camera}=clubReview;const length=Math.hypot(...direction),distance=.20;
          camera.position.set(-.005+direction[0]/length*distance,.030+direction[1]/length*distance,-.017+direction[2]/length*distance);
        },direction);
        await page.waitForTimeout(200);
        await page.locator('.club-studio').screenshot({path:out+`${prefix}${id}-${name}.png`});
      }
    }
    await page.locator('[data-club-mode=full]').click();await page.waitForTimeout(200);
    await checkFraming(id,'full',true);
    await page.locator('.club-studio').screenshot({path:out+`${prefix}${id}-full.png`});
    await page.locator('[data-club-mode=head]').click();
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('[data-club-id=sw] .bag-preview').click();
  await page.locator('#clubCanvas[data-state=ready]').waitFor();
  await page.locator('.bag-workspace').evaluate(el=>el.scrollTop=0);
  await page.waitForTimeout(200);await page.screenshot({path:out+`${prefix}sw-mobile.png`});
  await checkFraming('sw','mobile');
  assert.deepEqual(errors,[]);
  await fs.writeFile(out+prefix+'browser-audit.json',JSON.stringify({models:ids,framing,errors},null,2)+'\n');
  console.log('Four wedges captured: back, face, sole, full club; SW toe/address/mobile. No browser errors.');
}finally{await browser.close();}
