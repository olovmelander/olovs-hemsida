import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { PLAYER_TREE_SETS, REALISTIC_TREE_REVISION, playerTreeSet } from './ghibli-trees.mjs';
import { REALISTIC_LEAVES } from './ghibli-foliage-material.mjs';

const root = new URL('../../public/models/trees/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, root));
const approved = JSON.parse(read('ghibli-fluffy.json'));
const v2 = JSON.parse(read('realistic-v2.json'));

describe('the realistic catalogue (treeset v2)', () => {
  it('is drawn only when asked for: ?treeset=v2', () => {
    expect(PLAYER_TREE_SETS).toEqual(['v1', 'v2']);
    expect(playerTreeSet('')).toBe('v1');
    expect(playerTreeSet('?treeset=v2')).toBe('v2');
    expect(playerTreeSet('?treeset=v3')).toBe('v1');
    expect(v2.revision).toBe(REALISTIC_TREE_REVISION);
    expect(v2).toMatchObject({ schemaVersion: 1, kind: 'ghibli-trees', design: 'realistic-v2' });
  });
  it('stands every species exactly as tall and wide as the approved tree it replaces', () => {
    expect(v2.species.map(s => s.key)).toEqual(approved.species.map(s => s.key));
    for (const [i, s] of v2.species.entries()) {
      const a = approved.species[i];
      expect(s.foliage.key).toBe(a.foliage.key);
      expect(s.variants.length).toBe(a.variants.length);
      expect(s.variants[0].templateHeight).toBe(a.variants[0].templateHeight);
      expect(s.variants[0].templateRadius).toBe(a.variants[0].templateRadius);
    }
  });
  it('publishes hash-named assets whose bytes match their records, and cheaper hero meshes', () => {
    for (const s of v2.species) {
      for (const rec of [s.foliage.atlas, s.variants[0].tiers.hero, s.variants[0].tiers.full]) {
        const bytes = read(rec.file);
        expect(bytes.length).toBe(rec.bytes);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(rec.sha256);
        expect(rec.file).toContain(rec.sha256);
      }
      const hero = s.variants[0].tiers.hero.tris, before = approved.species.find(a => a.key === s.key).variants[0].tiers.hero.tris;
      expect(hero).toBeLessThan(before);
      expect(s.variants[0].tiers.full.tris).toBeLessThan(hero);
      /* the material divides by the atlas's mean: the sprigs are near neutral round it */
      for (const m of s.foliage.mean) expect(Math.abs(m - REALISTIC_LEAVES.mean)).toBeLessThan(0.08);
    }
    expect(v2.source.geometry).toBe('tools/blender-tree-study/realistic/realistic_trees.py');
  });
  it('keeps the meshes and impostors in agreement: no painted bands on either, the bake cut at the meshes\' own resolution', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toContain('realistic: foliage.realistic === true,');
    expect(main.match(/canopy: CANOPY_ON && !GHIBLI\.species\[s\]\.foliage\.realistic/g)?.length).toBe(2);
    const impostor = fs.readFileSync(new URL('./tree-impostor.mjs', import.meta.url), 'utf8');
    expect(impostor).toContain("const mask = foliage.realistic === true ? texture(foliage.map).level(0).a : texture(foliage.map).a;");
    expect(impostor).toContain('foliageSurfacePigment(texture(foliage.map), foliage.realistic === true)');
  });
});
