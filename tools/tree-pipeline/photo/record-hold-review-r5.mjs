/* Round 5 (2026-11-09): the agent-led chip verdicts for the held crowns the
   candidates stage lists in hold-screen.json (on a mapped building, or with no
   June 2025 vegetation in the crown disc), written to hold-review.json. The
   chips are the review stage's compact sheets (review-panels/compact-holds-NN.png,
   --stage review --only holds), numbered as the screen file sorts them:
   unreviewed first, then by key. Every chip was looked at; a number not
   listed below is a roof, a shed, a vehicle or a pole (not-tree), unless it
   is listed as unclear. Run from the repository root after the review stage. */
import fs from 'node:fs';
import path from 'node:path';

const R = 'geo_data/course-v2/johannesberg/vegetation/review-2026-11-08/';
const cache = process.argv[2] || 'johannesbergbuild/cache/trees-2026-11-08';
const reviewedAt = new Date().toISOString();
const sorted = JSON.parse(fs.readFileSync(path.join(cache, 'candidates', 'hold-screen.json'), 'utf8'))
  .sort((a, b) => (a.verdict === 'unreviewed' ? 0 : 1) - (b.verdict === 'unreviewed' ? 0 : 1) || a.key.localeCompare(b.key));
if (sorted.length !== 174) throw new Error(`the sheets were drawn for 174 held crowns; the screen now lists ${sorted.length}: redraw and review again`);

