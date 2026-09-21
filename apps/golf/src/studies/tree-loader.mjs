/* Comparison catalogues and Full/Lite tiers belong to the standalone studies. */
import { fbm } from '../engine/geom.js';
import { GHIBLI_SPECIES, GHIBLI_COLOURS, GHIBLI_FOLIAGE_REVISION, VISBY_PINE_REVISION,
  fetchGlb, loadFoliageAtlas, validateAsset, fitFoliageTier } from '../engine/ghibli-tree-assets.mjs';
export { GHIBLI_SPECIES, GHIBLI_COLOURS } from '../engine/ghibli-tree-assets.mjs';

/* the same per-vertex brightness and hue noise grownCrown() bakes into the
   procedural crowns (seed, colVar per species), applied over the study's
   depth tint: a flat green over a whole tree is most of what made the first
   in-app boot read as cut paper */
const CROWN_NOISE = [[1, 0.13], [2, 0.15], [3, 0.17], [4, 0.15], [5, 0.14]];
function crownVariation(colour, position, count, species) {
  const [seed, colVar] = CROWN_NOISE[species] ?? [1, 0.14];
  for (let i = 0; i < count; i++) {
    const x = position[i * 3], y = position[i * 3 + 1], z = position[i * 3 + 2];
    const n = fbm(x * 1.6 + seed * 13.7, z * 1.6 - y * 0.7 + seed * 7.1, 2);
    const cv = 1 + fbm(x * 2.1 - y * 1.1 + seed * 3, z * 2.1 + seed * 11, 2) * colVar;
    colour[i * 3] *= cv * (1 - n * 0.06); colour[i * 3 + 1] *= cv; colour[i * 3 + 2] *= cv * (1 + n * 0.1);
  }
}

function prepareStudyCrown(crown, species) {
  const cc = crown.attributes.color.array, cn = crown.attributes.position.count;
  crownVariation(cc, crown.attributes.position.array, cn, species);
  // Retain the original study's mean-one depth tint; the shared decoder clamps it.
  let mean = 0;
  for (let i = 0; i < cn; i++) mean += cc[i * 3 + 1];
  const gain = cn ? 1 / (mean / cn) : 1;
  for (let i = 0; i < cc.length; i++) cc[i] *= gain;
}

export async function loadStudyTrees({ baseUrl = '/', variants = 4, hero = false, fetchImpl = fetch,
  design = 'fluffy', courseSlug = null, heroOnly = false,
} = {}) {
  // The approved fluffy set is the default. Study pages explicitly request
  // the original/refined catalogues for comparison.
  const coastalPine = design === 'fluffy' && courseSlug === 'visby';
  const catalogue = design === 'fluffy' ? ['', coastalPine ? 'ghibli-visby.json' : 'ghibli-fluffy.json'] : design === 'refined' ? ['refined/', 'ghibli-v3.json'] : ['', 'ghibli-v1.json'];
  const base = `${baseUrl}models/trees/${catalogue[0]}`;
  const revisionQuery = design === 'fluffy' ? `?v=${coastalPine ? VISBY_PINE_REVISION : GHIBLI_FOLIAGE_REVISION}` : '';
  const res = await fetchImpl(`${base}${catalogue[1]}${revisionQuery}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Ghibli tree manifest: HTTP ${res.status}`);
  const manifest = await res.json();
  if (manifest?.schemaVersion !== 1 || manifest.kind !== 'ghibli-trees') throw new Error('Ghibli tree manifest: unknown schema');
  const byKey = Object.fromEntries(manifest.species.map(s => [s.key, s]));
  const out = { manifest, species: [], colours: GHIBLI_COLOURS, foliage: manifest.design === 'fluffy-2026-09', summary: { design: manifest.design || design, revision: manifest.revision || null, variants, hero: heroOnly || hero, heroOnly, files: 0, bytes: 0 } };
  for (const [s, key] of GHIBLI_SPECIES.entries()) {
    const entry = byKey[key];
    if (!entry) throw new Error(`Ghibli tree manifest lacks ${key}`);
    const foliage = entry.foliage ? { key: entry.foliage.key, map: await loadFoliageAtlas(base, entry.foliage.atlas, fetchImpl) } : null;
    if (foliage) { out.summary.files++; out.summary.bytes += entry.foliage.atlas.bytes; }
    const list = [];
    for (let v = 0; v < Math.min(variants, entry.variants.length); v++) {
      const var_ = entry.variants[v];
      const need = heroOnly ? { hero: 'hero' }
        : { full: 'full', decimated: 'lite', hero: hero && var_.tiers.hero ? 'hero' : 'full' };
      const tiers = {};
      for (const [slot, tier] of Object.entries(need)) {
        const rec = var_.tiers[tier];
        validateAsset(rec, 'glb');
        if (!tiers[tier]) {
          tiers[tier] = await fetchGlb(`${base}${rec.file}`, rec, fetchImpl, foliage ? null : crown => prepareStudyCrown(crown, s));
          if (foliage) fitFoliageTier(tiers[tier], var_.templateHeight, var_.templateRadius);
          out.summary.files++; out.summary.bytes += rec.bytes;
        }
        if (foliage && tier !== 'lite' && !tiers[tier].crown.attributes.uv) throw new Error(`Ghibli foliage ${key}/${tier} lacks UVs`);
        /* a slot that reuses another tier's file gets its OWN geometry: each
           tier's InstancedMesh hangs per-instance attributes (aFade, aTint)
           on its geometry, and two tiers sharing one object overwrote each
           other's -- every such crown drew black */
        tiers[slot] = slot === tier ? tiers[tier] : { crown: tiers[tier].crown.clone(), trunk: tiers[tier].trunk.clone() };
      }
      list.push({ key, variant: v, seed: var_.seed, foliage, templateHeight: var_.templateHeight, templateRadius: var_.templateRadius,
        trunkMean: (heroOnly ? tiers.hero : tiers.full).trunkMean,
        hero: tiers.hero, full: tiers.full, decimated: tiers.decimated, tris: Object.fromEntries(Object.entries(var_.tiers).map(([t, r]) => [t, r.tris])) });
    }
    if (!list.length) throw new Error(`Ghibli tree manifest: ${key} has no variants`);
    /* species-level record = variant 0 (what SPECIES[] and the impostor bake use), plus every variant */
    out.species.push({ ...list[0], variants: list });
  }
  return out;
}
