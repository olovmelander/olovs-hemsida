/* Screen clarity is independent of terrain/tree quality. Frame intervals are
   conservative feedback, not GPU timings or proof of spare GPU capacity. */
const STEPS = [1, 1.25, 1.5];
export const LOW_RESOLUTION_PIXEL_BUDGET = 1_000_000;
const finitePositive = (n, fallback) => Number.isFinite(n) && n > 0 ? n : fallback;

export function requestedRenderResolution(search = '') {
  const value = new URLSearchParams(search).get('resolution');
  return ['1', '1.25', '1.5', '2'].includes(value) ? Number(value) : null;
}

export function createRenderResolution({ renderer, lowQuality, adaptive = false,
  requested = null, width, height, devicePixelRatio = 1 }) {
  let w, h, nativeRatio, baseRatio, ratio, levels;
  let fallback = false, changes = 0, reason = 'initial', lastP90 = null;
  let samples = [], elapsed = 0, fastWindows = 0, slowWindows = 0;
  let settleUntil = 0, promoteAfter = 0;
  const fixed = [1, 1.25, 1.5, 2].includes(requested) ? requested : null;
  const automatic = !!(lowQuality && adaptive && fixed === null);

  function resetWindow() { samples = []; elapsed = 0; fastWindows = 0; slowWindows = 0; }
  function configure(nextWidth, nextHeight, nextNative) {
    w = Math.max(1, Math.floor(finitePositive(nextWidth, 1)));
    h = Math.max(1, Math.floor(finitePositive(nextHeight, 1)));
    nativeRatio = finitePositive(nextNative, 1);
    baseRatio = lowQuality || fallback ? 1 : Math.min(nativeRatio, 2);
    // Never lower the existing DPR-1 baseline on a large screen. Only the
    // extra clarity allocation is limited by this pixel budget.
    levels = STEPS.filter(r => r === 1 || (r <= nativeRatio && w * h * r * r <= LOW_RESOLUTION_PIXEL_BUDGET));
  }
  function initialRatio() {
    if (fixed === null) return baseRatio;
    const cap = lowQuality || fallback ? levels.at(-1) : Math.min(nativeRatio, 2);
    return Math.min(fixed, cap);
  }
  function sizeCanvas() {
    // Apply viewport and ratio together: rotating/resizing a fixed-sharpness
    // view must not briefly combine the old large size with the new ratio.
    renderer.setDrawingBufferSize(w, h, ratio);
    renderer.domElement.style.width = w + 'px';
    renderer.domElement.style.height = h + 'px';
  }
  function apply(next, why, now = 0) {
    if (next === ratio) return false;
    ratio = next; reason = why; changes++;
    // setPixelRatio already resizes Three's owned output targets. A second
    // setSize here would repeat that work; CSS dimensions stay unchanged.
    renderer.setPixelRatio(ratio);
    resetWindow(); settleUntil = now + 1500;
    return true;
  }
  configure(width, height, devicePixelRatio);
  ratio = initialRatio();
  sizeCanvas();

  return {
    // Both terrain error and optional screen-space tree LOD use this budget,
    // so a sharper image does not also request more geometry or streamed tiles.
    detailHeight: () => Math.max(1, Math.floor(h * baseRatio)),
    snapshot: () => ({ mode: fixed !== null ? 'fixed' : automatic ? 'adaptive' : 'quality',
      requested: fixed, pixelRatio: ratio, detailPixelRatio: baseRatio,
      maximumPixelRatio: lowQuality || fallback ? levels.at(-1) : Math.min(nativeRatio, 2),
      drawingBuffer: [Math.floor(w * ratio), Math.floor(h * ratio)],
      extraPixelBudget: lowQuality || fallback ? LOW_RESOLUTION_PIXEL_BUDGET : null,
      changes, reason, frameP90Ms: lastP90 }),
    resize(nextWidth, nextHeight, nextNative, now = 0) {
      configure(nextWidth, nextHeight, nextNative);
      const next = initialRatio();
      if (next !== ratio) { ratio = next; reason = 'resize'; changes++; }
      sizeCanvas();
      resetWindow(); settleUntil = now + 1500;
    },
    performanceFallback(now = 0) {
      fallback = true;
      configure(w, h, nativeRatio);
      apply(initialRatio(), 'performance-fallback', now);
      resetWindow();
    },
    sample(intervalMs, now, eligible = true) {
      if (!automatic || fallback || levels.length < 2) return false;
      if (!eligible || !Number.isFinite(now) || !Number.isFinite(intervalMs) || intervalMs <= 0) {
        resetWindow(); settleUntil = (Number.isFinite(now) ? now : 0) + 1500; return false;
      }
      if (intervalMs > 1000) {
        // A long foreground stall (or return from a suspended tab) is never
        // evidence for retaining extra pixel work. Restart from the baseline.
        resetWindow(); settleUntil = now + 1500; promoteAfter = now + 10_000;
        return apply(1, 'long-frame-gap', now);
      }
      if (now < settleUntil) return false;
      samples.push(intervalMs); elapsed += intervalMs;
      if (elapsed < 1000) return false;
      samples.sort((a, b) => a - b);
      lastP90 = samples[Math.ceil(samples.length * 0.9) - 1];
      samples = []; elapsed = 0;
      const index = levels.indexOf(ratio), next = levels[index + 1];
      // Two sustained slow windows step down. Promotion needs five windows
      // and a pixel-area estimate below 28 ms, leaving room for a 30 FPS view.
      slowWindows = lastP90 > 37 ? slowWindows + 1 : 0;
      fastWindows = next && lastP90 * (next / ratio) ** 2 < 28 ? fastWindows + 1 : 0;
      if (slowWindows >= 2 && index > 0) {
        promoteAfter = now + 60_000;
        return apply(levels[index - 1], 'sustained-slow-frames', now);
      }
      if (fastWindows >= 5 && next && now >= promoteAfter) {
        promoteAfter = now + 10_000;
        return apply(next, 'sustained-headroom', now);
      }
      return false;
    },
  };
}
