import * as THREE from 'three/webgpu';
import { TerrainTileBatchSet } from './v2-terrain-batch.mjs';

const SIZE = 65;
const SPACING = 4;
const SCALE = 0.01;
const UINT16_MAX = 65_535;

function heightAt(x, z) {
  const hill = 13 * Math.exp(-(x * x + z * z) / 34_000);
  const shoulder = 7 * Math.exp(-((x + 145) ** 2 + (z - 70) ** 2) / 12_000);
  const hollow = -5 * Math.exp(-((x - 115) ** 2 + (z + 95) ** 2) / 8_000);
  return 18 + hill + shoulder + hollow + Math.sin(x / 54) * 1.4 + Math.cos(z / 71) * 1.1;
}

function octNormal(x, z) {
  const e = SPACING;
  const dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
  const dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
  const length = Math.hypot(dx, 1, dz);
  const nx = -dx / length, ny = 1 / length, nz = -dz / length;
  const l1 = Math.abs(nx) + ny + Math.abs(nz);
  return [
    Math.round((nx / l1 * 0.5 + 0.5) * UINT16_MAX),
    Math.round((nz / l1 * 0.5 + 0.5) * UINT16_MAX),
  ];
}

function tile(tileId, worldOriginX, worldOriginZ) {
  const textureData = new Uint16Array(SIZE * SIZE * 4);
  for (let row = 0; row < SIZE; row++) for (let column = 0; column < SIZE; column++) {
    const x = worldOriginX + column * SPACING;
    const z = worldOriginZ + row * SPACING;
    const quantized = Math.round(heightAt(x, z) / SCALE);
    const oct = octNormal(x, z);
    const offset = (row * SIZE + column) * 4;
    textureData[offset] = quantized;
    textureData[offset + 1] = quantized;
    textureData[offset + 2] = oct[0];
    textureData[offset + 3] = oct[1];
  }
  return {
    tileId, width: SIZE, height: SIZE, textureData,
    layout: 'rgba16ui-height-parent-octnormal-v1',
    worldOriginX, worldOriginZ,
    heightOffsetWorld: 0,
    heightScaleMetres: SCALE,
    sampleSpacingMetres: SPACING,
    geometricErrorMetres: 0.05,
    maximumMorphDeltaMetres: 0,
    decodedSha256: tileId.padEnd(64, '0'),
  };
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb9cbbb);
scene.fog = new THREE.FogExp2(0xb9cbbb, 0.00125);
const camera = new THREE.PerspectiveCamera(43, innerWidth / innerHeight, 1, 3000);
camera.position.set(430, 245, 470);
camera.lookAt(0, 18, 0);
scene.add(new THREE.HemisphereLight(0xe7f1ea, 0x41523f, 2.2));
const sun = new THREE.DirectionalLight(0xfff1cc, 4.2);
sun.position.set(-260, 420, 190);
scene.add(sun);

const terrain = new TerrainTileBatchSet({ maximumTiles: 4, morphDurationMilliseconds: 0 });
scene.add(terrain.group);
terrain.sync([
  tile('l0/0/0', -256, -256), tile('l0/1/0', 0, -256),
  tile('l0/0/1', -256, 0), tile('l0/1/1', 0, 0),
], { now: 0 });

const forceWebGL = new URLSearchParams(location.search).get('gl') === '1';
const renderer = new THREE.WebGPURenderer({ antialias: true, samples: 4, forceWebGL });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.prepend(renderer.domElement);
await renderer.init();
await renderer.compileAsync(scene, camera);
await renderer.renderAsync(scene, camera);
document.getElementById('boot').classList.add('done');
window.V3D = {
  stats: { ...terrain.stats(), backend: renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2' },
  settled: () => true,
};

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  void renderer.renderAsync(scene, camera);
});
