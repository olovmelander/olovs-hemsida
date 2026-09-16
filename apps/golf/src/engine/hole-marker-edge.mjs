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
export function clearEdge(edge, reserved, size = sizeOf()) {
  const halfW = size.width / 2, half = size.height / 2, { bounds } = edge;
  const at = offsetPixels => {
    const x = edge.vertical ? edge.x : clamp(edge.x + offsetPixels, bounds.minX, bounds.maxX);
    const y = edge.vertical ? clamp(edge.y + offsetPixels, bounds.minY, bounds.maxY) : edge.y;
    return { left: x - halfW, top: y - half, right: x + halfW, bottom: y + half };
  };
  const blocked = rect => reserved.reduce((sum, r) => sum + areaOver(rect, r), 0);
  /* Step by the extent of whichever axis it slides along, so a wide tee pill
     clears sideways by its own width and not by a disc's. */
  const step = (edge.vertical ? size.height : size.width) + 8;
  let best = at(0), bestScore = blocked(best);
  if (!bestScore) return best;
  for (const offset of [step, -step, 2 * step, -2 * step]) {
    const candidate = at(offset), score = blocked(candidate);
    if (!score) return candidate;
    if (score < bestScore) { best = candidate; bestScore = score; }
  }
  return best;
}
