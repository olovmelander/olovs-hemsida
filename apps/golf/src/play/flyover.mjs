/* The hole's flyover: before the first shot the camera flies the hole from
   behind the tee, high along its line, and settles over the green looking at
   the flag, as a broadcast introduces a hole. Pure: the pose at a moment, from
   the hole's line and the ground's heights. */

const ease = u => u * u * (3 - 2 * u);

/** The polyline's total length and a point at a distance along it. */
function along(line, s) {
  let left = s;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (left <= l || i === line.length - 1) {
      const t = l > 0 ? Math.max(0, Math.min(1, left / l)) : 0;
      return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx: l ? (b[0] - a[0]) / l : 0, dz: l ? (b[1] - a[1]) / l : 1 };
    }
    left -= l;
  }
  return { x: line[0][0], z: line[0][1], dx: 0, dz: 1 };
}
export function lineLength(line) {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  return total;
}

/** How long a flyover of a hole takes, in seconds. */
export const flyoverSeconds = length => Math.min(9, 3.6 + length / 85);

/**
 * The camera at progress u (0..1) of a flyover: eye and look as [x, y, z].
 * line: the hole's [[x, z], ...] from tee to green; pin: [x, z, y].
 */
export function flyoverPose(line, pin, u, heightAt) {
  const length = Math.max(1, lineLength(line));
  const k = ease(Math.max(0, Math.min(1, u)));
  const altitude = 26 + Math.min(40, length * .08);
  // The eye travels from behind the tee to a little short of the green, sinking as it arrives.
  const s = -40 + (length - 25 + 40) * k;
  const at = along(line, Math.max(0, s));
  const behind = Math.min(0, s);
  const ex = at.x + at.dx * behind, ez = at.z + at.dz * behind;
  const ground = heightAt(ex, ez);
  const lift = altitude * (1 - .55 * k) + 6;
  // Keep above what lies just ahead too (a ridge between here and the green).
  const ahead = along(line, Math.max(0, s) + 30);
  const clear = Math.max(ground, heightAt(ahead.x, ahead.z));
  const eye = [ex, (Number.isFinite(clear) ? clear : 0) + lift, ez];
  // Look further down the hole early on, at the flag at the end.
  const lookAhead = along(line, Math.min(length, Math.max(0, s) + 70 + 60 * (1 - k)));
  const w = Math.max(0, (k - .55) / .45);
  const lx = lookAhead.x + (pin[0] - lookAhead.x) * w, lz = lookAhead.z + (pin[1] - lookAhead.z) * w;
  const ly = heightAt(lx, lz);
  return { eye, look: [lx, Number.isFinite(ly) ? ly : 0, lz] };
}
