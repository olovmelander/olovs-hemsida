import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { warmFramePipelines } from './warm-pipelines.mjs';

class FakePipelines {
  constructor() { this.calls = []; }
  getForRender(object, promises = null) { this.calls.push([object, promises]); if (promises) promises.push(Promise.resolve()); }
  updateForRender(object) { this.getForRender(object); }
}

describe('the warm frame', () => {
  it('sends a frame\'s pipelines down the parallel path, and only that frame\'s', async () => {
    const pipelines = new FakePipelines();
    let frames = 0;
    const report = await warmFramePipelines({ _pipelines: pipelines }, () => { if (!frames++) { pipelines.updateForRender('a'); pipelines.updateForRender('b'); } });
    expect(report).toMatchObject({ warmed: true, pipelines: 2 });
    expect(pipelines.calls.every(([, promises]) => Array.isArray(promises))).toBe(true);
    pipelines.updateForRender('after');
    expect(pipelines.calls.at(-1)).toEqual(['after', null]);
    expect(Object.hasOwn(pipelines, 'updateForRender')).toBe(false);
  });
  it('repeats until a frame asks for nothing new, since a frame can change what the next one needs', async () => {
    const pipelines = new FakePipelines();
    let frames = 0;
    const report = await warmFramePipelines({ _pipelines: pipelines }, () => { frames++; if (frames < 3) pipelines.updateForRender(`f${frames}`); });
    expect(frames).toBe(3);
    expect(report).toMatchObject({ warmed: true, pipelines: 2, frames: 3 });
  });
  it('stops at its bound however many frames keep asking', async () => {
    const pipelines = new FakePipelines();
    let frames = 0;
    await warmFramePipelines({ _pipelines: pipelines }, () => { frames++; pipelines.updateForRender('again'); });
    expect(frames).toBe(4);
  });
  it('waits until every pipeline is built', async () => {
    let built = null;
    const pipelines = new FakePipelines();
    pipelines.getForRender = (object, promises) => promises.push(new Promise(resolve => { built = resolve; }));
    let frames = 0;
    const warm = warmFramePipelines({ _pipelines: pipelines }, () => { if (!frames++) pipelines.updateForRender('a'); });
    const settled = vi.fn(); warm.then(settled);
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(settled).not.toHaveBeenCalled();
    built();
    await expect(warm).resolves.toMatchObject({ warmed: true });
  });
  it('puts the renderer back when the frame throws', async () => {
    const pipelines = new FakePipelines();
    await expect(warmFramePipelines({ _pipelines: pipelines }, () => { throw new Error('frame'); })).rejects.toThrow('frame');
    expect(Object.hasOwn(pipelines, 'updateForRender')).toBe(false);
  });
  it('opens anyway when a driver never finishes', async () => {
    const pipelines = new FakePipelines();
    pipelines.getForRender = (object, promises) => promises.push(new Promise(() => {}));
    const report = await warmFramePipelines({ _pipelines: pipelines }, () => pipelines.updateForRender('a'), { timeoutMs: 5 });
    expect(report).toMatchObject({ warmed: false, pipelines: 1 });
  });
  it('leaves a renderer without the hook alone', async () => {
    const frame = vi.fn();
    expect(await warmFramePipelines({}, frame)).toMatchObject({ warmed: false });
    expect(frame).not.toHaveBeenCalled();
  });
  it('is wired in behind ?warmframe=0, and asks for the shadow map again', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toContain("BOOTQ.get('warmframe') !== '0'");
    expect(main).toContain('BOOT_PERF.warmFrame = await warmFramePipelines(renderer, renderActivePipeline);');
    const warm = main.indexOf('BOOT_PERF.warmFrame = await');
    expect(main.indexOf('sun.shadow.needsUpdate = true;', warm)).toBeLessThan(main.indexOf("span('GPU startup: warm frame'", warm));
  });
});
