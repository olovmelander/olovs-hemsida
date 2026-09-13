import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
const out=path.resolve('docs/graphics/tree-atelier-2026-09-13');
const assets=path.resolve('apps/golf/public/models/trees/foliage-study');
const manifest=JSON.parse(fs.readFileSync(path.join(assets,'species-study.json')));
const report={errors:[],assets:[],views:[]};
for(const s of manifest.species)for(const [tier,rec] of Object.entries(s.tiers)){
  const b=fs.readFileSync(path.join(assets,rec.file));
  if(b.length!==rec.bytes||createHash('sha256').update(b).digest('hex')!==rec.sha256)throw Error(`Corrupt ${s.key}/${tier}`);
  const gltf=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString());
  let triangles=0;
  for(const mesh of gltf.meshes)for(const p of mesh.primitives){
    if((p.mode??4)!==4)throw Error('Non-triangle primitive');
    triangles+=gltf.accessors[p.indices??p.attributes.POSITION].count/3;
  }
  if(triangles!==rec.triangles||triangles>manifest.budgets[tier])throw Error(`Triangle budget ${s.key}/${tier}`);
  report.assets.push({species:s.key,tier,triangles,bytes:b.length});
}
const browser=await chromium.launch({channel:'chrome',args:['--no-sandbox','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
try{
  const page=await browser.newPage({viewport:{width:1560,height:980},deviceScaleFactor:1,serviceWorkers:'block'});
  page.on('pageerror',e=>report.errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.goto('http://localhost:5173/foliage-study.html');
  await page.waitForFunction(()=>window.foliageStudy?.current,{timeout:90000});
  report.meshIssues=await page.evaluate(()=>{
    const issues=[];
    for(const [key,tiers] of Object.entries(foliageStudy.templates))for(const [tier,root] of Object.entries(tiers))root.traverse(m=>{
      if(!m.isMesh)return;
      for(const [name,attr] of Object.entries(m.geometry.attributes))if(!Array.from(attr.array).every(Number.isFinite))issues.push(`${key}/${tier}/${name}`);
      if(m.name.startsWith('crown')&&tier!=='lite'&&(!m.material.map||m.material.alphaTest<=0))issues.push(`Missing foliage cutout ${key}/${tier}`);
    });return issues;
  });
  for(const s of manifest.species){
    await page.selectOption('#species',s.key);
    for(const tier of ['hero','full','lite']){
      await page.selectOption('#tier',tier);
      await page.evaluate(async()=>{for(const v of foliageStudy.views)await v.renderer.compileAsync(v.scene,v.camera);});
      await page.waitForTimeout(300);
      report.views.push(await page.evaluate(()=>({species:foliageStudy.species,tier:foliageStudy.current,
        views:foliageStudy.views.map(v=>({design:v.design,triangles:v.triangles,webgpu:v.renderer.backend.isWebGPUBackend,drawCalls:v.renderer.info.render.drawCalls}))})));
      await page.screenshot({path:path.join(out,`fluffy-${s.key}-${tier}.png`)});
    }
    await page.selectOption('#tier','hero');
    await page.evaluate(()=>{for(const v of foliageStudy.views)v.group.rotation.y=Math.PI;});
    await page.waitForTimeout(150);await page.screenshot({path:path.join(out,`fluffy-${s.key}-rear.png`)});
    await page.click('#reset');
  }
  await page.click('#collection');await page.waitForTimeout(500);
  await page.screenshot({path:path.join(out,'fluffy-five-species.png')});
  await page.setViewportSize({width:390,height:844});
  await page.click('#collection');await page.selectOption('#species','bjork');
  report.mobileOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  await page.screenshot({path:path.join(out,'fluffy-species-mobile.png'),fullPage:true});
}finally{await browser.close();fs.writeFileSync(path.join(out,'species-validation.json'),JSON.stringify(report,null,2)+'\n');}
if(report.errors.length||report.meshIssues?.length||report.mobileOverflow)throw Error(JSON.stringify(report));
console.log(`Verified ${report.assets.length} GLBs and ${report.views.length} species/detail views; WebGPU, finite attributes, alpha textures, budgets and mobile layout.`);
