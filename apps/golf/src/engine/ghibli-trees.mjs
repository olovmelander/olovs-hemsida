/* The player requires the approved painted catalogue and Hero geometry.
 * The same Hero templates supply impostors; failure reports a loading error.
 * Alternate catalogues and Full/Lite tiers live in studies/tree-loader.mjs. */
import { GHIBLI_SPECIES, GHIBLI_COLOURS, GHIBLI_FOLIAGE_REVISION, VISBY_PINE_REVISION,
  fetchGlb, loadFoliageAtlas, validateAsset, fitFoliageTier } from './ghibli-tree-assets.mjs';
export { GHIBLI_SPECIES, GHIBLI_COLOURS, GHIBLI_FOLIAGE_REVISION, VISBY_PINE_REVISION } from './ghibli-tree-assets.mjs';

export async function loadGhibliTrees({ baseUrl = '/', variants = 4, fetchImpl = fetch, courseSlug = null } = {}) {
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
      variants, hero: true, heroOnly: true, files: 0, bytes: 0 } };
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
      const variant = entry.variants[v], rec = variant.tiers.hero;
      validateAsset(rec, 'glb');
      out.summary.files++; out.summary.bytes += rec.bytes;
      const item = { key, variant: v, seed: variant.seed, foliage,
        templateHeight: variant.templateHeight, templateRadius: variant.templateRadius,
        trunkMean: null, hero: null,
        tris: Object.fromEntries(Object.entries(variant.tiers).map(([t, r]) => [t, r.tris])) };
      list.push(item);
      jobs.push(async () => {
        const hero = await fetchGlb(`${base}${rec.file}`, rec, fetchImpl);
        fitFoliageTier(hero, variant.templateHeight, variant.templateRadius);
        if (!hero.crown.attributes.uv) throw new Error(`Ghibli foliage ${key}/hero lacks UVs`);
        item.hero = hero; item.trunkMean = hero.trunkMean;
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
