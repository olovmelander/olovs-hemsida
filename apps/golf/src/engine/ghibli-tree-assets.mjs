/* Verified geometry/atlas decoding shared by the player and isolated tree studies. */
import * as THREE from 'three';
import { inspectBuildingGlb } from './authored-buildings.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
  .map(v => v.toString(16).padStart(2, '0')).join('');

/* Engine species index -> catalogue key. All five painted species use the
   approved Blender models. */
export const GHIBLI_SPECIES = ['gran', 'tall', 'björk', 'al', 'ek'];
// A new app revision must not select a previous catalogue when NetworkFirst
// falls back to its cache during a slow connection. Assets remain SHA-addressed.
export const GHIBLI_FOLIAGE_REVISION = 'continuous-canopy-2026-09-13';
export const VISBY_PINE_REVISION = 'visby-coastal-pine-2026-09-16';

/* Base colours for the original catalogue. Painted foliage uses the palette
   in ghibli-foliage-material.mjs. Trunks carry bark colour per vertex. */
export const GHIBLI_COLOURS = [
  { cc: 0x2c5230, tc: 0xffffff },
  { cc: 0x3a6134, tc: 0xffffff },
  { cc: 0x5f8944, tc: 0xffffff },
  /* grey alder: a darker, bluer green than birch; pasture oak: a deep warm green */
  { cc: 0x3e6a3a, tc: 0xffffff, sc: [0.7, 1.15] },
  { cc: 0x4a7a34, tc: 0xffffff, sc: [0.8, 1.3] },
];


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
  const uv = src.getAttribute('uv');
  if (uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(Array.from({ length: n * 2 }, (_, i) => i % 2 ? uv.getY(i >> 1) : uv.getX(i >> 1)), 2));
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

async function fetchGlb(url, expect, fetchImpl = fetch, prepareCrown = null) {
  const res = await fetchImpl(url);
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
  if (prepareCrown) prepareCrown(crown);
  const cc = crown.attributes.color.array;
  for (let i = 0; i < cc.length; i++) cc[i] = Math.min(1.35, cc[i]);
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

function validateAsset(rec, extension) {
  if (!rec || !SHA256.test(rec.sha256 || '') || !Number.isSafeInteger(rec.bytes) || rec.bytes <= 0
    || typeof rec.file !== 'string' || rec.file.startsWith('/') || rec.file.split('/').includes('..')
    || !new RegExp(`^[a-zA-Z0-9_/-]+\\.${extension}$`).test(rec.file)) throw new Error('Invalid Ghibli asset record');
}

async function loadFoliageAtlas(base, rec, fetchImpl) {
  validateAsset(rec, 'png');
  const response = await fetchImpl(base + rec.file);
  if (!response.ok) throw new Error(`Ghibli foliage atlas: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== rec.bytes || await digest(bytes) !== rec.sha256) throw new Error('Ghibli foliage atlas checksum mismatch');
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  try {
    const map = await new THREE.TextureLoader().loadAsync(url);
    map.colorSpace = THREE.SRGBColorSpace;map.name = `ghibli-foliage-${rec.sha256}`;
    map.flipY = false; // Preserve the exported glTF UV convention.
    map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;map.needsUpdate = true;
    return map;
  } finally { URL.revokeObjectURL(url); }
}

// The study's reduced models have different extents (larger spray cards in
// full, recessed solid interiors in lite). Fit every production tier to the
// approved close silhouette's height/radius, anchored at the same ground point.
// This also makes the full mesh and its impostor use exactly the same scale.
function fitFoliageTier(parts, height, radius) {
  const box = new THREE.Box3();
  for (const g of [parts.crown, parts.trunk]) { g.computeBoundingBox(); box.union(g.boundingBox); }
  const r = Math.max(Math.abs(box.min.x), box.max.x, Math.abs(box.min.z), box.max.z);
  if (!(height > 0 && radius > 0 && r > 0 && box.max.y > 0)) throw new Error('Invalid foliage tier extent');
  for (const g of [parts.crown, parts.trunk]) g.scale(radius / r, height / box.max.y, radius / r);
}


export { fetchGlb, loadFoliageAtlas, validateAsset, fitFoliageTier };
