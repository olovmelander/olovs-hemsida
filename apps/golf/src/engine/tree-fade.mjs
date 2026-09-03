/* Tree LOD phase 4: the dithered crossfade between tiers (docs/tree-lod-plan.md).
 *
 * A tree that changes tier is drawn by BOTH tiers for a short while: the old
 * entry fades out and the new one fades in, and the two never blend -- every
 * pixel is owned by exactly one of them. The ownership is a 4x4 ordered Bayer
 * dither in screen space: the pair (in, out) of one tree carries complementary
 * masks, so at fade level L the pixels with Bayer index below L show the new
 * tier and the rest still show the old one. Screen space is the only space in
 * which two different geometries (a 1,068-triangle crown and a 204-triangle
 * one, or a mesh and a billboard) can be given exactly complementary masks.
 *
 * The progress is quantised to sixteen levels, computed in f32 by the shader
 * and in f32 by the CPU twin here, so the two can never disagree by an ULP
 * about which level a pixel is on; the epsilon, the late drain and the
 * half-level reversal below are what make that hold at the level boundaries.
 *
 * Pure JS first (unit-tested, the CPU reference), then the TSL mask. */
import * as THREE from 'three/webgpu';
import { Fn, float, int, bool, attribute, varying, screenCoordinate, uniform, floor, saturate, select, oneMinus } from 'three/tsl';

export const FADE_LEVELS = 16;
/* of a level, either side of every boundary: an f32 second below 1024 s has
   at most 0.12 ms of ULP, and a 0.3 s fade's level is 18.75 ms */
export const FADE_EPS = 1 / 64;
/* the fade clock is rebased below this so it keeps its precision forever */
export const FADE_EPOCH_S = 512;
/* codes: 0 steady, 1 IN polarity 0, 2 IN polarity 1, 3 OUT polarity 0, 4 OUT polarity 1;
   PAIR[c] is the code of the other half of the same tree's fade */
export const PAIR = Object.freeze([0, 4, 3, 2, 1]);

export const treeFadeClock = uniform(0);      /* seconds, epoch-relative (TREE_LOD.fadeClock) */
export const treeFadeDuration = uniform(0);   /* seconds; <= 0 means no fade in flight anywhere */

/** The classic 4x4 Bayer matrix, integers 0..15. */
export function bayer4(x, y) {
  const m2 = (a, b) => ((a & 1) << 1) ^ ((b & 1) * 3);
  return 4 * m2(x & 1, y & 1) + m2((x >> 1) & 1, (y >> 1) & 1);
}

/** The shader's arithmetic, f32 at every step: the fade level in [0, 1] in steps of 1/16. */
export function fadeProgress(clock, t0, dur) {
  if (!(dur > 0)) return 1;
  const raw = Math.fround(Math.fround(Math.fround(clock) - Math.fround(t0)) / Math.fround(dur));
  return Math.floor(Math.min(1, Math.max(0, raw)) * FADE_LEVELS + FADE_EPS) / FADE_LEVELS;
}

/** When an OUT entry may be removed: one level after the fade completes, so
 *  the frame that removes it is drawing a fully discarded entry anyway. */
export function drainAt(t0, dur) { return t0 + dur * (1 + 1 / FADE_LEVELS); }

/** Does a pixel with dither value b = (bayer + 0.5) / 16 belong to this entry at level f? */
export function fadeKeep(code, f, b) {
  switch (code) {
    case 0: return true;
    case 1: return b < f;
    case 2: return b >= 1 - f;
    case 3: return b < 1 - f;
    case 4: return b >= f;
  }
  throw new RangeError(`fade code ${code}`);
}

/** A tree asked to go back while its fade runs: the new fade starts from the
 *  level the old one had reached, so the kept pixel sets are continuous. The
 *  new t0 is placed half a level inside its level, away from both boundaries. */
export function reversedFade(clock, t0, dur, inCode) {
  const f = fadeProgress(clock, t0, dur);
  return { t0: Math.fround(clock - (1 - f + 0.5 / FADE_LEVELS) * dur), inCode: inCode === 1 ? 2 : 1 };
}

/* the per-fragment keep mask for a geometry carrying aFade = (t0, code) per instance */
export const treeFadeMask = Fn(() => {
  const fade = varying(attribute('aFade', 'vec2')).setInterpolation('flat', 'either');
  const code = fade.y;
  const raw = saturate(treeFadeClock.sub(fade.x).div(treeFadeDuration.max(1e-4)));
  const f = select(treeFadeDuration.lessThanEqual(0), float(1),
                   floor(raw.mul(FADE_LEVELS).add(FADE_EPS)).div(FADE_LEVELS));
  const ix = int(screenCoordinate.x).bitAnd(int(3)), iy = int(screenCoordinate.y).bitAnd(int(3));
  const m2 = (a, b) => a.bitAnd(int(1)).shiftLeft(int(1)).bitXor(b.bitAnd(int(1)).mul(int(3)));
  const bayer = m2(ix, iy).mul(int(4)).add(m2(ix.shiftRight(int(1)), iy.shiftRight(int(1))));
  const b = float(bayer).add(0.5).div(FADE_LEVELS);
  return select(code.lessThan(0.5), bool(true),
         select(code.lessThan(1.5), b.lessThan(f),
         select(code.lessThan(2.5), b.greaterThanEqual(oneMinus(f)),
         select(code.lessThan(3.5), b.lessThan(oneMinus(f)), b.greaterThanEqual(f)))));
});

/** NodeMaterial emits `bool(maskNode).not().discard()` itself, in the colour
 *  pass and -- through Renderer._getShadowNodes -- in the shadow pass, so an
 *  instance that is out of its fade casts exactly the shadow it draws. */
export function attachTreeFade(material) {
  material.maskNode = treeFadeMask();
  return material;
}

/** The per-instance (t0, code) attribute: zero is steady, which is what a
 *  geometry that never fades (the far ring) carries forever. */
export function createFadeAttribute(capacity) {
  const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
  a.setUsage(THREE.DynamicDrawUsage);
  return a;
}
