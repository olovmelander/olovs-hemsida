/* Synthetic shader/capture fixture, not course geography or a shipped asset. */
import * as THREE from 'three/webgpu';
import { createV2GroundMaterialDecorator } from './material.js';
import { fillGroundDetailPixels } from './ground-detail-texture.mjs';
import { createPackedGroundDetailTexture } from './ground-detail-upload.mjs';
import { SURFACE } from './surface.js';

export function createGroundReliefFixture(surfaceRelief) {
  const size = 128, bounds = { x0: -8, z0: -8, x1: 8, z1: 8, w: size, h: size, res: 16 / size };
  const channels = [SURFACE.GREEN, SURFACE.FAIRWAY, SURFACE.SAND];
  const rectangles = [[-4, -4, 0, 0], [0, -4, 4, 0], [0, 0, 4, 4]];
  const data = new Uint8Array(size * size * 4);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    const x = bounds.x0 + (c + 0.5) * bounds.res, z = bounds.z0 + (r + 0.5) * bounds.res;
    rectangles.forEach(([x0, z0, x1, z1], channel) => {
      const inside = Math.min(x - x0, x1 - x, z - z0, z1 - z);
      const distance = inside >= 0 ? inside : -Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
      data[(r * size + c) * 4 + channel] = Math.round((Math.max(-4, Math.min(4, distance)) + 4) / 8 * 255);
    });
  }
  const texSdf = new THREE.DataTexture(data, size, size);
  texSdf.minFilter = texSdf.magFilter = THREE.LinearFilter;
  texSdf.needsUpdate = true;
  const texF = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
  texF.needsUpdate = true;
  let DETAIL;
  if (surfaceRelief === 'off') {
    // Match the current app baseline, including its lossy canvas alpha path.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const context = canvas.getContext('2d'), pixels = context.createImageData(512, 512);
    fillGroundDetailPixels(pixels.data, 512, { seamless: true });
    context.putImageData(pixels, 0, 0);
    DETAIL = new THREE.CanvasTexture(canvas);
    DETAIL.wrapS = DETAIL.wrapT = THREE.RepeatWrapping;
    DETAIL.anisotropy = 8;
  } else DETAIL = createPackedGroundDetailTexture();
  const C = Object.fromEntries(Object.entries({ rough: 0x4c7135, forest: 0x405433, heath: 0x77764c,
    semi: 0x65933e, fair: 0x60a03e, fringe: 0x649540, green: 0x489a4c, tee: 0x60a03e,
    sand: 0xd6c497, path: 0x938d7b, aspL: 0x575957, hard: 0x9e9884, soil: 0x786747,
    wet: 0x4d6042, rock: 0x858881, shore: 0xb6ae88 }).map(([key, value]) => [key, new THREE.Color(value).toArray()]));
  const SHADE = Array.from({ length: 32 }, () => [0.62, 1.25, 0.06, 0]);
  SHADE[SURFACE.FAIRWAY] = [1.55, 0.44, 0.28, 1.15];
  SHADE[SURFACE.SAND] = [2.3, 0.58, 0.14, 0];
  const atlas = { bounds, texSdf: [texSdf], texF, data: {
    representation: 'class-sdf-v1', channels, routeStepMetres: 0.25, ringStepMetres: 0.16,
  } };
  return { decorateMaterial: createV2GroundMaterialDecorator({ atlas, DETAIL, C, SHADE,
    graphicsPolish: true, surfaceRelief }), textures: [DETAIL, texSdf, texF] };
}
