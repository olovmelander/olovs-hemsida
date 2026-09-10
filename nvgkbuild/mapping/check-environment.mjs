import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {browserArgs} from '../../tools/browser-args.mjs';
import assert from 'node:assert/strict';
import {legacyGridBridge} from '../../apps/golf/src/engine/geodetic-frame.mjs';
import {NORRFALLSVIKEN_V2_CONFIG as frame} from '../../apps/golf/src/engine/v2-norrfallsviken-config.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const arg=(key,fallback)=>process.argv.includes(key)?process.argv[process.argv.indexOf(key)+1]:fallback;
const base=arg('--url','http://127.0.0.1:8637');
const out=path.join(root,arg('--out','nvgkbuild/cache/environment-after'));
fs.mkdirSync(out,{recursive:true});
const report={errors:[],warnings:[],views:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:[...browserArgs(),...(process.argv.includes('--webgl')?['--disable-webgpu']:[])]});
try{
 const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});
 page.on('pageerror',e=>{report.errors.push(e.message);console.log('PAGE ERROR '+e.message);});
 page.on('console',m=>{if(m.type()==='error')report.warnings.push(m.text().slice(0,300));if(m.text().includes('water'))console.log(m.text().slice(0,500));});
 console.log('Loading '+base);
 await page.goto(`${base}/?bana=norrfallsviken&hal=12&vy=tee&ljus=kvall&v2=require${process.argv.includes('--webgl')?'&gl=1':''}`,{waitUntil:'load',timeout:60000});
 await page.waitForSelector('#boot.done',{timeout:180000});
 console.log('Boot complete');
 report.boot=await page.evaluate(()=>({stats:V3D.stats,seaLevel:V3D.GEO.seaLevel,water:V3D.M.water.map(w=>({level:w.level,isSea:w.isSea,ring:w.ring})),sheets:V3D.waterSheets(),coastal:V3D.coastalWater(),flat:V3D.flatWater(),v2:V3D.v2Terrain()}));
 report.probes=await page.evaluate(()=>[[2500,-1500],[2800,-1500],[4000,-2000],[-1500,-2000],[300,0],[1000,0],[6000,0]].map(([x,z])=>({x,z,...V3D.probeGround(x,z)})));
 const sourceReview=JSON.parse(fs.readFileSync(path.join(root,'geo_data/course-v2/norrfallsviken/reference/lm-marine-water-2026-09-09.json'),'utf8'));
 const bridge=legacyGridBridge(frame.legacyFrame);
 const islands=sourceReview.islandProbes.map(p=>({...p,local:bridge.toLegacy(p.easting-frame.legacyOriginEpsg3006.easting,frame.legacyOriginEpsg3006.northing-p.northing)}));
 report.islandProbes=await page.evaluate(points=>points.map(p=>({...p,ground:V3D.probeGround(...p.local)})),islands);
 assert.equal(report.boot.coastal?.kind,'continuous-ocean');
 assert.equal(report.boot.coastal.geometry,'source-ocean','Verified LM geometry must be active');
 assert.equal(report.boot.coastal.polygonOffset,false,'The ocean must not bias its depth through land');
 assert.equal(report.boot.coastal.transparent,false,'Deep water must not blend with different terrain colours');
 assert.equal(report.boot.coastal.vistaTreesOnSea,0,'No distant forest may grow on ocean coverage');
 for(const p of report.islandProbes){assert.equal(p.ground.ocean,false,'Mapped island must stay dry');assert.equal(p.ground.island,true,'Mapped island must retain source membership');}
 assert.equal(report.boot.sheets.filter(s=>s.name==='norrfallsviken-continuous-ocean').length,1);
 assert.equal(report.boot.stats.backend,process.argv.includes('--webgl')?'webgl2':'webgpu');
 for(const p of report.probes)assert.equal(p.ocean,p.x!==300,`Unexpected ocean coverage at ${p.x},${p.z}`);
 assert(report.boot.water.filter(w=>!w.isSea).every(w=>w.level>report.boot.coastal.seaWorldLevel+5),'Inland ponds retain independent levels');
 assert(report.boot.flat.components.every(c=>c.level>report.boot.coastal.seaWorldLevel+5),'No residual ocean component may become a second shoreline sheet');
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
 for(const lighting of ['golden','noon'])for(const [id,p,l] of [
  ['north-coast',[2100,1150,2300],[0,30,-1300]],
  ['offshore',[100,1800,3400],[1700,20,-2500]],
  ['cape',[2500,1050,-2100],[-200,40,400]],
  ['shore',[520,100,-250],[1200,20,-550]],
  ['storsanden',[450,260,-1400],[-230,25,-770]],
  ['harbour',[-1350,220,1700],[-500,22,1100]],
  ['pond-14',[300,155,-550],[160,33,-280]],
 ]) {
  await page.evaluate(lighting=>V3D.setPreset(lighting),lighting);
  await page.evaluate(({p,l})=>V3D.setView(...p,...l),{p,l});
  await page.waitForFunction(()=>V3D.settled(),null,{timeout:20000});
  await page.waitForTimeout(2000);
  await page.screenshot({path:path.join(out,`${id}-${lighting}.png`)});
  report.views.push({id,lighting,camera:await page.evaluate(()=>V3D.camExact()),depth:await page.evaluate(()=>V3D.cameraInfo())});
  console.log('Captured '+id+' '+lighting);
 }
}catch(e){report.errors.push(e.stack);console.log(e.stack);}finally{await browser.close();}
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({errors:report.errors,views:report.views.length,backend:report.boot?.stats?.backend,
 ocean:report.boot?.coastal?.geometry,triangles:report.boot?.coastal?.triangles,mappedIslands:report.boot?.coastal?.sourceIslands,
 vistaTreesOnSea:report.boot?.coastal?.vistaTreesOnSea},null,2));
if(report.errors.length)process.exitCode=1;
