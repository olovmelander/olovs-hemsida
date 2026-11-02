import { describe, expect, it } from 'vitest';
import { createFramePacer, shouldRenderFrame, resolveFrameCap, nextFrameCap, FRAME_CAP_KEY, DEFAULT_FRAME_CAP } from './frame-pacer.mjs';

/* renders a second at a display cadence (Hz) against a cap, over 5 s */
function rendered(hz, cap, seconds = 5) {
  const pacer = createFramePacer();
  let n = 0;
  const frames = Math.round(hz * seconds);
  for (let i = 0; i < frames; i++) if (shouldRenderFrame(pacer, 1000 + i * 1000 / hz, cap)) n++;
  return n / seconds;
}

describe('frame cap', () => {
  it('caps a fast panel to the target', () => {
    expect(rendered(240, 60)).toBeCloseTo(60, 0);
    expect(rendered(240, 30)).toBeCloseTo(30, 0);
    expect(rendered(120, 60)).toBeCloseTo(60, 0);
  });
  it('never renders below the target on a cadence that does not divide it', () => {
    expect(rendered(144, 60)).toBeGreaterThanOrEqual(60);
    expect(rendered(165, 60)).toBeGreaterThanOrEqual(60);
    expect(rendered(90, 60)).toBeCloseTo(90, 0);
  });
  it('is a no-op at or below the target and when unlimited', () => {
    expect(rendered(60, 60)).toBeCloseTo(60, 0);
    expect(rendered(45, 60)).toBeCloseTo(45, 0);
    expect(rendered(240, 0)).toBeCloseTo(240, 0);
  });
  it('answers a repeat call in the same frame the same way', () => {
    const pacer = createFramePacer();
    for (let i = 0; i < 20; i++) shouldRenderFrame(pacer, i * 1000 / 240, 60);
    const t = 21 * 1000 / 240, first = shouldRenderFrame(pacer, t, 60);
    expect(shouldRenderFrame(pacer, t + 0.2, 60)).toBe(first);
  });
  it('takes the URL first, then the stored choice, then 60', () => {
    const store = v => ({ getItem: k => (k === FRAME_CAP_KEY ? v : null) });
    expect(resolveFrameCap('?fps=0', store('30'))).toBe(0);
    expect(resolveFrameCap('?fps=120', null)).toBe(120);
    expect(resolveFrameCap('?fps=5', null)).toBe(30);
    expect(resolveFrameCap('', store('30'))).toBe(30);
    expect(resolveFrameCap('', store('0'))).toBe(0);
    expect(resolveFrameCap('', store('77'))).toBe(DEFAULT_FRAME_CAP);
    expect(resolveFrameCap('', { getItem: () => { throw new Error('blocked'); } })).toBe(DEFAULT_FRAME_CAP);
  });
  it('cycles 60, unlimited, 30', () => {
    expect(nextFrameCap(60)).toBe(0);
    expect(nextFrameCap(0)).toBe(30);
    expect(nextFrameCap(30)).toBe(60);
  });
});
