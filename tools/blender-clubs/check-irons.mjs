/* Inspect the actual bag renderer at multiple angles. Start check-clubs --serve first. */
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { browserArgs } from '../browser-args.mjs';
const hoselReview=process.argv.includes('--hosel');
const out=fileURLToPath(new URL(`../../docs/graphics/clubs/${hoselReview ? 'hosel-refinement' : 'iron-refinement'}/`,import.meta.url));
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.BANVY_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:browserArgs()});
const errors=[];
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:hoselReview ? 2 : 1});
  page.on('pageerror',e=>errors.push(e.message));
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('http://127.0.0.1:5187/');
  await page.locator('#clubCanvas[data-state=ready]').waitFor({timeout:60000});
  for(const number of [5,6,7,8,9]){
    await page.locator(`[data-club-id="iron-${number}"] .bag-preview`).click();
    await page.locator('#clubCanvas[data-state=ready]').waitFor();
    await page.waitForTimeout(150);
    await page.locator('.club-studio').screenshot({path:out+`iron-${number}-back.png`});
    await page.locator('[data-club-pose=sole]').click();await page.waitForTimeout(150);
    await page.locator('.club-studio').screenshot({path:out+`iron-${number}-sole.png`});
    if(number===7){
      await page.locator('[data-club-pose=face]').click();await page.waitForTimeout(150);
      await page.locator('.club-studio').screenshot({path:out+'iron-7-face.png'});
      await page.locator('[data-club-pose=hero]').click();
      await page.locator('#clubCanvas canvas').focus();
      for(let i=0;i<9;i++)await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(250);
      await page.locator('.club-studio').screenshot({path:out+'iron-7-heel.png'});
      // Inspect the real head in orthogonal directions; these are review-only
      // camera positions and do not add controls to the player interface.
      for(const [name,direction] of [['toe',[-1,.05,0]],['address',[0,1,.12]]]){
        await page.locator('[data-club-pose=hero]').click();
        await page.evaluate(direction=>{
          const {camera}=window.clubReview;
          const length=Math.hypot(...direction),distance=.17;
          camera.position.set(direction[0]/length*distance,.032+direction[1]/length*distance,direction[2]/length*distance);
        },direction);
        await page.waitForTimeout(150);
        await page.locator('.club-studio').screenshot({path:out+`iron-7-${name}.png`});
      }
      if(hoselReview){
        await page.evaluate(()=>{
          const materials=new Set();clubReview.scene.traverse(o=>{if(o.material&&/steel|satin|recess/.test(o.material.name))materials.add(o.material);});
          window.hoselMaterials=[...materials].map(m=>({m,color:m.color.clone(),metalness:m.metalness,roughness:m.roughness}));
          for(const {m} of hoselMaterials){m.color.setRGB(.4,.4,.4);m.metalness=0;m.roughness=.85;}
        });
        for(const pose of ['face','hero']){
          await page.locator(`[data-club-pose=${pose}]`).click();await page.waitForTimeout(150);
          await page.locator('.club-studio').screenshot({path:out+`clay-${pose}.png`});
        }
        await page.evaluate(()=>{for(const {m,color,metalness,roughness} of hoselMaterials){m.color.copy(color);m.metalness=metalness;m.roughness=roughness;}delete window.hoselMaterials;});
      }
    }
  }
  assert.deepEqual(errors,[]);
  await fs.writeFile(out+'browser-audit.json',JSON.stringify({irons:[5,6,7,8,9],views:['back','sole','face','heel','toe','address'],errors},null,2)+'\n');
  console.log('Five numbered irons captured from the production renderer; no browser errors.');
}finally{await browser.close();}
