import { ringBBox } from '../engine/geom.js';

// Fraction along a shot to its intersection with one polygon/OB edge.
// Touching or running along an edge counts, including the far end of an overlap.
export function crossing(a, b, c, d) {
  const x = b[0] - a[0], z = b[1] - a[1], u = d[0] - c[0], v = d[1] - c[1];
  const px = c[0] - a[0], pz = c[1] - a[1], denom = x * v - z * u;
  if (Math.abs(denom) < 1e-8) {
    const length2 = x * x + z * z;
    if (!length2 || Math.abs(px * z - pz * x) > 1e-8) return -1;
    const start = (px * x + pz * z) / length2, end = start + (u * x + v * z) / length2;
    return Math.min(start, end) <= 1 && Math.max(start, end) >= 0 ? Math.min(1, Math.max(start, end)) : -1;
  }
  const t = (px * v - pz * u) / denom, at = (px * z - pz * x) / denom;
  return t >= 0 && t <= 1 && at >= 0 && at <= 1 ? t : -1;
}

// Convert a stream with published width into strips, so short diagonal crossings
// between samples are just as visible to the planner as a wide lake.
export function stripsOf(line, width) {
  const rings = [];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    if (!len) continue;
    const u = -dz / len * width / 2, v = dx / len * width / 2;
    rings.push([[a[0] + u, a[1] + v], [b[0] + u, b[1] + v], [b[0] - u, b[1] - v], [a[0] - u, a[1] - v]]);
  }
  return rings;
}

export function waterShape(...rings) {
  return { ...ringBBox(rings.length === 1 ? rings[0] : rings.flat()), rings };
}

/* All consumers of mapped water use these same published outlines. Coastal
   rings marked over land have a visual mask in their place. */
export function mappedWaterShapes(features) {
  const channels = (items, width) => items.flatMap(item => {
    const rings = stripsOf(item.line, item.width ?? width);
    return rings.length ? [{ ...waterShape(...rings), approximate: item.width == null }] : [];
  });
  return [
    ...features.water.filter(item => !item.overLand).map(item => waterShape(item.ring)),
    ...features.basins.map(ring => waterShape(ring)),
    ...channels(features.streams, 2), ...channels(features.drains, 1.2),
  ];
}
