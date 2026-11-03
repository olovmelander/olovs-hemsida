import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardParallelCompile } from './webgl-compile-guard.mjs';

/* a WebGL2 backend's shape, as far as createRenderPipeline touches it */
function backend() {
  const programs = new Map();
  let next = 1;
  const gl = {
    createProgram: () => { const p = { id: next++ }; programs.set(p, { done: false, alive: true }); return p; },
    attachShader() {}, linkProgram() {},
    isProgram: p => programs.get(p)?.alive === true,
    getProgramParameter: (p, pname) => (programs.get(p)?.alive ? programs.get(p).done : null),
    deleteProgram: p => { programs.get(p).alive = false; },
  };
  const store = new Map();
  const b = {
    isWebGLBackend: true, gl, parallel: { COMPLETION_STATUS_KHR: 0x91B1 },
    get: k => { if (!store.has(k)) store.set(k, {}); return store.get(k); },
    set: (k, v) => store.set(k, v),
    _completeCompile: vi.fn(),
    createRenderPipeline: vi.fn(),
    programs,
  };
  return b;
}
const renderObject = () => ({ pipeline: { fragmentProgram: {}, vertexProgram: {} } });

describe('a pipeline destroyed while it compiles', () => {
  let frames;
  beforeEach(() => { frames = []; vi.stubGlobal('requestAnimationFrame', fn => frames.push(fn)); });
  afterEach(() => vi.unstubAllGlobals());
  const tick = () => { const run = frames.splice(0); run.forEach(fn => fn()); };

  it('completes a program that finishes, as three does', async () => {
    const b = backend(); expect(guardParallelCompile(b)).toBe(true);
    const promises = [], ro = renderObject();
    b.createRenderPipeline(ro, promises);
    tick(); expect(b._completeCompile).not.toHaveBeenCalled();
    for (const s of b.programs.values()) s.done = true;
    tick();
    await promises[0];
    expect(b._completeCompile).toHaveBeenCalledWith(ro, ro.pipeline);
  });
  it('resolves and stops polling when the program is deleted first', async () => {
    const b = backend(); guardParallelCompile(b);
    const promises = [];
    b.createRenderPipeline(renderObject(), promises);
    tick();
    for (const p of b.programs.keys()) b.gl.deleteProgram(p);
    tick();
    await promises[0];
    expect(b._completeCompile).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
  });
  it('leaves WebGPU, a backend without the extension and a synchronous compile alone', () => {
    expect(guardParallelCompile({ isWebGLBackend: false })).toBe(false);
    const plain = backend(); plain.parallel = null;
    expect(guardParallelCompile(plain)).toBe(false);
    const b = backend(), original = b.createRenderPipeline;
    guardParallelCompile(b);
    b.createRenderPipeline(renderObject(), null);
    expect(original).toHaveBeenCalled();
    expect(guardParallelCompile(b)).toBe(false);
  });
  it('is installed on the renderer\'s backend in main.js', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/guardParallelCompile\(renderer\.backend\)/);
  });
});
