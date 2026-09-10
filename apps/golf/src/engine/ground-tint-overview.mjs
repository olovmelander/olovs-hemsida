const linearByte = Float64Array.from({ length: 256 }, (_, byte) => {
  const v = byte / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});

/** Downsample the detailed tint without exposing its rectangular crop edge.
 * Both the footprint average and the transition to the vista are in linear
 * light, matching the GPU's sRGB texture sampling. The footprint guard makes
 * the detailed contribution reach zero before any required samples run out.
 */
export function createGroundTintOverview(layer, { spacing, blendMetres = 300 }, vistaColourAt) {
  const { n, dx, bounds, texture } = layer;
  const data = texture.image.data;
  const radius = spacing / 2;
  return (x, z) => {
    const edge = Math.min(x - bounds.x0, bounds.x1 - x, z - bounds.z0, bounds.z1 - z);
    const t = Math.max(0, Math.min(1, (edge - radius) / blendMetres));
    if (t === 0) return vistaColourAt(x, z);
    const weight = t * t * (3 - 2 * t);
    const x0 = (x - radius - bounds.x0) / dx, x1 = (x + radius - bounds.x0) / dx;
    const z0 = (z - radius - bounds.z0) / dx, z1 = (z + radius - bounds.z0) / dx;
    const sum = [0, 0, 0];
    // Include partial edge texels: the two grids share sample centres, so a
    // 24 m footprint spans five 6 m texels, with half a texel at either end.
    for (let j = Math.max(0, Math.floor(z0)); j < Math.min(n, Math.ceil(z1)); j++) {
      const dz = Math.min(j + 1, z1) - Math.max(j, z0);
      for (let i = Math.max(0, Math.floor(x0)); i < Math.min(n, Math.ceil(x1)); i++) {
        const area = dz * (Math.min(i + 1, x1) - Math.max(i, x0));
        const o = (j * n + i) * 4;
        for (let k = 0; k < 3; k++) sum[k] += linearByte[data[o + k]] * area;
      }
    }
    const area = (spacing / dx) ** 2;
    const near = sum.map(v => v / area);
    if (weight === 1) return near;
    const vista = vistaColourAt(x, z);
    return vista.map((v, k) => v + (near[k] - v) * weight);
  };
}
