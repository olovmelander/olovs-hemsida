/* The shadow box's size (engine/shadow-fit.mjs): within the tuned range the
   box is exactly what it was, and past it the box is the 1150 m box scaled,
   so a camera pulled far back keeps its shadows across the view. */
import { describe, it, expect } from 'vitest';
import { SHADOW_FITS, SHADOW_FIT_TUNED, chooseShadowFit, shadowBoxFor } from './shadow-fit.mjs';
import { preparedTintAllowed } from './prepared-ground-tint.mjs';
import { preparedWaterAllowed } from './prepared-water.mjs';
import { preparedVistaAllowed } from './prepared-vista.mjs';
import { preparedScatterAllowed } from './prepared-scatter.mjs';

/* placeSun's want: the camera's distance to its target plus a margin, within the fits */
const wantFor = (distance, max) => Math.min(max, Math.max(260, distance * 1.15 + 90));
const MAX = SHADOW_FITS[SHADOW_FITS.length - 1];

describe('the shadow box within the tuned range', () => {
  it('keeps every tuned fit\'s depth range, light distance and normal bias', () => {
    for (const R of [260, 400, 600, 850, 1150]) {
      expect(shadowBoxFor(R)).toEqual({ near: 200, far: 2400, lightDistance: 1200, normalBias: 0.22 * Math.min(2.5, R / 260) });
    }
  });
  it('chooses the same fits as before for every camera within 900 m of its target', () => {
    /* the rule before the larger fits existed, verbatim */
    const before = (want, current) => {
      const fits = [260, 400, 600, 850, 1150];
      let R = current || 0;
      if (!R || want > R) R = fits.find(f => f >= want) ?? fits[fits.length - 1];
      else { const i = fits.indexOf(R); if (i > 0 && want < fits[i - 1] * 0.9) R = fits.find(f => f >= want) ?? R; }
      return R;
    };
    let now = 0, then = 0;
    /* out, in and out again, so the hysteresis is walked both ways */
    const path = [];
    for (let d = 5; d <= 900; d += 5) path.push(d);
    for (let d = 900; d >= 5; d -= 7) path.push(d);
    for (let d = 5; d <= 900; d += 3) path.push(d);
    for (const d of path) {
      now = chooseShadowFit(wantFor(d, MAX), now);
      then = before(wantFor(d, 1150), then);
      expect(now).toBe(then);
    }
  });
});

describe('the shadow box past the tuned range', () => {
  it('is the 1150 m box scaled: depth range, light distance and normal bias in proportion', () => {
    const tuned = shadowBoxFor(SHADOW_FIT_TUNED);
    for (const R of SHADOW_FITS.filter(f => f > SHADOW_FIT_TUNED)) {
      const box = shadowBoxFor(R), k = R / SHADOW_FIT_TUNED;
      for (const key of ['near', 'far', 'lightDistance', 'normalBias']) expect(box[key]).toBeCloseTo(tuned[key] * k, 9);
      /* the depth bias is a fixed fraction of the depth range, so it scales with it too, and the
         target keeps its place in that range: the reach toward and away from the sun grows with the box */
      expect((box.lightDistance - box.near) / (box.far - box.near)).toBeCloseTo((tuned.lightDistance - tuned.near) / (tuned.far - tuned.near), 12);
    }
  });
  it('grows with the camera as it pulls back, to the largest fit, and no further under ?shadowreach=0', () => {
    let R = 0, Rbefore = 0, last = 0;
    for (let d = 50; d <= 4200; d += 25) {
      R = chooseShadowFit(wantFor(d, MAX), R);
      Rbefore = chooseShadowFit(wantFor(d, SHADOW_FIT_TUNED), Rbefore);
      expect(R).toBeGreaterThanOrEqual(last);
      expect(R).toBeGreaterThanOrEqual(wantFor(d, MAX));
      expect(Rbefore).toBeLessThanOrEqual(SHADOW_FIT_TUNED);
      last = R;
    }
    expect(R).toBe(MAX);
    expect(Rbefore).toBe(SHADOW_FIT_TUNED);
    /* two kilometres out: the old box held full shadow to 690 m of the target, this one to 0.6 R */
    expect(chooseShadowFit(wantFor(2000, MAX), 0) * 0.6).toBeGreaterThan(1500);
  });
  it('leaves the prepared startup paths eligible for the shadow before-and-after switches', () => {
    for (const allowed of [preparedTintAllowed, preparedWaterAllowed, preparedVistaAllowed, preparedScatterAllowed])
      for (const flag of ['shadowreach=0', 'impostorshadow=0', 'foliageshadow=mip', 'offscreenshadow=0']) expect(allowed(`?bana=puttom&${flag}`)).toBe(true);
  });
  it('shrinks with hysteresis on the way back in, as the tuned fits do', () => {
    expect(chooseShadowFit(2100, 3000)).toBe(3000);
    expect(chooseShadowFit(1950, 3000)).toBe(2200);
    expect(chooseShadowFit(1500, 2200)).toBe(2200);
    expect(chooseShadowFit(1400, 2200)).toBe(1600);
    expect(chooseShadowFit(1100, 1600)).toBe(1600);
    expect(chooseShadowFit(1000, 1600)).toBe(1150);
  });
});
