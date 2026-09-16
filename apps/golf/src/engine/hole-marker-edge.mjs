/* The off-screen half of the hole marker, kept pure so it can be measured
   without a DOM, a camera or a GPU. hole-marker.mjs owns the painting. */

/* The disc's diameter, and the height of every badge. The green's is exactly
   this wide; the tee carries its own length beside the icon and so measures
   wider, which is why placement takes a size rather than assuming a square. */
export const BADGE = 34;

export const sizeOf = (width = BADGE, height = BADGE) => ({ width, height });

export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export const areaOver = (a, b) => Math.max(0, Math.min(a.right + 8, b.right) - Math.max(a.left - 8, b.left))
  * Math.max(0, Math.min(a.bottom + 8, b.bottom) - Math.max(a.top - 8, b.top));

/* Clear of the hole card at the top and, at phone widths, the sheet and the
   quick actions at the bottom -- the same insets the badge placement uses. */
export const inset = (width, height) => ({
  top: width <= 768 ? 60 : 82, bottom: width <= 768 ? 108 : 70, side: 14, width, height,
});

/** Where a ray from the middle of the screen toward the target leaves the safe
 * box. A point BEHIND the camera projects mirrored through the centre, so its
 * direction is negated first -- without that the arrow points away from the
 * flag exactly when the player has turned their back on it, which is when they
 * need it most. */
export function edgePlacement(p, box, size = sizeOf()) {
  const cx = box.width / 2, cy = box.height / 2;
  let dx = p.x - cx, dy = p.y - cy;
  if (!p.inFront) { dx = -dx; dy = -dy; }
  if (!dx && !dy) dy = 1;
  const halfW = size.width / 2, half = size.height / 2;
  const minX = box.side + halfW, maxX = box.width - box.side - halfW;
  const minY = box.top + half, maxY = box.height - box.bottom - half;
  const tx = dx > 0 ? (maxX - cx) / dx : dx < 0 ? (minX - cx) / dx : Infinity;
  const ty = dy > 0 ? (maxY - cy) / dy : dy < 0 ? (minY - cy) / dy : Infinity;
  const t = Math.max(0, Math.min(tx, ty));
  return {
    x: clamp(cx + dx * t, minX, maxX), y: clamp(cy + dy * t, minY, maxY),
    /* Which side the ray left by: the badge may then slide ALONG that side to
       clear a neighbour without ever leaving the edge it belongs to. */
    vertical: tx <= ty,
    angle: Math.atan2(dy, dx) * 180 / Math.PI,
    bounds: { minX, maxX, minY, maxY },
  };
}

/** Both badges are off screen together whenever the player faces away from the
 * hole, and a ray from one centre reaches the same corner as the other's, so
 * the green would sit on top of the tee. It slides along its own edge. */
/* The safe box's outline, as the path the badge's CENTRE may travel. */
const spans = bounds => ({
  w: Math.max(0, bounds.maxX - bounds.minX),
  h: Math.max(0, bounds.maxY - bounds.minY),
});

/** A distance clockwise around that outline, starting from its top-left. */
export function perimeterPoint(bounds, distance) {
  const { w, h } = spans(bounds), total = 2 * (w + h);
  if (total <= 0) return { x: bounds.minX, y: bounds.minY };
  let s = ((distance % total) + total) % total;
  if (s < w) return { x: bounds.minX + s, y: bounds.minY };
  s -= w;
  if (s < h) return { x: bounds.maxX, y: bounds.minY + s };
  s -= h;
  if (s < w) return { x: bounds.maxX - s, y: bounds.maxY };
  return { x: bounds.minX, y: bounds.maxY - (s - w) };
}

/** Where a point on that outline lies along it. Corners belong to whichever
 * side it is nearest, which is enough: the walk starts here and moves on. */
export function perimeterDistance(bounds, x, y) {
  const { w, h } = spans(bounds);
  const sides = [
    { d: Math.abs(y - bounds.minY), at: clamp(x, bounds.minX, bounds.maxX) - bounds.minX },
    { d: Math.abs(x - bounds.maxX), at: w + clamp(y, bounds.minY, bounds.maxY) - bounds.minY },
    { d: Math.abs(y - bounds.maxY), at: w + h + bounds.maxX - clamp(x, bounds.minX, bounds.maxX) },
    { d: Math.abs(x - bounds.minX), at: 2 * w + h + bounds.maxY - clamp(y, bounds.minY, bounds.maxY) },
  ];
  return sides.reduce((best, side) => side.d < best.d ? side : best).at;
}

/** Walk the outline outward from the badge's ideal place until it is clear of
 * the HUD, in both directions, nearest first.
 *
 * Sliding a fixed step or two along ONE side is not enough and shipped broken:
 * the control panel stands 572 px tall down the right-hand side, so a badge
 * whose direction points right lands inside it and two 42 px steps do not
 * reach past it -- the badge then renders BEHIND the panel (z-index 18 against
 * the panel's 20) and all a player sees is the arrow poking out. Going round
 * the corner is what actually clears a panel that owns a whole side. */
export function clearEdge(edge, reserved, size = sizeOf()) {
  const halfW = size.width / 2, half = size.height / 2, { bounds } = edge;
  const rectAt = ({ x, y }) => ({ left: x - halfW, top: y - half, right: x + halfW, bottom: y + half });
  const blocked = rect => reserved.reduce((sum, r) => sum + areaOver(rect, r), 0);
  let best = rectAt({ x: edge.x, y: edge.y }), bestScore = blocked(best);
  if (!bestScore) return best;
  const { w, h } = spans(bounds), total = 2 * (w + h);
  const from = perimeterDistance(bounds, edge.x, edge.y);
  const step = 10;
  for (let travelled = step; travelled <= total / 2; travelled += step) {
    for (const direction of [1, -1]) {
      const candidate = rectAt(perimeterPoint(bounds, from + direction * travelled));
      const score = blocked(candidate);
      if (!score) return candidate;
      if (score < bestScore) { best = candidate; bestScore = score; }
    }
  }
  return best;
}
