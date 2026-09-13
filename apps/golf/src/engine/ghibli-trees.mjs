/* Authored tree templates (the Blender study in tools/blender-tree-study),
 * loaded behind ?trees=ghibli. The manifest models/trees/ghibli-v1.json names
 * one GLB per (species, variant, tier); each GLB holds a "crown" node and one
 * or more "trunk*" nodes with POSITION, the authored (bent) NORMAL and
 * COLOR_0 -- on a crown a grey depth multiplier for the species colour, on a
 * trunk the bark colour itself -- and nothing else: no textures, no URIs, so
 * the buildings' GLB inspector accepts it unchanged.
 *
 * What this module does NOT do: it never touches placement. trees[] and
 * treeWhy[] are the planter's; only the SPECIES templates the tiers draw are
 * replaced, so `boot-profile --fingerprint`'s `trees` hash is unchanged and
 * `treeInstances` moves exactly as a template change is documented to move it
 * (measured trees rescale to keep their laser height). Every failure throws
 * with a diagnostic and main.js falls back to the procedural templates. */
import * as THREE from 'three';
import { inspectBuildingGlb } from './authored-buildings.mjs';
import { fbm } from './geom.js';

const SHA256 = /^[a-f0-9]{64}$/;
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
  .map(v => v.toString(16).padStart(2, '0')).join('');

/* engine species index -> catalogue key; a null here would keep the engine's
   own procedural template for that species. The spruce is authored in the
   original's fashion (flat-shaded stacked cones with grown skirts), because
   the owner prefers that silhouette and wants every tree to come from Blender. */
export const GHIBLI_SPECIES = ['gran', 'tall', 'björk', 'al', 'ek'];

/* The crown colours are the engine's own (main.js SPECIES: spruce, pine,
   birch) -- the owner preferred them to the study's toon mid-tones, which
   read as one flat lime under the app's sun. Trunks carry their bark colour
   per vertex (a pine is grey below, orange above) and take white here. */
export const GHIBLI_COLOURS = [
  { cc: 0x2c5230, tc: 0xffffff },
  { cc: 0x3a6134, tc: 0xffffff },
  { cc: 0x5f8944, tc: 0xffffff },
  /* grey alder: a darker, bluer green than birch; pasture oak: a deep warm green */
  { cc: 0x3e6a3a, tc: 0xffffff, sc: [0.7, 1.15] },
  { cc: 0x4a7a34, tc: 0xffffff, sc: [0.8, 1.3] },
];

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

function toGeometry(mesh, label) {
  const src = mesh.geometry;
  const pos = src.getAttribute('position'), nor = src.getAttribute('normal'), col = src.getAttribute('color');
  if (!pos || !nor) throw new Error(`Ghibli tree ${label} lacks position or normal`);
  const geo = new THREE.BufferGeometry();
  const n = pos.count;
  /* bake the node transform (the exporter writes identity, but a rotated
     node would silently lean every tree) */
  mesh.updateMatrixWorld(true);
  const p = new Float32Array(n * 3), q = new Float32Array(n * 3), c = new Float32Array(n * 3);
  const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  for (let i = 0; i < n; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld);
    p[i * 3] = v.x; p[i * 3 + 1] = v.y; p[i * 3 + 2] = v.z;
    v.set(nor.getX(i), nor.getY(i), nor.getZ(i)).applyMatrix3(nm).normalize();
    q[i * 3] = v.x; q[i * 3 + 1] = v.y; q[i * 3 + 2] = v.z;
    if (col) { c[i * 3] = col.getX(i); c[i * 3 + 1] = col.getY(i); c[i * 3 + 2] = col.getZ(i); }
    else { c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = 1; }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(q, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (src.index) geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array), 1));
  return geo;
}

