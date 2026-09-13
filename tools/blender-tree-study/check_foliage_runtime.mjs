// Validate the production catalogue in the actual app, without replacing trees.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const out=path.resolve('docs/graphics/tree-atelier-2026-09-13');
const report={production:true,errors:[],scenarios:[]};
const browser=await chromium.launch({channel:'chrome',args:['--no-sandbox','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
const scenario=process.argv[2]||'upsala';
try{
  const low=scenario==='low',natural=scenario==='natural';
  const page=await browser.newPage({viewport:low?{width:390,height:844}:{width:1920,height:1080},deviceScaleFactor:1,serviceWorkers:'block'});
  await page.addInitScript(()=>{
    const NativeSocket=window.WebSocket;
    window.WebSocket=class extends NativeSocket{constructor(url,protocols){super(url,protocols);if(protocols==='vite-hmr')this.addEventListener('message',e=>{try{if(['update','full-reload'].includes(JSON.parse(e.data).type))e.stopImmediatePropagation();}catch{}},true);}};
  });
  const requests=[];
  page.on('request',r=>{if(r.url().includes('/models/trees/'))requests.push(new URL(r.url()).pathname);});
  page.on('pageerror',e=>report.errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error'||/ghibli trees unavailable/i.test(m.text()))report.errors.push(m.text());});
  const course=['puttom','ribbingsfors','angso'].includes(scenario)?scenario:'upsala';
  const url=`http://localhost:5173/?bana=${course}&ghibli=${natural?0:1}&hal=${course==='puttom'?1:2}&vy=${course==='puttom'?'fritt':'tee'}&ljus=kvall&det=1&q=${low?'lo':'hi'}&qualitylock=1${low?'&hero=0':''}`;
  console.log(`Loading production ${scenario}.`);
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:240000});
  await page.waitForFunction(()=>window.V3D?.settled(),undefined,{timeout:240000});
  console.log('Course ready.');
  const record={scenario,url,requests,backend:await page.evaluate(()=>V3D.stats.backend)};
  report.scenarios.push(record);
  record.inventory=await page.evaluate(()=>{
    const result=[];V3D.harness().scene.traverse(m=>{
      if(m.isMesh&&(/^(trees-|vista-)/.test(m.name)))result.push({name:m.name,key:m.material.userData.foliageKey||null,instances:m.isInstancedMesh?m.count:m.geometry.instanceCount,triangles:(m.geometry.index?.count??m.geometry.attributes.position.count)/3,map:!!m.material.map,uv:!!m.geometry.attributes.uv,tint:!!m.geometry.attributes.aTint,wind:!!m.material.positionNode,fade:!!m.geometry.attributes.aFade});
    });return result;
  });
  record.triangles=await page.evaluate(()=>V3D.treeTriangles());
  record.quality=await page.evaluate(()=>V3D.quality());
  record.vistaSpecies=await page.evaluate(()=>V3D.stats.vistaSpecies);
  const crowns=record.inventory.filter(m=>m.name.includes('-crown-'));
  const impostors=record.inventory.filter(m=>m.name.includes('-impostor'));
  assert(crowns.length&&impostors.length,'Expected tree meshes and impostors');
  if(natural){
    assert(!requests.some(u=>u.includes('ghibli-fluffy')),'Natural mode must not load painted trees');
    assert([...crowns,...impostors].every(m=>!m.key));
  }else{
    assert(requests.some(u=>u.endsWith('ghibli-fluffy.json')));
    assert(!requests.some(u=>/foliage-study|ghibli-v1/.test(u)));
    assert([...crowns,...impostors].every(m=>m.key&&m.tint),'Every ring must use painted foliage and instance tint');
    assert(crowns.every(m=>m.name.includes('-t2')?!m.map:m.map&&m.uv),'Detailed crowns need foliage textures; lite crowns do not');
    record.atlases=[];
    for(let s=0;s<5;s++){
      const summary=await page.evaluate(async s=>{
        const a=await V3D.treeAtlas(s),n=await V3D.treeAtlas(s,'normal');
        const covered=a.data.filter((_,i)=>i%4===3&&a.data[i]>.5).length;
        const leaves=n.data.filter((_,i)=>i%4===3&&n.data[i]>.5).length;
        return{species:s,covered,leaves,finite:[...a.data,...n.data].every(Number.isFinite),frameSize:a.frameSize,height:a.height,radius:a.radius};
      },s);
      assert(summary.finite&&summary.leaves>30&&summary.covered>=summary.leaves);record.atlases.push(summary);
    }
  }
  record.automatic=await page.evaluate(()=>({tiers:V3D.treeTiers(),audit:V3D.treeTierAudit(),renderer:V3D.rendererInfo()}));
  assert(record.automatic.audit.ok);
  await page.evaluate(()=>V3D.prepareCapture());
  await page.screenshot({path:path.join(out,`production-${scenario}-evening.png`)});
  if(scenario==='puttom'){
    await page.evaluate(()=>V3D.setPreset('noon'));
    await page.waitForTimeout(500);
    await page.evaluate(()=>V3D.prepareCapture());
    await page.screenshot({path:path.join(out,'production-puttom-noon.png')});
  }
  if(scenario==='upsala'){
    record.tiers=[];
    for(const tier of [1,2,3,4]){
      await page.evaluate(tier=>{V3D.setTreeLod(tier);V3D.setTreeLodPx({reset:true});},tier);
      await page.waitForTimeout(500);
      await page.waitForFunction(()=>V3D.settled(),undefined,{timeout:90000});
      const state=await page.evaluate(()=>({tiers:V3D.treeTiers(),audit:V3D.treeTierAudit()}));
      assert(state.audit.ok);record.tiers.push({tier,...state});
      await page.evaluate(()=>V3D.prepareCapture());
      await page.screenshot({path:path.join(out,`production-tier-${tier}.png`)});
      console.log(`Tier ${tier} rendered; audit passed.`);
    }
    // Hold a real mesh -> impostor transition halfway through, then finish it.
    // Verify both CPU slot ownership and matching per-tree tint/season values.
    await page.evaluate(()=>{V3D.driveTreeFadeClock(true);V3D.setTreeFadeClock(100);V3D.setTreeFade(.4);V3D.setTreeLod(2);});
    await page.waitForTimeout(500);
    await page.evaluate(()=>V3D.setTreeFadeClock(101));
    await page.waitForTimeout(300);
    await page.evaluate(()=>{V3D.setTreeFadeClock(102);V3D.setTreeLod(4);});
    await page.waitForTimeout(300);
    await page.evaluate(()=>V3D.setTreeFadeClock(102.2));
    await page.waitForTimeout(300);
    record.midFade=await page.evaluate(()=>{
      const tinted=[];V3D.harness().scene.traverse(m=>{if(m.name.startsWith('trees-')&&m.geometry?.attributes.aTint){const a=m.geometry.attributes.aTint;const count=m.isInstancedMesh?m.count:m.geometry.instanceCount;if(count)tinted.push({name:m.name,count,values:Array.from(a.array.slice(0,count*4)),version:a.version});}});
      return {audit:V3D.treeTierAudit(),tiers:V3D.treeTiers(),tints:tinted.map(m=>({name:m.name,count:m.count,version:m.version,valid:m.values.every(Number.isFinite)&&m.values.every((v,i)=>i%4===3?v>=0&&v<=1:v>.7&&v<1.3)}))};
    });
    assert(record.midFade.audit.ok&&record.midFade.tiers.fading>0);
    assert(record.midFade.tints.every(m=>m.valid&&m.version>0));
    await page.evaluate(()=>V3D.prepareCapture());
    await page.screenshot({path:path.join(out,'production-mid-fade.png')});
    await page.evaluate(()=>V3D.setTreeFadeClock(103));
    await page.waitForTimeout(300);
    record.completedFade=await page.evaluate(()=>({tiers:V3D.treeTiers(),audit:V3D.treeTierAudit()}));
    assert(record.completedFade.audit.ok&&record.completedFade.tiers.fading===0);
    await page.evaluate(()=>{V3D.setTreeFade(0);V3D.driveTreeFadeClock(false);});
    await page.evaluate(()=>{V3D.setTreeLod(0);V3D.setTreeLodPx({reset:true});});
    for(const preset of ['noon','host','bluehour']){
      await page.evaluate(preset=>V3D.setPreset(preset),preset);
      await page.waitForTimeout(500);
      await page.evaluate(()=>V3D.prepareCapture());
      await page.screenshot({path:path.join(out,`production-upsala-${preset}.png`)});
      console.log(`${preset} rendered.`);
    }
  }
  assert.equal(report.errors.length,0,JSON.stringify(report.errors));
  console.log(`Production ${scenario} passed.`);
}catch(e){report.failure=String(e);throw e;}
finally{await browser.close();fs.writeFileSync(path.join(out,`production-${scenario}-validation.json`),JSON.stringify(report,null,2)+'\n');}
