/* Pack the realistic catalogue (treeset v2): the Blender trees (realistic_trees.py's JSON) as
   geometry-only GLBs with a `crown` and a `trunk` node, the leaf atlases (make_leaf_atlas.mjs),
   all hash-named under apps/golf/public/models/trees/realistic-v2/, and the manifest
   apps/golf/public/models/trees/realistic-v2.json in the approved catalogue's schema.

   The template height and radius are the APPROVED catalogue's (ghibli-fluffy.json), not the new
   meshes' own: the loader fits every tier to them (fitFoliageTier), so a v2 tree stands exactly
   as tall and wide as the tree it replaces and placements and shadows still match.

   node tools/blender-tree-study/realistic/pack_catalogue.mjs <trees-json-dir> <atlas-dir>     */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { treeGlb } from './tree-glb.mjs';

const [treeDir, atlasDir, barkDir = null] = process.argv.slice(2);
/* the modelled bark (bark_atlas.py, pack_bark.mjs), if given */
const barkRecord = barkDir ? JSON.parse(fs.readFileSync(path.join(barkDir, 'bark.json'))) : null;
const root = path.resolve('apps/golf/public/models/trees');
const outDir = path.join(root, 'realistic-v2');
fs.mkdirSync(outDir, { recursive: true });
const approved = JSON.parse(fs.readFileSync(path.join(root, 'ghibli-fluffy.json')));
const atlasRecord = JSON.parse(fs.readFileSync(path.join(atlasDir, 'atlas.json')));
const sha = b => createHash('sha256').update(b).digest('hex');
export const REVISION = 'realistic-v2-2026-11-03';

const write = (bytes, ext) => {
  const h = sha(bytes), file = `realistic-v2/${h}.${ext}`;
  fs.writeFileSync(path.join(root, file), bytes);
  return { file, bytes: bytes.length, sha256: h };
};

const species = [];
for (const old of approved.species) {
  const key = old.key, a = atlasRecord.species[key];
  if (!a) throw new Error(`no atlas for ${key}`);
  const atlasBytes = fs.readFileSync(path.join(atlasDir, `${key}.png`));
  if (sha(atlasBytes) !== a.sha256) throw new Error(`atlas ${key} does not match its record`);
  const atlas = write(atlasBytes, 'png');
  /* the modelled sprigs (sprig_atlas.py, pack_sprigs.mjs) carry their normals and light through */
  let normals = null;
  if (a.normal) {
    const nb = fs.readFileSync(path.join(atlasDir, `${key}-normal.png`));
    if (sha(nb) !== a.normal.sha256) throw new Error(`normals ${key} do not match their record`);
    normals = write(nb, 'png');
  }
  /* every variant stands in the approved template's box: the engine draws each species' variants
     at the species template's height and radius (main.js TEMPLATES, ky = kxz = 1) */
  const variant = old.variants[0];
  const variants = [];
  for (let v = 0; fs.existsSync(path.join(treeDir, `${key}-hero-${v}.json`)); v++) {
  const tiers = {};
  for (const tier of ['hero', 'full']) {
    const t = JSON.parse(fs.readFileSync(path.join(treeDir, `${key}-${tier}-${v}.json`)));
    const bytes = treeGlb(t);
    tiers[tier] = { ...write(bytes, 'glb'), tris: (t.crown.index.length + t.trunk.index.length) / 3 };
  }
  variants.push({ seed: variant.seed + 101 * v, templateHeight: variant.templateHeight, templateRadius: variant.templateRadius, tiers });
  }
  if (!variants.length) throw new Error(`no trees for ${key}`);
  let bark = null;
  if (barkRecord?.species[key]) {
    const b = barkRecord.species[key], read = f => fs.readFileSync(path.join(barkDir, f));
    const cb = read(`bark-${key}.png`), nb = read(`bark-${key}-normal.png`);
    if (sha(cb) !== b.colour.sha256 || sha(nb) !== b.normal.sha256) throw new Error(`bark ${key} does not match its record`);
    bark = { atlas: write(cb, 'png'), normals: write(nb, 'png'), mean: b.mean, tileMetres: barkRecord.tileMetres };
  }
  species.push({ key, name: old.name, foliage: { key: old.foliage.key, atlas, ...(normals ? { normals } : {}), mean: a.mean }, ...(bark ? { bark } : {}), variants });
}
const manifest = { schemaVersion: 1, kind: 'ghibli-trees', design: 'realistic-v2', revision: REVISION,
  budgets: { hero: Math.max(...species.flatMap(s => s.variants.map(v => v.tiers.hero.tris))), full: Math.max(...species.flatMap(s => s.variants.map(v => v.tiers.full.tris))) },
  source: { geometry: 'tools/blender-tree-study/realistic/realistic_trees.py', atlas: 'tools/blender-tree-study/realistic/sprig_atlas.py (Blender, Cycles on the CPU) + pack_sprigs.mjs',
    pack: 'tools/blender-tree-study/realistic/pack_catalogue.mjs', fittedTo: 'ghibli-fluffy.json (approved hero heights and radii)' },
  species };
fs.writeFileSync(path.join(root, 'realistic-v2.json'), JSON.stringify(manifest, null, 2) + '\n');
for (const s of species) console.log(s.key, s.variants.map(v => Object.entries(v.tiers).map(([t, r]) => `${t} ${r.tris}`).join('/')).join('  '), 'atlas', s.foliage.atlas.bytes, 'B');
