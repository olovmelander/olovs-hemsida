/* Depth inside a crown: the approved crowns' flat vertex colours darken toward
   their heart and under their skirt, by their own leaves, and keep the colour
   they had where they are open -- on every approved crown, both drawn tiers. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import * as THREE from 'three';
import { loadGhibliTrees } from './ghibli-trees.mjs';
import { bakeCrownDepth, crownOpenness, CROWN_DEPTH } from './crown-depth.mjs';

const root = new URL('../../public/models/trees/', import.meta.url);
const assetFetch = url => Promise.resolve(new Response(fs.readFileSync(new URL(String(url).split('/models/trees/')[1], root))));

describe('baked crown depth', () => {
  beforeEach(() => vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(async () => new THREE.Texture()));
  afterEach(() => vi.restoreAllMocks());

  for (const courseSlug of [null, 'visby']) for (const tier of ['hero', 'full']) {
    it(`darkens the heart of every ${courseSlug ?? 'standard'} ${tier} crown and keeps its open quarter`, async () => {
      const flat = await loadGhibliTrees({ baseUrl: '/', fetchImpl: assetFetch, courseSlug, tier, crownDepth: false });
      const deep = await loadGhibliTrees({ baseUrl: '/', fetchImpl: assetFetch, courseSlug, tier });
      for (let s = 0; s < flat.species.length; s++) {
        const a = flat.species[s].mesh.crown, b = deep.species[s].mesh.crown, key = flat.species[s].key;
        /* the same crown, only its colours changed, and each vertex by one factor on all three channels */
        expect(b.attributes.position.array).toEqual(a.attributes.position.array);
        const ca = a.attributes.color.array, cb = b.attributes.color.array, n = ca.length / 3;
        const factor = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          factor[i] = cb[i * 3 + 1] / ca[i * 3 + 1];
          expect(cb[i * 3] / ca[i * 3]).toBeCloseTo(factor[i], 5);
          expect(cb[i * 3 + 2] / ca[i * 3 + 2]).toBeCloseTo(factor[i], 5);
        }
        const open = factor.filter(f => f > 1 - 1e-6).length / n;
        const mean = factor.reduce((x, y) => x + y, 0) / n;
        expect(Math.max(...factor), key).toBeLessThanOrEqual(1 + 1e-6);
        expect(Math.min(...factor), key).toBeGreaterThanOrEqual(CROWN_DEPTH.floor - 1e-6);
        expect(open, key).toBeGreaterThanOrEqual(CROWN_DEPTH.openShare - 0.01);
        expect(mean, key).toBeGreaterThan(0.72);
        expect(mean, key).toBeLessThan(0.9);
        /* nearer the crown's axis is darker than toward its rim */
        const pos = a.attributes.position.array;
        let cx = 0, cz = 0;
        for (let i = 0; i < n; i++) { cx += pos[i * 3]; cz += pos[i * 3 + 2]; }
        cx /= n; cz /= n;
        const radius = Array.from({ length: n }, (_, i) => Math.hypot(pos[i * 3] - cx, pos[i * 3 + 2] - cz));
        const median = [...radius].sort((x, y) => x - y)[n >> 1];
        const side = inner => { let sum = 0, count = 0; for (let i = 0; i < n; i++) if ((radius[i] < median) === inner) { sum += factor[i]; count++; } return sum / count; };
        expect(side(true), key).toBeLessThan(side(false) - 0.04);
      }
    }, 60000);
  }

  it('is the same crown on every visit, and a crown with nothing around its vertices stays as it was', () => {
    const cards = () => {
      /* a ball of 400 small cards, 5 m across, and one far card on its own */
      const positions = [], rng = (() => { let x = 7; return () => (x = (x * 16807) % 2147483647) / 2147483647; })();
      for (let c = 0; c < 400; c++) {
        const u = rng() * 2 - 1, t = rng() * Math.PI * 2, r = 2.5 * Math.cbrt(rng());
        const p = [r * Math.sqrt(1 - u * u) * Math.cos(t), 3 + r * u, r * Math.sqrt(1 - u * u) * Math.sin(t)];
        positions.push(...p, p[0] + 0.5, p[1], p[2], p[0], p[1] + 0.5, p[2]);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(positions.length).fill(0.97), 3));
      return geometry;
    };
    const a = cards(), b = cards();
    const fa = bakeCrownDepth(a), fb = bakeCrownDepth(b);
    expect(Array.from(fa)).toEqual(Array.from(fb));
    /* the ball's centre is its least open part, its surface its most */
    const open = crownOpenness(cards()), pos = a.attributes.position.array;
    const depth = i => Math.hypot(pos[i * 3], pos[i * 3 + 1] - 3, pos[i * 3 + 2]);
    let core = 0, nc = 0, shell = 0, ns = 0;
    for (let i = 0; i < open.length; i++) { if (depth(i) < 1) { core += open[i]; nc++; } else if (depth(i) > 2.2) { shell += open[i]; ns++; } }
    expect(core / nc).toBeLessThan(shell / ns);
    expect(Math.min(...fa)).toBeCloseTo(CROWN_DEPTH.floor, 5);
  });
});
