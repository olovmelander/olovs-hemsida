/* Real shader/geometry smoke, including the v2 decorator and layered terrain.
   node tools/check-golf-cups.mjs [--webgpu] [--out=tools/goldens/cups]
   --app also visits Ängsö's atlas and legacy overlay renderers.
   BANVY_CHROME selects a browser executable. Software timings are not benchmarks. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from '../apps/golf/node_modules/vite/dist/node/index.js';
import { browserArgs } from './browser-args.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url)), APP = path.join(ROOT, 'apps/golf');
const webgpu = process.argv.includes('--webgpu');
const out = path.resolve(ROOT, process.argv.find(a => a.startsWith('--out='))?.slice(6) || 'tools/goldens/cups');
const entry = path.join(APP, 'src/__cup-review.mjs');
const fixture = `
import * as THREE from 'three/webgpu';
import { CUP, createGolfCupMask, createGolfCupGeometry } from './engine/golf-cups.mjs';
import { FLAG_POLE_PROFILE } from './engine/flag-appearance.mjs';
import { createV2GroundMaterialDecorator } from './engine/material.js';
import { SURFACE } from './engine/surface.js';
const renderer = new THREE.WebGPURenderer({ antialias:true, forceWebGL:${!webgpu} });
renderer.setSize(1200,800); renderer.setPixelRatio(1); await renderer.init(); document.body.append(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#cad6bb');
scene.add(new THREE.HemisphereLight('#e5eeff','#50583b',1.8));
const sun = new THREE.DirectionalLight('#fff2d6',2.3); sun.position.set(3,6,4); scene.add(sun);
const camera = new THREE.PerspectiveCamera(35,1.5,.01,20);
const x = 256, z = -128, y = 12, heightAt = (px,pz) => y+(px-x)*.06-(pz-z)*.04;
const mask = createGolfCupMask([[x,z],[x+16,z+16]]);
const tex = bytes => { const t = new THREE.DataTexture(new Uint8Array(bytes),1,1); t.needsUpdate=true; return t; };
const DETAIL = tex([126,130,128,255]); DETAIL.wrapS = DETAIL.wrapT = THREE.RepeatWrapping;
const C = Object.fromEntries(['rough','forest','heath','semi','fair','fringe','green','tee','sand','path','aspL','hard','soil','wet','rock','shore']
  .map(name=>[name,[.3,.46,.2]]));
const atlas = { bounds:{x0:x-2,z0:z-2,x1:x+2,z1:z+2,w:1,h:1,res:4},
  texID:tex([SURFACE.GREEN,SURFACE.GREEN,0,255]),texF:tex([128,0,0,0]),data:{representation:'pair-sdf-v1'} };
const decorate = mask.wrap(createV2GroundMaterialDecorator({atlas,DETAIL,C,SHADE:Array.from({length:32},()=>[1.5,.1,.2,.6])}));
const material = decorate(new THREE.MeshStandardNodeMaterial());
const groundGeometry = new THREE.PlaneGeometry(4,4); groundGeometry.rotateX(-Math.PI/2);
const p = groundGeometry.attributes.position;
for(let i=0;i<p.count;i++) p.setY(i,p.getX(i)*.06-p.getZ(i)*.04);
groundGeometry.computeVertexNormals();
const ground = new THREE.Mesh(groundGeometry,material); ground.position.set(x,y,z); scene.add(ground);
const underlay = new THREE.Mesh(groundGeometry,mask.apply(new THREE.MeshStandardNodeMaterial({color:'#526d35'})));
underlay.position.set(x,y-.015,z); scene.add(underlay);
const cup = new THREE.Mesh(createGolfCupGeometry(x,z,heightAt),new THREE.MeshStandardNodeMaterial({vertexColors:true,roughness:.92}));
cup.position.set(x,y,z); scene.add(cup);
const poleProfile = FLAG_POLE_PROFILE.map(([r,h],i)=>new THREE.Vector2(r,i<2?h-CUP.depth:h));
const pole = new THREE.Mesh(new THREE.LatheGeometry(poleProfile,10),new THREE.MeshStandardNodeMaterial({color:'#f2f4f2',roughness:.35,metalness:.5}));
pole.position.set(x,y+1.3,z); scene.add(pole);
const proof = new THREE.Mesh(new THREE.PlaneGeometry(.3,.3),new THREE.MeshBasicNodeMaterial({color:'#ff00ff'}));
proof.rotation.x=-Math.PI/2; proof.position.set(x,y-.15,z); proof.visible=false; scene.add(proof);
function draw(){ renderer.render(scene,camera); }
function view(name){
  if(name==='top') camera.position.set(x,y+.5,z+.0001);
  else if(name==='standing') camera.position.set(x+.5,y+1.65,z+1.3);
  else if(name==='grazing') camera.position.set(x+.16,y+.055,z+.4);
  else camera.position.set(x+.2,y+.25,z+.36);
  camera.lookAt(x,y-.035,z); draw();
}
view('detail');
window.cupReview={backend:renderer.backend.isWebGPUBackend?'webgpu':'webgl2',view,
  async proveOpening(){
    cup.visible=false; pole.visible=false; proof.visible=true; view('top');
    const target=new THREE.RenderTarget(1200,800); renderer.setRenderTarget(target); draw();
    const centre=Array.from(await renderer.readRenderTargetPixelsAsync(target,600,400,1,1));
    const turf=Array.from(await renderer.readRenderTargetPixelsAsync(target,900,400,1,1));
    renderer.setRenderTarget(null); target.dispose();
    cup.visible=true; pole.visible=true; proof.visible=false; view('detail');
    if(!(centre[0]>180&&centre[1]<30&&centre[2]>180)) throw new Error('Ground seals opening: '+centre);
    if(!(turf[1]>turf[0]&&turf[1]>turf[2])) throw new Error('Cup mask removes neighbouring turf: '+turf);
    return {centre,turf};
  }
};
`;
const server = await createServer({ root:APP, server:{port:0,host:'127.0.0.1'}, plugins:[{
  name:'cup-review', resolveId(id){if(id==='/src/__cup-review.mjs')return entry;}, load(id){if(id===entry)return fixture;},
}] });
let browser;
try {
  await server.listen(); await fs.mkdir(out,{recursive:true});
  browser = await chromium.launch({headless:true,executablePath:process.env.BANVY_CHROME||undefined,
    args:[...browserArgs(),...(webgpu?['--enable-unsafe-webgpu']:[])]});
  const page = await browser.newPage({viewport:{width:1200,height:800}}), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('**/__cup-review.html',route=>route.fulfill({contentType:'text/html',body:
    '<html><body style="margin:0"><script type="module" src="/src/__cup-review.mjs"></script></body></html>'}));
  const base = 'http://127.0.0.1:'+server.httpServer.address().port;
  await page.goto(base+'/__cup-review.html');
  try {await page.waitForFunction(()=>window.cupReview,null,{timeout:60000});}
  catch(e){throw new Error(errors.join('\n')||e.message);}
  const proof = await page.evaluate(()=>window.cupReview.proveOpening());
  for(const name of ['detail','top','grazing','standing']) {
    await page.evaluate(name=>window.cupReview.view(name),name);
    await page.screenshot({path:path.join(out,name+'.png')});
  }
  if(errors.length)throw new Error(errors.join('\n'));
  const appResults=[];
  if(process.argv.includes('--app'))for(const ground of ['v2-ghibli']) {
    const app = await browser.newPage({viewport:{width:1200,height:800}}), appErrors=[];
    app.on('pageerror',e=>appErrors.push(e.message));
    await app.goto(base+'/?bana=angso&gl=1&q=lo&det=1&vind=270,5');
    await app.waitForFunction(()=>window.V3D?.cups,null,{timeout:240000});
    const cups=await app.evaluate(()=>window.V3D.cups());
    if(cups.positions.length!==18)throw new Error('Missing cups');
    await app.evaluate(()=>{const p=V3D.cups().positions[0]; V3D.setView(p.x+.45,p.y+1.7,p.z+1.1,p.x,p.y-.025,p.z);});
    await app.waitForFunction(()=>V3D.settled(),null,{timeout:180000});
    const closeView = await app.evaluate(()=>({ camera:V3D.camExact(), markerHidden:document.getElementById('selectedGreen').hidden }));
    if(!closeView.markerHidden)throw new Error('Pin badge covers the cup at close range');
    const p=cups.positions[0], c=closeView.camera.pos;
    if(Math.hypot(c[0]-p.x,c[1]-p.y,c[2]-p.z)>3)throw new Error('Close zoom was clamped away from the cup');
    await app.screenshot({path:path.join(out,'app-'+ground+'.png')});
    if(appErrors.length)throw new Error(appErrors.join('\n'));
    appResults.push({ground,cups: cups.positions.length,maskBytes:cups.maskBytes,overlays:cups.legacyGreenOverlays,closeView});
    await app.close();
  }
  console.log(JSON.stringify({backend:await page.evaluate(()=>window.cupReview.backend),proof,errors,appResults,out}));
} finally {await browser?.close(); await server.close();}
