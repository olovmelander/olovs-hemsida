import { describe, expect, it } from 'vitest';
import { LessDepth, LessEqualDepth, Matrix4, MeshBasicNodeMaterial, Vector3, WebGPUCoordinateSystem } from 'three/webgpu';
import { configureWaterDepth, configureWaterRenderPasses, MEASURED_WATER_CLEARANCE_METRES } from './water-render-policy.mjs';

const projection = reversed => {
  const top = Math.tan(48 * Math.PI / 360);
  return new Matrix4().makePerspective(-top, top, top, -top, 1, 14000, WebGPUCoordinateSystem, reversed);
};
const projectedDepth = (matrix, distance) => new Vector3(0, 0, -distance).applyMatrix4(matrix).z;
const fixed24 = depth => Math.round(depth * (2 ** 24 - 1)) / (2 ** 24 - 1);

describe.each([
  { label: 'conventional 24-bit', reversed: false, storeDepth: fixed24, unit: 1 / (2 ** 24 - 1) },
  // A large ocean triangle clipped at the near plane has max depth 1.
  // Float bias is calculated from that triangle maximum (23 mantissa bits),
  // even when the fragment in question is kilometres away at depth ~0.0002.
  { label: 'reversed float with a near-clipped ocean triangle', reversed: true, storeDepth: Math.fround, unit: 2 ** -23 },
])('coastal occlusion: $label', ({ reversed, storeDepth, unit }) => {
  it('keeps low foreground land in front of water across distance and view pitch', () => {
    const matrix = projection(reversed), sign = reversed ? 1 : -1;
    const material = configureWaterDepth(new MeshBasicNodeMaterial(), { measuredOnly: true, depthSign: sign });
    let oldLeaks = 0;
    for (const distance of [250, 1000, 4200]) for (const pitch of [2, 8, 30]) {
      // The same viewing ray meets low land, then the sea sheet behind it.
      // Six centimetres above the displayed sea is still dry land.
      const seaDistance = distance + MEASURED_WATER_CLEARANCE_METRES / Math.sin(pitch * Math.PI / 180);
      const land = storeDepth(projectedDepth(matrix, distance));
      const sea = projectedDepth(matrix, seaDistance);
      const inFront = (depth, strict) => reversed
        ? (strict ? depth > land : depth >= land)
        : (strict ? depth < land : depth <= land);
      const offset = material.polygonOffset ? material.polygonOffsetUnits * unit : 0;
      expect(inFront(storeDepth(sea + offset), material.depthFunc === LessDepth), `${distance} m / ${pitch}°`).toBe(false);
      // Negative control: the previous constant-only policy must reproduce
      // the failure, or this regression would pass without the fix.
      if (inFront(storeDepth(sea + sign * 2 * unit))) oldLeaks++;
    }
    expect(oldLeaks).toBeGreaterThan(0);
    expect(material.depthTest).toBe(true);
    expect(material.depthFunc).toBe(LessDepth);
    expect(material.polygonOffsetFactor).toBe(0);
    expect(material.polygonOffsetUnits).toBe(0);
  });
});

it('keeps physically separated sea visible above the laser surface with reversed float depth', () => {
  const matrix = projection(true);
  for (const distance of [250, 1000, 4200]) for (const pitch of [2, 8, 30]) {
    // Visby: measured sea 0.23 m, laser plate 0.24 m, displayed sea 0.29 m.
    const clearance = 0.23 + MEASURED_WATER_CLEARANCE_METRES - 0.24;
    const bedDistance = distance + clearance / Math.sin(pitch * Math.PI / 180);
    expect(Math.fround(projectedDepth(matrix, distance)))
      .toBeGreaterThan(Math.fround(projectedDepth(matrix, bedDistance)));
  }
});

it('retains carved inland water depth policy and flat-mask pass behavior', () => {
  for (const depthSign of [-1, 1]) {
    const material = configureWaterDepth(new MeshBasicNodeMaterial(), { depthSign });
    expect(material.polygonOffset).toBe(true);
    expect(material.polygonOffsetFactor).toBe(depthSign);
    expect(material.polygonOffsetUnits).toBe(depthSign * 2);
    expect(material.depthFunc).toBe(LessEqualDepth);
    configureWaterRenderPasses(material);
    expect(material.forceSinglePass).toBe(true);
    configureWaterRenderPasses(material, { mask: {} });
    expect(material.forceSinglePass).toBe(false);
  }
});
