/* Combine independently inspected classes, refusing competing replacements. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sha256File } from '../../packages/course-geo/manifest.mjs';
import { applyReviewedOrthophoto, verifyOrthophotoSources } from './reviewed-orthophoto.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const sha = b => createHash('sha256').update(b).digest('hex');
const files = ['lm-review-front9-surfaces.json', 'lm-review-front9-fairways.json',
  'lm-review-front9-tees-water.json', 'lm-review-back9.json', 'lm-review-back9-tees.json'];
const review = { schemaVersion: 1, groundId: 'angso', reviewedAt: '2026-09-09',
  sourceCaptureDate: '2025-04-24', method: 'Explicit visual interpretation of georeferenced Lantmateriet pixels; no fitted coordinate shift.',
  sources: {}, holes: [], water: [], parts: [], limitations: [
    'The image resolution is 0.16 m; boundary interpretation and absolute positional accuracy are separate quantities.',
    'Spring imagery and tree shadows limit some turf boundaries. Read the per-part decisions and uncertainty notes.',
    'Colour associations use club-linked schematic topology and native image landmarks. References are representative, not surveyed daily markers; unresolved decisions retain explicit uncertainty.',
    'Terrain elevations, laser canopy, infrastructure and surrounding land cover retain their previous sources unless explicitly reviewed.',
  ] };
for (const file of files) {
  const bytes = fs.readFileSync(path.join(HERE, file)), part = JSON.parse(bytes);
  if (part.groundId !== review.groundId || part.schemaVersion !== 1) throw new Error(`Wrong review identity: ${file}`);
  review.parts.push({ path: `angsobuild/mapping/${file}`, sha256: sha256File(path.join(HERE, file)) });
  for (const [key, source] of Object.entries(part.sources)) {
    const previous = review.sources[key];
    if (previous && ['sha256','requestSha256','width','height','geoTransform'].some(field =>
      JSON.stringify(previous[field]) !== JSON.stringify(source[field]))) throw new Error(`Conflicting image evidence: ${key}`);
    review.sources[key] ??= source;
  }
  for (const entry of part.holes) {
    let hole = review.holes.find(h => h.n === entry.n);
    if (!hole) { hole = { n: entry.n }; review.holes.push(hole); }
    for (const [key, value] of Object.entries(entry)) {
      if (key === 'n') continue;
      if (hole[key] !== undefined) throw new Error(`Conflicting H${entry.n} ${key} review`);
      hole[key] = value;
    }
  }
  review.water.push(...(part.water ?? []));
}
const evidenceFile = 'tee-source-evidence.json';
const evidenceBytes = fs.readFileSync(path.join(HERE, evidenceFile));
const evidence = JSON.parse(evidenceBytes);
review.parts.push({ path: `angsobuild/mapping/${evidenceFile}`, sha256: sha256File(path.join(HERE, evidenceFile)) });
review.teeEvidenceAssets = {};
for (const asset of [...evidence.sources, ...evidence.perHole.map(h => ({ ...h.schematicAsset, role: 'club-linked-schematic' }))]) {
  const cachePath = path.resolve(ROOT, asset.cachePath ?? asset.path);
  if (!cachePath.startsWith(path.join(ROOT, 'angsobuild/cache/tee-placement') + path.sep) ||
      sha(fs.readFileSync(cachePath)) !== asset.sha256) throw new Error(`Changed tee evidence bytes: ${asset.id}`);
  review.teeEvidenceAssets[asset.id] = { id: asset.id, url: asset.url, sha256: asset.sha256,
    ...(asset.hole ? { hole: asset.hole } : {}), ...(asset.role ? { role: asset.role } : {}) };
}
const placementHoles = new Set();
for (const file of ['tee-placement-front9.json', 'tee-placement-back9.json']) {
  const bytes = fs.readFileSync(path.join(HERE, file)), placement = JSON.parse(bytes);
  if (placement.groundId !== 'angso' || placement.schemaVersion !== 1) throw new Error(`Invalid tee review: ${file}`);
  review.parts.push({ path: `angsobuild/mapping/${file}`, sha256: sha256File(path.join(HERE, file)) });
  for (const entry of placement.holes) {
    const hole = review.holes.find(h => h.n === entry.n);
    if (!hole?.tees || placementHoles.has(entry.n)) throw new Error('Invalid or duplicate tee placement hole');
    placementHoles.add(entry.n);
    hole.teeReferences = entry.marks;
    hole.tees.accepted.push(...(entry.pads ?? []));
  }
}
if (placementHoles.size !== 18) throw new Error('Tee placement review must cover all 18 holes');
review.holes.sort((a,b) => a.n-b.n);
if (review.holes.length !== 18 || review.holes.some(h => !h.green || !h.tees || !h.bunkers)) {
  throw new Error('Every hole needs a reviewed green, physical tee inventory and sand inventory');
}
verifyOrthophotoSources(review, { sourceDirectory: path.join(ROOT, 'angsobuild/cache/lm-ortho') });
const modelPath = path.join(ROOT, 'angsobuild/course-model.json');
const baselinePath = path.join(ROOT, 'angsobuild/cache/lm-ortho/baseline-course-model.json');
if (!fs.existsSync(baselinePath)) fs.copyFileSync(modelPath, baselinePath);
const baseline = JSON.parse(fs.readFileSync(baselinePath));
const updated = applyReviewedOrthophoto(baseline, review);
fs.writeFileSync(path.join(HERE, 'orthophoto-review.json'), JSON.stringify(review, null, 2)+'\n');
console.log(updated.orthophotoReview.summary);
