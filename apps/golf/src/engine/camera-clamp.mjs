/* The ground clamp: what keeps a walking camera out of the terrain, gently.

   The old rule was a snap -- if the camera is under eye height, put it AT eye
   height, this frame. Against a 1 m LiDAR heightfield that is a kick on every
   bump: measured at Puttom's 5th tee, a right-drag pan lifted the camera 1.45 m
   in steps of up to 5.6 cm and a slow orbit lifted it 9 m in steps of up to
   48 cm, and the frames that stepped changed four times as much of the picture
   as the frames that did not. At eye height a 3 cm step moves the ground ten
   metres out by three pixels, so that is the "terrain jitter" a golfer feels
   when panning at a tee.

   Three rules instead:
   - eye height is approached, not snapped to: an exponential ease with a short
     time constant, so a step becomes a ramp a few frames long;
   - a rise AHEAD is climbed before it arrives: the camera's own motion over the
     last frame is extrapolated a sixth to two thirds of a second ahead, and
     the ground there sets a climb RATE -- the rise divided by the time the
     nearer horizon takes to reach it -- so a steady pan onto a bank starts
     climbing early, at a steady speed, and never lags into the floor;
   - what the ground lifted, the ground gives back: the clamp keeps an account
     of its own lift and pays it out when the ground falls away, eased and
     never faster than a glide (1.5 m/s) -- and only that, so a camera the
     user raised is never lowered.
   A hard floor remains, at the height below which the near plane would cut the
   turf (1.0 m near plane, 48 degree lens: the plane's lower edge reaches at most
   1.095 m below the camera on level ground), and it is the only thing that can
   still move the camera in one step. */

export const GROUND_CLAMP = Object.freeze({
  eye: 1.7,          /* metres above the ground the camera settles to */
  floor: 1.15,       /* metres above the ground it is never allowed under, this frame */
  tau: 0.12,         /* seconds: the ease's time constant */
  lookAhead: Object.freeze([1 / 6, 1 / 3, 1 / 2, 2 / 3]),   /* seconds ahead along the camera's motion that the ground is read, nearest first */
  maxAhead: 4,       /* metres: how far ahead it is ever read, whatever the speed */
  maxDescent: 1.5,   /* metres per second: the fastest the lift is ever given back */
});

export function createGroundClamp({ heightAt, eye = GROUND_CLAMP.eye, floor = GROUND_CLAMP.floor, tau = GROUND_CLAMP.tau, lookAhead = GROUND_CLAMP.lookAhead, maxAhead = GROUND_CLAMP.maxAhead, maxDescent = GROUND_CLAMP.maxDescent } = {}) {
  if (typeof heightAt !== 'function') throw new TypeError('createGroundClamp needs heightAt(x, z)');
  let lift = 0, px = 0, pz = 0, valid = false;
  return {
    /* metres the clamp has added to the camera's height and not yet given back */
    get lift() { return lift; },
    /* forget the lift and the motion: the camera was placed on purpose */
    reset() { lift = 0; valid = false; },
    /* pos: an object with x, y, z, moved in place; dt: seconds since the last
       frame. Returns the height change applied, negative when lift is repaid. */
    step(pos, dt) {
      const vx = valid ? pos.x - px : 0, vz = valid ? pos.z - pz : 0;
      px = pos.x; pz = pos.z; valid = true;
      const here = heightAt(pos.x, pos.z);
      const k = dt > 0 ? 1 - Math.exp(-dt / tau) : 1;
      let top = here, d = 0;
      /* under eye height where it stands: ease up */
      if (pos.y < here + eye) d = (here + eye - pos.y) * k;
      /* a rise ahead: climb at the rate that has it done by the time the NEARER
         horizon reaches it, since the rise may begin anywhere between the two.
         An ease toward the ground ahead would take a fixed share of the whole
         rise in its first frame -- more of a kick than the snap it replaces.
         The extrapolation is a straight line and the camera's path is usually
         an arc, so it is capped in distance: an orbit at 40 m radius is 10 m
         off its own tangent 28 m out, and read a hill there it would never
         cross (measured at the 14th tee, 1.4 m in one frame). */
      const speed = Math.hypot(vx, vz);
      if (dt > 0 && speed > 0) {
        const cap = Math.max(1, maxAhead / speed);   /* frames to the distance cap, never under one */
        let tPrev = 0;
        for (let i = 0; i < lookAhead.length; i++) {
          const n = Math.min(lookAhead[i] / dt, cap), h = heightAt(pos.x + vx * n, pos.z + vz * n);
          if (h > top) top = h;
          const tHere = n * dt, t = i > 0 ? tPrev : tHere;
          tPrev = tHere;
          const need = h + eye - pos.y;
          if (need > 0) d = Math.max(d, need * dt / t);
        }
      }
      const hard = here + floor;
      if (pos.y + d < hard) d = hard - pos.y;
      if (d > 0) lift += d;
      else if (lift > 0 && pos.y > top + eye) {
        /* eased like the climb, but never faster than a glide: after nine
           metres of bank the ground along an orbit falls away by metres, and
           an ease alone repaid 1.3 m of it in one frame (the 14th tee) */
        d = -Math.min(lift, (pos.y - top - eye) * k, maxDescent * dt);
        lift += d;
        if (lift < 1e-6) lift = 0;
      }
      pos.y += d;
      return d;
    },
  };
}
