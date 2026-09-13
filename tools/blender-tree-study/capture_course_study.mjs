// Photograph the study models in an isolated browser. No course source or
// catalogue changes: the scene handle exists only in this intercepted response.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
const out=path.resolve('docs/graphics/tree-atelier-2026-09-13');
const report={studyOnly:true,method:'Temporary in-memory geometry and material replacement in a private browser',errors:[]};
const browser=await chromium.launch({channel:'chrome',args:['--no-sandbox','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
try{
  const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1,serviceWorkers:'block'});
  // Keep this one photograph stable while other work updates the dev server.
  await page.addInitScript(()=>{
    const NativeSocket=window.WebSocket;
    window.WebSocket=class extends NativeSocket{
      constructor(url,protocols){
        super(url,protocols);
        if(protocols==='vite-hmr')this.addEventListener('message',e=>{
          try{if(['update','full-reload'].includes(JSON.parse(e.data).type))e.stopImmediatePropagation();}catch{}
        },true);
      }
    };
  });
  page.on('pageerror',e=>report.errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.route('**/src/main.js*',async route=>{
    const response=await route.fetch();const code=await response.text();
    await route.fulfill({response,body:code+'\nwindow.__treePhoto={THREE,scene,camera,renderer,TREE_LOD,GHIBLI,SPECIES,uSun};\n'});
  });
  console.log('Loading Upsala hole 2.');
  await page.goto('http://localhost:5173/?bana=upsala&ghibli=1&hero=1&hal=2&vy=tee&ljus=kvall&det=1&q=hi&qualitylock=1',{waitUntil:'domcontentloaded',timeout:240000});
  await page.waitForFunction(()=>window.__treePhoto&&window.V3D?.settled(),undefined,{timeout:240000});
  console.log('Course ready; applying temporary tree study.');
  report.replacements=await page.evaluate(async()=>{
    const {THREE,scene,TREE_LOD,GHIBLI,SPECIES,uSun}=window.__treePhoto;
    const {GLTFLoader}=await import('/node_modules/.vite/deps/three_addons_loaders_GLTFLoader__js.js');
    const {makePaintedCanopyMaterial,makeBirchBarkMaterial}=await import('/src/study-canopy-material.mjs');
    const base='/models/trees/foliage-study/';const manifest=await fetch(base+'species-study.json').then(r=>r.json());
    const loader=new GLTFLoader();const templates={};
    for(const s of manifest.species){
      templates[s.key]={};
      for(const level of ['hero','full','lite']){
        const root=(await loader.loadAsync(base+s.tiers[level].file)).scene;root.updateMatrixWorld(true);
        const parts={};root.traverse(m=>{if(m.isMesh){const kind=m.name.startsWith('crown')?'crown':'trunk';parts[kind]={geometry:m.geometry.clone().applyMatrix4(m.matrixWorld),map:m.material.map};}});
        parts.height=new THREE.Box3().setFromObject(root).max.y;templates[s.key][level]=parts;
      }
    }
    TREE_LOD.frozen=true;
    V3D.setShadowUpdate(true);
    const keys=['gran','tall','bjork','al','ek'];const result=[];
    for(const rec of TREE_LOD.tiers){
      if(!rec)continue;
      const key=keys[rec.species];if(!templates[key])continue;
      const source=GHIBLI.species[rec.species].variants[rec.variant];
      const nominal=SPECIES[rec.species];const newHeight=templates[key].hero.height;
      for(let level=1;level<=3;level++){
        const tier=['hero','full','lite'][level-1];
        for(const im of rec.t[level].parts){
          const kind=im.name.includes('-crown-')?'crown':'trunk';
          const part=templates[key][tier][kind];const g=part.geometry.clone();
          const sy=source.templateHeight/newHeight;
          const sx=source.templateRadius/nominal.templateRadius*nominal.templateHeight/newHeight;
          g.scale(sx,sy,sx);g.computeBoundingSphere();im.geometry=g;
          im.material=kind==='crown'?makePaintedCanopyMaterial(manifest.species.find(s=>s.key===key).colour,tier==='lite'?null:part.map,key,uSun)
            :key==='bjork'?makeBirchBarkMaterial():new THREE.MeshStandardNodeMaterial({color:0xffffff,vertexColors:true,roughness:1});
          im.receiveShadow=kind==='trunk';
          result.push({name:im.name,instances:im.count,tier,triangles:(g.index?.count??g.attributes.position.count)/3});
        }
      }
    }
    return result;
  });
  await page.evaluate(async()=>{const {scene,camera,renderer}=window.__treePhoto;await renderer.compileAsync(scene,camera);});
  await page.waitForTimeout(1000);
  await page.evaluate(()=>V3D.prepareCapture());
  await page.screenshot({path:path.join(out,'upsala-fluffy-trees-evening.png')});
  report.camera=await page.evaluate(()=>V3D.cameraInfo());
  report.backend=await page.evaluate(()=>V3D.stats.backend);
  console.log('Evening course photograph saved.');
  await page.evaluate(()=>V3D.setPreset('noon'));
  await page.waitForTimeout(1000);
  await page.evaluate(()=>V3D.prepareCapture());
  await page.screenshot({path:path.join(out,'upsala-fluffy-trees-day.png')});
  console.log('Daylight course photograph saved.');
}finally{
  await browser.close();fs.writeFileSync(path.join(out,'course-photo-study.json'),JSON.stringify(report,null,2)+'\n');
}
if(report.errors.length)throw Error(JSON.stringify(report.errors));
