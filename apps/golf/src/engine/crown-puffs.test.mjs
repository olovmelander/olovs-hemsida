import { describe, expect, it } from 'vitest';
import { BufferGeometry, Float32BufferAttribute } from 'three/webgpu';
import { bakePuffNormals, CROWN_PUFFS } from './crown-puffs.mjs';

/* two round masses side by side and a third on top, as leaf cards (two triangles each) */
function crown() {
  const P = [], N = [], I = [];
  const masses = [[-2, 4, 0], [2, 4, 0], [0, 6.5, 0]];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const c of masses) for (let j = 0; j < 40; j++) {
    const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - z * z);
    const d = [s * Math.cos(a), z, s * Math.sin(a)], base = P.length / 3;
    for (const [u, v] of [[-.15, -.15], [.15, -.15], [.15, .15], [-.15, .15]]) {
      P.push(c[0] + d[0] * 1.5 + u, c[1] + d[1] * 1.5 + v, c[2] + d[2] * 1.5);
      /* the approved field: the whole crown's direction from its centre */
      const w = [c[0] + d[0] * 1.5, c[1] + d[1] * 1.5 - 5, c[2] + d[2] * 1.5], l = Math.hypot(...w);
      N.push(w[0] / l, w[1] / l, w[2] / l);
    }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new Float32BufferAttribute(N, 3));
  g.setIndex(I);
  return g;
}

describe('the crown\'s puffs', () => {
  it('finds the masses, keeps every card in one, and leaves the positions alone', () => {
    const g = crown(), before = Float32Array.from(g.attributes.position.array);
    const { label, centres } = bakePuffNormals(g, { puffs: 3 });
    expect(centres).toHaveLength(3);
    expect(Array.from(g.attributes.position.array)).toEqual(Array.from(before));
    const idx = g.index.array;
    for (let t = 0; t < idx.length; t += 6) expect(new Set([...idx.slice(t, t + 6)].map(i => label[i])).size).toBe(1);
    const tops = centres.map(c => c[1]).sort((a, b) => a - b);
    expect(tops[2]).toBeGreaterThan(6); expect(tops[0]).toBeLessThan(5);
  });
  it('lights each mass on its cap and darkens its belly, with unit normals', () => {
    const g = crown();
    const { label, centres } = bakePuffNormals(g, { puffs: 3 });
    const pos = g.attributes.position.array, n = g.attributes.normal.array;
    let capUp = 0, bellyUp = 0, caps = 0, bellies = 0;
    for (let i = 0; i < pos.length / 3; i++) {
      expect(Math.hypot(n[i * 3], n[i * 3 + 1], n[i * 3 + 2])).toBeCloseTo(1, 5);
      const dy = pos[i * 3 + 1] - centres[label[i]][1];
      if (dy > 0.8) { capUp += n[i * 3 + 1]; caps++; }
      if (dy < -0.8) { bellyUp += n[i * 3 + 1]; bellies++; }
    }
    expect(capUp / caps).toBeGreaterThan(0.5);
    expect(bellyUp / bellies).toBeLessThan(0);
  });
  it('is deterministic and bounded', () => {
    const a = crown(), b = crown();
    bakePuffNormals(a, { puffs: 3 }); bakePuffNormals(b, { puffs: 3 });
    expect(Array.from(a.attributes.normal.array)).toEqual(Array.from(b.attributes.normal.array));
    expect(CROWN_PUFFS.puffs.hero).toBeLessThanOrEqual(255);
    expect(CROWN_PUFFS.crown + CROWN_PUFFS.puff).toBeCloseTo(1, 6);
  });
});
