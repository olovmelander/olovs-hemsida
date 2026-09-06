import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForGpuFrame } from './first-frame-ready.mjs';

afterEach(() => vi.useRealTimers());
describe('first scene presentation gate', () => {
  it('waits for WebGPU completion before allowing the loading cover to leave', async () => {
    let finish;
    const submitted = new Promise(resolve => { finish = resolve; });
    let ready = false;
    const waiting = waitForGpuFrame({ backend: { device: { queue: { onSubmittedWorkDone: () => submitted } } } })
      .then(() => { ready = true; });
    await Promise.resolve();
    expect(ready).toBe(false);
    finish(); await waiting;
    expect(ready).toBe(true);
  });

  function fixture() {
    const gl = { SYNC_GPU_COMMANDS_COMPLETE: 1, WAIT_FAILED: 2, TIMEOUT_EXPIRED: 3,
      fenceSync: vi.fn(() => ({})), flush: vi.fn(), deleteSync: vi.fn(),
      isContextLost: () => false, clientWaitSync: vi.fn(() => 3) };
    return { gl, renderer: { backend: { gl } } };
  }

  it('polls WebGL2 without blocking and releases the fence after completion', async () => {
    vi.useFakeTimers();
    const { gl, renderer } = fixture();
    const waiting = waitForGpuFrame(renderer);
    expect(gl.deleteSync).not.toHaveBeenCalled();
    gl.clientWaitSync.mockReturnValue(4);
    await vi.advanceTimersByTimeAsync(8); await waiting;
    expect(gl.flush).toHaveBeenCalledOnce();
    expect(gl.deleteSync).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps failed or lost graphics from being reported as a ready view', async () => {
    const { gl, renderer } = fixture();
    gl.isContextLost = () => true;
    await expect(waitForGpuFrame(renderer)).rejects.toThrow('context lost');
    expect(gl.deleteSync).toHaveBeenCalledOnce();
  });

  it('bounds a stalled GPU and cancels its polling', async () => {
    vi.useFakeTimers();
    const { gl, renderer } = fixture();
    const waiting = expect(waitForGpuFrame(renderer, { timeoutMilliseconds: 20 })).rejects.toThrow('did not finish');
    await vi.advanceTimersByTimeAsync(20); await waiting;
    expect(gl.deleteSync).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
