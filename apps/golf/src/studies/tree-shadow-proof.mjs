/* The tree shadow proof (docs/tree-shadows-zoom.md), driven by
   tools/check-tree-shadows.mjs. One tree of each species stands at the
   origin twice -- as the player's mesh and as its impostor -- on layer 1,
   which the sun's shadow camera sees and the capture camera does not, so a
   top-down capture of the ground is the shadow alone. Each measurement
   renders the ground with no caster, with the mesh, and with the impostor,
   and compares the darkness each one adds.

   modes (?modes=, comma separated):
     match   the impostor's shadow against the mesh's, over sun heights and box sizes
     thin    each caster's shadow as the box grows, as a share of the mesh's at a fine texel;
             `before` is the reference build's crown material (the tool's --ref)
     colour  the reference build's impostor and crown materials against these, colour pass only
     fade    the crossfade reaching both shadows
   The reference modules come from the tool (virtual:tree-shadow-reference/...). */
import * as THREE from 'three/webgpu';
import { color, float, vec3, uniform } from 'three/tsl';
import { bakeImpostorAtlas, createImpostorMaterial, createImpostorGeometry } from '../engine/tree-impostor.mjs';
import { loadGhibliTrees } from '../engine/ghibli-trees.mjs';
import { makeGhibliFoliageMaterial } from '../engine/ghibli-foliage-material.mjs';
import { createSunShadowFilter } from '../engine/sun-shadow.mjs';
import { treeFadeClock, treeFadeDuration, attachTreeFade, createFadeAttribute } from '../engine/tree-fade.mjs';
import { shadowBoxFor } from '../engine/shadow-fit.mjs';
import * as REF_IMPOSTOR from 'virtual:tree-shadow-reference/tree-impostor.mjs';
import * as REF_FOLIAGE from 'virtual:tree-shadow-reference/ghibli-foliage-material.mjs';

const q = new URLSearchParams(location.search);
const modes = new Set((q.get('modes') || 'match,thin,colour,fade').split(','));
const onlySpecies = q.get('species') ? q.get('species').split(',').map(Number) : null;
const tier = q.get('tier') || 'hero';
const W = 768;
const result = { tier, match: [], thin: [], colour: [], fade: [], dumps: [], errors: [] };

/* A Chromium that predates the string form of the view swizzle three r186
   sends rejects it; identity is the default, so leave it out there. */
if (globalThis.GPUTexture) {
  const createView = GPUTexture.prototype.createView;
  GPUTexture.prototype.createView = function (d) { if (d && d.swizzle === 'rgba') { d = { ...d }; delete d.swizzle; } return createView.call(this, d); };
}
const forceWebGL = q.get('gl') === '1';
const renderer = new THREE.WebGPURenderer({ antialias: false, forceWebGL, reversedDepthBuffer: !forceWebGL });
await renderer.init();
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
result.backend = renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2';
result.reversedDepth = renderer.reversedDepthBuffer === true;

const GHIBLI = await loadGhibliTrees({ baseUrl: '/', variants: 1, tier });
const uSun = uniform(new THREE.Vector3(-0.42, 0.46, 0.78).normalize());
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 1, metalness: 0 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
scene.add(ground, new THREE.HemisphereLight(0xffffff, 0xffffff, 0.25));
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.castShadow = true;
sun.shadow.bias = -0.0004;
sun.shadow.filterNode = createSunShadowFilter().filterNode;
sun.shadow.camera.layers.enable(1);
scene.add(sun, sun.target);
const captureCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2000);
const rt = new THREE.RenderTarget(W, W, { type: THREE.UnsignedByteType, depthBuffer: true });

