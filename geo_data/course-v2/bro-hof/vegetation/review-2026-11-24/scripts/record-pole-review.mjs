#!/usr/bin/env node
/* Round r1b (27 November 2026): the crowns the laser read as trees that are poles.

   node geo_data/course-v2/bro-hof/vegetation/review-2026-11-24/scripts/record-pole-review.mjs
   node tools/tree-pipeline.mjs --ground bro-hof --stage candidates

   Owner report, 27 November: "the flags are standing exactly where there are trees". The castle's eight flagpoles
   were in the laser (2020-11-06) as conifers 8.7-9.4 m tall with crowns 1.1-1.6 m across: wider than the pole-like
   hold's 1 m, so they were placed. Each stands where the 2025-06-14 photo has a pole's thin shadow with a flag at its
   end, on open lawn, with no crown; on the 2021-04-16 photo the white pole top shows. They are recorded here as spot
   checks (hold-review.json, kind 'spot', verdict 'not-tree'), which removes a placed crown.

   The screen that found them, run over every placed crown in the window: own shadow in June 2025 under 0.2, the April
   2021 crown disc green (contrast over 0.3: lawn, not a leafless or needled crown), crown under 2 m, no other crown
   within 4 m. It caught all eight poles and 20 more; widened (shadow under 0.25, contrast over 0.25, radius under
   2.2 m, 3 m apart) and kept to crowns under 15 m with at most 30 laser returns, 37 in all. Each of the 29 that were
   not the eight poles was looked at on the 2025 and 2021 photos (24 m chips): none is a pole. 16 of them stand on
   the western building site and the works yard by Castle 13's tee, cleared after the laser (see the README's round
   r1b): they are left for a check against a newer height model, not removed by eye.

   The lamp posts were already out: a lamp post is narrower than 1 m, so the pole-like hold keeps it unplaced. The
   ten held pole-like crowns round the castle, the range and the car parks were looked at on the same chips and are
   decided in pole-review.json: a lamp post and a pole (not-tree), a small planted tree in the car park's strip
   (tree), the rest left held. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = 'the agent (Claude), 2026-11-27, on 24 m chips of the 2025-06-14 and 2021-04-16 orthophotos';

const FLAGPOLES = [
  ['tree-bro-hof-014041', 648586.3, 6598159.8, 'the flagpole north of the sunken putting green'],
  ['tree-bro-hof-014308', 648584.8, 6598140.8, 'a flagpole on the west rim of the sunken putting green'],
  ['tree-bro-hof-014011', 648589.8, 6598122.3, 'a flagpole on the south-west rim of the sunken putting green'],
  ['tree-bro-hof-014115', 648603.8, 6598108.3, 'the flagpole by the path below the terrace (the Swedish flag)'],
  ['tree-bro-hof-014034', 648618.8, 6598100.8, 'a flagpole on the south rim of the practice green below the terrace'],
  ['tree-bro-hof-014528', 648638.3, 6598100.8, 'a flagpole on the south rim of the practice green below the terrace'],
  ['tree-bro-hof-014012', 648655.3, 6598109.8, 'a flagpole by the hedge south-east of the castle'],
  ['tree-bro-hof-014116', 648668.8, 6598123.3, 'a flagpole by the path east of the castle'],
];

const holdPath = path.join(DIR, 'hold-review.json');
const hold = JSON.parse(fs.readFileSync(holdPath, 'utf8'));
for (const [id, easting, northing, what] of FLAGPOLES) {
  hold.decisions[`${easting.toFixed(1)}_${northing.toFixed(1)}`] = {
    kind: 'spot', verdict: 'not-tree', easting, northing, record: id,
    note: `${what}: a pole's thin shadow with a flag at its end on open lawn on the 2025 photo, no crown; the pole top on the 2021 photo (${at}; owner report 2026-11-27)`,
  };
}
hold.verdicts['not-tree'] = 'a pole, mast or lamp the laser read as a crown: removed';
hold.counts = Object.values(hold.decisions).reduce((counts, d) => {
  const key = `${d.kind}:${d.verdict}`;
  counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}, {});
hold.roundR1b = 'the eight flagpoles round the castle recorded as spot not-tree on 2026-11-27 (scripts/record-pole-review.mjs)';
fs.writeFileSync(holdPath, `${JSON.stringify(hold, null, 1)}\n`);

const POLE_LIKE = [
  [648550.25, 6598170.75, 'not-tree', 'a lamp post by the path west of the castle: a thin shadow ending in the lamp head on both photos'],
  [648776.75, 6598012.75, 'not-tree', 'a pole on the lawn by the putting course: a straight thin shadow and no crown on the 2025 photo'],
  [648505.81, 6598185.06, 'tree', 'a small planted tree in the car park strip: its own crown and shadow on the 2025 photo'],
  [648522.75, 6598426.25, 'unclear', 'a second top at the edge of a broadleaf crown; left held'],
  [648568.25, 6598178.25, 'unclear', 'at the edge of a broadleaf crown by the castle path; left held'],
  [648515.35, 6598212.36, 'unclear', 'in the car park strip between small trees: a lamp or a young tree; left held'],
  [648542.87, 6598242.56, 'unclear', 'a planted car park island; left held'],
  [648394.25, 6597930.25, 'unclear', 'at the edge of a wood band; left held'],
  [648372.19, 6598461.29, 'unclear', 'in scrub; left held'],
  [648747.25, 6597953.75, 'unclear', 'among scrub and trees; left held'],
];
const polePath = path.join(DIR, 'pole-review.json');
const pole = fs.existsSync(polePath) ? JSON.parse(fs.readFileSync(polePath, 'utf8'))
  : { schemaVersion: 1, kind: 'tree-pole-review', decisions: {} };
pole.reviewedAt = '2026-11-27';
pole.reviewer = at;
pole.scope = 'the ten pole-like crowns (radius under 1 m, 5 m or taller, held) round the castle, the range and the car parks; the other 194 in the window stay unreviewed and held';
pole.verdicts = { tree: 'placed', 'not-tree': 'a pole, mast or lamp: not placed', unclear: 'left held, not placed' };
for (const [easting, northing, verdict, note] of POLE_LIKE) pole.decisions[`${easting.toFixed(1)}_${northing.toFixed(1)}`] = { verdict, easting, northing, note };
fs.writeFileSync(polePath, `${JSON.stringify(pole, null, 1)}\n`);
console.log(`hold-review.json: ${FLAGPOLES.length} flagpoles as spot not-tree; pole-review.json: ${POLE_LIKE.length} verdicts`);
