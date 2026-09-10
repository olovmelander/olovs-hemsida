import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

/* The surroundings record (geobuild/parse-osm-wide.mjs) is data the engine
   concatenates onto the pack -- so what must hold is what the engine assumes
   rather than a rendering: every ring is a ring, every level the engine draws
   a sheet at is a number, the pack's own kinds stay outside the pack's own
   extract, and the sea polygon closed from the coastline contains the harbour
   and not the course. The last is the check that never entered the closing. */
const inRing = (x, z, r) => {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const inBox = (p, b) => p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.z0 && p[1] <= b.z1;

describe('the surroundings record', () => {
  const builds = ['geobuild', 'veckefjardenkortbuild'];
  for (const b of builds) {
    const file = new URL(`../../../../${b}/surroundings.json`, import.meta.url);
    if (!existsSync(file)) continue;
    const S = JSON.parse(readFileSync(file, 'utf8'));
    it(`${b}: is version 1, boxed, and every ring is a ring inside the box`, () => {
      expect(S.version).toBe(1);
      expect(S.box.x1 - S.box.x0).toBeGreaterThanOrEqual(12000);
      expect(inBox([S.inner.x0, S.inner.z0], S.box) && inBox([S.inner.x1, S.inner.z1], S.box)).toBe(true);
      for (const k of ['landmarks', 'water', 'landuse', 'pistes', 'sports'])
        for (const f of S[k]) {
          expect(f.ring.length, `${k} ${f.id}`).toBeGreaterThanOrEqual(3);
          for (const p of f.ring) expect(inBox(p, S.box), `${k} ${f.id} leaves the box`).toBe(true);
        }
      for (const k of ['roads', 'railway', 'lifts'])
        for (const f of S[k]) { expect(f.line.length).toBeGreaterThanOrEqual(2); for (const p of f.line) expect(inBox(p, S.box)).toBe(true); }
      for (const bx of S.buildings) { expect(bx.length).toBe(7); expect(bx.every(Number.isFinite)).toBe(true); }
    });
    it(`${b}: the pack's own kinds stay outside the pack's extract and never repeat a way the pack has`, () => {
      const core = JSON.parse(readFileSync(new URL('../../../../geobuild/osm-features.json', import.meta.url), 'utf8'));
      const packIds = new Set();
      for (const k of ['buildings', 'paths', 'tracks', 'roads', 'railway', 'landuse', 'water', 'parking', 'piers', 'forest', 'wood'])
        for (const f of core[k] || []) if (f.id) packIds.add(f.id);
      for (const k of ['landmarks', 'water', 'landuse', 'piers', 'roads', 'railway'])
        for (const f of S[k]) if (f.id !== 'coast') expect(packIds.has(f.id) && k !== 'roads' && k !== 'railway', `${k} ${f.id} is already in the pack`).toBe(false);
      for (const bx of S.buildings) expect(inBox(bx, S.inner), `box at ${bx[0]},${bx[1]}`).toBe(false);
      /* a way the pack carries is clipped to its outside runs: a run may end ON
         the inner edge (that is how it meets the pack's ribbon), never inside
         it. A way the pack DROPPED (a street too far from the course for its
         rules) is kept whole, inner part included, since nothing else draws it. */
      const strictly = (p, bb) => p[0] > bb.x0 + 1 && p[0] < bb.x1 - 1 && p[1] > bb.z0 + 1 && p[1] < bb.z1 - 1;
      let clipped = 0, whole = 0;
      for (const r of S.roads.concat(S.railway)) {
        if (!packIds.has(r.id)) { whole++; continue; }
        clipped++;
        for (const p of r.line) expect(strictly(p, S.inner), `${r.id} is the pack's and reaches inside the extract at ${p}`).toBe(false);
      }
      expect(clipped).toBeGreaterThan(0);
      expect(whole).toBeGreaterThan(0);
    });
    it(`${b}: the sea closed from the coastline holds the harbour and not the course`, () => {
      const sea = S.water.filter(w => w.kind === 'sea');
      expect(sea.length).toBeGreaterThan(0);
      for (const w of sea) { expect(Number.isFinite(w.level)).toBe(true); expect(w.levelSamples).toBeGreaterThan(100); }
      /* Örnsköldsviksfjärden's harbour basin and inner bay; the frame origin (on the course), the town centre, the ski jumps */
      for (const p of [[3000, 1400], [2500, 1300]]) expect(sea.some(w => inRing(p[0], p[1], w.ring)), `sea at ${p}`).toBe(true);
      for (const p of [[0, 0], [2600, -600], [1300, -540]]) expect(sea.some(w => inRing(p[0], p[1], w.ring)), `land at ${p}`).toBe(false);
      /* Terrarium carries this basin ~21 m above RH 2000: the sea reads near the lake's 21.59, never near 0 */
      for (const w of sea) { expect(w.level).toBeGreaterThan(17); expect(w.level).toBeLessThan(23); }
    });
    it(`${b}: carries the things the town is recognised by`, () => {
      expect(S.pistes.filter(p => p.kind === 'ski_jump').length).toBeGreaterThanOrEqual(1);
      expect(S.pistes.some(p => p.kind === 'downhill' && p.prov === 'trace')).toBe(true);
      expect(S.sports.some(s => s.kind === 'track' && s.sport === 'horse_racing')).toBe(true);
      expect(S.lifts.length).toBeGreaterThanOrEqual(2);
      expect(S.towers.some(t => t.kind === 'water_tower')).toBe(true);
      expect(S.landmarks.some(l => /Hägglunds Arena/.test(l.name || ''))).toBe(true);
      expect(S.landmarks.some(l => l.kind === 'church')).toBe(true);
      /* the three nodes the scenery module draws itself must not be here twice */
      for (const id of ['n845145336', 'n9502846496', 'n10943559733']) expect(S.towers.some(t => t.id === id), id).toBe(false);
      const ids = S.roads.map(r => r.id).concat(S.railway.map(r => r.id));
      expect(new Set(S.landmarks.map(l => l.id)).size).toBe(S.landmarks.length);
      expect(ids.length).toBeGreaterThan(0);
    });
  }
});