const species = GHIBLI.species.map((sp, s) => {
  const near = sp.mesh;
  const atlas = bakeImpostorAtlas(renderer, { crown: near.crown, trunk: near.trunk, trunkColor: new THREE.Color(...sp.trunkMean), foliage: sp.foliage });
  const crownOptions = { key: sp.foliage.key, map: sp.foliage.map, sunDirection: uSun, tint: vec3(1), seed: float(0.5), autumn: float(0) };
  const crownMat = makeGhibliFoliageMaterial(crownOptions), crownRef = REF_FOLIAGE.makeGhibliFoliageMaterial(crownOptions);
  const crown = new THREE.Mesh(near.crown, crownMat), trunk = new THREE.Mesh(near.trunk, new THREE.MeshStandardNodeMaterial({ color: 0x806040 }));
  const mesh = new THREE.Group();
  for (const m of [crown, trunk]) { m.castShadow = true; m.frustumCulled = false; m.layers.set(1); mesh.add(m); }
  mesh.layers.set(1);
  const impostor = (mod, count = 1) => {
    const geo = mod.createImpostorGeometry(count);
    geo.getAttribute('aImpostorParam').array.set([0, 1, 1, 0]);
    geo.instanceCount = count;
    const m = new THREE.Mesh(geo, mod.createImpostorMaterial(atlas, { crownBase: color(0x2c5230), sunDirection: uSun, autumn: float(0), fade: true }));
    m.castShadow = true; m.frustumCulled = false; m.layers.set(1);
    return m;
  };
  const imp = impostor({ createImpostorGeometry, createImpostorMaterial });
  scene.add(mesh, imp);
  mesh.visible = imp.visible = false;
  return { s, key: sp.key, near, foliage: sp.foliage, mesh, crown, crownMat, crownRef, imp, impostor, height: atlas.height, radius: sp.templateRadius };
});
const chosen = species.filter(sp => !onlySpecies || onlySpecies.includes(sp.s));

async function capture(camera) {
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  return new Uint8Array(await renderer.readRenderTargetPixelsAsync(rt, 0, 0, W, W));
}
const luma = (px, i) => (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3;
const shadowLength = (sp, d) => sp.height / Math.tan(Math.max(Math.asin(d.y), 0.02));
/* a box that holds the whole shadow inside the filter's full-strength disc */
const fineBox = (sp, d) => Math.max(60, Math.ceil((shadowLength(sp, d) / 2 + sp.radius * 1.6 + 4) * 1.8));

/* the darkness the mesh and the impostor each add to the lit ground, with the sun's box as placeSun sizes it */
async function shadows(sp, sunDir, R, mapSize, yaw, dump = null) {
  const d = new THREE.Vector3(...sunDir).normalize();
  uSun.value.copy(d);
  sun.intensity = 1.6 / Math.max(0.05, d.y);   /* the same lit ground at every sun height */
  sp.mesh.rotation.y = yaw; sp.mesh.updateMatrixWorld(true);
  const par = sp.imp.geometry.getAttribute('aImpostorParam'); par.array[0] = yaw; par.needsUpdate = true;
  const length = shadowLength(sp, d), away = new THREE.Vector2(-d.x, -d.z).normalize();
  const mid = new THREE.Vector3(away.x * length / 2, 0, away.y * length / 2);
  const half = Math.min(length / 2 + sp.radius * 1.6 + 4, 400);
  if (!R) R = fineBox(sp, d);
  const box = shadowBoxFor(R), c = sun.shadow.camera;
  c.left = -R; c.right = R; c.top = R; c.bottom = -R; c.near = box.near; c.far = box.far; c.updateProjectionMatrix();
  sun.shadow.normalBias = box.normalBias;
  sun.shadow.mapSize.set(mapSize, mapSize);
  sun.position.copy(mid).addScaledVector(d, box.lightDistance);
  sun.target.position.copy(mid); sun.target.updateMatrixWorld(); sun.updateMatrixWorld();
  captureCam.left = -half; captureCam.right = half; captureCam.top = half; captureCam.bottom = -half;
  captureCam.position.set(mid.x, 800, mid.z); captureCam.up.set(0, 0, -1); captureCam.lookAt(mid.x, 0, mid.z);
  captureCam.updateProjectionMatrix(); captureCam.updateMatrixWorld();
  const none = await capture(captureCam);
  sp.mesh.visible = true; const withMesh = await capture(captureCam); sp.mesh.visible = false;
  sp.imp.visible = true; const withImp = await capture(captureCam); sp.imp.visible = false;
  const dm = new Float32Array(W * W), di = new Float32Array(W * W);
  let maxDark = 0;
  for (let i = 0; i < W * W; i++) {
    const n = luma(none, i);
    dm[i] = Math.max(0, n - luma(withMesh, i)); di[i] = Math.max(0, n - luma(withImp, i));
    maxDark = Math.max(maxDark, dm[i], di[i]);
  }
  const th = maxDark * 0.5;
  let aM = 0, aI = 0, both = 0, either = 0, massMesh = 0, massImpostor = 0;
  for (let i = 0; i < W * W; i++) {
    const m = dm[i] > th, k = di[i] > th;
    aM += m; aI += k; both += m && k; either += m || k;
    massMesh += dm[i]; massImpostor += di[i];
  }
  if (dump) {
    /* red the mesh's shadow, green the impostor's, yellow where they agree */
    const img = new Uint8ClampedArray(W * W * 4);
    for (let i = 0; i < W * W; i++) { img[i * 4] = dm[i] / maxDark * 255; img[i * 4 + 1] = di[i] / maxDark * 255; img[i * 4 + 3] = 255; }
    const canvas = new OffscreenCanvas(W, W); canvas.getContext('2d').putImageData(new ImageData(img, W, W), 0, 0);
    result.dumps.push({ name: dump, png: [...new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer())] });
  }
  const mpp = 2 * half / W;
  return { species: sp.key, elevationDeg: +(Math.asin(d.y) * 180 / Math.PI).toFixed(1), R, mapSize, texel: +(2 * R / mapSize).toFixed(3),
    areaMeshM2: +(aM * mpp * mpp).toFixed(1), areaImpostorM2: +(aI * mpp * mpp).toFixed(1), iou: +(both / Math.max(1, either)).toFixed(3),
    massRatio: +(massImpostor / Math.max(1, massMesh)).toFixed(3), massMesh, massImpostor };
}

