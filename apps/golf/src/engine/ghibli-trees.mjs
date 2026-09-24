/* The player requires the approved painted catalogue and draws ONE of its
 * mesh tiers near the course: Hero at high quality, the same catalogue's Full
 * model at low quality (every phone). Both are fitted to the variant's height
 * and radius, so a tree stands exactly as tall and wide in either; the tier
 * drawn also supplies its impostors. Failure reports a loading error.
 * Alternate catalogues and the Lite tier live in studies/tree-loader.mjs. */
import { GHIBLI_SPECIES, GHIBLI_COLOURS, GHIBLI_FOLIAGE_REVISION, VISBY_PINE_REVISION,
  fetchGlb, loadFoliageAtlas, validateAsset, fitFoliageTier } from './ghibli-tree-assets.mjs';
export { GHIBLI_SPECIES, GHIBLI_COLOURS, GHIBLI_FOLIAGE_REVISION, VISBY_PINE_REVISION } from './ghibli-tree-assets.mjs';

/* Hero is 4,032-4,500 triangles a tree and Full 1,620-1,700. */
export const PLAYER_TREE_MESH_TIERS = Object.freeze(['hero', 'full']);

/** The mesh tier a visit draws: low quality takes Full, high quality Hero.
 *  ?treemesh=hero|full selects either for comparison; any other value is ignored. */
export function playerTreeMeshTier(search = '', lowQuality = false) {
  const value = new URLSearchParams(search).get('treemesh');
  if (PLAYER_TREE_MESH_TIERS.includes(value)) return value;
  return lowQuality ? 'full' : 'hero';
}

export async function loadGhibliTrees({ baseUrl = '/', variants = 4, fetchImpl = fetch, courseSlug = null, tier = 'hero' } = {}) {
  if (!PLAYER_TREE_MESH_TIERS.includes(tier)) throw new Error(`Ghibli trees: the player draws no ${tier} tier`);
  const coastalPine = courseSlug === 'visby';
  const base = `${baseUrl}models/trees/`;
  const catalogue = coastalPine ? 'ghibli-visby.json' : 'ghibli-fluffy.json';
  const revision = coastalPine ? VISBY_PINE_REVISION : GHIBLI_FOLIAGE_REVISION;
  const res = await fetchImpl(`${base}${catalogue}?v=${revision}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Ghibli tree manifest: HTTP ${res.status}`);
  const manifest = await res.json();
  if (manifest?.schemaVersion !== 1 || manifest.kind !== 'ghibli-trees') throw new Error('Ghibli tree manifest: unknown schema');
  const byKey = Object.fromEntries(manifest.species.map(s => [s.key, s]));
  const out = { manifest, species: [], colours: GHIBLI_COLOURS, foliage: true,
    summary: { design: manifest.design || 'fluffy', revision: manifest.revision || null,
      variants, tier, hero: tier === 'hero', files: 0, bytes: 0 } };
  const jobs = [];
  const species = [];
  for (const key of GHIBLI_SPECIES) {
    const entry = byKey[key];
    if (!entry) throw new Error(`Ghibli tree manifest lacks ${key}`);
    if (!entry.foliage?.key) throw new Error(`Ghibli tree manifest lacks painted foliage for ${key}`);
    validateAsset(entry.foliage.atlas, 'png');
    const foliage = { key: entry.foliage.key, map: null };
    jobs.push(async () => { foliage.map = await loadFoliageAtlas(base, entry.foliage.atlas, fetchImpl); });
    out.summary.files++; out.summary.bytes += entry.foliage.atlas.bytes;
    const list = [];
    for (let v = 0; v < Math.min(variants, entry.variants.length); v++) {
      const variant = entry.variants[v], rec = variant.tiers[tier];
      validateAsset(rec, 'glb');
      out.summary.files++; out.summary.bytes += rec.bytes;
      /* `mesh` is the drawn template whichever tier it is; it is also filed
         under the tier's own name, so a Full visit carries no `hero` */
      const item = { key, variant: v, seed: variant.seed, foliage, tier,
        templateHeight: variant.templateHeight, templateRadius: variant.templateRadius,
        trunkMean: null, mesh: null,
        tris: Object.fromEntries(Object.entries(variant.tiers).map(([t, r]) => [t, r.tris])) };
      list.push(item);
      jobs.push(async () => {
        const mesh = await fetchGlb(`${base}${rec.file}`, rec, fetchImpl);
        fitFoliageTier(mesh, variant.templateHeight, variant.templateRadius);
        if (!mesh.crown.attributes.uv) throw new Error(`Ghibli foliage ${key}/${tier} lacks UVs`);
        item.mesh = mesh; item[tier] = mesh; item.trunkMean = mesh.trunkMean;
      });
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
