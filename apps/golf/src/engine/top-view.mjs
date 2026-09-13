import { alongLine, polyLen } from './geom.js';

/* OVAN PUTS THE TEE AT THE BOTTOM AND THE WHOLE HOLE ON SCREEN.
 * It used to stand 330 m over the hole's midpoint at (mid.x, +330, mid.z + 0.1).
 * That 0.1 m is what orients the picture: with the camera a hair SOUTH of what it
 * looks at and `camera.up` left at +Y, screen-up is north, on every hole of every
 * course. So a hole playing south was drawn upside down and one playing east lay
 * across the frame, and which end of it you were standing on was anybody's guess.
 *
 * Two things fix it, and only doing the first makes the picture worse:
 *
 *  1. ORIENT. Offset the camera BACKWARD ALONG THE HOLE instead of southward and
 *     screen-up becomes the hole's own forward -- tee low, green high. camera.up
 *     stays +Y, which matters: OrbitControls takes its pole from it, and handing it
 *     a horizontal up would orbit the world about the hole's axis on the first drag.
 *  2. FIT. The frame at 330 m is 294 m tall and the median hole here is 345 m, so
 *     standing over the midpoint with the hole running vertically pushes the tee
 *     off the bottom edge: measured, the tee is on screen on 53 of 171 holes that
 *     way, against 118 for the old north-up on a desktop. Orientation alone is a
 *     regression. The height is therefore derived from the hole rather than fixed.
 *
 * The frame is fitted to the hole's own bounding box in its own axes, and the box
 * is pushed DOWN so its low edge sits a margin above the bottom of the frame --
 * which is where the tee is, the hole being measured from it. Both screen shapes
 * are served from the same rule because `aspect` is an argument: a phone held
 * upright has a frame 0.58 as wide as it is tall, and fitting a dogleg's width
 * there is what sets the height, not its length. */

/** Where the camera stands for `?vy=ovan`, and what it looks at.
 * `aspect` is the viewport's, so this must be re-asked when the window changes
 * shape -- a phone turned sideways is a different frame, not the same one wider. */
export function topView(hole, { aspect = 16 / 9, fovDegrees = 48,
  marginMetres = 45, minHeightMetres = 170, maxHeightMetres = 900 } = {}) {
  const line = hole.line;
  const tee = line[0];
  /* the hole's own axes: forward is alongLine's (sin b, cos b) at the tee, and
     screen-right is what the lookAt basis makes of it -- (F.z, -F.x). Never
     bearing()'s angle, which is the reflection this repo keeps meeting. */
  const b = alongLine(line, 0.02).b;
  const F = [Math.sin(b), Math.cos(b)];
  const R = [F[1], -F[0]];

  let uMin = 0, uMax = 0, vMin = 0, vMax = 0;
  for (const [x, z] of line) {
    const dx = x - tee[0], dz = z - tee[1];
    const u = dx * R[0] + dz * R[1], v = dx * F[0] + dz * F[1];
    if (u < uMin) uMin = u; if (u > uMax) uMax = u;
    if (v < vMin) vMin = v; if (v > vMax) vMax = v;
  }

  const tan = Math.tan(fovDegrees * 0.5 * Math.PI / 180);
  /* clamp the HEIGHT and read the half-extent back from it, so a bound is exact
     and the framing below is computed from the frame the camera really has */
  const needed = Math.max((vMax - vMin) / 2 + marginMetres,
                          ((uMax - uMin) / 2 + marginMetres) / aspect);
  const height = Math.min(Math.max(needed / tan, minHeightMetres), maxHeightMetres);
  const halfV = height * tan;

  /* anchor the box's low edge a margin above the bottom of the frame, so the tee
     is in the lower part of the picture rather than merely somewhere in it */
  const centreV = Math.min(vMin + halfV - marginMetres, (vMin + vMax) / 2);
  const centreU = (uMin + uMax) / 2;
  const aim = { x: tee[0] + R[0] * centreU + F[0] * centreV,
                z: tee[1] + R[1] * centreU + F[1] * centreV };
  /* the backward nudge that orients the picture; small enough that this stays a
     plan view (0.02 deg off vertical) and large enough to define the basis */
  const NUDGE = 0.1;
  return { position: { x: aim.x - F[0] * NUDGE, z: aim.z - F[1] * NUDGE }, aim, height };
}
