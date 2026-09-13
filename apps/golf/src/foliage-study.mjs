import * as THREE from 'three/webgpu';
import { normalViewGeometry } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadGhibliTrees, GHIBLI_COLOURS } from './engine/ghibli-trees.mjs';

const base = `${import.meta.env.BASE_URL}models/trees/foliage-study/`;
const status = document.querySelector('#status');
const views = [], tierSelect = document.querySelector('#tier');
let rotating = false;
try {
  const [original, report] = await Promise.all([
    loadGhibliTrees({ baseUrl: import.meta.env.BASE_URL, hero: true, design: 'original' }),
    fetch(`${base}study.json`).then(r => { if (!r.ok) throw new Error('Missing foliage study'); return r.json(); }),
  ]);
  const loader = new GLTFLoader(), templates = {};
  for (const tier of ['hero', 'full', 'lite']) {
    templates[tier] = (await loader.loadAsync(base + report.tiers[tier].file)).scene;
    templates[tier].traverse(mesh => {
      if (!mesh.isMesh) return;
      // glTF carries the map and custom radial normals; TSL keeps the same
      // normal on both sides of a spray, avoiding dark card-shaped patches.
      const src = mesh.material;
      const m = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, vertexColors: true, roughness: 1 });
      if (mesh.name.startsWith('crown')) {
        m.color.set(0x597747); m.map = src.map; m.side = THREE.DoubleSide;
        m.normalNode = normalViewGeometry;
        if (tier !== 'lite') { m.alphaTest = .45; m.alphaToCoverage = true; }
      }
      mesh.material = m; mesh.castShadow = true;
      // Radial normals provide the broad light/shade form. Self-shadowing
      // hundreds of overlapping sprays adds harsh speckles to that form.
      mesh.receiveShadow = !mesh.name.startsWith('crown');
    });
  }
  for (const design of ['original', 'textured']) {
    const host = document.getElementById(design);
    const renderer = new THREE.WebGPURenderer({ antialias: true });
    await renderer.init();
    renderer.info.autoReset = false;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setClearColor(0xdfe4d5);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
    host.prepend(renderer.domElement);
    const scene = new THREE.Scene(), group = new THREE.Group(); scene.add(group);
    scene.add(new THREE.HemisphereLight(0xeaf1ff, 0x6c7657, 1.9));
    const sun = new THREE.DirectionalLight(0xffefd2, 2.8); sun.position.set(-12,22,10); sun.castShadow=true;
    sun.shadow.mapSize.set(2048,2048); sun.shadow.normalBias=.025;
    Object.assign(sun.shadow.camera,{left:-15,right:15,top:23,bottom:-14,near:1,far:70}); scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardNodeMaterial({color:0xdfe4d5,roughness:1}));
    ground.rotation.x=-Math.PI/2; ground.position.y=-.06; ground.receiveShadow=true; scene.add(ground);
    const camera = new THREE.PerspectiveCamera(33,1,.1,140); camera.position.set(17,10.5,30);
    const controls = new OrbitControls(camera,renderer.domElement); controls.target.set(0,7,0); controls.minDistance=9; controls.maxDistance=65; controls.maxPolarAngle=Math.PI*.52; controls.update();
    const view={design,host,renderer,scene,camera,controls,group}; views.push(view);
    new ResizeObserver(()=>{
      const width=host.clientWidth,height=renderer.domElement.clientHeight;
      renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();
    }).observe(host);
  }
  for(const v of views) v.controls.addEventListener('change',()=>{
    const other=views.find(x=>x!==v);other.camera.position.copy(v.camera.position);other.camera.quaternion.copy(v.camera.quaternion);other.controls.target.copy(v.controls.target);
  });
  function update(){
    const tier=tierSelect.value;
    for(const v of views){
      for(const child of [...v.group.children]) {
        if(v.design==='original') child.material.dispose();
        v.group.remove(child);
      }
      if(v.design==='original'){
        const tree=original.species[1].variants[0], lod=tier==='lite'?'decimated':tier;
        for(const part of ['crown','trunk']){
          const mesh=new THREE.Mesh(tree[lod][part],new THREE.MeshStandardNodeMaterial({color:part==='crown'?GHIBLI_COLOURS[1].cc:0xffffff,vertexColors:true,roughness:1}));
          mesh.castShadow=true;mesh.receiveShadow=true;v.group.add(mesh);
        }
        v.group.scale.setScalar(15/tree.templateHeight);
      }else{
        v.group.add(templates[tier].clone(true));v.group.scale.setScalar(15/report.height);
      }
      let tris=0;v.group.traverse(m=>{if(m.isMesh)tris+=(m.geometry.index?.count??m.geometry.attributes.position.count)/3;});
      v.triangles=tris;v.host.querySelector('.stats').textContent=`${tris.toLocaleString('en')} triangles · ${tier==='hero'?'Close':tier==='full'?'Middle':'Distant'} detail`;
    }
    window.foliageStudy.current=tier;
  }
  window.foliageStudy={views,report,templates,current:null,update};
  tierSelect.addEventListener('change',update);
  document.querySelector('#rotate').addEventListener('click',e=>{rotating=!rotating;e.currentTarget.textContent=rotating?'Pause rotation':'Rotate';});
  document.querySelector('#reset').addEventListener('click',()=>{
    rotating=false;document.querySelector('#rotate').textContent='Rotate';
    for(const v of views){v.group.rotation.y=0;v.controls.target.set(0,7,0);v.camera.position.set(17,10.5,30);v.controls.update();}
  });
  update();status.textContent=`${views.every(v=>v.renderer.backend.isWebGPUBackend)?'WebGPU':'WebGL fallback'} · Drag to orbit · Scroll to zoom`;
  let last=performance.now();
  views[0].renderer.setAnimationLoop(now=>{
    const dt=Math.min(.05,(now-last)/1000);last=now;
    for(const v of views){if(rotating)v.group.rotation.y+=dt*.22;v.renderer.info.reset();v.renderer.render(v.scene,v.camera);}
  });
}catch(error){status.textContent=`Study failed: ${error.message}`;console.error(error);}
