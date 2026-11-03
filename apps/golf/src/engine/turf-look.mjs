/* THE TOUR TURF (3 November, owner request: "the grass like EA Sports PGA Tour
   2K25, absolutely stunning on the tees, the green, the rough, the fairways and
   every other ground: the moss, the gravel, the roads"). The class-SDF ground
   (ground-material-core.mjs) painted each surface as its colour, its metre-wide
   clumps and blotches and soft stripes; this lays the turf's own grain over
   that, from the turf detail texture (turf-detail.mjs):

   - every class takes its material's channel: the mown cuts the laid blades,
     turned onto each hole's own mowing so the grain runs with the stripes; the
     rough, the forest floor's moss, the heath and the wetland the wild blades;
     sand and the shore the grain; paths and gravel the pebbles; asphalt the
     fine aggregate, dirt and rock a quieter stone;
   - a bright blade is a little warmer and a dark gap a little cooler, as lit
     grass is; a third, coarser tap breaks the repeat at mid distance;
   - the same values are the ground's height for a bump: the terrain's normal
     is perturbed by the grain's slope (from its screen derivatives, the
     unparametrised bump of Mikkelsen 2010), so a low sun picks out the
     blades, the pebbles and the rake;
   - all of it fades by the pixel's footprint (the texture's own mips take it
     to its mean before then), so far ground keeps its tone and never shimmers.

   The stripes are stronger and depend on where you stand (turf-look's
   `stripes` and `flipStripes`): a pass laid away from you shows the blades'
   lit backs and one laid toward you their shaded faces, so looking back down
   the hole the light and dark passes swap, as on any mown course.
   ?turf=painted is the before, for this and the finish (material.js). */
import {
  abs, cross, dFdx, dFdy, dot, float, fwidth, normalize, oneMinus, positionView, sign, smoothstep, texture, vec2, vec3,
} from 'three/tsl';
import { SURFACE } from './surface.js';

const S = SURFACE;
export const TURF_LOOK = Object.freeze({
  /* the texture's repeat on the ground, metres: the mown blades', the world taps' and the coarse tap's */
  tiles: Object.freeze({ mown: 0.85, world: 1.5, mid: 6.1 }),
  /* each class: its channel, its display amplitude either side of its tone, and its bump's height, metres */
  classes: Object.freeze({
    [S.FAIRWAY]: Object.freeze(['r', 0.17, 0.0035]),
    [S.SEMI]: Object.freeze(['r', 0.15, 0.004]),
    [S.TEE]: Object.freeze(['r', 0.17, 0.0035]),
    [S.FRINGE]: Object.freeze(['r', 0.12, 0.003]),
    [S.GREEN]: Object.freeze(['r', 0.07, 0.0012]),
    [S.ROUGH]: Object.freeze(['g', 0.2, 0.008]),
    [S.FOREST]: Object.freeze(['g', 0.24, 0.008]),
    [S.HEATH]: Object.freeze(['g', 0.2, 0.007]),
    [S.WETLAND]: Object.freeze(['g', 0.18, 0.007]),
    [S.SAND]: Object.freeze(['a', 0.12, 0.002]),
    [S.SHORE]: Object.freeze(['a', 0.12, 0.002]),
    [S.PATH]: Object.freeze(['b', 0.26, 0.006]),
    [S.GRAVEL]: Object.freeze(['b', 0.3, 0.007]),
    [S.DIRT]: Object.freeze(['b', 0.16, 0.004]),
    [S.ROCK]: Object.freeze(['b', 0.14, 0.004]),
    [S.MUD]: Object.freeze(['a', 0.1, 0.002]),
    [S.ASPHALT]: Object.freeze(['a', 0.16, 0.0012]),
  }),
  /* the classes that are turf: the coarse tap's variation and the warm blades */
  turf: Object.freeze([S.FAIRWAY, S.SEMI, S.TEE, S.FRINGE, S.GREEN, S.ROUGH, S.FOREST, S.HEATH, S.WETLAND]),
  /* the coarse tap's display amplitude, and how much warmer a bright blade is (a dark one cooler) */
  mid: 0.06, warm: Object.freeze([1.12, 1, 0.72]),
  /* whole while a pixel's footprint is under fade[0] metres, gone past fade[1] */
  fade: Object.freeze([0.035, 0.24]),
  /* THE TOUR GRADE: each class's colour, multiplied in linear light, toward a broadcast course's
     turf: warmer, yellower cuts (the fairway near 90 degrees of hue on screen, not 100), a green
     still cooler than the fairway but no longer teal (105, not 123), a darker rough, and warm stone
     on the paths, gravel and soil (asphalt darker) instead of a pale blue-grey. The
     ground and the blades round the ball take the same grade, so a blade keeps its root's colour */
  grade: Object.freeze({
    [S.FAIRWAY]: Object.freeze([1.36, 1.0, 0.98]), [S.TEE]: Object.freeze([1.3, 1.0, 0.98]),
    [S.SEMI]: Object.freeze([1.2, 0.93, 0.9]), [S.FRINGE]: Object.freeze([1.42, 0.96, 0.93]),
    [S.GREEN]: Object.freeze([1.66, 0.92, 0.9]), [S.ROUGH]: Object.freeze([0.9, 0.9, 0.78]),
    [S.FOREST]: Object.freeze([0.88, 0.86, 0.76]), [S.HEATH]: Object.freeze([1.0, 0.88, 0.8]),
    [S.WETLAND]: Object.freeze([0.9, 0.88, 0.82]),
    /* the hard ground: warm stone, not a cold grey; asphalt darker */
    [S.PATH]: Object.freeze([0.92, 0.84, 0.7]), [S.GRAVEL]: Object.freeze([0.92, 0.84, 0.7]),
    [S.DIRT]: Object.freeze([0.95, 0.88, 0.78]), [S.ASPHALT]: Object.freeze([0.72, 0.72, 0.74]),
  }),
  /* the stripes' display amplitude either side, per class (the painted ground's MOW_AMPLITUDE before) */
  stripes: Object.freeze({ [S.FAIRWAY]: 0.11, [S.SEMI]: 0.05, [S.GREEN]: 0.07, [S.FRINGE]: 0.05, [S.TEE]: 0.08 }),
});

