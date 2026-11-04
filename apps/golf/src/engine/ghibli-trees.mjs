/* The player requires one tree catalogue, the realistic one unless a course or
 * ?treeset=v1 says otherwise, and draws ONE of its mesh tiers near the course: Hero at high quality, the same catalogue's Full
 * model at low quality (every phone). Both are fitted to the variant's height
 * and radius, so a tree stands exactly as tall and wide in either; the tier
 * drawn also supplies its impostors. Failure reports a loading error.
 * Alternate catalogues and the Lite tier live in studies/tree-loader.mjs. */
import { GHIBLI_SPECIES, GHIBLI_COLOURS, GHIBLI_FOLIAGE_REVISION, VISBY_PINE_REVISION,
  fetchGlb, loadFoliageAtlas, validateAsset, fitFoliageTier } from './ghibli-tree-assets.mjs';
export { GHIBLI_SPECIES, GHIBLI_COLOURS, GHIBLI_FOLIAGE_REVISION, VISBY_PINE_REVISION } from './ghibli-tree-assets.mjs';
import { bakeCrownDepth } from './crown-depth.mjs';
import { bakePuffNormals, CROWN_PUFFS } from './crown-puffs.mjs';

/* THE REALISTIC CATALOGUE (treeset v2, 3 November; owner request: trees as realistic as the new
   grass): the same five species grown in Blender from branching trunks, crowns of many small
   sprig cards from modelled leaves, fitted to the painted catalogue's heights and radii
   (tools/blender-tree-study/realistic/). The default since 4 November (owner request);
   ?treeset=v1 is the before, the painted catalogue. Visby has its own of each, with its coastal
   pine: the same growth forms and boxes as the painted one the owner kept. */
export const REALISTIC_TREE_REVISION = 'realistic-v2-2026-11-03';
export const REALISTIC_VISBY_REVISION = 'realistic-visby-2026-11-04';
export const PLAYER_TREE_SETS = Object.freeze(['v1', 'v2']);
/** The catalogue a visit draws: the realistic one, or ?treeset=v1 the painted one; any other value is ignored. */
export function playerTreeSet(search = '') {
  return new URLSearchParams(search).get('treeset') === 'v1' ? 'v1' : 'v2';
}

/* Hero is 4,032-4,500 triangles a tree and Full 1,620-1,700 (v2: 4,480-6,428 and 1,542-2,512). */
export const PLAYER_TREE_MESH_TIERS = Object.freeze(['hero', 'full']);

/** The mesh tier a visit draws: low quality takes Full, high quality Hero.
 *  ?treemesh=hero|full selects either for comparison; any other value is ignored. */
export function playerTreeMeshTier(search = '', lowQuality = false) {
  const value = new URLSearchParams(search).get('treemesh');
  if (PLAYER_TREE_MESH_TIERS.includes(value)) return value;
  return lowQuality ? 'full' : 'hero';
}

/* crownDepth darkens each crown's heart and underside by its own leaves
   (crown-depth.mjs); false is the before, flat crown colours. */
/* puffs leans each crown's normals toward the masses it is made of
   (crown-puffs.mjs, the painted canopy): the spruce's masses are its tiers. */
/* relief loads the realistic catalogue's leaf normals and bark maps; false leaves them out and
   draws what ?leafnormals=0&bark=0 draws, the models and the leaves' own colours. */
