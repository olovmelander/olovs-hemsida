import path from 'node:path';
import {chromium} from 'playwright-core';
import {OUT,SLUGS,json,save,serve} from './preview.mjs';
import {VECKEFJARDEN_V2_CONFIG as config} from '../../apps/golf/src/engine/v2-veckefjarden-config.mjs';
import {legacyGridBridge} from '../../apps/golf/src/engine/geodetic-frame.mjs';
const transform=legacyGridBridge(config.legacyFrame),origin=config.legacyOriginEpsg3006;
const points=json(path.join(OUT,'probe-points.json')).map(p=>{const [x,z]=transform.toLegacy(p.easting-origin.easting,origin.northing-p.northing);return {...p,x,z};});
const {server,url}=await serve('before');
const browser=await chromium.launch({channel:'chrome',args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
const runs=[];
try{for(const slug of SLUGS){
 const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'}),page=await context.newPage();
 await page.goto(`${url}/?bana=${slug}&v2=require&det=1&qualitylock=1&ghibli=1&ljus=dag&q=hi`,{waitUntil:'domcontentloaded',timeout:120000});
 await page.waitForFunction(()=>window.V3D?.settled()&&document.querySelector('#boot')?.classList.contains('done'),null,{timeout:240000});
 const result=await page.evaluate(points=>({terrain:V3D.v2Terrain(),mown:V3D.mownSurface(),rows:points.map(p=>{
  const a=V3D.classifyAnalytic(p.x,p.z),atlas=V3D.groundSample(p.x,p.z);
  return {...p,analytic:a,atlas,height:V3D.terrainH(p.x,p.z),blocked:a.fair>.05||a.green>.02||a.tee>.02||a.sand>.05||a.path>.15||a.water>.02};
 })}),points);
 runs.push({slug,...result});save(path.join(OUT,'runtime-probes.json'),runs);console.log(slug,'blocked',result.rows.filter(r=>r.blocked).length,'of',points.length);await context.close();
}}finally{await browser.close();await new Promise(r=>server.close(r));}
