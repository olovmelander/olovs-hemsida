#!/usr/bin/env node
/* Two-surface depth regression using the production terrain mask and depth policy.
   Software correctness only; this does not measure phone performance. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { build } from '../apps/golf/node_modules/vite/dist/node/index.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const args=Object.fromEntries(Array.from({length:(process.argv.length-2)/2},(_,i)=>[process.argv[2+i*2].replace(/^--/,''),process.argv[3+i*2]]));
const backend=args.backend||'webgl2';
if(!args.out||!['webgl2','webgpu'].includes(backend))throw Error('--out DIR --backend webgl2|webgpu [--chrome PATH]');
const out=path.resolve(args.out);fs.mkdirSync(out,{recursive:true});
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'banvy-coastal-depth-'));
const modulePath=path.join(root,'apps/golf/src/engine/coastal-terrain-mask.mjs');
const policyPath=path.join(root,'apps/golf/src/engine/water-render-policy.mjs');
fs.writeFileSync(path.join(tmp,'index.html'),'<html><body style="margin:0"><script type="module" src="/proof.mjs"></script></body></html>');
fs.writeFileSync(path.join(tmp,'proof.mjs'),`
import * as THREE from 'three/webgpu';
import {positionWorld} from 'three/tsl';
import {createCoastalTerrainMask} from ${JSON.stringify(modulePath)};
import {configureWaterDepth,configureWaterRenderPasses} from ${JSON.stringify(policyPath)};
const renderer=new THREE.WebGPURenderer({forceWebGL:${backend==='webgl2'},antialias:true,samples:4,reversedDepthBuffer:true});
await renderer.init();renderer.setPixelRatio(1);renderer.setSize(480,320);document.body.appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color(0xcccccc);
const camera=new THREE.PerspectiveCamera(48,1.5,105,14000);camera.position.set(1500,1600,-1900);camera.lookAt(-500,5,300);
const red=()=>new THREE.MeshBasicNodeMaterial({color:0xcc1100});
const native=red(),masked=red();
const coverage=new Uint8Array(512*512).fill(1);
for(let row=240;row<248;row++)for(let col=224;col<232;col++)coverage[row*512+col]=0;
const mask=createCoastalTerrainMask({terrainCoverage:coverage,width:512,height:512,spacing:32,bounds:{x0:-8192,z0:-8192},maximumCoveredTerrainHeight:.28});
mask.apply(masked);
const bed=new THREE.Mesh(new THREE.PlaneGeometry(16384,16384,256,256).rotateX(-Math.PI/2),native);bed.position.y=.14;scene.add(bed);
const seaMaterial=configureWaterRenderPasses(configureWaterDepth(new THREE.MeshBasicNodeMaterial({color:0x0055ee,transparent:true,side:THREE.DoubleSide}),{measuredOnly:true,depthSign:renderer.reversedDepthBuffer?1:-1}));
seaMaterial.maskNode=positionWorld.x.lessThan(-1024).or(positionWorld.x.greaterThan(-768)).or(positionWorld.z.lessThan(-512)).or(positionWorld.z.greaterThan(-256));
const sea=new THREE.Mesh(new THREE.PlaneGeometry(16384,16384,1,512).rotateX(-Math.PI/2),seaMaterial);sea.position.y=.19;scene.add(sea);
const island=new THREE.Mesh(new THREE.BoxGeometry(260,30,260),masked);island.position.set(-500,15,300);scene.add(island);
const lowIsland=new THREE.Mesh(new THREE.PlaneGeometry(256,256).rotateX(-Math.PI/2),masked);lowIsland.position.set(-896,.20,-384);scene.add(lowIsland);
const copy=document.createElement('canvas');copy.width=480;copy.height=320;const ctx=copy.getContext('2d',{willReadFrequently:true});
const isRed=(p,i)=>p[i]>120&&p[i+1]<80&&p[i+2]<80;
let islandPixels=null,shorePixels=null;
window.P={render:({mode,low=false})=>{
 camera.position.set(...(low?[500,180,-1400]:[1500,1600,-1900]));camera.lookAt(-500,5,300);camera.near=${backend==='webgpu'?'1':'low?7.2:105'};camera.updateProjectionMatrix();
 bed.visible=sea.visible=!mode.endsWith('island');island.visible=mode!=='low-island';bed.material=mode==='masked'?masked:native;
 renderer.render(scene,camera);ctx.drawImage(renderer.domElement,0,0);const p=ctx.getImageData(0,0,480,320).data;
 if(mode.endsWith('island')){
  islandPixels=Uint8Array.from({length:480*320},(_,k)=>isRed(p,k*4)?1:0);shorePixels=islandPixels.slice();
  // The sheet hole and the raised low island have different projected edges.
  // Exclude only their two-pixel rasterized boundary from open-sea leak counts.
  for(let y=0;y<320;y++)for(let x=0;x<480;x++)if(islandPixels[y*480+x])for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const a=x+dx,b=y+dy;if(a>=0&&a<480&&b>=0&&b<320)shorePixels[b*480+a]=1;}
 }
 let seaLeaks=0,landPixels=0,waterPixels=0;
 for(let k=0;k<480*320;k++){const i=k*4;if(isRed(p,i)){if(islandPixels[k])landPixels++;else if(!shorePixels[k])seaLeaks++;}if(p[i+2]>180&&p[i]<50)waterPixels++;}
 return {mode,low,seaLeaks,landPixels,waterPixels,near:camera.near,reversedDepth:camera.reversedDepth};
},backend:renderer.backend.isWebGPUBackend?'webgpu':'webgl2'};
document.body.dataset.ready='1';
`);
const three=path.join(root,'apps/golf/node_modules/three/build');
await build({configFile:false,root:tmp,base:'./',logLevel:'error',resolve:{alias:[
 {find:'three/webgpu',replacement:path.join(three,'three.webgpu.js')},{find:'three/tsl',replacement:path.join(three,'three.tsl.js')},
 {find:'three',replacement:path.join(three,'three.module.js')} ]},build:{outDir:path.join(tmp,'dist'),emptyOutDir:true}});
const dist=path.join(tmp,'dist');
const server=http.createServer((req,res)=>{const p=path.resolve(dist,'.'+decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!p.startsWith(dist+path.sep)||!fs.existsSync(p)){res.writeHead(404).end();return;}res.setHeader('Content-Type',p.endsWith('.html')?'text/html':'text/javascript');fs.createReadStream(p).pipe(res);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;const report={backend,executionAdapter:'swiftshader-software',performanceEvidence:false,errors:[],views:[],passed:false};
try{
 const flags=['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader'];
 if(backend==='webgpu')flags.push('--enable-unsafe-webgpu','--enable-webgpu-developer-features','--enable-experimental-web-platform-features','--use-gpu-in-tests','--enable-features=UseSkiaRenderer,Vulkan','--use-vulkan=swiftshader','--use-webgpu-adapter=swiftshader','--disable-vulkan-surface');
 browser=await chromium.launch({executablePath:args.chrome,headless:true,args:flags});
 const page=await browser.newPage({viewport:{width:480,height:320}});
 page.on('pageerror',e=>report.errors.push(String(e)));
 page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('body[data-ready="1"]',{timeout:120000});
 if(await page.evaluate(()=>P.backend)!==backend)throw Error('Unexpected backend');
 for(const low of [false,true]){
  const lowControl=await page.evaluate(o=>P.render(o),{mode:'low-island',low});
  if(lowControl.landPixels<20)throw Error('Low dry island was clipped: check mask UV orientation');
  const control=await page.evaluate(o=>P.render(o),{mode:'island',low});
  if(control.landPixels<20)throw Error('Dry-land control not visible');
  for(const mode of ['native','masked']){
   const result=await page.evaluate(o=>P.render(o),{mode,low});
   const file=(low?'low':'overview')+'-'+mode+'.png';await page.screenshot({path:path.join(out,file)});
   report.views.push({...result,file,controlLandPixels:control.landPixels,lowDryControlPixels:lowControl.landPixels,shoreBoundaryPixelsExcluded:2});
   console.log(backend,result);
   if(mode==='masked'&&(result.seaLeaks>8||result.landPixels<control.landPixels*.98||result.waterPixels<20000))throw Error('Sea visibility or dry-land occlusion failed');
  }
 }
 if(backend==='webgl2'&&!report.views.some(v=>v.mode==='native'&&v.seaLeaks>100))throw Error('Negative control did not reproduce the reported depth breakup');
 report.passed=report.errors.length===0;
}catch(e){report.errors.push(String(e));}
finally{await browser?.close();await new Promise(r=>{server.closeAllConnections();server.close(r);});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
console.log(report.passed?'PASS':'FAIL');if(!report.passed)process.exitCode=1;
