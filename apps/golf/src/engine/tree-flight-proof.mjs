/* Isolated renderer proof, excluded from the application entry point.
   Deliberately asymmetric: a round cone would hide an orientation jump. */
import * as THREE from 'three/webgpu';
import { attribute, cameraPosition, color, float, normalize, positionWorld, pow, saturate, uniform, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bakeImpostorAtlas, createImpostorGeometry, createImpostorMaterial, impostorDebugMode } from './tree-impostor.mjs';
import { treeFadeClock, treeFadeDuration } from './tree-fade.mjs';

const query = new URLSearchParams(location.search);
const renderer = new THREE.WebGPURenderer({ antialias: true, samples: 4, forceWebGL: query.get('gl') === '1' });
renderer.setSize(256, 256);
renderer.setPixelRatio(1);
document.body.append(renderer.domElement);
await renderer.init();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);
const distantFog = new THREE.FogExp2(0xc4b49c, 0.00040);
scene.add(new THREE.HemisphereLight(0xddeeff, 0x354520, 2));
const sun = new THREE.DirectionalLight(0xfff1d5, 2);
sun.position.set(0.4, 0.8, 0.3); scene.add(sun);
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 4000);
camera.up.set(0, 0, -1);
const lobes = [[0, 9, 0, 3.2, 0.24], [3, 7, 0, 2, 0.55], [-1, 10, -2, 1.8, 0.8]].map(([x, y, z, r, shade]) => {
  const g = new THREE.IcosahedronGeometry(r, 1).translate(x, y, z);
  const colours = new Float32Array(g.getAttribute('position').count * 3).fill(shade);
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return g;
});
const crown = mergeGeometries(lobes);
const trunk = new THREE.CylinderGeometry(0.2, 0.4, 9, 6).translate(0, 4.5, 0);
const atlas = bakeImpostorAtlas(renderer, { crown, trunk, trunkColor: 0x35291f });
const geometry = createImpostorGeometry(1);
geometry.getAttribute('aImpostorPos').setXYZ(0, 0, 0, 0);
geometry.getAttribute('aImpostorParam').setXYZW(0, 0.8, 1.3, 1.8, 0);
geometry.instanceCount = 1;
const material = createImpostorMaterial(atlas, { crownBase: color(0x446629), sunDirection: vec3(0.4, 0.8, 0.3), debug: 'albedo' });
const hardMaterial = createImpostorMaterial(atlas, { crownBase: color(0x446629), sunDirection: vec3(0.4, 0.8, 0.3), debug: 'albedo' });
const litMaterial = createImpostorMaterial(atlas, { crownBase: color(0x446629), sunDirection: vec3(0.4, 0.8, 0.3), fade: true });
// Black silhouettes isolate sample coverage from the tree's lighting and tint.
const silhouetteMaterial = createImpostorMaterial(atlas, { crownBase: color(0x446629), sunDirection: vec3(0.4, 0.8, 0.3), debug: 'albedo' });
silhouetteMaterial.colorNode = vec3(0);
hardMaterial.alphaToCoverage = false;
hardMaterial.alphaTestNode = float(0.5);
impostorDebugMode.value = 3;
const mesh = new THREE.Mesh(geometry, material);
mesh.frustumCulled = false;
scene.add(mesh);
// Draw exactly the geometry baked above, with the same instance transform and
// crown lighting as the application's mesh tier, to expose density/color drift.
const reference = new THREE.Group();
reference.rotation.y = 0.8;
reference.scale.set(1.3, 1.8, 1.3);
const referenceCrownMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0, flatShading: true });
const view = normalize(cameraPosition.sub(positionWorld));
referenceCrownMaterial.colorNode = color(0x446629).mul(attribute('color', 'vec3')).mul(
  pow(saturate(view.dot(vec3(-0.4, -0.8, -0.3))), 2.6).mul(0.55).add(1));
const referenceTrunkMaterial = new THREE.MeshStandardNodeMaterial({ color: 0x35291f, roughness: 0.95, metalness: 0, flatShading: true });
const referenceSilhouetteMaterial = new THREE.MeshBasicNodeMaterial({ color: 0x000000 });
const referenceCrown = new THREE.Mesh(crown, referenceCrownMaterial);
const referenceTrunk = new THREE.Mesh(trunk, referenceTrunkMaterial);
reference.add(referenceCrown, referenceTrunk);
reference.visible = false;
scene.add(reference);
const target = new THREE.RenderTarget(256, 256, { samples: 4 });
const singleTarget = new THREE.RenderTarget(256, 256, { samples: 0 });
const centre = new THREE.Vector3(0, atlas.centreY * 1.8, 0);

