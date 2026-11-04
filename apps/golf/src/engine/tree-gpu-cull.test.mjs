import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BufferGeometry, Float32BufferAttribute, InstancedMesh, MeshBasicNodeMaterial } from 'three/webgpu';
import { TREE_SHADOW_LAYER, storageInstanceAttribute } from './tree-gpu-cull.mjs';
import { reserveTreeTier } from './tree-tier-capacity.mjs';

const source = fs.readFileSync(new URL('./tree-gpu-cull.mjs', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');

describe('the trees culled on the GPU', () => {
  it('gives a tier storage-capable instance buffers, and keeps them so when the tier grows', () => {
    const a = storageInstanceAttribute(8, 16);
    expect(a.isStorageInstancedBufferAttribute).toBe(true);
    expect(a.count).toBe(8);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    geo.setAttribute('aFade', storageInstanceAttribute(4, 2));
    geo.setAttribute('aTint', storageInstanceAttribute(4, 4));
    const im = new InstancedMesh(geo, new MeshBasicNodeMaterial(), 4);
    im.instanceMatrix = storageInstanceAttribute(4, 16);
    const tier = { parts: [im], slots: new Int32Array(4), count: 4 };
    expect(reserveTreeTier(tier, 10, 100)).toBe(true);
    expect(im.instanceMatrix.isStorageInstancedBufferAttribute).toBe(true);
    expect(im.instanceMatrix.count).toBeGreaterThanOrEqual(10);
    expect(im.geometry.getAttribute('aFade').isStorageInstancedBufferAttribute).toBe(true);
    expect(im.geometry.getAttribute('aTint').isStorageInstancedBufferAttribute).toBe(true);
  });
  it('draws every tree into the shadow map from the tier itself, and only the ones in view in colour', () => {
    expect(source).toContain('im.layers.set(TREE_SHADOW_LAYER);');
    expect(source).toContain('sun.shadow.camera.layers.enable(TREE_SHADOW_LAYER);');
    expect(source).toContain('im.castShadow = false;');
    expect(TREE_SHADOW_LAYER).not.toBe(0);
    /* the copy follows a tier that grew */
    expect(source).toContain('if (crown.instanceMatrix !== e.srcMatrix) build(e);');
    /* crown and trunk draw one count */
    expect(source).toContain('atomicStore(a.element(6), atomicLoad(a.element(1)));');
  });
  it('runs only when asked, on WebGPU at high quality, before each frame', () => {
    expect(main).toContain("const TREE_GPU_CULL = IS_GPU && !LOWQ && new URLSearchParams(location.search).get('treecull') === 'gpu';");
    expect(main).toContain('if (TREE_GPU_CULL) im.instanceMatrix = storageInstanceAttribute(initialCapacity, 16);');
    expect(main).toContain('treeGpuCull?.update(camera);');
  });
});