/* bandTier also loads that tier's meshes as `band`, for the trees further from the holes (main.js TREE_BANDS) */
export async function loadGhibliTrees({ baseUrl = '/', variants = 4, fetchImpl = fetch, courseSlug = null, tier = 'hero', crownDepth = true, puffs = false, treeset = 'v1', relief = true, bandTier = null } = {}) {
  if (!PLAYER_TREE_MESH_TIERS.includes(tier)) throw new Error(`Ghibli trees: the player draws no ${tier} tier`);
  const coastalPine = courseSlug === 'visby';
  const realistic = treeset === 'v2';
  const base = `${baseUrl}models/trees/`;
  const catalogue = realistic ? (coastalPine ? 'realistic-visby.json' : 'realistic-v2.json') : coastalPine ? 'ghibli-visby.json' : 'ghibli-fluffy.json';
  const revision = realistic ? (coastalPine ? REALISTIC_VISBY_REVISION : REALISTIC_TREE_REVISION) : coastalPine ? VISBY_PINE_REVISION : GHIBLI_FOLIAGE_REVISION;
  /* the realistic crowns carry their soft normals from the bake: the painted canopy's puffs would lean them again */
  if (realistic) puffs = false;
  const res = await fetchImpl(`${base}${catalogue}?v=${revision}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Ghibli tree manifest: HTTP ${res.status}`);
  const manifest = await res.json();
  if (manifest?.schemaVersion !== 1 || manifest.kind !== 'ghibli-trees') throw new Error('Ghibli tree manifest: unknown schema');
  const byKey = Object.fromEntries(manifest.species.map(s => [s.key, s]));
  const out = { manifest, species: [], colours: GHIBLI_COLOURS, foliage: true,
    summary: { design: manifest.design || 'fluffy', revision: manifest.revision || null, treeset: realistic ? 'v2' : 'v1',
      variants, tier, hero: tier === 'hero', files: 0, bytes: 0 } };
  const jobs = [];
  const species = [];
  for (const key of GHIBLI_SPECIES) {
    const entry = byKey[key];
    if (!entry) throw new Error(`Ghibli tree manifest lacks ${key}`);
    if (!entry.foliage?.key) throw new Error(`Ghibli tree manifest lacks painted foliage for ${key}`);
    validateAsset(entry.foliage.atlas, 'png');
    /* `realistic`: the material reads the sprigs' own leaf colours (ghibli-foliage-material.mjs) */
    /* the modelled sprigs (sprig_atlas.py) add their normals and light through, and every realistic atlas its leaves' mean */
    const foliage = { key: entry.foliage.key, map: null, realistic, normals: null, mean: realistic ? entry.foliage.mean ?? null : null };
    jobs.push(async () => { foliage.map = await loadFoliageAtlas(base, entry.foliage.atlas, fetchImpl); });
    out.summary.files++; out.summary.bytes += entry.foliage.atlas.bytes;
    /* the modelled bark (bark_atlas.py): its colour and relief, wrapping round the trunk */
    if (realistic && relief && entry.bark) {
      validateAsset(entry.bark.atlas, 'png'); validateAsset(entry.bark.normals, 'png');
      foliage.bark = { map: null, normals: null, mean: entry.bark.mean };
      jobs.push(async () => { foliage.bark.map = await loadFoliageAtlas(base, entry.bark.atlas, fetchImpl, { repeat: true }); });
      jobs.push(async () => { foliage.bark.normals = await loadFoliageAtlas(base, entry.bark.normals, fetchImpl, { linear: true, repeat: true }); });
      out.summary.files += 2; out.summary.bytes += entry.bark.atlas.bytes + entry.bark.normals.bytes;
    }
    if (realistic && relief && entry.foliage.normals) {
      validateAsset(entry.foliage.normals, 'png');
      jobs.push(async () => { foliage.normals = await loadFoliageAtlas(base, entry.foliage.normals, fetchImpl, { linear: true }); });
      out.summary.files++; out.summary.bytes += entry.foliage.normals.bytes;
    }
    const list = [];
    for (let v = 0; v < Math.min(variants, entry.variants.length); v++) {
      const variant = entry.variants[v], rec = variant.tiers[tier];
      validateAsset(rec, 'glb');
      out.summary.files++; out.summary.bytes += rec.bytes;
      /* `mesh` is the drawn template whichever tier it is; it is also filed
         under the tier's own name, so a Full visit carries no `hero` */
      const item = { key, variant: v, seed: variant.seed, foliage, tier,
        templateHeight: variant.templateHeight, templateRadius: variant.templateRadius,
        trunkMean: null, mesh: null, band: null,
        tris: Object.fromEntries(Object.entries(variant.tiers).map(([t, r]) => [t, r.tris])) };
      list.push(item);
      jobs.push(async () => {
        const mesh = await fetchGlb(`${base}${rec.file}`, rec, fetchImpl);
        fitFoliageTier(mesh, variant.templateHeight, variant.templateRadius);
        if (!mesh.crown.attributes.uv) throw new Error(`Ghibli foliage ${key}/${tier} lacks UVs`);
        if (crownDepth) bakeCrownDepth(mesh.crown);
        if (puffs) bakePuffNormals(mesh.crown, key === 'gran'
          ? { puffs: CROWN_PUFFS.spruce[tier] ?? CROWN_PUFFS.spruce.full, tierWeight: CROWN_PUFFS.spruce.tierWeight }
          : { puffs: CROWN_PUFFS.puffs[tier] ?? CROWN_PUFFS.puffs.full });
        item.mesh = mesh; item[tier] = mesh; item.trunkMean = mesh.trunkMean;
      });
      const bandRec = bandTier && bandTier !== tier ? variant.tiers[bandTier] : null;
      if (bandRec) {
        validateAsset(bandRec, 'glb');
        out.summary.files++; out.summary.bytes += bandRec.bytes;
        jobs.push(async () => {
          const mesh = await fetchGlb(`${base}${bandRec.file}`, bandRec, fetchImpl);
          fitFoliageTier(mesh, variant.templateHeight, variant.templateRadius);
          if (crownDepth) bakeCrownDepth(mesh.crown);
          item.band = mesh;
        });
      }
    }
    if (!list.length) throw new Error(`Ghibli tree manifest: ${key} has no variants`);
    species.push(list);
  }
  // Bound network/decode pressure while preserving catalogue/variant order.
  // The caller receives nothing until every asset passed its existing checks.
  let next = 0, failed = false;
  await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, async () => {
    while (!failed && next < jobs.length) {
      const job = jobs[next++];
      try { await job(); } catch (error) { failed = true; throw error; }
    }
  }));
  out.species = species.map(list => ({ ...list[0], variants: list }));
  return out;
}
