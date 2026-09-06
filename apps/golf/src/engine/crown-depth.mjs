/**
 * Bake restrained crown depth and warm outer tips into an existing colour
 * attribute. Call once after the crown's final positions and normals are built,
 * before its impostor atlas is baked. Pass the FULL species template's vertical
 * envelope to every detail tier so matching local points receive the same tint.
 *
 * This is local canopy colour variation, independent of the sun and camera. It
 * changes no geometry, normals, bounds or allocation on the rendering path;
 * mesh materials and impostor albedo already consume this colour attribute.
 */
export function applyCrownDepth(geometry, { minY, maxY } = {}) {
  if (!Number.isFinite(minY) || !Number.isFinite(maxY) || maxY <= minY) {
    throw new RangeError('Crown depth needs a finite, increasing full-template height envelope');
  }
  const position = geometry?.getAttribute('position');
  const normal = geometry?.getAttribute('normal');
  const colour = geometry?.getAttribute('color');
  if (!position || !normal || !colour || position.itemSize !== 3 || normal.itemSize !== 3
      || colour.itemSize !== 3 || normal.count !== position.count || colour.count !== position.count) {
    throw new TypeError('Crown depth needs matching existing position, normal and color vec3 attributes');
  }
  const inverseHeight = 1 / (maxY - minY);
  for (let i = 0; i < position.count; i++) {
    const height = Math.max(0, Math.min(1, (position.getY(i) - minY) * inverseHeight));
    const exposure = height * height * (3 - 2 * height);
    const underside = Math.max(0, Math.min(1, -normal.getY(i)));
    const brightness = 0.94 + 0.10 * exposure - 0.055 * underside;
    colour.setXYZ(i,
      colour.getX(i) * brightness * (1 + 0.018 * exposure),
      colour.getY(i) * brightness,
      colour.getZ(i) * brightness * (1 - 0.025 * exposure));
  }
  colour.needsUpdate = true;
  return geometry;
}
