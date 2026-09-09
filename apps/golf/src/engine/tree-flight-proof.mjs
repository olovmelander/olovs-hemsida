/* Isolated renderer proof, excluded from the application entry point.
   Deliberately asymmetric: a round cone would hide an orientation jump. */
import * as THREE from 'three/webgpu';
import { color, float, vec3 } from 'three/tsl';
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
hardMaterial.alphaToCoverage = false;
hardMaterial.alphaTestNode = float(0.5);
impostorDebugMode.value = 3;
const mesh = new THREE.Mesh(geometry, material);
mesh.frustumCulled = false;
scene.add(mesh);
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
  async capture({ theta = 0.0447, azimuth = 1.1, distance = 65, shift = 0, coverage = true, samples = 4, measureOnly = false, lit = false, fadeCode = 0 } = {}) {
    mesh.material = lit ? litMaterial : coverage ? material : hardMaterial;
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
