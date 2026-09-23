import { describe, it, expect } from 'vitest';
import { shadowSnapCell, sameShadowCell } from './shadow-cell.mjs';

const basis = () => {
  const d = { x: 0.35, y: 0.8, z: -0.48 }, n = Math.hypot(d.x, d.y, d.z);
  d.x /= n; d.y /= n; d.z /= n;
  const r = { x: d.z, y: 0, z: -d.x }, rn = Math.hypot(r.x, r.z); r.x /= rn; r.z /= rn;
  const u = { x: d.y * r.z - d.z * r.y, y: d.z * r.x - d.x * r.z, z: d.x * r.y - d.y * r.x };
  return { d, right: r, up: u };
};

describe('shadow cell key', () => {
  it('reproduces the texel offset the float placement used', () => {
    const { d, right, up } = basis(), texel = 2 * 400 / 4096, t = { x: -1234.567, y: 41.2, z: 876.54 };
    const c = shadowSnapCell(t, right, up, d, texel);
    const u = t.x * right.x + t.y * right.y + t.z * right.z;
    expect(c.ox).toBe(Math.round(u / texel) * texel - u);
    expect(Math.abs(c.ox)).toBeLessThanOrEqual(texel / 2);
  });

  it('keeps one placement through last-bit noise in the orbit target', () => {
    const { d, right, up } = basis(), texel = 2 * 400 / 4096, state = { version: -1 };
    const t = { x: -1234.567, y: 41.2, z: 876.54 };
    expect(sameShadowCell(state, 1, texel, shadowSnapCell(t, right, up, d, texel))).toBe(false);
    for (const e of [1.1e-13, -1.1e-13, 2.2e-13]) {
      const jittered = { x: t.x + e, y: t.y - e, z: t.z + e };
      expect(sameShadowCell(state, 1, texel, shadowSnapCell(jittered, right, up, d, texel))).toBe(true);
    }
  });

  it('re-places on a new cell, fit or sun direction', () => {
    const { d, right, up } = basis(), texel = 2 * 400 / 4096, state = { version: -1 };
    const t = { x: 10, y: 20, z: 30 };
    sameShadowCell(state, 1, texel, shadowSnapCell(t, right, up, d, texel));
    const moved = { x: t.x + right.x * texel, y: t.y + right.y * texel, z: t.z + right.z * texel };
    expect(sameShadowCell(state, 1, texel, shadowSnapCell(moved, right, up, d, texel))).toBe(false);
    expect(sameShadowCell(state, 1, 2 * 600 / 4096, shadowSnapCell(moved, right, up, d, 2 * 600 / 4096))).toBe(false);
    expect(sameShadowCell(state, 2, 2 * 600 / 4096, shadowSnapCell(moved, right, up, d, 2 * 600 / 4096))).toBe(false);
  });
});
