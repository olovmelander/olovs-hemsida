import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColorManagement, FloatType, HalfFloatType, NoToneMapping } from 'three/webgpu';
import { prepareOpeningGpu } from './prepare-opening-gpu.mjs';

afterEach(() => vi.restoreAllMocks());
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(count = 7) {
  const children = Array.from({ length: count }, (_, id) => ({ id, visible: true }));
  children.push({ isLight: true, visible: true }, { visible: false });
  const scene = { children, updateMatrixWorld: vi.fn() }, camera = {};
  const originalTarget = { name: 'original' }, originalMRT = {};
  let target = originalTarget, mrt = originalMRT;
  const renderer = { samples: 4, reversedDepthBuffer: true, toneMapping: 123, outputColorSpace: 'srgb',
    debug: { onShaderError: null }, backend: { device: { pushErrorScope: vi.fn(), popErrorScope: vi.fn(async () => null) } },
    getRenderTarget: () => target, setRenderTarget: value => { target = value; },
    getMRT: () => mrt, setMRT: value => { mrt = value; },
    getOutputBufferType: () => HalfFloatType, getDrawingBufferSize: vector => vector.set(1600, 900),
    compileAsync: vi.fn(async () => {}) };
  const scenePass = { renderTarget: { texture: {}, depthTexture: {} }, options: {}, getMRT: () => null, setSize: vi.fn() };
  const restored = () => {
    expect(renderer.getRenderTarget()).toBe(originalTarget); expect(renderer.getMRT()).toBe(originalMRT);
    expect(renderer.toneMapping).toBe(123); expect(renderer.outputColorSpace).toBe('srgb');
    expect(renderer.debug.onShaderError).toBe(null);
  };
  return { scene, camera, renderer, scenePass, restored };
}

describe('opening GPU preparation', () => {
  it('bounds in-flight compilation and compiles original branches in their final scene', async () => {
    const f = fixture(), waits = Array.from({ length: 7 }, deferred);
    const originalChildren = [...f.scene.children];
    let active = 0, peak = 0;
    f.renderer.compileAsync.mockImplementation(async (object, camera, scene) => {
      expect(camera).toBe(f.camera); expect(scene).toBe(f.scene);
      expect(scene.children).toEqual(originalChildren);
      active++; peak = Math.max(peak, active);
      await waits[object.id].promise; active--;
    });
    const preparing = prepareOpeningGpu(f.renderer, f.scene, f.camera);
    expect(f.renderer.compileAsync).toHaveBeenCalledTimes(4);
    waits[1].resolve(); await vi.waitFor(() => expect(f.renderer.compileAsync).toHaveBeenCalledTimes(5));
    for (const wait of waits) wait.resolve();
    expect(await preparing).toMatchObject({ completed: 7, branches: 7, concurrency: 4, target: 'canvas' });
    expect(peak).toBe(4); f.restored();
  });

  it('matches the HDR scene pass, MSAA and reversed depth without changing the displayed tone mapping', async () => {
    const f = fixture();
    f.renderer.compileAsync.mockImplementation(async () => {
      expect(f.renderer.getRenderTarget()).toBe(f.scenePass.renderTarget);
      expect(f.renderer.getMRT()).toBe(null);
      expect(f.renderer.toneMapping).toBe(NoToneMapping);
      expect(f.renderer.outputColorSpace).toBe(ColorManagement.workingColorSpace);
      expect(f.scenePass.renderTarget).toMatchObject({ samples: 4, texture: { type: HalfFloatType }, depthTexture: { type: FloatType } });
    });
    await prepareOpeningGpu(f.renderer, f.scene, f.camera, { scenePass: f.scenePass });
    expect(f.scenePass.setSize).toHaveBeenCalledWith(1600, 900);
    f.restored();
  });

  it('drains outstanding work after a rejection before restoring render state', async () => {
    const f = fixture(), wait = deferred(); let settled = false;
    f.renderer.compileAsync.mockImplementation(object => object.id === 0 ? Promise.reject(new Error('compile failed')) : wait.promise);
    const preparing = prepareOpeningGpu(f.renderer, f.scene, f.camera, { scenePass: f.scenePass, concurrency: 2 });
    const rejection = expect(preparing.finally(() => { settled = true; })).rejects.toThrow('Could not prepare');
    await Promise.resolve(); await Promise.resolve();
    expect(settled).toBe(false); expect(f.renderer.getRenderTarget()).toBe(f.scenePass.renderTarget);
    expect(f.renderer.compileAsync).toHaveBeenCalledTimes(2);
    wait.resolve(); await rejection; f.restored();
  });

  it('rejects a Three pipeline error even when compileAsync resolves', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const original = console.error, f = fixture();
    f.renderer.compileAsync.mockImplementation(async () => console.error('WebGPURenderer: Async render pipeline creation failed'));
    await expect(prepareOpeningGpu(f.renderer, f.scene, f.camera)).rejects.toThrow('Could not prepare');
    expect(console.error).toBe(original); f.restored();
  });

  it('rejects validation errors and restores hooks even if the validation pop rejects', async () => {
    const f = fixture();
    f.renderer.backend.device.popErrorScope.mockResolvedValueOnce({ message: 'invalid buffer' });
    await expect(prepareOpeningGpu(f.renderer, f.scene, f.camera)).rejects.toThrow('Could not prepare');
    f.restored();
    f.renderer.backend.device.popErrorScope.mockRejectedValueOnce(new Error('device lost'));
    await expect(prepareOpeningGpu(f.renderer, f.scene, f.camera)).rejects.toThrow('device lost');
    f.restored();
  });

  it('preserves explicit pass samples and conventional depth', async () => {
    const f = fixture(); f.renderer.reversedDepthBuffer = false;
    f.scenePass.options.samples = 1; f.scenePass.renderTarget.depthTexture.type = 17;
    await prepareOpeningGpu(f.renderer, f.scene, f.camera, { scenePass: f.scenePass });
    expect(f.scenePass.renderTarget.samples).toBe(1); expect(f.scenePass.renderTarget.depthTexture.type).toBe(17);
    f.restored();
  });

  it('refuses an unbounded burst without changing any renderer state', async () => {
    const f = fixture();
    await expect(prepareOpeningGpu(f.renderer, f.scene, f.camera, { concurrency: 50 })).rejects.toThrow('concurrency');
    expect(f.renderer.compileAsync).not.toHaveBeenCalled(); f.restored();
  });
});
