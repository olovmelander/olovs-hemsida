// Isolated, reproducible Visby baseline and pilot. No production roots are written.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readChunk} from '../../packages/course-v2/chunk-node.mjs';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const OUT = path.join(ROOT, 'output/visby-tree-pilot');
export const PUBLIC = path.join(ROOT, 'apps/golf/public');
export const sha = b => createHash('sha256').update(b).digest('hex');
export const json = p => JSON.parse(fs.readFileSync(p, 'utf8'));
export function save(p, value) { fs.mkdirSync(path.dirname(p), {recursive:true}); fs.writeFileSync(p, JSON.stringify(value,null,2)+'\n'); }


const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json',
  '.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.geojson':'application/geo+json'};
export async function serve(mode='round4',port=0) {
  if(!['before','after','round2','round3','round4'].includes(mode)) throw Error('Expected before, after, round2 or round3');
  const roots=[path.join(OUT,/^round[234]$/.test(mode)?`${mode}/after`:mode),path.join(OUT,'build'),path.join(OUT,'before'),PUBLIC];
  const server=http.createServer((req,res)=>{
    let relative;try {relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1)||'index.html';}catch{res.writeHead(400);res.end();return;}
    const candidates=relative.startsWith('pilot-review/') ? [{root:OUT,relative:relative.slice(13)}] : roots.map(root=>({root,relative}));
    const file=candidates.map(({root,relative})=>({root,file:path.resolve(root,relative)}))
      .find(({root,file})=>file.startsWith(root+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())?.file;
    if(!file){res.writeHead(404);res.end('not found');return;}
    res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','content-length':fs.statSync(file).size,'cache-control':'no-store'});
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  return {server,url:`http://127.0.0.1:${server.address().port}`};
}

export async function capture(mode='round4',quick=false,onlyScenario) {
  const {chromium}=await import('playwright-core');
  const {server,url}=await serve(mode);
  const browser=await chromium.launch({channel:'chrome',args:['--no-sandbox','--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
  const directory=/^round[234]$/.test(mode)?path.join(OUT,mode,'captures'):path.join(OUT,'captures',mode);fs.mkdirSync(directory,{recursive:true});
  const scenarios=['webgpu-high','webgl-high','webgl-low'];
  if(onlyScenario&&!scenarios.includes(onlyScenario))throw Error('Unknown scenario');
  const runs=onlyScenario?json(path.join(directory,'report.json')).runs.filter(r=>r.scenario!==onlyScenario):[];
  try {
    for(const scenario of [{name:'webgpu-high',query:'&q=hi'}, {name:'webgl-high',query:'&gl=1&q=hi'}, {name:'webgl-low',query:'&gl=1&q=lo'}].filter(s=>!onlyScenario||s.name===onlyScenario)) {
      const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,serviceWorkers:'block'});
      const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
      const start=Date.now();
      await page.goto(url+'/?bana=visby&v2=require&det=1&qualitylock=1&ghibli=1&ljus=dag'+scenario.query,{waitUntil:'domcontentloaded',timeout:120000});
      await page.waitForFunction(()=>window.V3D?.settled()&&document.querySelector('#boot')?.classList.contains('done'),null,{timeout:240000});
      const state=await page.evaluate(()=>({trees:V3D.legacyTrees({instances:true}),objects:V3D.v2Objects(),stats:V3D.stats,quality:V3D.quality(),catalogue:V3D.treeCatalogue(),perf:V3D.perf(),audit:V3D.treeTierAudit()}));
      const run={scenario:scenario.name,bootMs:Date.now()-start,errors,state,views:[]};
      save(path.join(directory,scenario.name+'-instances.json'),state.trees);delete state.trees.instances;
      if(errors.length||!state.audit.ok||state.objects.error||!state.objects.loaded)throw Error(JSON.stringify({errors,audit:state.audit,objects:state.objects}));
      const holes=scenario.name==='webgpu-high'&&!quick?Array.from({length:18},(_,i)=>i+1):[9,16];
      for(const hole of holes)for(const cam of (scenario.name==='webgpu-high'?['tee','top']:['tee'])) {
        await page.evaluate(({hole,cam})=>{V3D.setPreset('noon');V3D.goHole(hole,true,true);V3D.setCam(cam,true);},{hole,cam});
        await page.waitForFunction(()=>V3D.settled(),null,{timeout:60000});await page.waitForTimeout(350);
        const name=`${scenario.name}-h${String(hole).padStart(2,'0')}-${cam}.png`;
        await page.screenshot({path:path.join(directory,name),animations:'disabled'});
        const timing=await page.evaluate(()=>new Promise(resolve=>{
          const deltas=[];let prev;function frame(t){if(prev!==undefined)deltas.push(t-prev);prev=t;if(deltas.length<90)requestAnimationFrame(frame);else{deltas.sort((a,b)=>a-b);resolve({medianMs:deltas[45],p95Ms:deltas[85],camera:V3D.camInfo(),audit:V3D.treeTierAudit()});}}requestAnimationFrame(frame);
        }));
        run.views.push({hole,cam,file:name,sha256:sha(fs.readFileSync(path.join(directory,name))),...timing});
        console.log(mode,scenario.name,hole,cam,Math.round(timing.medianMs*10)/10+' ms');
      }
      runs.push(run);runs.sort((a,b)=>scenarios.indexOf(a.scenario)-scenarios.indexOf(b.scenario));save(path.join(directory,'report.json'),{mode,runs});await context.close();
    }
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
  return runs;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [command,mode='round4',port]=process.argv.slice(2);
  if(command==='serve'){const result=await serve(mode,Number(port)||8648);console.log(result.url+'/?bana=visby&v2=require');}
  else if(command==='capture')await capture(mode,process.argv.includes('--quick'),process.argv.includes('--scenario')?process.argv[process.argv.indexOf('--scenario')+1]:undefined);
  else throw Error('Usage: round4-preview.mjs serve round3|round4 [port] | capture round4 [--quick]');
}