window.treeProof = {
  backend: renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2',
  samples: renderer.samples,
  async shader() {
    mesh.material = litMaterial;
    return renderer.debug.getShaderAsync(scene, camera, mesh);
  },
  async opaqueDisplay() {
    // Matching foreground/background RGB must remain a flat color through
    // the final ACES output transform, including partially covered samples.
    const flat = new THREE.Color().setRGB(0.2, 0.35, 0.12);
    const mat = createImpostorMaterial(atlas, { crownBase: color(0x446629), sunDirection: vec3(0), debug: 'albedo' });
    mat.colorNode = color(flat);
    const displayScene = new THREE.Scene();
    displayScene.background = flat;
    displayScene.add(new THREE.Mesh(geometry, mat));
    camera.position.copy(centre).addScaledVector(new THREE.Vector3(0.2, 0.97, 0.1).normalize(), 700);
    camera.lookAt(centre);
    camera.updateMatrixWorld(true);
    const previous = { toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure };
    try {
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.22;
      renderer.setRenderTarget(null);
      renderer.render(displayScene, camera);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const context = canvas.getContext('2d');
      context.drawImage(renderer.domElement, 0, 0);
      const data = context.getImageData(0, 0, 256, 256).data;
      const background = Array.from(data.subarray(0, 3));
      let maxRgbError = 0, outlinePixels = 0;
      for (let i = 0; i < data.length; i += 4) {
        const error = Math.max(...background.map((v, k) => Math.abs(data[i + k] - v)));
        maxRgbError = Math.max(maxRgbError, error);
        if (error > 1) outlinePixels++;
      }
      return { background, maxRgbError, outlinePixels, tolerance: 1 };
    } finally {
      renderer.toneMapping = previous.toneMapping;
      renderer.toneMappingExposure = previous.exposure;
      mat.dispose();
    }
  },
  async mixedTexelTint() {
    // One filtered texel containing both crown and trunk: compare the actual
    // runtime color graph against tinting the two original surfaces first.
    const trunkColor = new THREE.Color(0x35291f), crownBase = uniform(new THREE.Color());
    const albedo = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    const normal = new THREE.DataTexture(new Float32Array([0.5, 1, 0.5, 0]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    albedo.colorSpace = normal.colorSpace = THREE.LinearSRGBColorSpace;
    const runtime = createImpostorMaterial({ ...atlas, albedo, normal, trunkColor }, { crownBase, sunDirection: vec3(0) });
    const unlit = new THREE.MeshBasicNodeMaterial({ fog: false, toneMapped: false });
    unlit.positionNode = runtime.positionNode;
    unlit.colorNode = runtime.colorNode;
    unlit.opacityNode = runtime.opacityNode;
    unlit.alphaToCoverage = true;
    const synthetic = new THREE.Scene();
    synthetic.add(new THREE.Mesh(geometry, unlit));
    camera.position.copy(centre).add(new THREE.Vector3(0, 65, 0));
    camera.lookAt(centre);
    camera.updateMatrixWorld(true);
    const samples = [], shade = 0.6;
    try {
      for (const crownHex of [0x446629, 0xc8842e]) {
        crownBase.value.setHex(crownHex);
        for (const mask of [0, 0.25, 0.5, 0.75, 1]) {
          const trunkRgb = trunkColor.toArray(), crownRgb = crownBase.value.toArray();
          albedo.image.data.set([...trunkRgb.map(v => shade * mask + v * (1 - mask)), 1]);
          normal.image.data[3] = mask;
          albedo.needsUpdate = normal.needsUpdate = true;
          renderer.setRenderTarget(singleTarget);
          renderer.render(synthetic, camera);
          const pixel = await renderer.readRenderTargetPixelsAsync(singleTarget, 128, 128, 1, 1);
          const actual = Array.from(pixel.subarray(0, 3), v => v / 255);
          const expected = crownRgb.map((v, k) => v * shade * mask + trunkRgb[k] * (1 - mask));
          samples.push({ crownHex, mask, actual, expected, maxError: Math.max(...actual.map((v, k) => Math.abs(v - expected[k]))) });
        }
      }
    } finally {
      renderer.setRenderTarget(null);
      albedo.dispose(); normal.dispose(); runtime.dispose(); unlit.dispose();
    }
    return { tolerance: 0.005, samples };
  },
  async capture({ theta = 0.0447, azimuth = 1.1, distance = 65, shift = 0, coverage = true, samples = 4, measureOnly = false, lit = false, fadeCode = 0, kind = 'impostor', silhouette = false, fog = false } = {}) {
    scene.fog = fog && !silhouette ? distantFog : null;
    mesh.visible = kind !== 'mesh';
    reference.visible = kind === 'mesh';
    referenceCrown.material = silhouette ? referenceSilhouetteMaterial : referenceCrownMaterial;
    referenceTrunk.material = silhouette ? referenceSilhouetteMaterial : referenceTrunkMaterial;
    mesh.material = silhouette ? silhouetteMaterial : lit ? litMaterial : coverage ? material : hardMaterial;
    if (coverage && !material.alphaToCoverage) { material.alphaToCoverage = true; material.needsUpdate = true; }
    const readback = samples === 0 ? singleTarget : target;
    geometry.getAttribute('aFade').setXY(0, 0, fadeCode);
    geometry.getAttribute('aFade').needsUpdate = true;
    treeFadeClock.value = 0.15; treeFadeDuration.value = 0.3;
    const direction = new THREE.Vector3(Math.sin(theta) * Math.cos(azimuth), Math.cos(theta), Math.sin(theta) * Math.sin(azimuth));
    camera.position.copy(centre).addScaledVector(direction, distance);
    camera.lookAt(centre);
    camera.updateMatrixWorld(true);
    const pan = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(shift);
    camera.position.add(pan);
    camera.lookAt(centre.clone().add(pan));
    camera.updateMatrixWorld(true);
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    renderer.setRenderTarget(readback);
    renderer.render(scene, camera);
    const data = await renderer.readRenderTargetPixelsAsync(readback, 0, 0, 256, 256);
    renderer.setRenderTarget(null);
    if (measureOnly) {
      let area = 0;
      for (let i = 0; i < data.length; i += 4) area += 1 - (data[i] + data[i + 1] + data[i + 2]) / 765;
      return area;
    }
    let binary = '';
    for (let i = 0; i < data.length; i += 32768) binary += String.fromCharCode(...data.subarray(i, i + 32768));
    return btoa(binary);
  },
};
