import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadGhibliTrees, GHIBLI_SPECIES, GHIBLI_COLOURS } from './engine/ghibli-trees.mjs';

const notes = {
  gran: ['Norway spruce', 'Individual sweeping boughs replace the stacked skirts. Smaller drooping sprays break up the edges, with darker old growth beneath the fresh tips.'],
  tall: ['Scots pine', 'The broad, connected crown and bent trunk retain their original arrangement. Extra geometry refines the crown edges; a continuous grey-to-copper bark colour reduces the old segment bands.'],
  'björk': ['Silver birch', 'Slender ivory leaders fork into hanging twigs and smaller leaf clusters. Openings between the branches let the sky through; bark carries broken dark lenticels.'],
  al: ['Grey alder', 'Several ascending stems carry an irregular, upright crown. Smaller foliage masses and subdued bark give the tree a softer woodland character.'],
  ek: ['Pasture oak', 'A substantial root flare and spreading limbs support a generous crown. Overlapping clusters, warm leaf tops and shaded undersides give the oak its weight.'],
};
const speciesSelect = document.querySelector('#species');
const variantSelect = document.querySelector('#variant');
const tierSelect = document.querySelector('#tier');
const status = document.querySelector('#status');
const initial = new URLSearchParams(location.search);
if (initial.get('species') === 'tall') speciesSelect.value = initial.get('species');
const views = [];
let rotating = false, ready = false;

for (const design of ['original', 'atelier']) {
  const host = document.getElementById(design);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0xe2e5d5);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  host.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(33, 1, .1, 140);
  camera.position.set(17, 10.5, 30);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 7, 0);
  controls.minDistance = 9; controls.maxDistance = 65;
  controls.maxPolarAngle = Math.PI * .52;
  controls.update();
  scene.add(new THREE.HemisphereLight(0xe5f0ff, 0x88896a, 2.0));
  const sun = new THREE.DirectionalLight(0xfff1d3, 3.4);
  sun.position.set(-12, 22, 10); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 24, bottom: -14, near: 1, far: 70 });
  sun.shadow.normalBias = .045;
  scene.add(sun);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0xe2e5d5, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.07; floor.receiveShadow = true; scene.add(floor);
  const group = new THREE.Group(); scene.add(group);
  const view = { design, host, renderer, scene, camera, controls, group };
  views.push(view);
  new ResizeObserver(() => {
    const width = host.clientWidth, height = renderer.domElement.clientHeight;
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
  }).observe(host);
}
for (const view of views) view.controls.addEventListener('change', () => {
  const other = views.find(v => v !== view);
  other.camera.position.copy(view.camera.position);
  other.camera.quaternion.copy(view.camera.quaternion);
  other.controls.target.copy(view.controls.target);
});

try {
  for (const view of views) {
    view.catalogue = await loadGhibliTrees({ baseUrl: import.meta.env.BASE_URL, hero: true, design: view.design === 'atelier' ? 'refined' : 'original' });
  }
  function update() {
    const s = GHIBLI_SPECIES.indexOf(speciesSelect.value), variant = Number(variantSelect.value), tier = tierSelect.value;
    for (const view of views) {
      for (const mesh of [...view.group.children]) { mesh.material.dispose(); view.group.remove(mesh); }
      const tree = view.catalogue.species[s].variants[variant];
      for (const part of ['crown', 'trunk']) {
        const mesh = new THREE.Mesh(tree[tier][part], new THREE.MeshStandardMaterial({
          color: part === 'crown' ? GHIBLI_COLOURS[s].cc : 0xffffff,
          vertexColors: true, roughness: .95, metalness: 0,
        }));
        mesh.castShadow = true; mesh.receiveShadow = true; view.group.add(mesh);
      }
      const scale = 15 / tree.templateHeight;
      view.group.scale.setScalar(scale);
      const tris = view.group.children.reduce((sum, mesh) => sum + (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3, 0);
      view.host.querySelector('.stats').textContent = `${Math.round(tris).toLocaleString('en')} triangles · ${tier === 'hero' ? 'Close' : tier === 'full' ? 'Middle' : 'Distant'} detail`;
    }
    const [title, note] = notes[speciesSelect.value];
    document.querySelector('#species-title').textContent = title;
    document.querySelector('#species-note').textContent = note;
    const url = new URL(location.href); url.searchParams.set('species', speciesSelect.value); history.replaceState(null, '', url);
    status.textContent = 'Drag to orbit · Scroll to zoom';
    window.treeStudy.current = { species: speciesSelect.value, variant, tier };
  }
  window.treeStudy = { views, current: null, update };
  for (const select of [speciesSelect, variantSelect, tierSelect]) select.addEventListener('change', update);
  document.querySelector('#rotate').addEventListener('click', event => {
    rotating = !rotating; event.currentTarget.setAttribute('aria-pressed', String(rotating));
  });
  document.querySelector('#reset').addEventListener('click', () => {
    rotating = false; document.querySelector('#rotate').setAttribute('aria-pressed', 'false');
    for (const v of views) { v.group.rotation.y = 0; v.controls.target.set(0, 7, 0); v.camera.position.set(17, 10.5, 30); v.controls.update(); }
  });
  update(); ready = true;
} catch (error) {
  status.textContent = `Could not load tree models: ${error.message}`;
  console.error(error);
}
let last = performance.now();
function draw(now) {
  const delta = Math.min(.05, (now - last) / 1000); last = now;
  for (const v of views) {
    if (ready && rotating) v.group.rotation.y += delta * .22;
    v.renderer.render(v.scene, v.camera);
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
