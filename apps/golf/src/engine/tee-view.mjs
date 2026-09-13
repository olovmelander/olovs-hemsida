import { alongLine, clampf, polyLen } from './geom.js';

/* FROM THE TEE YOU LOOK AT YOUR LANDING AREA, NOT AT THE PIN.
 * The aim used to be the route point 72% along what REMAINS of the hole, which is
 * right on a straight hole and wrong on a dogleg: that far down the route the hole
 * has already turned, so the camera is pointed across the corner -- at the trees
 * the corner is made of. Measured over all ten builds' back tees, 35 of 171 holes
 * aimed more than 10 deg off the tee's own heading and 8 more than 20, worst 58.6
 * (Ribbingsfors' 3rd); the owner's report was Upsala's 16th, 26.7 deg off.
 *
 * WHICH SCREEN IS LOOKING DECIDES WHETHER THAT MATTERS, and it is most of the
 * story. three's `fov` is the VERTICAL angle and main.js holds it at 48 deg, so
 * the horizontal window is the aspect's to set: +-38 deg on a 16:9 desktop, +-44
 * on a phone held sideways, and +-14.5 on a phone held UPRIGHT. An aim 27 deg off
 * the corridor is a framing quibble on a desktop and puts the fairway entirely
 * off-screen on a portrait phone -- which is the report, and the picture.
 *
 * So the aim is capped at a drive now: it is the ground the tee shot is played to.
 * It stays ON THE ROUTE, which is what makes it better rather than merely
 * different -- both rules that were tried and rejected left the route:
 *
 *   rule                          portrait: fairway   frame centred   desktop:
 *                                 the drive plays to   on TREES       fairway
 *   route at 72% of remaining        81.7%              6.2%          95.8%
 *   corridor: within 10 deg of tee     --                --           (worse)
 *   the landing's DIRECTION only     86.2%             10.7%          95.9%
 *   ON ROUTE at the landing (this)   84.3%              6.3%          95.8%
 *
 * Holding the aim inside a tolerance of the tee's heading looks like the obvious
 * fix and is the worst of the three: it points hard down the first leg and throws
 * the rest of the hole out of frame, and where a route leaves the tee at an angle
 * its first segment is a stub, not a corridor. Keeping that direction but the old
 * range is worse still on the very symptom being fixed -- extended past the corner
 * the aim lands IN the wood, 10.7% of frames against 6.2%.
 *
 * THE CAP IS SET BY THE NARROWEST SCREEN, NOT BY GOLF. Shorter caps frame more of
 * the drive (86.7% at 180 m) and cost fairway that a portrait phone used to hold:
 * below 260 m, Veckefjärden's 5th loses its own fairway from frame on every tee,
 * because that hole's routed line runs straight down while its OSM fairway lies
 * 45-110 m east of it -- a disagreement in the model, which no aim along the line
 * can frame. 260 m is the longest cap that still gains and the shortest that
 * regresses nothing: portrait 81.7% -> 84.3%, no tee newly blind (the 8 that see
 * no fairway see none either way), desktop unchanged, and 609 of 819 tee marks do
 * not move at all -- a hole short enough that 72% of it lies inside the cap is
 * bit-identical. The median range change is 0 m, so pitch and orbit radius stand.
 *
 * The two numbers live INSIDE the function on purpose: `tools/check-upsala-tee-
 * coordinates.mjs` gates the standalone page by slicing this function's own text
 * out of the HTML and evaluating it, so anything it closes over at module scope is
 * simply undefined there. A helper that is copied into a page has to be
 * self-contained, and the gate is what says so. */

/** Resolve the selected shot origin and the view's forward aim. The app adds
 * a small camera setback when framing this origin; markers and measurements
 * continue to use the selected reference itself.
 * Aim along the REMAINING route, so a forward tee cannot look behind itself, and
 * no further than a drive, so a dogleg does not point the camera into its corner. */
export function teeView(hole, mark) {
  const line = hole.line, total = polyLen(line);
  let walked = 0, nearestDistance = Infinity, start = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    if (!length) continue;
    const t = clampf(((mark.c[0] - a[0]) * dx + (mark.c[1] - a[1]) * dz) / (length * length), 0, 1);
    const distance = Math.hypot(mark.c[0] - a[0] - t * dx, mark.c[1] - a[1] - t * dz);
    if (distance < nearestDistance) { nearestDistance = distance; start = walked + t * length; }
    walked += length;
  }
  const AIM_FRACTION = 0.72, DRIVE_METRES = 260;
  const aimMetres = Math.min(start + AIM_FRACTION * (total - start), start + DRIVE_METRES);
  const aim = total > 0 ? alongLine(line, aimMetres / total)
    : { x: hole.pin[0], z: hole.pin[1] };
  return { position: [...mark.c], aim, startMetres: start };
}
