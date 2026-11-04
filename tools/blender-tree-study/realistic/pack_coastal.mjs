/* Pack Visby's realistic catalogue: the coastal pine (realistic_trees.py's `kust`) in the place of the inland pine,
   and the rest of realistic-v2.json as it stands, so every other species is the same files. The pine's growth forms
   keep the heights and radii of the painted ones the owner kept (ghibli-visby.json) and their seeds. It has its own
   sprig (sprig_atlas.py `kust`, pack_sprigs.mjs --keys kust) in the painted pine's palette, and the inland pine's bark.

   node tools/blender-tree-study/realistic/pack_coastal.mjs <trees-json-dir> <atlas-dir>     */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { glb } from './tree-glb.mjs';

const [treeDir, atlasDir] = process.argv.slice(2);
const root = path.resolve('apps/golf/public/models/trees');
const read = f => JSON.parse(fs.readFileSync(path.join(root, f)));
const base = read('realistic-v2.json'), painted = read('ghibli-visby.json');
export const REVISION = 'realistic-visby-2026-11-04';
const write = (bytes, ext = 'glb') => {
  const h = createHash('sha256').update(bytes).digest('hex'), file = `realistic-v2/${h}.${ext}`;
  fs.writeFileSync(path.join(root, file), bytes);
  return { file, bytes: bytes.length, sha256: h };
};
const kept = painted.species.find(s => s.key === 'tall');
const variants = kept.variants.map((old, v) => {
  const tiers = {};
  for (const tier of ['hero', 'full']) {
    const t = JSON.parse(fs.readFileSync(path.join(treeDir, `kust-${tier}-${v}.json`)));
    const count = t.crown.position.length / 3;
    tiers[tier] = { ...write(glb([
      { name: 'crown', attributes: { POSITION: [Float32Array.from(t.crown.position), 'VEC3'], NORMAL: [Float32Array.from(t.crown.normal), 'VEC3'],
        TEXCOORD_0: [Float32Array.from(t.crown.uv), 'VEC2'], COLOR_0: [new Float32Array(count * 3).fill(1), 'VEC3'] }, index: Uint32Array.from(t.crown.index) },
      { name: 'trunk', attributes: { POSITION: [Float32Array.from(t.trunk.position), 'VEC3'], NORMAL: [Float32Array.from(t.trunk.normal), 'VEC3'],
        COLOR_0: [Float32Array.from(t.trunk.color), 'VEC3'], TEXCOORD_0: [Float32Array.from(t.trunk.uv), 'VEC2'] }, index: Uint32Array.from(t.trunk.index) },
    ])), tris: (t.crown.index.length + t.trunk.index.length) / 3 };
  }
  return { seed: old.seed, templateHeight: old.templateHeight, templateRadius: old.templateRadius, tiers };
});
const atlasRecord = JSON.parse(fs.readFileSync(path.join(atlasDir, 'atlas.json'))).species.kust;
const foliage = { key: 'tall', atlas: write(fs.readFileSync(path.join(atlasDir, 'kust.png')), 'png'),
  normals: write(fs.readFileSync(path.join(atlasDir, 'kust-normal.png')), 'png'), mean: atlasRecord.mean };
const species = base.species.map(s => s.key === 'tall' ? { ...s, name: kept.name, foliage, variants } : s);
const manifest = { ...base, design: 'realistic-visby', revision: REVISION, course: 'visby',
  budgets: { hero: Math.max(...species.flatMap(s => s.variants.map(v => v.tiers.hero.tris))), full: Math.max(...species.flatMap(s => s.variants.map(v => v.tiers.full.tris))) },
  source: { ...base.source, geometry: "tools/blender-tree-study/realistic/realistic_trees.py (`kust`, the coastal pine)",
    pack: 'tools/blender-tree-study/realistic/pack_coastal.mjs', fittedTo: 'ghibli-visby.json (the kept coastal pines\' heights and radii; the rest as realistic-v2.json)' },
  species };
fs.writeFileSync(path.join(root, 'realistic-visby.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('coastal pine', variants.map(v => `${v.tiers.hero.tris}/${v.tiers.full.tris}`).join('  '));
