import * as THREE from 'three/webgpu';
import { makePaintedCanopyMaterial, makeBirchBarkMaterial } from './study-canopy-material.mjs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadStudyTrees, GHIBLI_COLOURS, GHIBLI_SPECIES } from './studies/tree-loader.mjs';

const base = `${import.meta.env.BASE_URL}models/trees/foliage-study/`;
const status = document.querySelector('#status');
const views = [], tierSelect = document.querySelector('#tier'), speciesSelect = document.querySelector('#species');
const notes = {
  tall: 'Scots pine · Connected, spreading crowns with soft painted highlights and copper-grey bark.',
  gran: 'Norway spruce · Spreading, drooping boughs with fluffy green tips and soft shadow between the branches.',
  bjork: 'Silver birch · A broad, arching crown with flowing curtains of foliage around graceful ivory branches.',
  al: 'Grey alder · Several rising stems carry a connected, upright crown with cool painted shadows.',
  ek: 'Pasture oak · Heavy spreading limbs support a broad, integrated crown with warm painted colour.',
};
let rotating = false, collection = false;
const initial = new URLSearchParams(location.search);
if (notes[initial.get('species')]) speciesSelect.value = initial.get('species');
try {
  const [original, report] = await Promise.all([
    loadStudyTrees({ baseUrl: import.meta.env.BASE_URL, hero: true, design: 'original' }),
    fetch(`${base}species-study.json`).then(r => { if (!r.ok) throw new Error('Missing foliage study'); return r.json(); }),
  ]);
  const loader = new GLTFLoader(), templates = {};
  for (const species of report.species) {
   templates[species.key] = {};
   for (const tier of ['hero', 'full', 'lite']) {
    const root = (await loader.loadAsync(base + species.tiers[tier].file)).scene;
    templates[species.key][tier] = root;
    root.traverse(mesh => {
      if (!mesh.isMesh) return;
      // glTF carries the map and custom radial normals; TSL keeps the same
      // normal on both sides of a spray, avoiding dark card-shaped patches.
      const src = mesh.material;
      let m = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, vertexColors: true, roughness: 1 });
      if (mesh.name.startsWith('crown')) {
        m.dispose();m=makePaintedCanopyMaterial(species.colour,tier==='lite'?null:src.map,species.key);
      }else if(species.key==='bjork'){
        m.dispose();m=makeBirchBarkMaterial();
      }
      mesh.material = m; mesh.castShadow = true;
      // Radial normals provide the broad light/shade form. Self-shadowing
      // hundreds of overlapping sprays adds harsh speckles to that form.
      mesh.receiveShadow = !mesh.name.startsWith('crown');
    });
   }
   // All detail levels share the close model's display scale.
   const bounds = new THREE.Box3().setFromObject(templates[species.key].hero);
   species.displayScale = 15 / bounds.max.y;
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
    const view={design,host,renderer,scene,camera,controls,group,sun}; views.push(view);
    new ResizeObserver(()=>{
      const width=host.clientWidth,height=renderer.domElement.clientHeight;
      if(!width || !height) return;
      renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();
      if(collection) frame();
    }).observe(host);
  }
  for(const v of views) v.controls.addEventListener('change',()=>{
    const other=views.find(x=>x!==v);other.camera.position.copy(v.camera.position);other.camera.quaternion.copy(v.camera.quaternion);other.controls.target.copy(v.controls.target);
  });
  function makeTree(design,key,tier){
    const group = new THREE.Group();
    if(design==='original'){
      const index=GHIBLI_SPECIES.indexOf(key==='bjork'?'björk':key);
      const tree=original.species[index].variants[0],lod=tier==='lite'?'decimated':tier;
      for(const part of ['crown','trunk']){
        const mesh=new THREE.Mesh(tree[lod][part],new THREE.MeshStandardNodeMaterial({color:part==='crown'?GHIBLI_COLOURS[index].cc:0xffffff,vertexColors:true,roughness:1}));
        mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
      }
      group.scale.setScalar(15/tree.templateHeight);
    }else{
      group.add(templates[key][tier].clone(true));
      group.scale.setScalar(report.species.find(s=>s.key===key).displayScale);
    }
    return group;
  }
  function frame(){
    for(const v of views){
      v.group.rotation.y=0;v.controls.target.set(0,7,0);
      const distance=collection?Math.max(66,42/(Math.tan(v.camera.fov*Math.PI/360)*v.camera.aspect)):36;
      v.camera.position.set(...(collection?[0,7+distance*.135,distance]:[17,10.5,30]));
      v.controls.maxDistance=collection?distance*2:65;v.controls.update();
      Object.assign(v.sun.shadow.camera,{left:collection?-44:-15,right:collection?44:15,top:collection?35:23,bottom:collection?-35:-14});
      v.sun.shadow.camera.updateProjectionMatrix();v.sun.shadow.needsUpdate=true;
    }
  }
  function update(){
    const tier=tierSelect.value,key=speciesSelect.value;
    for(const v of views){
      for(const child of [...v.group.children]) {
        if(v.design==='original') child.traverse(m=>{if(m.isMesh)m.material.dispose();});
        v.group.remove(child);
      }
      const keys=collection?report.species.map(s=>s.key):[key];
      for(const [i,s] of keys.entries()){
        const tree=makeTree(v.design,s,tier);tree.position.x=collection?(i-2)*15:0;v.group.add(tree);
      }
      let tris=0;v.group.traverse(m=>{if(m.isMesh)tris+=(m.geometry.index?.count??m.geometry.attributes.position.count)/3;});
      v.triangles=tris;v.host.querySelector('.stats').textContent=`${tris.toLocaleString('en')} triangles · ${tier==='hero'?'Close':tier==='full'?'Middle':'Distant'} detail`;
    }
    window.foliageStudy.current=tier;
    window.foliageStudy.species=key;window.foliageStudy.collection=collection;
    const species=report.species.find(s=>s.key===key);
    document.querySelector('#study-title').textContent=collection?'The Swedish collection':`${species.name} · ${species.swedish}`;
    document.querySelector('#species-note').textContent=collection?'Five distinct silhouettes, with a shared soft foliage treatment. From left: pine, spruce, birch, alder and oak.':notes[key];
    document.querySelector('#collection-key').textContent=collection?'Tall / Pine · Gran / Spruce · Björk / Birch · Al / Alder · Ek / Oak':'Five Swedish species · Three levels of detail';
    const url=new URL(location.href);url.searchParams.set('species',key);history.replaceState(null,'',url);
  }
  window.foliageStudy={views,report,templates,current:null,update};
  tierSelect.addEventListener('change',update);
  speciesSelect.addEventListener('change',()=>{if(collection)document.querySelector('#collection').click();else update();});
  document.querySelector('#collection').addEventListener('click',e=>{
    collection=!collection;document.body.classList.toggle('collection',collection);
    e.currentTarget.setAttribute('aria-pressed',String(collection));e.currentTarget.textContent=collection?'Compare one tree':'View collection';
    update();frame();
  });
  document.querySelector('#rotate').addEventListener('click',e=>{rotating=!rotating;e.currentTarget.textContent=rotating?'Pause rotation':'Rotate';});
  document.querySelector('#reset').addEventListener('click',()=>{
    rotating=false;document.querySelector('#rotate').textContent='Rotate';
    update();frame();
  });
  update();status.textContent=`${views.every(v=>v.renderer.backend.isWebGPUBackend)?'WebGPU':'WebGL fallback'} · Drag to orbit · Scroll to zoom`;
  let last=performance.now();
  views[0].renderer.setAnimationLoop(now=>{
    const dt=Math.min(.05,(now-last)/1000);last=now;
    for(const v of views){
      if(collection&&v.design==='original')continue;
      if(rotating){if(collection)for(const tree of v.group.children)tree.rotation.y+=dt*.22;else v.group.rotation.y+=dt*.22;}
      v.renderer.info.reset();v.renderer.render(v.scene,v.camera);
    }
  });
}catch(error){status.textContent=`Study failed: ${error.message}`;console.error(error);}
