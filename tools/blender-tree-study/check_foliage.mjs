import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
const out=path.resolve('docs/graphics/tree-atelier-2026-09-13');
const assets=path.resolve('apps/golf/public/models/trees/foliage-study');
const manifest=JSON.parse(fs.readFileSync(path.join(assets,'study.json')));
for(const [tier,rec] of Object.entries(manifest.tiers)){
  const b=fs.readFileSync(path.join(assets,rec.file));
  if(b.length!==rec.bytes||createHash('sha256').update(b).digest('hex')!==rec.sha256)throw Error(`Corrupt ${tier}`);
}
const report={errors:[],views:[]};
const browser=await chromium.launch({channel:'chrome',args:['--no-sandbox','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
try{
  const page=await browser.newPage({viewport:{width:1560,height:980},deviceScaleFactor:1});
  page.on('pageerror',e=>report.errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.goto('http://localhost:5173/foliage-study.html');
  await page.waitForFunction(()=>window.foliageStudy?.current,{timeout:90000});
  for(const tier of ['hero','full','lite']){
    await page.selectOption('#tier',tier);await page.waitForTimeout(1800);
    report.views.push(await page.evaluate(()=>({tier:foliageStudy.current,views:foliageStudy.views.map(v=>({design:v.design,triangles:v.triangles,webgpu:v.renderer.backend.isWebGPUBackend,drawCalls:v.renderer.info.render.drawCalls})),materials:Object.values(foliageStudy.templates).flatMap(root=>{const rows=[];root.traverse(m=>{if(m.isMesh)rows.push({name:m.name,map:!!m.material.map,alphaTest:m.material.alphaTest});});return rows;})})));
    await page.screenshot({path:path.join(out,`textured-pine-${tier}.png`)});
  }
  await page.selectOption('#tier','hero');
  await page.evaluate(()=>{for(const v of foliageStudy.views)v.group.rotation.y=Math.PI;});
  await page.waitForTimeout(700);await page.screenshot({path:path.join(out,'textured-pine-rear.png')});
  await page.setViewportSize({width:390,height:844});
  report.mobileOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  await page.screenshot({path:path.join(out,'textured-pine-mobile.png'),fullPage:true});
}finally{await browser.close();fs.writeFileSync(path.join(out,'foliage-validation.json'),JSON.stringify(report,null,2)+'\n');}
if(report.errors.length||report.mobileOverflow)throw Error(JSON.stringify(report));
console.log(JSON.stringify(report,null,2));