/** A class's tour grade (linear RGB multipliers), or null where it has none. */
export const tourGradeOf = sid => TURF_LOOK.grade[sid] ?? null;

/** How a pass's tone turns with where you stand: +1 looking along `bearing`, -1 against it, 0 square across. */
export function flipStripes(toCameraXZ, bearing) {
  const facing = dot(toCameraXZ, bearing);
  return facing.div(abs(facing).max(0.12)).clamp(-1, 1);
}

/**
 * The turf's grain over `litBase`: `{ litBase, normal }`.
 * - `classes`, `weights`: the ground's classes and their weights at the pixel;
 * - `wp`: the world position (x, z); `dir`: the hole's mowing bearing (unit vec2) or null;
 * - `detail`: the turf detail texture; `normal`: the terrain's view-space normal; `display`: the finish's tone exponent.
 */
export function tourTurf({ classes, weights, wp, dir = null, detail, normal, display, strength = float(1) }) {
  const T = TURF_LOOK;
  const along = dir ? wp.dot(dir) : wp.x, across = dir ? wp.y.mul(dir.x).sub(wp.x.mul(dir.y)) : wp.y;
  const mown = texture(detail, vec2(along, across).div(T.tiles.mown));
  /* the world tap turned off the axes (as the ground's near tap is), so its repeat lines up with nothing */
  const world = texture(detail, vec2(wp.x.mul(0.8).sub(wp.y.mul(0.6)), wp.x.mul(0.6).add(wp.y.mul(0.8))).div(T.tiles.world));
  const mid = texture(detail, wp.div(T.tiles.mid).add(vec2(0.31, 0.77)));
  const channel = { r: mown.r, g: world.g, b: world.b, a: world.a };
  let grain = float(0), height = float(0), turfShare = float(0);
  classes.forEach((sid, index) => {
    const spec = T.classes[sid];
    if (spec) {
      const v = channel[spec[0]].sub(0.5).mul(2);
      grain = grain.add(weights[index].mul(v.mul(spec[1])));
      height = height.add(weights[index].mul(v.mul(spec[2])));
    }
    if (T.turf.includes(sid)) turfShare = turfShare.add(weights[index]);
  });
  const footprint = fwidth(wp).length();
  const near = oneMinus(smoothstep(T.fade[0], T.fade[1], footprint)).mul(strength);
  const coarse = mid.r.add(mid.g).sub(1).mul(T.mid).mul(turfShare).mul(strength);
  const lift = grain.mul(near).add(coarse).mul(display);
  /* a bright blade warmer, a dark gap cooler: the warmth only on turf */
  const warmth = vec3(1).add(vec3(...T.warm).sub(1).mul(turfShare));
  const lit = vec3(1).add(warmth.mul(lift));
  /* THE BUMP: the grain's height, perturbing the terrain's own normal (in view space) by its screen slope */
  const h = height.mul(near);
  const dpdx = dFdx(positionView), dpdy = dFdy(positionView);
  const N = normalize(normal);
  const r1 = cross(dpdy, N), r2 = cross(N, dpdx);
  const det = dot(dpdx, r1);
  const grad = r1.mul(dFdx(h)).add(r2.mul(dFdy(h))).mul(sign(det));
  const bumped = normalize(abs(det).max(1e-12).mul(N).sub(grad));
  return { lit, normal: bumped, turfShare };
}