const BANK = {
  35: 'a 15.5 m leafless broadleaf over the roof in April 2021 and a green crown at its edge in June 2025: a tree beside the house',
  54: 'an 11.7 m crown of trees over a small mapped building; no roof shows through in either photo',
  55: 'green canopy in June 2025 beside a small structure; trees in April 2021',
  57: 'a conifer beside the shed (red in the April 2021 colour infrared, dark green in June 2025)',
  59: 'a bush-like tree beside the building, vegetated in both photos',
  60: 'a round tree beside the building, vegetated in both photos',
  89: 'a conifer beside the small building, vegetated in both photos',
  98: 'a green crown in June 2025 beside the building, trees in April 2021',
  131: 'a 12.6 m broadleaf over the barn: leafless branches in April 2021, a green crown on the barn edge in June 2025',
  172: 'a green crown in June 2025 beside a small building; a tree in April 2021',
};
const PRESENT = {
  29: 'a small conifer: red in the April 2021 colour infrared, a dark crown in June 2025',
  62: 'a conifer in shade: red in April 2021, a dark crown in June 2025',
  64: 'a conifer in shade: red in April 2021, a dark crown in June 2025',
  66: 'a round dark crown in June 2025, red in April 2021',
  71: 'a conifer: red in April 2021, green-grey in June 2025',
  72: 'a conifer in shade: red in April 2021, a dark crown in June 2025',
  73: 'a conifer in shade: red in April 2021, a dark crown in June 2025',
  76: 'a conifer in shade: red in April 2021, a dark crown in June 2025',
  77: 'a conifer in shade: red in April 2021, a dark crown in June 2025',
  104: 'a 14 m conifer in deep shade among conifers: red crowns in April 2021, shade in June 2025',
  125: 'a conifer in shade: red in April 2021, a dark crown in June 2025',
  126: 'a conifer in shade: red in April 2021, a dark crown in June 2025',
  142: 'a crown in shade: pink-red in April 2021, a dark crown in June 2025',
  151: 'a green crown in June 2025, pink-red in April 2021',
};
const ABSENT = {
  145: 'thinned: a red conifer crown in April 2021, pale ground in June 2025',
  146: 'thinned: a red conifer crown in April 2021, pale ground in June 2025',
  147: 'thinned: a red conifer crown in April 2021, pale ground in June 2025',
  148: 'thinned: a red conifer crown in April 2021, pale ground in June 2025',
};
const UNCLEAR = {
  21: 'leafless branches over a barn roof in April 2021 (a tree or its shadow); no crown over the roof in June 2025',
  23: 'leafless branches by the barn in April 2021; grass in June 2025',
  25: 'a small shrub on rock',
  28: 'a red crown in April 2021; dry ground and a dark spot in June 2025',
  63: 'shade under conifers; no crown of its own', 65: 'shade under conifers; no crown of its own',
  67: 'at a pond edge by a gravel heap', 68: 'a small object by the water: a post or a shrub', 69: 'heath with small crowns', 70: 'heath with small crowns',
  80: 'a 7 m object on a lawn by a shelter', 82: 'shade; no crown of its own', 95: 'shade; pink-red in April 2021', 96: 'shade; pink-red in April 2021',
  108: 'a dark heap or bush on grass', 112: 'a 2.6 m spot under conifers',
  122: 'a 3.8 m top under conifers', 123: 'heath', 127: 'a stem lying on the ground in both photos (fallen or felled?)',
  136: 'a 3.3 m spot', 137: 'rock and heath', 138: 'shade', 139: 'shade', 140: 'shade', 141: 'a 3.6 m spot', 143: 'pale ground with stems lying, a 10 m top in the laser', 144: 'rock',
  149: 'a 3.1 m spot', 150: 'red crowns beside it', 152: 'red crown beside it', 153: 'a 3.3 m spot', 154: 'heath', 155: 'pale ground in both photos', 156: 'a 4.2 m spot', 157: 'heath', 158: 'clear-cut debris', 159: 'heath', 160: 'a red crown in April 2021, grey ground in June 2025', 161: 'heath', 162: 'heath', 163: 'shade beside red crowns', 164: 'pale ground', 165: 'heath', 166: 'a pink crown in April 2021, pale and dark ground in June 2025', 167: 'shade', 168: 'a 2.3 m spot', 169: 'a 2.2 m spot', 174: 'rock and shrubs',
};
const decisions = {};
sorted.forEach((t, i) => {
  const n = i + 1;
  const [verdict, note] = BANK[n] ? ['bank', BANK[n]] : PRESENT[n] ? ['present', PRESENT[n]] : ABSENT[n] ? ['absent', ABSENT[n]] : UNCLEAR[n] ? ['unclear', UNCLEAR[n]] : ['not-tree', t.kind === 'building' ? 'a roof (the pit-free CHM keeps roofs as canopy)' : 'a roof, shed, vehicle or post: no crown in either photo'];
  if (verdict === 'bank' && t.kind !== 'building') throw new Error(`chip ${n} is not on a building`);
  if (verdict === 'present' && t.kind !== 'no-vegetation') throw new Error(`chip ${n} is on a building: bank it, not present`);
  decisions[t.key] = { index: n, kind: t.kind, verdict, note, easting: t.easting, northing: t.northing, heightMetres: t.heightMetres };
});
const counts = {};
for (const d of Object.values(decisions)) counts[`${d.kind}:${d.verdict}`] = (counts[`${d.kind}:${d.verdict}`] || 0) + 1;
const doc = {
  schemaVersion: 1,
  kind: 'tree-hold-review',
  reviewedAt,
  reviewer: 'agent-led visual review (Claude, main session) of compact chips (June 2025 colour and April 2021 colour infrared at native 0.16 m, centred between the laser base and the displaced top); not a field check',
  screen: 'hold-screen.json of the round-4 candidates (bank rule on): crowns on a mapped building and crowns with no June 2025 vegetation in the crown disc',
  verdicts: {
    bank: 'a tree beside the building: its stem moves to the nearest cell of its own crown (or laser canopy within holds.bank.reachMetres) clear of every mapped surface, and it is placed',
    present: 'a crown stands in June 2025 (mostly conifers in shade, red in the April 2021 colour infrared): placed',
    absent: 'stood in April 2021, gone in June 2025: not placed / removed (the owner confirms the list)',
    'not-tree': 'a roof, shed, vehicle or post the canopy model kept: not placed / removed',
    unclear: 'held',
  },
  counts,
  decisions,
};
fs.writeFileSync(R + 'hold-review.json', JSON.stringify(doc, null, 1) + '\n');
console.log(JSON.stringify(counts));
