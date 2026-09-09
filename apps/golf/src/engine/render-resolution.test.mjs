import { describe, expect, it } from 'vitest';
import { createRenderResolution, requestedRenderResolution } from './render-resolution.mjs';

function fixture(options = {}) {
  let now = 0, pixelRatio = 1;
  const calls = [], size = [0, 0];
  const renderer = {
    domElement: { style: {} },
    setPixelRatio(r) { pixelRatio = r; calls.push(['ratio', r]); },
    setDrawingBufferSize(w, h, r) { size[0] = w; size[1] = h; pixelRatio = r; calls.push(['size', w, h, r]); },
  };
  const controller = createRenderResolution({ renderer, lowQuality: true, adaptive: true,
    width: 390, height: 844, devicePixelRatio: 3, ...options });
  return { controller, calls, size, ratio: () => pixelRatio,
    run(ms, interval = 1000 / 60, eligible = true) {
      const end = now + ms;
      while (now < end) { now += interval; controller.sample(interval, now, eligible); }
    },
    resize(w, h, native = 3) { controller.resize(w, h, native, now); },
    fallback() { controller.performanceFallback(now); },
  };
}

describe('independent render resolution', () => {
  it('starts low, earns sharper pixels under sustained load, and keeps geometry fixed', () => {
    const f = fixture();
    expect(f.ratio()).toBe(1);
    f.run(4500);
    expect(f.ratio()).toBe(1);
    f.run(1000);
    expect(f.ratio()).toBe(1.25);
    f.run(15_000);
    expect(f.ratio()).toBe(1.5);
    expect(f.controller.detailHeight()).toBe(844);
    expect(f.controller.snapshot().drawingBuffer).toEqual([585, 1266]);
    expect(f.calls.filter(c => c[0] === 'size')).toHaveLength(1);
  });
  it('does not mistake a 30 FPS baseline or brief fast burst for enough headroom', () => {
    const f = fixture();
    f.run(30_000, 1000 / 30);
    f.run(3000, 1000 / 60);
    f.run(10_000, 1000 / 30);
    expect(f.ratio()).toBe(1);
  });
  it('recovers from a heavier view or thermal slowdown and avoids repeated up/down steps', () => {
    const f = fixture();
    f.run(25_000);
    expect(f.ratio()).toBe(1.5);
    f.run(500, 50); // A single hitch/burst is insufficient.
    expect(f.ratio()).toBe(1.5);
    f.run(6000, 50);
    expect(f.ratio()).toBe(1);
    f.run(50_000);
    expect(f.ratio()).toBe(1);
    f.run(20_000);
    expect(f.ratio()).toBeGreaterThan(1);
    expect(f.controller.detailHeight()).toBe(844);
  });
  it('discards startup, hidden-tab and capture samples, then requires fresh evidence', () => {
    const f = fixture();
    f.run(30_000, 1000 / 60, false);
    f.run(5000);
    expect(f.ratio()).toBe(1);
    f.run(3000);
    expect(f.ratio()).toBe(1.25);
    const before = f.controller.snapshot().changes;
    f.controller.sample(60_000, 100_000, false);
    expect(f.controller.snapshot().changes).toBe(before);
  });
  it('returns to baseline after a long foreground stall and ignores invalid samples', () => {
    const f = fixture(); f.run(25_000);
    f.controller.sample(2500, 27_500, true);
    expect(f.ratio()).toBe(1);
    for (const interval of [NaN, Infinity, -1, 0]) f.controller.sample(interval, 28_000, true);
    expect(f.ratio()).toBe(1);
  });
  it.each([
    [{ devicePixelRatio: 1 }, 1],
    [{ devicePixelRatio: 1.25 }, 1.25],
    [{ width: 800, height: 700 }, 1.25],
    [{ width: 1920, height: 1080 }, 1],
  ])('respects native display and extra pixel limits: %j', (options, maximum) => {
    const f = fixture(options); f.run(30_000);
    expect(f.ratio()).toBe(maximum);
  });
  it('resets the budget on resize/rotation and responds to a new display DPR', () => {
    const f = fixture(); f.run(25_000);
    f.resize(844, 390);
    expect(f.ratio()).toBe(1);
    expect(f.controller.detailHeight()).toBe(390);
    f.run(25_000);
    expect(f.ratio()).toBe(1.5);
    f.resize(844, 390, 1);
    expect(f.ratio()).toBe(1);
    f.run(25_000);
    expect(f.ratio()).toBe(1);
  });
  it('applies fixed-ratio size changes without an intermediate oversized buffer', () => {
    const f = fixture({ width: 1920, height: 1080, requested: 1.5 });
    expect(f.ratio()).toBe(1);
    f.resize(390, 844);
    expect(f.calls).toEqual([['size', 1920, 1080, 1], ['size', 390, 844, 1.5]]);
    f.resize(1920, 1080);
    expect(f.calls.at(-1)).toEqual(['size', 1920, 1080, 1]);
  });
  it('keeps high quality and disabled adaptation at their existing resolution', () => {
    const high = fixture({ lowQuality: false }), locked = fixture({ adaptive: false });
    for (const f of [high, locked]) { f.run(30_000); f.run(30_000, 50); }
    expect(high.ratio()).toBe(2);
    expect(high.controller.detailHeight()).toBe(1688);
    expect(locked.ratio()).toBe(1);
    high.fallback();
    expect(high.ratio()).toBe(1);
    expect(high.controller.detailHeight()).toBe(844);
  });
  it('allows fixed sharpness independently of scene quality and diagnostic locks', () => {
    const f = fixture({ adaptive: false, requested: 1.5 });
    f.run(30_000, 50);
    expect(f.ratio()).toBe(1.5);
    expect(f.controller.detailHeight()).toBe(844);
    expect(f.controller.snapshot().mode).toBe('fixed');
    const high = fixture({ lowQuality: false, requested: 1.25 });
    expect(high.ratio()).toBe(1.25);
    expect(high.controller.detailHeight()).toBe(1688);
    high.fallback();
    expect(high.ratio()).toBe(1.25);
  });
  it('validates query overrides without converting empty or malformed values to a scale', () => {
    for (const q of ['', '?resolution=', '?resolution=0', '?resolution=NaN', '?resolution=100', '?resolution=auto']) {
      expect(requestedRenderResolution(q)).toBeNull();
    }
    expect(requestedRenderResolution('?q=lo&resolution=1.5')).toBe(1.5);
    expect(requestedRenderResolution('?resolution=1')).toBe(1);
  });
});
