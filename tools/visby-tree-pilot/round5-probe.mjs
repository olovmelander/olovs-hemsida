// Read the frozen second preview at known absent records and new candidates.
import path from 'node:path';
import {chromium} from 'playwright-core';
import {OUT,ROOT,serve,json,save} from './round5-preview.mjs';
const work=path.join(OUT,'round5');
const baseline=json(path.join(OUT,'baseline.json'));
const absent=json(path.join(ROOT,'geo_data/course-v2/visby/vegetation/pilot/coverage-audit/coverage.json')).suppressedRegistryRecords;
const candidates=json(path.join(work,'placement-candidates.geojson')).features.map(f=>({...f.properties,geometry:f.geometry}));
const {server,url}=await serve('round4');
const browser=await chromium.launch({channel:'chrome',args:['--no-sandbox','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900},serviceWorkers:'block'});
 await page.goto(url+'/?bana=visby&v2=require&det=1&qualitylock=1&ghibli=1&ljus=dag&q=hi',{waitUntil:'domcontentloaded',timeout:120000});
 await page.waitForFunction(()=>window.V3D?.settled()&&document.querySelector('#boot')?.classList.contains('done'),null,{timeout:240000});
 const result=await page.evaluate(({points,origin})=>({
   backend:V3D.stats.backend,vegetation:V3D.v2Objects(),
   probes:points.map(p=>{const x=p.easting-origin.easting,z=origin.northing-p.northing;
     return {id:p.id,scene:p.scene,reviewNumber:p.reviewNumber,easting:p.easting,northing:p.northing,
       analytic:V3D.classifyAnalytic(x,z),atlas:V3D.groundSample(x,z),v2Surface:V3D.v2SurfaceProbe?.(x,z),height:V3D.terrainH(x,z)};
   })
 }),{points:[...absent,...candidates],origin:baseline.ground.frame.origin});
 save(path.join(work,'runtime-probes.json'),result);
 console.log(JSON.stringify(result.probes.slice(0,8),null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
