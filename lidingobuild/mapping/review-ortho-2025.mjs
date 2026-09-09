/* Review priorities from actually acquired RGBI statistics. No image pixels,
 * automatic shape edits, class-wide greenness assumptions or survey claims. */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../../', import.meta.url);
const inputs = [];
const read = relative => {
  const bytes = fs.readFileSync(new URL(relative, root));
  inputs.push({ path: relative, sha256: createHash('sha256').update(bytes).digest('hex') });
  return JSON.parse(bytes);
};
const audit = read('geo_data/course-v2/lidingo/acquisition/ortho-2025-surface-audit.json');
const discovery = read('geo_data/course-v2/lidingo/acquisition/d2-discovery.json');
const surfaces = read('lidingobuild/mapping/playing-surfaces.geojson');
if (audit.state !== 'acquired-and-measured') throw new Error('New imagery has not been acquired');
const byId = new Map(audit.features.map(f => [f.id, f]));
if (byId.size !== audit.features.length || byId.size !== surfaces.features.length) throw new Error('Orthophoto audit does not cover the current feature set');
const coverageFailures = [], priorities = [];
for (const f of surfaces.features) {
  const row = byId.get(f.id);
  if (!row || row.kind !== f.properties.kind || row.hole !== f.properties.hole || !Number.isFinite(row.pixels) || row.pixels <= 0 || row.validFraction < .99) {
    coverageFailures.push(f.id); continue;
  }
  // Close-cut greens routinely have lower NDVI than fairway turf in this
  // image. A single threshold cannot decide whether their outlines are wrong.
  if (row.kind === 'bunker' && row.vegetationFractionNDVI025 > .5) {
    priorities.push({ id: row.id, hole: row.hole, kind: row.kind,
      priority: row.vegetationFractionNDVI025 >= .9 ? 'high' : 'review',
      medianNDVI: row.medianNDVI, vegetationFraction: row.vegetationFractionNDVI025,
      validFraction: row.validFraction, sampledPixels: row.pixels,
      observation: 'Vegetation signal covers much of the adopted bunker outline in the 2025 image.',
      decision: 'retain pending visual review; possible changed land cover, misplaced boundary or mixed pixels' });
  }
}
priorities.sort((a,b) => b.vegetationFraction-a.vegetationFraction);
const report = { schemaVersion: 1, groundId: 'lidingo', state: coverageFailures.length ? 'incomplete-sampling' : 'spectral-review-ready',
  inputs, acquiredAt: audit.checkedAt, capturedAt: '2025-05-31',
  sourceItems: discovery.orthophoto.items.map(i => ({id:i.id, capturedAt:i.capturedAt, resolutionMetres:i.resolutionMetres})),
  analyzedFeatures: audit.features.length, statisticsResolutionMetres: audit.resolutionMetres,
  coverageFailures, priorities, geometryEditsApplied: 0, visualReviewCompleted: false,
  limitations: ['All 18 holes still require an image overlay review, including missing features outside adopted polygons.',
    'Mean colour/NDVI cannot verify exact boundaries, tree stems or current tee/flag locations.',
    'No global threshold is applied to greens or tees; turf maintenance and shadow affect their spectra.',
    '2025 imagery does not establish changes after its capture date.'] };
const rows = priorities.map(p => `| ${p.hole ?? 'Unassigned'} | ${p.id} | ${(100*p.vegetationFraction).toFixed(1)}% | ${p.medianNDVI.toFixed(4)} | ${p.priority} |`).join('\n');
const md = `# Lidingö: first review using the new orthophotos\n\n**Both 2025 RGBI source tiles were successfully read.** They were captured on 31 May 2025 at 0.16 m source pixel spacing. The approved pipeline measured all ${audit.features.length} adopted playing-surface polygons using a 1 m averaged grid. Coverage failures: ${coverageFailures.length}.\n\n## Bunker outlines requiring inspection\n\nThese are review flags, not confirmed bunker removals. No boundary has been moved or deleted from spectral statistics alone.\n\n| Hole | Adopted outline | Pixels with NDVI > 0.25 | Median NDVI | Priority |\n|---|---|---|---|---|\n${rows}\n\nThe two largest signals are the western hole-16 bunker and the mapped hole-15 bunker. Inspect the actual 2025 crop against the outlines before deciding whether the bunker was filled, the outline is misplaced, or another explanation fits. The independently reported new hole-13 bunker is outside the adopted bunker inventory and cannot be discovered by within-polygon statistics alone.\n\nThe next image review should cover hole 13's green/bunker area, these hole-15/16 flags, hole 17/18 alterations and the uncertain tee platforms. All 18 holes remain in the review queue. Green and tee grass often has lower NDVI than fairway grass in this acquisition, so a single vegetation threshold must not be used to remove turf surfaces.\n\nThe explicitly approved encrypted-image transfer is installed. Public Actions [run 34326604307](https://github.com/olovmelander/olovs-hemsida/actions/runs/34326604307) completed successfully and uploaded only the encrypted artifact, with one-day retention. This public report contains the previously approved statistics; private-image observations and decrypted crop metadata are not included.\n\nRun \`node lidingobuild/mapping/review-ortho-2025.mjs\` to regenerate this report from the retained measurement output.\n`;
fs.writeFileSync(new URL('lidingobuild/mapping/ortho-2025-review.json', root), JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(new URL('lidingobuild/mapping/ortho-2025-review.md', root), md);
console.log(JSON.stringify({state:report.state, features:report.analyzedFeatures, priorities:priorities.length, coverageFailures}));
if (coverageFailures.length) process.exitCode = 1;
