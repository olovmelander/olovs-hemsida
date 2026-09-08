import { alongLine, clampf, polyLen } from './geom.js';

/** The selected reference is where the player stands. A fixed setback can
 * leave a narrow tee, or even cross a path into trees. Do not move an unresolved
 * reference onto another platform: its source uncertainty belongs to the data.
 * Aim along the REMAINING route, so a forward tee cannot look behind itself. */
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
  const aim = total > 0 ? alongLine(line, (start + 0.72 * (total - start)) / total)
    : { x: hole.pin[0], z: hole.pin[1] };
  return { position: [...mark.c], aim, startMetres: start };
}
