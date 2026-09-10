/* Validate the loaded course, then capture the corrected surfaces and facilities. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { browserArgs } from '../../tools/browser-args.mjs';
import { withInferredTeePads } from '../../apps/golf/src/engine/tee-pads.mjs';
import { reviewedTeeMarkerPositions } from '../../apps/golf/src/engine/reviewed-tee-marker-placement.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const out=path.join(root,'nvgkbuild/cache/lm-browser');fs.mkdirSync(out,{recursive:true});
const model=JSON.parse(fs.readFileSync(path.join(root,'nvgkbuild/course-model.json'),'utf8'));
const expected=withInferredTeePads(model.holes);
const base=process.argv[2]||'http://127.0.0.1:8637';
const report={errors:[],warnings:[],shots:[],checks:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:browserArgs()});
try {
  const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',m=>{if(['warning','error'].includes(m.type())&&report.warnings.length<20)report.warnings.push(m.text().slice(0,500));});
  await page.goto(`${base}/?bana=norrfallsviken&v2=require&det=1&hal=1&vy=over&ljus=dag`,{waitUntil:'load',timeout:60000});
  await page.waitForSelector('#boot.done',{timeout:180000});
  const live=await page.evaluate(()=>({holes:V3D.HOLES,stats:V3D.stats,v2:V3D.v2Terrain(),markers:V3D.sceneInventory().filter(m=>m.tag==='markers')}));
  report.stats=live.stats;report.v2=live.v2;
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const check=(name,pass)=>report.checks.push({name,pass});
  check('all reviewed green rings survive runtime unchanged',expected.every(h=>same(h.green.ring,live.holes.find(q=>q.n===h.n).green.ring)));
  check('all physical tee platforms survive runtime unchanged',expected.every(h=>same(h.tees.pads.map(p=>p.ring),live.holes.find(q=>q.n===h.n).tees.pads.map(p=>p.ring))));
  check('all runtime tee references match expected display anchors',expected.every(h=>same(h.tees.marks.map(m=>m.c),live.holes.find(q=>q.n===h.n).tees.marks.map(m=>m.c))));
  check('measured clubhouse roof assembly rendered',live.stats.facilities?.status==='loaded'
    && live.stats.facilities.replacedBuildingIds.includes('w1205924894')
    && live.stats.facilities.facilities.some(f=>f.id==='clubhouse-main-roof-native'));
  check('twelve reviewed range mats rendered',live.stats.courtyardDetails?.counts?.range_mat===12);
  check('invented range targets omitted',live.stats.inferredRangeTargets===0);
  const markerCount=expected.reduce((n,h)=>n+h.tees.marks.reduce((m,t)=>m+reviewedTeeMarkerPositions(h,t).length,0),0);
  report.expectedMarkerCount=markerCount;report.actualMarkerCount=live.markers.reduce((n,m)=>n+(m.instances||0),0);
  check('rendered marker count agrees with reviewed placement policy',markerCount===report.actualMarkerCount);
  check('v2 terrain ready',live.v2.adapter?.phase==='ready');
  for(const [id,hole,mode] of [['hole-01',1,'over'],['shared-green-04',4,'green'],['shared-green-08',8,'green'],['hole-14',14,'over'],['tee-16',16,'tee']]) {
    await page.evaluate(({hole,mode})=>{V3D.goHole(hole,true,true);V3D.setCam(mode,true);},{hole,mode});
    await page.waitForFunction(()=>V3D.settled(),null,{timeout:20000});
    await page.waitForTimeout(1200);
    await page.screenshot({path:path.join(out,`${id}.png`)});report.shots.push(id);
  }
  for(const [id,x,z,dx,dz,height] of [['clubhouse',-391,134,-34,46,28],['range',-320,225,-100,80,130],['beach',-385,-445,70,60,130]]) {
    await page.evaluate(({x,z,dx,dz,height})=>{const y=V3D.terrainH(x,z);V3D.setView(x+dx,y+height,z+dz,x,y+2,z);},{x,z,dx,dz,height});
    await page.waitForTimeout(1800);await page.screenshot({path:path.join(out,`${id}.png`)});report.shots.push(id);
  }
  check('no browser errors',report.errors.length===0);
}catch(e){report.errors.push(e.stack);}finally{await browser.close();}
report.pass=report.errors.length===0&&report.checks.every(c=>c.pass);
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({pass:report.pass,checks:report.checks,errors:report.errors,warnings:report.warnings,shots:report.shots},null,2));
if(!report.pass)process.exitCode=1;
