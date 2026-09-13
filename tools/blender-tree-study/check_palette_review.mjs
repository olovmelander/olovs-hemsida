import {chromium} from 'playwright-core';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=path.resolve('docs/graphics/tree-palette-2026-09-13');
const browser=await chromium.launch({channel:'chrome'});
try{
 const page=await browser.newPage({viewport:{width:1500,height:1160}}),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(pathToFileURL(path.join(out,'index.html')).href);
 for(const course of ['puttom','upsala','angso']){
   await page.selectOption('#course',course);
   for(const mode of ['noon','golden','dawn','midnight','bluehour','storm','mist','host']){
     await page.click(`[data-mode="${mode}"]`);
     await page.waitForFunction(()=>[...document.querySelectorAll('.comparison img')]
       .filter(i=>i.checkVisibility()).every(i=>i.complete&&i.naturalWidth>0));
     assert.equal(await page.getAttribute(`[data-mode="${mode}"]`,'aria-pressed'),'true');
   }
 }
 await page.selectOption('#course','puttom');
 await page.click('[data-mode="noon"]');
 await page.waitForFunction(()=>[...document.querySelectorAll('.comparison img')].every(i=>i.complete&&i.naturalWidth>0));
 await page.screenshot({path:path.join(out,'review-page.png'),fullPage:true});
 assert.deepEqual(errors,[]);console.log('Review gallery: 24 selections passed.');
}finally{await browser.close();}
