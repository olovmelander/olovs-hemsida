/* Keep this standalone page's retained runtime functions and payload mapping
 * identical to the app's shared helpers. Run before embed.mjs. */
import fs from 'node:fs';
const read = file => fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
const write = (file, text) => fs.writeFileSync(file, text);
const emitFile = 'packages/course-pack/emit-pack.mjs';
let emit = read(emitFile);
if (!emit.includes('h.tees.markerLayout')) emit = emit.replace('pads: h.tees.pads.map', "...(h.tees.markerLayout ? { markerLayout: h.tees.markerLayout } : {}), pads: h.tees.pads.map");
if (!emit.includes('m.referenceSurfaceRing')) emit = emit.replace('...(m.orthophotoReference ?', '...(m.referenceSurfaceRing ? { referenceSurfaceRing: m.referenceSurfaceRing } : {}), ...(m.orthophotoReference ?');
emit = emit.replace('marking: (model.marking || []).map(m => ({ c: m.color, pts: m.pts })),', "marking: (model.marking || []).map(m => ({ c: m.color, pts: m.pts, ...(m.reviewId ? { id: m.id, reviewId: m.reviewId, hole: m.hole, boundaryStatus: m.boundaryStatus, corridorUncertaintyM: m.corridorUncertaintyM, postPlacementKind: m.postPlacementKind, physicalPostPositionsObserved: m.physicalPostPositionsObserved } : {}) })),");
write(emitFile, emit);
const teeLine = emit.match(/^    tees: .*$/m)?.[0];
const markingLine = emit.match(/^  marking: .*$/m)?.[0];
if (!teeLine || !markingLine) throw new Error('runtime payload mapping missing');
for (const file of ['johannesbergbuild/embed.mjs', 'johannesbergbuild/check3d.mjs']) {
  let src = read(file);
  src = src.replace(/    tees: \{[\s\S]*?\n    bunkers:/, teeLine + '\n    bunkers:');
  if (file.includes('embed')) src = src.replace(/^  marking: .*$/m, markingLine);
  write(file, src);
}
const functionBody = file => read(file).replace(/^import .*;\n/gm, '').replaceAll('export function ', 'function ').trim();
const helpers = [functionBody('apps/golf/src/engine/tee-marker-placement.mjs'),
  functionBody('apps/golf/src/engine/reviewed-tee-marker-placement.mjs'),
  functionBody('apps/golf/src/engine/boundary-marker-placement.mjs')].join('\n\n');
const file = 'johannesberg3d.html';
let html = read(file);
const start = '/*@TEE_PLACEMENT_RUNTIME*/', end = '/*@/TEE_PLACEMENT_RUNTIME*/';
if (html.includes(start)) html = html.slice(0, html.indexOf(start)) + start + '\n' + helpers + '\n' + html.slice(html.indexOf(end));
else html = html.replace('const TEE_COLS =', start + '\n' + helpers + '\n' + end + '\nconst TEE_COLS =');
html = html.replace('const m = mk[k], b = m.b * Math.PI / 180, R = rightOf(b);', 'const m = mk[k];');
html = html.replace('for (const s of [-2.6, 2.6]) {\n      const mx = m.c[0] + R[0] * s, mz = m.c[1] + R[1] * s;', 'for (const [mx, mz] of reviewedTeeMarkerPositions(h, m)) {');
html = html.replace('let drowned = false;\n      for (const w of WI.at(x, z)) if (!w.stream && h < w.level + 0.05) drowned = true;',
  'const drowned = boundaryMarkerSubmerged(x, z, h, WI.at(x, z));');
write(file, html);
console.log('Johannesberg placement serialization and standalone functions synchronized');
