import fs from 'node:fs';
import { createHash } from 'node:crypto';
const base = 'lidingobuild/mapping/';
const paths = ['tee-review-front5.json', 'tee-review-06-09.json', 'tee-review-back9.json'];
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const review = read(base + paths[2]);
review.holes = paths.flatMap(p => read(base + p).holes);
review.planSha256 = sha('geo_data/course-v2/lidingo/reference/lm-ortho-plan-2026-09-09.json');
review.reviewInputs = paths.map(p => ({ path: base + p, sha256: sha(base + p) }));
review.limitations = [
  'The newest complete published LM campaign was checked live on 2026-09-09; its contributing pixels were captured 2025-05-31.',
  'Visible turf outlines are machine-reviewed. Partial canopy and shadow boundaries carry explicit uncertainty; absolute survey accuracy is unverified.',
  'Colour groups use club guide evidence. No movable daily tee-marker position is asserted.',
  `${review.holes.reduce((n, h) => n + h.markers.filter(m => m.unresolved).length, 0)} unresolved Orange starts use clearly identified platform camera fallbacks with physical marker furniture withheld.`,
  'The exact EPSG:3006 frame and source terrain are unchanged. No outlines or coordinates are scaled to scorecard distances.',
];
fs.writeFileSync(base + 'tee-native-alignment-review-2026-09-09.json', JSON.stringify(review, null, 2) + '\n');
console.log(JSON.stringify({ holes: review.holes.length, pads: review.holes.reduce((n, h) => n + h.platforms.length, 0) }));
