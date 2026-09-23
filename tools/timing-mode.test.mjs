import { describe, it, expect } from 'vitest';
import { timingQuery, timingQueryString, gpuUtilisation, assertGpuIdle } from './timing-mode.mjs';

describe('timing mode', () => {
  it('measures normal use unless det is asked for', () => {
    expect(timingQuery()).toEqual({ qualitylock: '1', q: 'hi' });
    expect(timingQuery({ quality: 'lo' })).toEqual({ qualitylock: '1', q: 'lo' });
    expect(timingQuery({ det: true })).toEqual({ qualitylock: '1', q: 'hi', det: '1' });
    expect(timingQueryString()).toBe('&qualitylock=1&q=hi');
  });
  it('reads the busiest GPU and reports none without nvidia-smi', () => {
    expect(gpuUtilisation(() => '3\n41\n')).toBe(41);
    expect(gpuUtilisation(() => { throw new Error('ENOENT'); })).toBe(null);
  });
  it('refuses a busy GPU, allows it when asked, and passes a quiet or unknown one', async () => {
    const quiet = () => 4, busy = () => 100, none = () => null, log = () => {};
    await expect(assertGpuIdle({ read: busy, intervalMs: 0, log })).rejects.toThrow(/100% busy/);
    expect(await assertGpuIdle({ read: busy, intervalMs: 0, allowBusy: true, log })).toEqual({ checked: true, utilisation: 100, allowedBusy: true });
    expect(await assertGpuIdle({ read: quiet, intervalMs: 0, log })).toEqual({ checked: true, utilisation: 4, allowedBusy: false });
    expect(await assertGpuIdle({ read: none, intervalMs: 0, log })).toEqual({ checked: false, utilisation: null, allowedBusy: false });
  });
  it('uses the quietest reading, so the tool\'s own launch does not refuse the run', async () => {
    const readings = [60, 5, 30];
    expect((await assertGpuIdle({ read: () => readings.shift(), intervalMs: 0, log: () => {} })).utilisation).toBe(5);
  });
});
