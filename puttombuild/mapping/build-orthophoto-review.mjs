import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { applyReviewedOrthophoto, verifyOrthophotoSources } from './reviewed-orthophoto.mjs';
import { mergeReviewedHole } from './merge-tee-review.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
const files = ['review-holes-01-06.json', 'review-holes-07-12.json', 'review-holes-13-18.json',
  'review-tees.json', 'review-fairways-01-09.json', 'review-fairways-10-18.json', 'review-infrastructure.json'];
for (const file of ['review-tees-followup-01-09.json', 'review-tees-followup-10-18.json']) {
  if (fs.existsSync(path.join(root, 'puttombuild/mapping', file))) files.push(file);
}
const baseline = read('puttombuild/cache/orthophoto-baseline.json');
const review = { schemaVersion: 1, groundId: 'puttom', reviewedAt: '2026-09-09',
  reviewMethod: 'machine visual interpretation of verified Lantmateriet RGBI and club hole plans; not independently surveyed or human approved',
  attribution: 'Ortofoto Nedladdning © Lantmäteriet, bearbetad information, CC BY 4.0.',
  captureDate: '2024-06-27', baseModelSha256: sha(JSON.stringify(baseline)),
  pixelConvention: 'continuous pixel-edge coordinates; sample centres are column+0.5,row+0.5; no extra half-pixel offset',
  preserveMappedBoundaries: true, fragments: [], sources: {}, holes: [], deferredFeatures: [],
  waterCandidate: { path: 'puttombuild/mapping/review-water.json', adopted: false,
    reason: 'Spectral open water excludes reeds and obscured banks. The runtime lake ring also controls water levels, bed carving and wetness; candidate is retained for review without replacing the hydrological outline.' } };
const holes = new Map();
for (const file of files) {
  const relative = `puttombuild/mapping/${file}`, fragment = read(relative);
  if (fragment.groundId !== 'puttom' || fragment.schemaVersion !== 1) throw new Error(`Unexpected fragment ${file}`);
  review.fragments.push({ path: relative, sha256: sha(fs.readFileSync(path.join(root, relative))) });
  for (const [key, value] of Object.entries(fragment.sources)) {
    const fields = ['id','horizontalCrs','rasterFile','sha256','requestSha256','width','height','geoTransform','boundsEpsg3006','sourceIds','sources','derivation'];
    const source = Object.fromEntries(fields.filter(f => value[f] !== undefined).map(f => [f,value[f]]));
    source.id ??= key;
    source.rasterFile ??= `${key}.tif`;
    source.sourceIds ??= source.sources?.map(s => s.id);
    if (review.sources[key]) {
      const previous = review.sources[key];
      for (const field of fields) if (source[field] !== undefined && previous[field] !== undefined &&
          JSON.stringify(source[field]) !== JSON.stringify(previous[field])) throw new Error(`Conflicting source ${key}.${field}`);
      review.sources[key] = { ...previous, ...source };
    } else review.sources[key] = source;
  }
  for (const entry of fragment.holes ?? []) {
    holes.set(entry.n, mergeReviewedHole(holes.get(entry.n) ?? { n: entry.n }, entry));
  }
  for (const key of ['deferredFeatures','unresolved']) review.deferredFeatures.push(...(fragment[key] ?? []));
  if (fragment.numberedPlatformSources) {
    for (const [key, source] of Object.entries(fragment.numberedPlatformSources)) {
      const previous = review.numberedPlatformSources?.[key];
      if (previous && (previous.url !== source.url || previous.sha256 !== source.sha256)) throw new Error(`Changed numbered plan ${key}`);
      (review.numberedPlatformSources ??= {})[key] = source;
    }
  }
  if (fragment.teeReviewAudit) review.teeReviewAudit = [...new Map([...(review.teeReviewAudit ?? []), ...fragment.teeReviewAudit].map(row => [row.n, row])).values()].sort((a,b) => a.n-b.n);
  if (fragment.referenceReview) {
    review.referenceReview = [...new Map([...(review.referenceReview ?? []), ...fragment.referenceReview]
      .map(row => [`${row.hole}:${row.teeKey}`, row])).values()];
    const refreshed = [...new Set(fragment.referenceReview.map(row => row.hole))].map(n => {
      const rows = fragment.referenceReview.filter(row => row.hole === n);
      const unresolvedReferences = rows.filter(row => row.status === 'unresolved').map(row => row.teeKey);
      return { n, status: unresolvedReferences.length ? 'partially-reviewed' : 'reviewed-references',
        unresolvedReferences, notes: 'Latest paired-year tee review; platform outlines and visible-interior references retain their separate evidence in the feature records.' };
    });
    review.teeReviewAudit = [...new Map([...(review.teeReviewAudit ?? []), ...refreshed].map(row => [row.n, row])).values()].sort((a,b) => a.n-b.n);
  }
  if (fragment.cameraReferenceMeaning) review.cameraReferenceMeaning = fragment.cameraReferenceMeaning;
}
review.holes = [...holes.values()].sort((a,b) => a.n-b.n);
review.captureDates = [...new Set(Object.values(review.sources).flatMap(s => s.sources?.map(v => v.capturedAt?.slice(0,10)).filter(Boolean) ?? []))].sort();
review.captureDateMeaning = 'Primary campaign date; per-source capture dates also include earlier morning/midday tee corroboration when present.';
verifyOrthophotoSources(review, { sourceDirectory: path.join(root, 'puttombuild/cache/lm-ortho') });
const adopted = applyReviewedOrthophoto(baseline, review);
review.summary = {
  holesInspected: 18, greens: review.holes.filter(h => h.green).length,
  teePlatforms: review.holes.reduce((n,h) => n+(h.tees?.length ?? 0),0),
  cameraReferences: review.holes.reduce((n,h) => n+(h.cameraReferences?.length ?? 0)+
    (h.tees ?? []).reduce((s,t) => s+Object.keys(t.cameraReferencesPixels ?? {}).length,0),0),
  standaloneCameraReferences: review.holes.reduce((n,h) => n+(h.cameraReferences?.length ?? 0),0),
  fairwayRings: review.holes.reduce((n,h) => n+(h.fairways?.length ?? 0),0),
  bunkerBoundaries: adopted.holes.flatMap(h => h.bunkers).filter(b => b.prov === 'lm-orthophoto').length,
  bunkerReassignments: review.holes.reduce((n,h) => n+(h.removeBunkers?.length ?? 0),0),
};
fs.writeFileSync(path.join(root, 'puttombuild/mapping/orthophoto-review.json'), JSON.stringify(review,null,2)+'\n');
console.log(JSON.stringify(review.summary));
