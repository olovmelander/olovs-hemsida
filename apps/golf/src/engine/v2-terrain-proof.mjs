import * as THREE from 'three/webgpu';
import { TerrainTileBatchSet } from './v2-terrain-batch.mjs';
import { loadTerrainPreview } from './v2-terrain-preview-loader.mjs';

const SIZE = 65;
const SPACING = 4;
const SCALE = 0.01;
const UINT16_MAX = 65_535;

function writeUint16LittleEndian(target, offset, value) {
  target[offset] = value & 0xff;
  target[offset + 1] = value >>> 8;
}

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

function syntheticTile(tileId, worldOriginX, worldOriginZ) {
  const textureData = new Uint8Array(SIZE * SIZE * 8);
  for (let row = 0; row < SIZE; row++) for (let column = 0; column < SIZE; column++) {
    const x = worldOriginX + column * SPACING;
    const z = worldOriginZ + row * SPACING;
    const quantized = Math.round(heightAt(x, z) / SCALE);
    const oct = octNormal(x, z);
    const offset = (row * SIZE + column) * 8;
    writeUint16LittleEndian(textureData, offset, quantized);
    writeUint16LittleEndian(textureData, offset + 2, quantized);
    writeUint16LittleEndian(textureData, offset + 4, oct[0]);
    writeUint16LittleEndian(textureData, offset + 6, oct[1]);
  }
  return {
    tileId, width: SIZE, height: SIZE, textureData,
    layout: 'rgba8x2-height-parent-octnormal-v1',
    worldOriginX, worldOriginZ,
    heightOffsetWorld: 0,
    heightScaleMetres: SCALE,
    sampleSpacingMetres: SPACING,
    geometricErrorMetres: 0.05,
    maximumMorphDeltaMetres: 0,
    decodedSha256: tileId.padEnd(64, '0'),
  };
}

function syntheticPreview() {
  return {
    descriptor: {
      label: 'instansierad terräng',
      provisional: true,
      camera: {
        position: [430, 245, 470], target: [0, 18, 0],
        fovDegrees: 43, nearMetres: 1, farMetres: 3000,
      },
    },
    resources: [
      syntheticTile('l0/0/0', -256, -256), syntheticTile('l0/1/0', 0, -256),
      syntheticTile('l0/0/1', -256, 0), syntheticTile('l0/1/1', 0, 0),
    ],
    synthetic: true,
  };
}

function sameOriginPreviewUrl(value) {
  const url = new URL(value, location.href);
  if (url.origin !== location.origin || url.username || url.password || url.hash) {
    throw new Error('preview descriptor must be a clean same-origin URL');
  }
  return url.href;
}

async function main() {
  const params = new URLSearchParams(location.search);
  const previewParameter = params.get('preview');
  const loaded = previewParameter
    ? { ...(await loadTerrainPreview(sameOriginPreviewUrl(previewParameter))), synthetic: false }
    : syntheticPreview();

  const title = document.getElementById('proof-title');
  const detail = document.getElementById('proof-detail');
  const backendLabel = document.getElementById('proof-backend');
  title.textContent = `D4 · ${loaded.descriptor.label}`;
  detail.textContent = loaded.synthetic
    ? 'Syntetiskt teknikbevis — inte en golfbana'
    : 'Verifierade BVCH-tiles · provisorisk visuell QA · produktion av';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xb9cbbb);
  scene.fog = new THREE.FogExp2(0xb9cbbb, loaded.synthetic ? 0.00125 : 0.00075);
  const view = loaded.descriptor.camera;
  const camera = new THREE.PerspectiveCamera(
    view.fovDegrees, innerWidth / innerHeight, view.nearMetres, view.farMetres,
  );
  camera.position.fromArray(view.position);
  camera.lookAt(...view.target);
  scene.add(new THREE.HemisphereLight(0xe7f1ea, 0x35443a, 2.35));
  const sun = new THREE.DirectionalLight(0xffedc5, 4.5);
  const span = Math.max(400, Math.hypot(view.position[0], view.position[2]));
  sun.position.set(-span * 0.65, span, span * 0.42);
  scene.add(sun);

  const terrain = new TerrainTileBatchSet({
    maximumTiles: loaded.resources.length,
    morphDurationMilliseconds: 0,
  });
  scene.add(terrain.group);
  terrain.sync(loaded.resources, { now: 0 });

  const forceWebGL = params.get('gl') === '1';
  const renderer = new THREE.WebGPURenderer({ antialias: true, samples: 4, forceWebGL });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  document.body.prepend(renderer.domElement);
  await renderer.init();
  await renderer.compileAsync(scene, camera);
  /* Texture-array creation and the first compositor presentation are separate
     operations on some WebGL2/SwiftShader devices. Capture only after two
     presented frames, never the correctly-cleared but not-yet-drawn first one. */
  for (let frame = 0; frame < 3; frame++) {
    await renderer.renderAsync(scene, camera);
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
  const backend = renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2';
  const renderInfo = renderer.info?.render || {};
  backendLabel.textContent = `${backend.toUpperCase()} · ${loaded.resources.length} tiles · ${terrain.stats().drawCalls} draw call`;
  document.getElementById('boot').classList.add('done');
  window.V3D = {
    stats: {
      ...terrain.stats(), backend, synthetic: loaded.synthetic,
      provisional: Boolean(loaded.descriptor.provisional),
      actualDrawCalls: renderInfo.calls ?? null,
      actualTriangles: renderInfo.triangles ?? null,
    },
    settled: () => true,
    render: () => renderer.renderAsync(scene, camera),
  };

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    void renderer.renderAsync(scene, camera);
  });
}

main().catch(error => {
  const message = String(error?.message || error || 'Okänt renderfel');
  document.getElementById('proof-title').textContent = 'D4 · renderfel';
  document.getElementById('proof-detail').textContent = message.slice(0, 180);
  document.getElementById('boot').classList.add('error');
  window.V3D = { error: message, settled: () => true };
  queueMicrotask(() => { throw error; });
});
