import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { PLAYER_TREE_SETS, REALISTIC_TREE_REVISION, REALISTIC_VISBY_REVISION, playerTreeSet } from './ghibli-trees.mjs';
import { REALISTIC_BARK, REALISTIC_LEAVES } from './ghibli-foliage-material.mjs';

const root = new URL('../../public/models/trees/', import.meta.url);
const read = f => fs.readFileSync(new URL(f, root));
const approved = JSON.parse(read('ghibli-fluffy.json'));
const v2 = JSON.parse(read('realistic-v2.json'));

describe('the realistic catalogue (treeset v2)', () => {
  it('is the default, and ?treeset=v1 is the before', () => {
    expect(PLAYER_TREE_SETS).toEqual(['v1', 'v2']);
    expect(playerTreeSet('')).toBe('v2');
    expect(playerTreeSet('?treeset=v2')).toBe('v2');
    expect(playerTreeSet('?treeset=v3')).toBe('v2');
    expect(playerTreeSet('?treeset=v1')).toBe('v1');
    expect(v2.revision).toBe(REALISTIC_TREE_REVISION);
    expect(v2).toMatchObject({ schemaVersion: 1, kind: 'ghibli-trees', design: 'realistic-v2' });
  });
  it('stands every species exactly as tall and wide as the approved tree it replaces', () => {
    expect(v2.species.map(s => s.key)).toEqual(approved.species.map(s => s.key));
    for (const [i, s] of v2.species.entries()) {
      const a = approved.species[i];
      expect(s.foliage.key).toBe(a.foliage.key);
      /* three variants a species, every one in the approved template's box (main.js TEMPLATES: ky = kxz = 1) */
      expect(s.variants.length).toBe(3);
      for (const v of s.variants) {
        expect(v.templateHeight).toBe(a.variants[0].templateHeight);
        expect(v.templateRadius).toBe(a.variants[0].templateRadius);
      }
      expect(new Set(s.variants.map(v => v.tiers.hero.sha256)).size).toBe(3);
    }
  });
  it('publishes hash-named assets whose bytes match their records, within the hero budget', () => {
    for (const s of v2.species) {
      /* the modelled sprigs (sprig_atlas.py): a normal and light-through atlas beside the colour */
      expect(s.foliage.normals?.file).toMatch(/^realistic-v2\/[a-f0-9]{64}\.png$/);
      /* the modelled bark (bark_atlas.py): its colour and relief, wrapping round the trunk */
      expect(s.bark?.tileMetres).toBe(0.6);
      for (const rec of [s.foliage.atlas, s.foliage.normals, s.bark.atlas, s.bark.normals, ...s.variants.flatMap(v => [v.tiers.hero, v.tiers.full])]) {
        const bytes = read(rec.file);
        expect(bytes.length).toBe(rec.bytes);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(rec.sha256);
        expect(rec.file).toContain(rec.sha256);
      }
      /* fuller crowns (owner, 3 November) at about the approved hero's triangles: the spruce's dense sprays
         take up to half again, measured within the frame budget (docs/visual-trees-realistic-2026-11-03.md) */
      const before = approved.species.find(a => a.key === s.key).variants[0].tiers.hero.tris;
      for (const v of s.variants) {
        expect(v.tiers.hero.tris).toBeLessThan(before * 1.5);
        expect(v.tiers.full.tris).toBeLessThan(v.tiers.hero.tris / 2);
      }
      /* the material divides by the atlas's own mean (the manifest's): near neutral, so the palette keeps the hue */
      expect(s.foliage.mean).toHaveLength(3);
      for (const m of s.foliage.mean) { expect(m).toBeGreaterThan(0.6); expect(m).toBeLessThan(0.95); }
      expect(Math.max(...s.foliage.mean) - Math.min(...s.foliage.mean)).toBeLessThan(0.06);
      expect(REALISTIC_LEAVES.share).toBeGreaterThan(0.5);
    }
    expect(v2.source.geometry).toBe('tools/blender-tree-study/realistic/realistic_trees.py');
    expect(v2.source.atlas).toContain('sprig_atlas.py');
  });
  it('leaves the relief out at low quality, and works offline', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toContain("relief: !LOWQ || new URLSearchParams(location.search).get('treerelief') === '1',");
    const loader = fs.readFileSync(new URL('./ghibli-trees.mjs', import.meta.url), 'utf8');
    expect(loader).toContain('if (realistic && relief && entry.bark) {');
    expect(loader).toContain('if (realistic && relief && entry.foliage.normals) {');
    /* the service worker keeps what the default visit draws, as it keeps the painted catalogue */
    const worker = fs.readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
    expect(worker).toContain('(ghibli-fluffy|ghibli-visby|realistic-v2|realistic-visby)');
    expect(worker).toContain('(ghibli-fluffy|visby-pine|realistic-v2)');
    expect(v2.species[0].foliage.atlas.file.startsWith('realistic-v2/')).toBe(true);
  });
  it('gives Visby its coastal pine in the kept growth forms, and every other tree as the other courses have it', () => {
    const coast = JSON.parse(read('realistic-visby.json')), kept = JSON.parse(read('ghibli-visby.json'));
    expect(coast.revision).toBe(REALISTIC_VISBY_REVISION);
    expect(coast).toMatchObject({ schemaVersion: 1, kind: 'ghibli-trees', design: 'realistic-visby', course: 'visby' });
    expect(coast.species.map(s => s.key)).toEqual(v2.species.map(s => s.key));
    for (const s of coast.species) {
      if (s.key !== 'tall') { expect(s).toEqual(v2.species.find(o => o.key === s.key)); continue; }
      const painted = kept.species.find(o => o.key === 'tall'), inland = v2.species.find(o => o.key === 'tall');
      expect(s.name).toBe(painted.name);
      /* its own sprig in the kept palette, the inland pine's bark, in the painted pine's boxes and seeds, a hero budget's triangles */
      expect(s.foliage.key).toBe(painted.foliage.key);
      expect(s.foliage.atlas.sha256).not.toBe(inland.foliage.atlas.sha256);
      for (const rec of [s.foliage.atlas, s.foliage.normals]) expect(createHash('sha256').update(read(rec.file)).digest('hex')).toBe(rec.sha256);
      expect(s.bark).toEqual(inland.bark);
      expect(s.variants.length).toBe(painted.variants.length);
      for (const [i, v] of s.variants.entries()) {
        const p = painted.variants[i];
        expect([v.seed, v.templateHeight, v.templateRadius]).toEqual([p.seed, p.templateHeight, p.templateRadius]);
        expect(v.tiers.hero.tris).toBeLessThan(p.tiers.hero.tris * 1.5);
        expect(v.tiers.full.tris).toBeLessThan(v.tiers.hero.tris / 2);
        for (const rec of [v.tiers.hero, v.tiers.full]) {
          const bytes = read(rec.file);
          expect(bytes.length).toBe(rec.bytes);
          expect(createHash('sha256').update(bytes).digest('hex')).toBe(rec.sha256);
          expect(rec.file).toMatch(/^realistic-v2\/[a-f0-9]{64}\.glb$/);
        }
      }
    }
  });
  it('keeps the meshes and impostors in agreement: no painted bands on either, the bake cut at the meshes\' own resolution', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toContain('realistic: foliage.realistic === true,');
    expect(main.match(/canopy: CANOPY_ON && !GHIBLI\.species\[s\]\.foliage\.realistic/g)?.length).toBe(2);
    const impostor = fs.readFileSync(new URL('./tree-impostor.mjs', import.meta.url), 'utf8');
    expect(impostor).toContain("const mask = foliage.realistic === true ? texture(foliage.map).level(0).a : texture(foliage.map).a;");
    expect(impostor).toContain('foliageSurfacePigment(texture(foliage.map), foliage.realistic === true, foliage.mean ?? null)');
    /* the bake's normals are the leaves' own, as the mesh lights them */
    expect(impostor).toContain('foliage.realistic === true && foliage.normals ? leafNormal({ normals: foliage.normals }) : normalWorldGeometry');
    expect(main).toContain("normals: new URLSearchParams(location.search).get('leafnormals') !== '0' ? foliage.normals ?? null : null, mean: foliage.mean ?? null,");
    expect(main).toContain("if (bark?.map && bark.normals && new URLSearchParams(location.search).get('bark') !== '0') {");
    expect(impostor).toContain("frameSize ??= foliage?.realistic === true ? REALISTIC_IMPOSTOR_FRAME : 96;");
  });
});

describe('the bark and the shadow-only trees', () => {
  it('gives the dark even barks their own relief, and counts the trees kept only for their shadows', () => {
    expect(REALISTIC_BARK.reliefBy.ek).toBeGreaterThan(REALISTIC_BARK.relief);
    expect(REALISTIC_BARK.reliefBy.al).toBeGreaterThan(REALISTIC_BARK.relief);
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toContain('barkSurface({ bark, key: GHIBLI.species[s].foliage.key })');
    expect(main).toContain('TREE_LOD.stats.shadowTrees = shadowTrees;');
  });
});
