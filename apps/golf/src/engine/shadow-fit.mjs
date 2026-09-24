/* How big the sun's shadow box is (placeSun). The box is one of a few FIXED
   half-sizes, chosen with hysteresis from how far the camera stands from its
   target, so its texel changes rarely (docs/tree-lod-plan.md, "Shadow
   swimming and the depth buffer").

   The depth range, the light's distance and the normal bias were tuned on
   boxes up to 1150 m, and the box used to stop there: a camera pulled back
   past ~900 m saw shadows only within a kilometre of its target, fading to
   none beyond. The larger fits are the 1150 m box scaled -- depth range,
   light distance and normal bias grow with it -- so a texel, the depth bias
   (a fraction of the depth range) and the fade at the box's edge keep their
   proportions while the box covers the view. */
export const SHADOW_FITS = Object.freeze([260, 400, 600, 850, 1150, 1600, 2200, 3000]);
export const SHADOW_FIT_TUNED = 1150;

/** The smallest fit that holds `want`; it grows at once and shrinks only
 *  once the want is well under the next size down. `current` is the fit in
 *  use (0 before the first). */
export function chooseShadowFit(want, current, fits = SHADOW_FITS) {
  if (!current || want > current) return fits.find(f => f >= want) ?? fits[fits.length - 1];
  const i = fits.indexOf(current);
  if (i > 0 && want < fits[i - 1] * 0.9) return fits.find(f => f >= want) ?? current;
  return current;
}

/** The shadow camera's depth range, the light's distance from the target
 *  along the sun, and the normal bias, for a fit of half-size R. The bias is
 *  a texel's worth of push, capped at 2.5 x its 260 m value within the tuned
 *  range, and scaled with the box beyond it. */
export function shadowBoxFor(R) {
  const k = Math.max(1, R / SHADOW_FIT_TUNED);
  return { near: 200 * k, far: 2400 * k, lightDistance: 1200 * k,
           normalBias: 0.22 * Math.min(2.5, R / 260) * k };
}
