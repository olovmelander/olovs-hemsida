/* Round 6 (2026-11-09): the chip verdicts for the crowns the round-6
   candidates newly screened, added to pole-review.json, felling-review.json
   and hold-review.json. The chips are the review stage's compact sheets
   (review-panels/compact-{poles,felling,holds}-NN.png, --stage review --only
   screens), numbered as the screen files sort them: unreviewed first, then by
   key. Every chip was looked at; a pole-like chip not listed is a tree.
   Poles 1-225: sheets 1-4, 5-7 and 8-10 by three helper agents the main
   session briefed (it spot-checked sheets 1, 6 and 9); felling and holds by
   the main session. Run from the repository root after the review
   stage. */
import fs from 'node:fs';
import path from 'node:path';

const R = 'geo_data/course-v2/johannesberg/vegetation/review-2026-11-08/';
const cache = process.argv[2] || 'johannesbergbuild/cache/trees-2026-11-08';
const reviewedAt = new Date().toISOString();
const sorted = file => JSON.parse(fs.readFileSync(path.join(cache, 'candidates', file), 'utf8'))
  .sort((a, b) => (a.verdict === 'unreviewed' ? 0 : 1) - (b.verdict === 'unreviewed' ? 0 : 1) || a.key.localeCompare(b.key));
const reviewer = 'agent-led visual review (Claude: the main session and three helper agents it briefed and spot-checked) of compact chips (June 2025 colour, April 2021 colour infrared, native 0.16 m, centred between the laser base and the displaced top); not a field check';

/* pole-like chips that are not plain trees (number: [verdict, note]) */
const POLE_EXCEPTIONS = {
  206: ['unclear', 'a stand cleared or thinned since 2021: open ground with logs at the top in June 2025, pink crowns only beside it in April 2021'],
};
const FELLING = {
  1: ['absent', 'a leafless crown by the car park in April 2021; lawn in June 2025'],
  2: ['absent', 'a leafless crown by the car park in April 2021; lawn and the car park edge in June 2025'],
};
const HOLDS = {
  1: ['not-tree', 'a roof (the pit-free CHM keeps roofs as canopy)'],
  2: ['bank', 'a 14 m tree over the building: leafless branches in April 2021, a green crown at the roof edge in June 2025'],
  3: ['present', 'a conifer in shade: red in April 2021, a dark crown in June 2025'],
  4: ['bank', 'a conifer beside the small building (red in April 2021, green in June 2025)'],
  5: ['not-tree', 'a roof (the pit-free CHM keeps roofs as canopy)'],
  6: ['not-tree', 'a roof (the pit-free CHM keeps roofs as canopy)'],
  7: ['unclear', 'at a roof edge beside trees: the displaced top on the roof'],
  8: ['present', 'a conifer in shade: red in April 2021, a dark crown in June 2025'],
};

const poles = JSON.parse(fs.readFileSync(R + 'pole-review.json', 'utf8'));
const added = {};
sorted('pole-screen.json').forEach((t, i) => {
  if (t.verdict !== 'unreviewed') return;
  const n = i + 1;
  const [verdict, note] = POLE_EXCEPTIONS[n] || ['tree', 'a narrow top the width split separated in a stand or at an edge: a crown in both photos, no pole (round 6)'];
  poles.decisions[t.key] = { index: n, verdict, note, easting: t.easting, northing: t.northing, heightMetres: t.heightMetres, radiusMetres: t.radiusMetres, round: 'r6' };
  added[verdict] = (added[verdict] || 0) + 1;
});
poles.counts = Object.values(poles.decisions).reduce((o, d) => { o[d.verdict] = (o[d.verdict] || 0) + 1; return o; }, {});
poles.round6 = { reviewedAt, reviewer, screen: 'the round-6 candidates: compact-poles-01..10, chips 1-225', added };
fs.writeFileSync(R + 'pole-review.json', JSON.stringify(poles, null, 1) + '\n');

const felling = JSON.parse(fs.readFileSync(R + 'felling-review.json', 'utf8'));
const fAdded = {};
sorted('felling-screen.json').forEach((t, i) => {
  if (t.verdict !== 'unreviewed') return;
  const [verdict, note] = FELLING[i + 1] || [];
  if (!verdict) throw new Error(`felling chip ${i + 1} has no verdict`);
  felling.decisions[t.key] = { index: i + 1, verdict, note: `${note} (round 6)`, easting: t.easting, northing: t.northing, heightMetres: t.heightMetres, round: 'r6' };
  fAdded[verdict] = (fAdded[verdict] || 0) + 1;
});
felling.counts = Object.values(felling.decisions).reduce((o, d) => { o[d.verdict] = (o[d.verdict] || 0) + 1; return o; }, {});
felling.round6 = { reviewedAt, reviewer, screen: 'the round-6 candidates: compact-felling-01, chips 1-2', added: fAdded };
fs.writeFileSync(R + 'felling-review.json', JSON.stringify(felling, null, 1) + '\n');

const holds = JSON.parse(fs.readFileSync(R + 'hold-review.json', 'utf8'));
const hAdded = {};
sorted('hold-screen.json').forEach((t, i) => {
  if (t.verdict !== 'unreviewed') return;
  const [verdict, note] = HOLDS[i + 1] || [];
  if (!verdict) throw new Error(`hold chip ${i + 1} has no verdict`);
  if (verdict === 'bank' && t.kind !== 'building') throw new Error(`hold chip ${i + 1} is not on a building`);
  if (verdict === 'present' && t.kind !== 'no-vegetation') throw new Error(`hold chip ${i + 1} is on a building`);
  holds.decisions[t.key] = { index: i + 1, kind: t.kind, verdict, note: `${note} (round 6)`, easting: t.easting, northing: t.northing, heightMetres: t.heightMetres, round: 'r6' };
  hAdded[`${t.kind}:${verdict}`] = (hAdded[`${t.kind}:${verdict}`] || 0) + 1;
});
holds.counts = Object.values(holds.decisions).reduce((o, d) => { o[`${d.kind}:${d.verdict}`] = (o[`${d.kind}:${d.verdict}`] || 0) + 1; return o; }, {});
holds.round6 = { reviewedAt, reviewer, screen: 'the round-6 candidates: compact-holds-01, chips 1-8', added: hAdded };
fs.writeFileSync(R + 'hold-review.json', JSON.stringify(holds, null, 1) + '\n');
console.log('poles', JSON.stringify(added), 'felling', JSON.stringify(fAdded), 'holds', JSON.stringify(hAdded));
