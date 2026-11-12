/* What a golfer GLB holds: meshes, triangles, attributes, materials, textures and where its bytes go.
   usage: node tools/blender-golfer/v3/inspect_glb.mjs experiments/golfer/assets/banvy-golfer.glb [--json] */
import { readFile } from 'node:fs/promises';

const [path, ...flags] = process.argv.slice(2);
const data = await readFile(path);
const jsonLength = data.readUInt32LE(12);
const gltf = JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8'));
const views = gltf.bufferViews || [], accessors = gltf.accessors || [];
const viewBytes = i => (i == null ? 0 : views[i].byteLength);
const used = new Map();
const claim = (accessor, kind) => {
  if (accessor == null) return;
  const view = accessors[accessor].bufferView;
  if (view != null && !used.has(view)) used.set(view, kind);
};
let triangles = 0, vertices = 0;
const meshes = [];
const skinned = new Set((gltf.nodes || []).filter(n => n.mesh != null && n.skin != null).map(n => n.mesh));
(gltf.meshes || []).forEach((mesh, index) => {
  let t = 0, v = 0; const attrs = new Set(); const mats = new Set();
  for (const p of mesh.primitives) {
    for (const [name, a] of Object.entries(p.attributes)) { attrs.add(name); claim(a, 'geometry'); }
    claim(p.indices, 'geometry');
    v += accessors[p.attributes.POSITION].count;
    t += (p.indices != null ? accessors[p.indices].count : accessors[p.attributes.POSITION].count) / 3;
    if (p.material != null) mats.add(gltf.materials[p.material].name);
  }
  triangles += t; vertices += v;
  meshes.push({ name: mesh.name, triangles: Math.round(t), vertices: v, colour: attrs.has('COLOR_0'), skinned: skinned.has(index), materials: [...mats] });
});
for (const a of gltf.animations || []) for (const s of a.samplers) { claim(s.input, 'animation'); claim(s.output, 'animation'); }
for (const s of gltf.skins || []) claim(s.inverseBindMatrices, 'skin');
const images = (gltf.images || []).map(img => ({ name: img.name, mime: img.mimeType, bytes: viewBytes(img.bufferView) }));
for (const img of gltf.images || []) if (img.bufferView != null) used.set(img.bufferView, 'images');
const bytes = { geometry: 0, animation: 0, images: 0, skin: 0, other: 0 };
views.forEach((view, i) => { bytes[used.get(i) || 'other'] += view.byteLength; });
const keys = (gltf.animations || []).reduce((n, a) => n + a.samplers.reduce((m, s) => m + accessors[s.input].count, 0), 0);
const report = {
  file: path, bytes: data.length, json: jsonLength, split: bytes,
  meshes: meshes.length, triangles: Math.round(triangles), vertices,
  withColour: meshes.filter(m => m.colour).length,
  materials: (gltf.materials || []).length, textures: images.length,
  animations: (gltf.animations || []).length, channels: (gltf.animations || []).reduce((n, a) => n + a.channels.length, 0), keys,
  bones: (gltf.skins || [])[0]?.joints.length ?? 0,
  extensions: gltf.extensionsUsed || [],
};
if (flags.includes('--json')) console.log(JSON.stringify({ ...report, meshList: meshes, images }, null, 1));
else {
  const mb = n => (n / 1048576).toFixed(2) + ' MB';
  console.log(`${path}: ${mb(report.bytes)}`);
  console.log(`  geometry ${mb(bytes.geometry)} · animation ${mb(bytes.animation)} · images ${mb(bytes.images)} · json ${mb(jsonLength)} · other ${mb(bytes.other + bytes.skin)}`);
  console.log(`  ${report.meshes} meshes, ${report.triangles} triangles, ${report.vertices} vertices; ${report.withColour} carry COLOR_0`);
  console.log(`  ${report.materials} materials, ${report.textures} textures, ${report.animations} clips (${report.channels} channels, ${report.keys} keys), ${report.bones} bones`);
  console.log(`  extensions: ${report.extensions.join(', ') || 'none'}`);
  for (const m of meshes.sort((a, b) => b.triangles - a.triangles).slice(0, 14)) console.log(`    ${String(m.triangles).padStart(6)} tris  ${m.colour ? 'c' : ' '}  ${m.name}`);
  for (const img of images.sort((a, b) => b.bytes - a.bytes)) console.log(`    ${(img.bytes / 1024).toFixed(0).padStart(6)} kB  ${img.mime}  ${img.name}`);
}
