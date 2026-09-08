import { ringSDIndexed, distToLineIndexed } from './ring-index.mjs';

/* Triangulation pieces may share internal cut edges. Shore depth and foam are
 * measured against the source water boundary, including island shores, before
 * partitioning. This CPU attribute feeds the same material on both backends.
 * Explicit source lines can omit map/tile clipping edges that are not shores. */
export function waterShoreDistance(x, z, water) {
  if (!water.shoreline) return Math.max(0, -ringSDIndexed(x, z, water.ring));
  let distance = Infinity;
  for (const ring of water.shoreline.rings ?? []) distance = Math.min(distance, Math.abs(ringSDIndexed(x, z, ring)));
  for (const entry of water.shoreline.lines ?? []) distance = Math.min(distance, distToLineIndexed(x, z, entry.line));
  // An explicit empty boundary means no observed shore, e.g. an offshore tile.
  return Number.isFinite(distance) ? distance : 1e6;
}