function mergeParts(list) {
  if (list.length === 1) return list[0];
  let vt = 0, it = 0;
  for (const g of list) { vt += g.attributes.position.count; it += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(vt * 3), nor = new Float32Array(vt * 3), col = new Float32Array(vt * 3), idx = new Uint32Array(it);
  let vo = 0, io = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3); nor.set(g.attributes.normal.array, vo * 3); col.set(g.attributes.color.array, vo * 3);
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.array[i] + vo;
    else for (let i = 0; i < n; i++) idx[io++] = i + vo;
    vo += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

async function fetchGlb(url, expect, species) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Ghibli tree asset ${url}: HTTP ${res.status}`);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength !== expect.bytes) throw new Error(`Ghibli tree asset ${url}: ${bytes.byteLength} bytes, manifest says ${expect.bytes}`);
  const sha = await digest(bytes);
  if (sha !== expect.sha256) throw new Error(`Ghibli tree asset ${url}: sha256 mismatch`);
  inspectBuildingGlb(bytes);
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().parseAsync(bytes, '');
  let crown = null; const trunks = [];
  gltf.scene.traverse(node => {
    if (!node.isMesh) return;
    if (node.name === 'crown') crown = toGeometry(node, `${url} crown`);
    else if (node.name.startsWith('trunk')) trunks.push(toGeometry(node, `${url} ${node.name}`));
    else throw new Error(`Ghibli tree asset ${url}: unexpected node ${node.name}`);
  });
  if (!crown || !trunks.length) throw new Error(`Ghibli tree asset ${url}: needs a crown and a trunk`);
  const cc = crown.attributes.color.array, cn = crown.attributes.position.count;
  crownVariation(cc, crown.attributes.position.array, cn, species);
  /* the study's depth tint averages ~0.75, which read as a crown three
     quarters as bright as the old one under the same species colour; keep the
     relative shading (inner and underside darker) but centre it on 1 like
     grownCrown's noise, so the species colour is the crown's mean colour */
  let mean = 0;
  for (let i = 0; i < cn; i++) mean += cc[i * 3 + 1];
  const gain = cn ? 1 / (mean / cn) : 1;
  for (let i = 0; i < cn * 3; i++) cc[i] = Math.min(1.35, cc[i] * gain);
  const trunk = mergeParts(trunks);
  /* THE IMPOSTOR BAKE PAINTS A TRUNK ONE FLAT COLOUR (tree-impostor.mjs:
     `new MeshBasicNodeMaterial({ color: trunkColor })`), and the runtime then
     recovers the crown's own contribution by subtracting exactly that colour.
     An authored trunk carries its bark PER VERTEX and takes white as its
     material colour, so the bake painted every one of them pure white: at
     impostor range the spruce hid it in its skirt and the birch is pale
     anyway, but the pine -- a long bare trunk -- became a white pole, and a
     hillside of them read as a birch forest where the model says 31% pine
     and 1% birch. So the atlas is handed the trunk's own MEAN bark colour,
     which keeps the bake and its flat-colour recovery exactly as they are.
     A per-vertex mean, not an area-weighted one: the trunks are near-uniform
     cylinders and the difference is under a quantum of what this decides. */
  const bark = trunk.attributes.color.array, bn = trunk.attributes.position.count;
  const barkSum = [0, 0, 0];
  for (let i = 0; i < bn; i++) for (let c = 0; c < 3; c++) barkSum[c] += bark[i * 3 + c];
  const trunkMean = bn ? barkSum.map(v => v / bn) : [1, 1, 1];
  return { crown, trunk, trunkMean };
}

/** Load the templates the engine's three tiers draw: hero (optional, the
 * study's hero tier, else the full one), full, and the far mesh tier (the
 * study's "lite"). One variant per species for now; variants per instance
 * are the next step and need their own instanced meshes. */
export async function loadGhibliTrees({ baseUrl = '/', variants = 4, hero = false, fetchImpl = fetch,
  design = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('treeart') ?? 'original' : 'original',
} = {}) {
  // A separate catalogue makes the modelling study directly comparable on the
  // same course, without changing tree placement or the normal painted look.
  const catalogue = design === 'refined' ? ['refined/', 'ghibli-v3.json'] : ['', 'ghibli-v1.json'];
  const base = `${baseUrl}models/trees/${catalogue[0]}`;
  const res = await fetchImpl(`${base}${catalogue[1]}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Ghibli tree manifest: HTTP ${res.status}`);
  const manifest = await res.json();
  if (manifest?.schemaVersion !== 1 || manifest.kind !== 'ghibli-trees') throw new Error('Ghibli tree manifest: unknown schema');
  const byKey = Object.fromEntries(manifest.species.map(s => [s.key, s]));
  const out = { manifest, species: [], colours: GHIBLI_COLOURS, summary: { variants, hero, files: 0, bytes: 0 } };
  for (const [s, key] of GHIBLI_SPECIES.entries()) {
    if (!key) { out.species.push(null); continue; }
    const entry = byKey[key];
    if (!entry) throw new Error(`Ghibli tree manifest lacks ${key}`);
    const list = [];
    for (let v = 0; v < Math.min(variants, entry.variants.length); v++) {
      const var_ = entry.variants[v];
      const need = { full: 'full', decimated: 'lite', hero: hero && var_.tiers.hero ? 'hero' : 'full' };
      const tiers = {};
      for (const [slot, tier] of Object.entries(need)) {
        const rec = var_.tiers[tier];
        if (!rec || !SHA256.test(rec.sha256 || '')) throw new Error(`Ghibli tree manifest: ${key} v${v} lacks tier ${tier}`);
        if (!tiers[tier]) { tiers[tier] = await fetchGlb(`${base}${rec.file}`, rec, s); out.summary.files++; out.summary.bytes += rec.bytes; }
        /* a slot that reuses another tier's file gets its OWN geometry: each
           tier's InstancedMesh hangs per-instance attributes (aFade, aTint)
           on its geometry, and two tiers sharing one object overwrote each
           other's -- every such crown drew black */
        tiers[slot] = slot === tier ? tiers[tier] : { crown: tiers[tier].crown.clone(), trunk: tiers[tier].trunk.clone() };
      }
      list.push({ key, variant: v, seed: var_.seed, templateHeight: var_.templateHeight, templateRadius: var_.templateRadius,
        trunkMean: tiers.full.trunkMean,
        hero: tiers.hero, full: tiers.full, decimated: tiers.decimated, tris: Object.fromEntries(Object.entries(var_.tiers).map(([t, r]) => [t, r.tris])) });
    }
    if (!list.length) throw new Error(`Ghibli tree manifest: ${key} has no variants`);
    /* species-level record = variant 0 (what SPECIES[] and the impostor bake use), plus every variant */
    out.species.push({ ...list[0], variants: list });
  }
  return out;
}
