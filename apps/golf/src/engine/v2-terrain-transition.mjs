/* Presentation-only transition outside a fixed measured terrain window. The
 * source samples inside the window are untouched; the surrounding legacy
 * mesh approaches the measured edge over a bounded band. */
export function createLegacyTerrainTransition({ bounds, bridge, heightAtGrid, widthMetres }) {
  if (!bounds || !['x0', 'x1', 'z0', 'z1'].every(k => Number.isFinite(bounds[k])) ||
      bounds.x1 <= bounds.x0 || bounds.z1 <= bounds.z0 ||
      typeof bridge?.toGrid !== 'function' || typeof heightAtGrid !== 'function' ||
      !Number.isFinite(widthMetres) || widthMetres <= 0) {
    throw new TypeError('terrain transition requires finite bounds, bridge, sampler and positive width');
  }
  return (x, z, legacyHeight) => {
    const [gx, gz] = bridge.toGrid(x, z);
    if (gx > bounds.x0 && gx < bounds.x1 && gz > bounds.z0 && gz < bounds.z1) return legacyHeight;
    const ex = Math.max(bounds.x0, Math.min(bounds.x1, gx));
    const ez = Math.max(bounds.z0, Math.min(bounds.z1, gz));
    const distance = Math.hypot(gx - ex, gz - ez);
    if (distance >= widthMetres) return legacyHeight;
    const sample = heightAtGrid(ex, ez);
    const edgeHeight = Number.isFinite(sample) ? sample : sample?.height;
    if (!Number.isFinite(edgeHeight)) throw new Error('verified terrain boundary has no height');
    const t = distance / widthMetres;
    const legacyWeight = t * t * (3 - 2 * t);
    return edgeHeight + (legacyHeight - edgeHeight) * legacyWeight;
  };
}
