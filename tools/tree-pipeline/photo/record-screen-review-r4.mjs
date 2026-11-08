/* Round 4 (published by round 4b): add the agent-led chip verdicts for the
   crowns the round-4 candidates newly screened (447 pole-like, 9 felling) to
   pole-review.json and felling-review.json. The chips are the review stage's
   compact sheets (review-panels/compact-{poles,felling}-NN.png), numbered as
   the screen files sort them: unreviewed first, then by key. Every chip was
   looked at; the verdicts below are those that are not "tree" / that are
   listed. Run from the repository root after --stage review --only screens. */
import fs from 'node:fs';
import path from 'node:path';

const R = 'geo_data/course-v2/johannesberg/vegetation/review-2026-11-08/';
const cache = process.argv[2] || 'johannesbergbuild/cache/trees-2026-11-08';
const reviewedAt = new Date().toISOString();
const sorted = file => JSON.parse(fs.readFileSync(path.join(cache, 'candidates', file), 'utf8'))
  .sort((a, b) => (a.verdict === 'unreviewed' ? 0 : 1) - (b.verdict === 'unreviewed' ? 0 : 1) || a.key.localeCompare(b.key));

const POLE_UNCLEAR = {
  5: 'at a lawn edge by a roof; a small crown or a bush, not decidable',
  85: 'a 5 m stem in ground cleared before 2021 (pale in April); young green growth in June 2025, not decidable as one tree',
  86: 'as 85, beside it',
  88: 'a very narrow 11.6 m crown at a meadow edge; a pole or a lone stem, not decidable',
  134: 'at a meadow edge; nothing clear in June 2025',
  138: 'a narrow 5.7 m stem in a clear-cut (April 2021); regrowth in June 2025, not decidable',
  142: 'a 5.2 m stem in a clear-cut; regrowth in June 2025, not decidable',
  143: 'a narrow 5.7 m stem in a clear-cut; regrowth in June 2025, not decidable',
};
const FELLING = {
  1: ['present', 'a shrub or small tree by the ditch, green in June 2025'],
  2: ['present', 'a small green crown in June 2025'],
  3: ['absent', 'lawn by the path in June 2025; nothing stands there'],
  4: ['present', 'a dark crown in June 2025'],
  5: ['unclear', 'a brownish, partly dead-looking crown in June 2025'],
  6: ['absent', 'lawn by the path in June 2025; the 2021 crown is gone'],
  7: ['unclear', 'a 3 m crown in garden scrub; not decidable'],
  8: ['absent', 'lawn in June 2025 where a leafless 17 m crown stood in April 2021: felled'],
  9: ['present', 'a dark crown in June 2025'],
};

const poles = JSON.parse(fs.readFileSync(R + 'pole-review.json', 'utf8'));
const poleList = sorted('pole-screen.json');
let added = { tree: 0, unclear: 0 };
poleList.forEach((t, i) => {
  if (t.verdict !== 'unreviewed') return;
  const n = i + 1;
  const unclear = POLE_UNCLEAR[n];
  const verdict = unclear ? 'unclear' : 'tree';
  poles.decisions[t.key] = { index: n, verdict, note: unclear || 'a narrow tree in a stand or at an edge: crown in both photos, no pole (round 4)', easting: t.easting, northing: t.northing, heightMetres: t.heightMetres, radiusMetres: t.radiusMetres, round: 'r4' };
  added[verdict]++;
});
poles.counts = Object.values(poles.decisions).reduce((o, d) => { o[d.verdict] = (o[d.verdict] || 0) + 1; return o; }, {});
poles.round4 = { reviewedAt, reviewer: 'agent-led visual review (Claude) of compact chips (June 2025 colour, April 2021 colour infrared, native 0.16 m, centred between the laser base and the displaced top); not a field check', screen: 'the round-4 candidates (round-4 lock, published by round 4b): compact-poles-01..19, chips 1-447', added };
fs.writeFileSync(R + 'pole-review.json', JSON.stringify(poles, null, 1) + '\n');

const felling = JSON.parse(fs.readFileSync(R + 'felling-review.json', 'utf8'));
const fellList = sorted('felling-screen.json');
const fAdded = {};
fellList.forEach((t, i) => {
  if (t.verdict !== 'unreviewed') return;
  const [verdict, note] = FELLING[i + 1] || [];
  if (!verdict) throw new Error(`felling chip ${i + 1} has no verdict`);
  felling.decisions[t.key] = { index: i + 1, verdict, note: `${note} (round 4)`, easting: t.easting, northing: t.northing, heightMetres: t.heightMetres, round: 'r4' };
  fAdded[verdict] = (fAdded[verdict] || 0) + 1;
});
felling.counts = Object.values(felling.decisions).reduce((o, d) => { o[d.verdict] = (o[d.verdict] || 0) + 1; return o; }, {});
felling.round4 = { reviewedAt, reviewer: poles.round4.reviewer, screen: 'the round-4 candidates: compact-felling-01, chips 1-9', added: fAdded };
fs.writeFileSync(R + 'felling-review.json', JSON.stringify(felling, null, 1) + '\n');
console.log('poles', JSON.stringify(added), 'felling', JSON.stringify(fAdded));
