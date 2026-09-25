import { fbm, hash2, vnoise } from './geom.js';

/* COLOUR ACROSS A STAND. Each tree took its own tint from a hash of where it
   stands -- a warm/cool shift of up to 12% and a green one of up to 8% -- so no
   two neighbours matched, and from any distance the speckle averaged away into
   one flat green. A stand shares its soil, its age and its light, and a painter
   lays it in one broad wash, a little bluer or warmer, darker or lusher than
   the next, and picks out single trees within it. The tint keeps its two axes
   and adds two slow washes across the ground: warm/cool over about 300 m and
   lush/dark over about 130 m, 10% and 8% at one standard deviation -- a
   variation that survives distance, as a tree's own does not. Each tree keeps
   half of its own. The washes are one function of position, so the far
   vista, which had no colour of its own, takes the same stands as the trees
   near the course. */
export const STAND_TINT = Object.freeze({
  /* the old per-tree amplitudes: warm/cool 0.24, lush 0.16, on uniform hashes of +-0.5 */
  treeWarm: 0.12, treeLush: 0.08,
  /* a wash's spread at one standard deviation: warm/cool 10%, lush/dark 8% (fbm's s.d. 0.32, vnoise's 0.43) */
  standWarm: 0.31, standLush: 0.186,
  warmMetres: 300, lushMetres: 130,
});

/** A tree's tint at (x, z) into out[o..o+3]: r, g, b multipliers and its
    autumn hash. `stands` false is the before: each tree's own speckle. */
export function treeTint(x, z, out, o, stands = true) {
  const a = hash2(x * 0.37 + 11.3, z * 0.91 + 5.7) - 0.5, b = hash2(z * 0.53 + 2.1, x * 0.29 + 9.9) - 0.5;
  let warm, lush;
  if (stands) {
    warm = STAND_TINT.standWarm * fbm(x / STAND_TINT.warmMetres + 7.1, z / STAND_TINT.warmMetres - 3.3, 2) + STAND_TINT.treeWarm * a;
    lush = STAND_TINT.standLush * vnoise(x / STAND_TINT.lushMetres - 5.2, z / STAND_TINT.lushMetres + 8.4) + STAND_TINT.treeLush * b;
  } else {
    warm = 0.24 * a;
    lush = 0.16 * b;
  }
  /* lush lifts green most, as the old per-tree term did (0.06, 0.16, 0.04) */
  out[o] = 1 + warm + 0.375 * lush;
  out[o + 1] = 1 + lush;
  out[o + 2] = 1 - warm + 0.25 * lush;
  out[o + 3] = hash2(x * 0.71 + 4.4, z * 0.43 + 1.9);
  return out;
}

/** The far vista's tint: the stands' own, or the before's plain (1, 1, 1). */
export function vistaTint(x, z, out, o, stands = true) {
  if (stands) return treeTint(x, z, out, o, true);
  out[o] = out[o + 1] = out[o + 2] = 1;
  out[o + 3] = hash2(x * 0.71 + 4.4, z * 0.43 + 1.9);
  return out;
}
