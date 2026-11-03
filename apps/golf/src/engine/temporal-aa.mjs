/* TEMPORAL AA (3 November; owner request: grass with no noise, as AAA golf games
   draw it -- EA Sports PGA Tour runs TAA by default). three r187's TRAANode jitters
   the camera a fraction of a pixel each frame (a 32-sample Halton sequence) and
   blends the frames, reprojected by each pixel's velocity, so detail finer than a
   pixel -- grass blades, leaf cards, the turf's grain -- averages out instead of
   sparkling. It replaces the scene pass's MSAA (three: "MSAA must be disabled when
   TRAA is in use").

   THE VELOCITY. three's own velocity reads the geometry's raw position, which is
   wrong for everything this engine places in a shader: the terrain's tiles (their
   heights from a texture), every grass blade (a camera-anchored grid), the tree
   impostors. Nearly the whole scene stands still in the world, so the velocity
   here is the WORLD-STATIC one: each pixel's own world position, through this
   frame's and the last frame's unjittered view-projection, in normalised device
   coordinates (three's convention: current minus previous). It needs no input a
   material does not already have (the pixel's world position) and is exact for
   the camera's motion; what moves in the world (a swan, the ball) is reprojected
   as if still, and the TRAA's neighbourhood clipping holds its ghost to a trail
   of a few pixels. */
import { Matrix4 } from 'three/webgpu';
import { Fn, positionWorld, uniform, vec4 } from 'three/tsl';

/** `{ velocity, update(camera), reset(camera) }`: the world-static velocity node and its matrices. */
export function createWorldVelocity() {
  const current = uniform(new Matrix4()), previous = uniform(new Matrix4());
  let primed = false;
  const velocity = Fn(() => {
    const p = vec4(positionWorld, 1);
    const c = current.mul(p), q = previous.mul(p);
    return c.xy.div(c.w).sub(q.xy.div(q.w));
  })();
  return {
    velocity,
    /** Call once a rendered frame, before the pipeline renders (the camera unjittered then). */
    update(camera) {
      camera.updateMatrixWorld();
      if (primed) previous.value.copy(current.value);
      current.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      if (!primed) { previous.value.copy(current.value); primed = true; }
    },
    /** A cut (a teleport, a new hole): no motion from the last frame. */
    reset(camera) { primed = false; this.update(camera); },
    matrices: { current, previous },
  };
}
