/* WHAT LIES ON THE GROUND STAYS ON IT AT A DISTANCE (3 November, owner report:
   "the roads and paths further from the golf course get covered by ground
   material", on every course). Roads, paths, tracks, lots and ballast are
   ribbons draped a few centimetres over the ground's exact height. The ground
   that is DRAWN is not exact away from the eye: its tiles refine until they are
   within a pixel of the surface on the course and about three off it, and stay
   coarser under a tight budget, so a far tile's surface stands metres over a
   road in a cut or on a slope and buries it.

   A ribbon's vertex keeps its place and is drawn where it is; only its DEPTH is
   moved toward the eye, along the eye's own ray, by the terrain's error allowance
   there: `pixels` of the screen at that distance, as a height, turned into a
   distance along the ray by how steeply the eye looks down on it (a low, grazing
   view needs more of the ray to clear the same height). The vertex projects to
   the same pixel, and the fragment's position -- its lighting, shadows, fog and
   the temporal AA's reprojection -- is the true one; three r187 runs the material's
   vertex setup as usual and only takes the clip position from `vertexNode`. It
   starts beyond `from` metres, where the ground is drawn to a pixel and the
   ribbons' few centimetres and polygon offset already do, and never moves a
   depth more than `share` of its distance. ?drape=before is the before. */
import { Fn, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, max, min, modelWorldMatrix, positionLocal, screenSize, smoothstep, vec4 } from 'three/tsl';

export const DRAPE_DEPTH = Object.freeze({
  /* the terrain's error allowance, screen pixels (its off-course target 3, with its hysteresis and budget) */
  pixels: 6,
  /* the steepest the eye is taken to look down for the ray's length (a sine), and the most of a distance moved */
  minSine: 0.15, share: 0.06,
  /* from none at from[0] metres to all of it by from[1] */
  from: Object.freeze([60, 200]),
});

/** How far toward the eye a point `distance` metres off, seen `sine` steeply, has its depth moved (CPU, for tests). */
export function drapeDepthMetres(distance, sine, { pixelAngle, pixels = DRAPE_DEPTH.pixels, minSine = DRAPE_DEPTH.minSine, share = DRAPE_DEPTH.share, from = DRAPE_DEPTH.from } = {}) {
  const t = Math.min(1, Math.max(0, (distance - from[0]) / (from[1] - from[0])));
  const ramp = t * t * (3 - 2 * t);
  const height = distance * pixelAngle * pixels;
  return Math.min(height / Math.max(Math.abs(sine), minSine), distance * share) * ramp;
}

/** Moves `material`'s depth (never its pixels) toward the eye as above. Returns the material. */
export function drapeOverDrawnTerrain(material) {
  const D = DRAPE_DEPTH;
  material.vertexNode = Fn(() => {
    const world = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz;
    const toEye = cameraPosition.sub(world);
    const distance = max(toEye.length(), 0.01);
    /* a pixel's height at this distance, and how steeply the eye looks down on the point */
    const pixelAngle = cameraProjectionMatrix.element(1).y.mul(max(screenSize.y, 1)).reciprocal().mul(2);
    const height = distance.mul(pixelAngle).mul(D.pixels);
    const sine = max(toEye.y.div(distance).abs(), D.minSine);
    const push = min(height.div(sine), distance.mul(D.share)).mul(smoothstep(D.from[0], D.from[1], distance));
    const moved = world.add(toEye.div(distance).mul(push));
    return cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(moved, 1));
  })();
  material.userData.drapeDepth = true;
  return material;
}