try {
  const suns = [[-0.22, 0.88, 0.42], [-0.42, 0.46, 0.78], [-0.56, 0.15, 0.71], [-0.20, 0.08, -0.97]];
  if (modes.has('match')) for (const sp of chosen) for (const sunDir of suns) {
    for (const [R, mapSize] of [[0, 2048], [850, 2048], [850, 1024], [2200, 2048]]) {
      const r = await shadows(sp, sunDir, R, mapSize, R ? 1.1 : 0, sunDir === suns[1] && R === 850 && mapSize === 2048 ? `match-${sp.key}-R850` : null);
      result.match.push(r); console.log(JSON.stringify(r));
    }
  }
  if (modes.has('thin')) for (const sp of chosen) for (const sunDir of [suns[1], suns[2]]) {
    sp.crown.material = sp.crownRef;
    const reference = await shadows(sp, sunDir, 0, 2048, 1.1);
    for (const [R, mapSize] of [[260, 2048], [400, 2048], [600, 2048], [850, 2048], [1150, 2048], [2200, 2048], [260, 1024], [600, 1024], [850, 1024], [1150, 1024]]) {
      sp.crown.material = sp.crownRef;
      const before = await shadows(sp, sunDir, R, mapSize, 1.1);
      sp.crown.material = sp.crownMat;
      const after = await shadows(sp, sunDir, R, mapSize, 1.1);
      const row = { species: sp.key, elevationDeg: after.elevationDeg, R, mapSize, texel: after.texel,
        meshBefore: +(before.massMesh / reference.massMesh).toFixed(3), mesh: +(after.massMesh / reference.massMesh).toFixed(3),
        impostor: +(after.massImpostor / reference.massMesh).toFixed(3), iouMeshImpostor: after.iou };
      result.thin.push(row); console.log(JSON.stringify(row));
    }
    sp.crown.material = sp.crownMat;
  }
  if (modes.has('colour')) {
    const cam = new THREE.PerspectiveCamera(48, 1, 1, 14000);
    const compare = async (label, views, setA, setB) => {
      const shots = [];
      for (const set of [setA, setB]) {
        set();
        for (const [pos, look] of views) { cam.position.set(...pos); cam.lookAt(...look); cam.updateMatrixWorld(); shots.push(await capture(cam)); }
      }
      for (let v = 0; v < views.length; v++) {
        const a = shots[v], b = shots[v + views.length];
        let differing = 0, covered = 0;
        for (let i = 0; i < a.length; i += 4) {
          if (a[i] || a[i + 1] || a[i + 2]) covered++;
          if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) differing++;
        }
        const row = { what: label, view: v, coveredPixels: covered, differingPixels: differing };
        result.colour.push(row); console.log(JSON.stringify(row));
      }
    };
    uSun.value.set(-0.42, 0.46, 0.78).normalize();
    for (const sp of chosen) {
      /* impostors, alone on a black ground-less frame: the same four trees from either material */
      const place = [[0, 0, 0, 0.3, 1, 1], [60, 3, -40, 2.1, 1.3, 1.1], [-80, -2, -120, 4, 0.8, 0.9], [150, 10, -400, 5.5, 1, 1.2]];
      const batch = mod => {
        const m = sp.impostor(mod, place.length), g = m.geometry;
        place.forEach((p, i) => { g.getAttribute('aImpostorPos').array.set(p.slice(0, 3), i * 3); g.getAttribute('aImpostorParam').array.set([p[3], p[4], p[5], 0], i * 4); });
        m.layers.set(0); m.castShadow = false;
        return m;
      };
      const reference = batch(REF_IMPOSTOR), current = batch({ createImpostorGeometry, createImpostorMaterial });
      ground.visible = false;
      await compare(`impostor ${sp.key}`, [[[30, 25, 160], [0, 8, 0]], [[0, 500, 300], [0, 0, -100]]],
        () => { scene.remove(current); scene.add(reference); }, () => { scene.remove(reference); scene.add(current); });
      scene.remove(current); ground.visible = true;
      /* the crown's colour pass, its own shadow left out: a changed crown SHADOW is the point of the change */
      sp.mesh.visible = true;
      for (const o of [sp.mesh, ...sp.mesh.children]) o.layers.set(0);
      for (const o of sp.mesh.children) o.castShadow = false;
      await compare(`crown ${sp.key}`, [[[12, 6, 30], [0, 8, 0]], [[60, 40, 160], [0, 6, 0]], [[0, 90, 20], [0, 5, 0]]],
        () => { sp.crown.material = sp.crownRef; }, () => { sp.crown.material = sp.crownMat; });
      for (const o of sp.mesh.children) o.castShadow = true;
      for (const o of [sp.mesh, ...sp.mesh.children]) o.layers.set(1);
      sp.mesh.visible = false;
    }
  }
  if (modes.has('fade')) {
    const sp = chosen[0], sunDir = [-0.42, 0.46, 0.78], clock = 0.5, done = 1.2;
    treeFadeDuration.value = 1;
    /* the impostor tier's batch, half-way in and out and finished */
    const steady = await shadows(sp, sunDir, 850, 2048, 0);
    const fade = sp.imp.geometry.getAttribute('aFade');
    for (const [label, t, code] of [['impostor in, half', clock, 1], ['impostor out, half', clock, 3], ['impostor in, done', done, 1], ['impostor out, done', done, 3]]) {
      treeFadeClock.value = t; fade.array.set([0, code]); fade.needsUpdate = true;
      const r = await shadows(sp, sunDir, 850, 2048, 0);
      const row = { label, shareOfSteady: +(r.massImpostor / steady.massImpostor).toFixed(3) };
      result.fade.push(row); console.log(JSON.stringify(row));
    }
    fade.array.set([0, 0]); fade.needsUpdate = true;
    /* the mesh crown as the tiers draw it -- instanced, with aFade and the fade attached; its trunk does not fade here */
    const g = sp.near.crown.clone(); g.setAttribute('aFade', createFadeAttribute(1));
    const faded = new THREE.InstancedMesh(g, attachTreeFade(makeGhibliFoliageMaterial({ key: sp.foliage.key, map: sp.foliage.map,
      sunDirection: uSun, tint: vec3(1), seed: float(0.5), autumn: float(0) })), 1);
    faded.setMatrixAt(0, new THREE.Matrix4()); faded.castShadow = true; faded.frustumCulled = false; faded.layers.set(1);
    sp.mesh.remove(sp.crown); sp.mesh.add(faded);
    treeFadeClock.value = done; g.getAttribute('aFade').array.set([0, 1]); g.getAttribute('aFade').needsUpdate = true;
    const crownSteady = await shadows(sp, sunDir, 850, 2048, 0);
    sp.mesh.remove(faded);   /* the trunk alone */
    const trunkOnly = await shadows(sp, sunDir, 850, 2048, 0);
    sp.mesh.add(faded);
    for (const [label, t, code] of [['crown in, half', clock, 1], ['crown out, half', clock, 3], ['crown in, done', done, 1], ['crown out, done', done, 3]]) {
      treeFadeClock.value = t; g.getAttribute('aFade').array.set([0, code]); g.getAttribute('aFade').needsUpdate = true;
      const r = await shadows(sp, sunDir, 850, 2048, 0);
      const row = { label, shareOfSteady: +((r.massMesh - trunkOnly.massMesh) / (crownSteady.massMesh - trunkOnly.massMesh)).toFixed(3) };
      result.fade.push(row); console.log(JSON.stringify(row));
    }
    sp.mesh.remove(faded); sp.mesh.add(sp.crown);
    treeFadeDuration.value = 0;
  }
} catch (e) {
  result.errors.push(String(e?.stack || e));
  console.error(e);
}
window.treeShadowProof = result;
