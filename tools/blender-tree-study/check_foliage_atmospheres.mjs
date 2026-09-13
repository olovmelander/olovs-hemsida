// Capture all atmosphere modes in the actual app for a palette review.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const out=path.resolve('docs/graphics/tree-palette-2026-09-13');
fs.mkdirSync(out,{recursive:true});
const phase=process.argv[2]||'after',course=process.argv[3]||'upsala';
const low=process.argv.includes('--low'),natural=process.argv.includes('--natural');
const option=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const modes=option('modes')?.split(',')||['noon','golden','dawn','midnight','bluehour','storm','mist','host'];
const samples=process.argv.includes('--sky-sweep')
  ? [.025,.05,.10,.20].map(skyRadiance=>({mode:'noon',suffix:`sky-${skyRadiance}`,overrides:{skyRadiance,skyPalette:.1,cloud:.35}}))
  : modes.map(mode=>({mode,suffix:mode}));
const report={phase,course,low,natural,errors:[],modes:[]};
const browser=await chromium.launch({channel:'chrome',args:['--no-sandbox','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:low?{width:390,height:844}:{width:1600,height:1000},deviceScaleFactor:1,serviceWorkers:'block'});
 await page.addInitScript(()=>{const Socket=window.WebSocket;window.WebSocket=class extends Socket{constructor(url,protocols){super(url,protocols);if(protocols==='vite-hmr')this.addEventListener('message',e=>{try{if(['update','full-reload'].includes(JSON.parse(e.data).type))e.stopImmediatePropagation();}catch{}},true);}};});
 page.on('pageerror',e=>report.errors.push(String(e)));
 page.on('console',m=>{if(m.type()==='error'||/ghibli trees unavailable/i.test(m.text()))report.errors.push(m.text());});
 const url=`http://localhost:5173/?bana=${course}&ghibli=${natural?0:1}&hal=${option('hole')||(course==='puttom'?1:2)}&vy=${option('view')||(course==='puttom'?'fritt':'tee')}&ljus=${option('initial')||'host'}&det=1&q=${low?'lo':'hi'}&qualitylock=1`;
 console.log(`Loading ${course}, ${phase}.`);
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:240000});
 await page.waitForFunction(()=>window.V3D?.settled()&&document.querySelector('#boot')?.classList.contains('done'),undefined,{timeout:240000});
 await page.waitForTimeout(1200);
 if(process.argv.includes('--oblique')){
   await page.evaluate(()=>{const c=V3D.cameraInfo(),t=c.target,h=c.position[1]-t[1];
     V3D.placeCamera([t[0],t[1]+h*.82,t[2]+h*.9],t);});
   await page.waitForFunction(()=>V3D.settled(),undefined,{timeout:90000});
 }
 report.backend=await page.evaluate(()=>V3D.stats.backend);
 assert.equal(report.backend,'webgpu','This comparison requires WebGPU; a fallback is not equivalent evidence.');
 report.camera=await page.evaluate(()=>V3D.cameraInfo());
 report.triangles=await page.evaluate(()=>V3D.treeTriangles());
 report.inventory=await page.evaluate(()=>{
   const result=[];V3D.harness().scene.traverse(m=>{
     if(m.isMesh&&/^(trees-|vista-)/.test(m.name))result.push({name:m.name,key:m.material.userData.foliageKey||null,
       triangles:(m.geometry.index?.count??m.geometry.attributes.position.count)/3});
   });return result;
 });
 assert(report.inventory.length>0);
 assert(report.inventory.filter(m=>/crown|impostor/.test(m.name)).every(m=>natural?!m.key:!!m.key));
 for(const {mode,suffix,overrides} of samples){
   await page.evaluate(({mode,overrides})=>V3D.setPreset(mode,overrides),{mode,overrides});
   await page.waitForTimeout(350);
   await page.evaluate(()=>V3D.prepareCapture());
   const screenshot=`${course}-${phase}-${suffix}.png`;
   const png=await page.screenshot({path:path.join(out,screenshot)});
   // A ready UI and valid tree inventory do not prove that the GPU drew the
   // world. Reject a blank canvas even if a lost context emitted no JS error.
   const visibleColour=await page.evaluate(async base64=>{
     const image=await createImageBitmap(await(await fetch('data:image/png;base64,'+base64)).blob());
     const canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
     const {data}=ctx.getImageData(Math.floor(image.width*.25),Math.floor(image.height*.4),Math.floor(image.width*.5),Math.floor(image.height*.4));
     let visible=0;for(let i=0;i<data.length;i+=4)if(Math.max(data[i],data[i+1],data[i+2])>28)visible++;
     image.close();return visible/(data.length/4);
   },png.toString('base64'));
   assert(visibleColour>.55,`The world appears blank: ${visibleColour}`);
   const state=await page.evaluate(()=>({audit:V3D.treeTierAudit(),tiers:V3D.treeTiers(),atmosphere:V3D.atmosphere().preset}));
   assert(state.audit.ok);assert.equal(state.atmosphere,mode);
   report.modes.push({mode,screenshot,visibleColour,...state});console.log(`${course} ${mode} captured.`);
 }
 if(process.argv.includes('--tiers')){
   report.tiers=[];
   await page.evaluate(()=>V3D.setPreset('host'));
   for(const tier of [1,2,3,4]){
     await page.evaluate(tier=>{V3D.setTreeLod(tier);V3D.setTreeLodPx({reset:true});},tier);
     await page.waitForFunction(()=>V3D.settled(),undefined,{timeout:90000});
     await page.waitForTimeout(900);
     await page.evaluate(()=>V3D.prepareCapture());
     const audit=await page.evaluate(()=>V3D.treeTierAudit());assert(audit.ok);
     const screenshot=`${course}-${phase}-autumn-tier-${tier}.png`;
     await page.screenshot({path:path.join(out,screenshot)});
     report.tiers.push({tier,screenshot,audit,counts:await page.evaluate(()=>V3D.treeTiers())});
   }
 }
 if(process.argv.includes('--water-probe')){
   report.water=await page.evaluate(()=>V3D.waterSheets());
   await page.evaluate(()=>V3D.setWaterVisible(false));await page.evaluate(()=>V3D.prepareCapture());
   await page.screenshot({path:path.join(out,`${course}-${phase}-water-hidden.png`)});
   await page.evaluate(()=>V3D.setWaterVisible(true));
 }
 assert.equal(report.errors.length,0,JSON.stringify(report.errors));
}catch(e){report.failure=String(e);throw e;}
finally{await browser.close();fs.writeFileSync(path.join(out,`${course}-${phase}-validation.json`),JSON.stringify(report,null,2)+'\n');}
