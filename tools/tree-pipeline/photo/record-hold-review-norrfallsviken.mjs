/* Norrfällsviken (review-2026-11-09): the agent-led chip verdicts for the held crowns the candidates stage
   lists in hold-screen.json (on a mapped building, or with no June 2024 vegetation in the crown disc),
   written to hold-review.json. The chips are the review stage's compact sheets
   (review-panels/compact-holds-NN.png, --stage review --only holds), numbered as the screen file sorts them:
   unreviewed first, then by key. Every one of the 41 sheets was looked at.

   Defaults, then the exceptions listed below:
   - a crown on a mapped building is a roof (not-tree);
   - a crown with no June 2024 vegetation is present: here these are mostly small heath pines (median
     5.6 m) whose crown discs lie in their neighbours' shadows and on pale lichen rock, dark crowns in the
     May 2020 colour infrared; three of the five such holds in the calibration windows are reference
     crowns (C7). The exceptions are roofs, sheds, decks, caravans and vehicles, most of them in the holiday
     village south and south-west of the course, where many houses were built after the May 2020 photo
     and are not yet mapped: the June 2025 laser reads their roofs as canopy.
   A second pass redrew every present hold 2.5 m or more in radius and under 6.5 m on the June 2024 photo
   alone (48 chips, all heath pines) and every present hold with a radius of 4 m or more (11: six roofs,
   listed below, five trees).
   Run from the repository root after the review stage. */
import fs from 'node:fs';
import path from 'node:path';

const R = 'geo_data/course-v2/norrfallsviken/vegetation/review-2026-11-09/';
const cache = process.argv[2] || 'norrfallsvikenbuild/cache/trees-2026-11-09';
const reviewedAt = new Date().toISOString();
/* the chip numbers are those of the sheets as first drawn (965 held crowns, all unreviewed, by key). Once a
   review is recorded the screen changes (banked crowns leave it), so a later run takes the numbering from the
   recorded hold-review.json, which pins every chip number to its key */
const recorded = fs.existsSync(R + 'hold-review.json') ? Object.entries(JSON.parse(fs.readFileSync(R + 'hold-review.json', 'utf8')).decisions).filter(([, d]) => d.kind !== 'spot') : [];
const sorted = recorded.length === 965
  ? recorded.sort((x, y) => x[1].index - y[1].index).map(([key, d]) => ({ key, kind: d.kind, easting: d.easting, northing: d.northing, heightMetres: d.heightMetres }))
  : JSON.parse(fs.readFileSync(path.join(cache, 'candidates', 'hold-screen.json'), 'utf8'))
    .sort((a, b) => (a.verdict === 'unreviewed' ? 0 : 1) - (b.verdict === 'unreviewed' ? 0 : 1) || a.key.localeCompare(b.key));
if (sorted.length !== 965) throw new Error(`the sheets were drawn for 965 held crowns; the screen now lists ${sorted.length}: redraw and review again`);
if (recorded.length === 965 && !sorted.every((t, i) => recorded.find(([k]) => k === t.key)[1].index === i + 1)) throw new Error('the recorded numbering is not contiguous');

const BANK = {
  185: 'a conifer crown over a small shed in the wood (dark green in June 2024, red in the May 2020 colour infrared)',
  744: 'a 7.5 m crown over the corner of a roof, green in June 2024 and red in May 2020: a tree beside the house',
  777: 'a 7.7 m conifer beside the dark house, green in June 2024 and red in May 2020',
};
/* no-vegetation holds that are not trees: roofs (mostly unmapped houses built after May 2020), sheds,
   decks, caravans, vehicles and one mast at sea */
const NOT_TREE = [
  1, 7, 11, 32, 33, 39, 40, 48, 90, 105, 115, 121, 122, 125, 128, 130, 132, 138, 154, 167, 168,
  170, 172, 176, 180, 187, 188, 197, 213, 251, 267, 276, 295, 314, 327, 339, 352, 362,
  385, 387, 388, 394, 396, 397, 399, 401, 406, 409, 410, 413, 417, 423, 430, 435, 456,
  469, 470, 473, 474, 512, 515, 516, 517, 518, 520, 521, 522, 523, 524, 526,
  530, 532, 533, 535, 540, 541, 543, 544, 545, 547, 548, 549, 550, 551, 552,
  553, 555, 556, 558, 559, 560, 561, 571, 572, 574, 579, 580, 582, 584, 586, 587, 590, 591, 592,
  596, 597, 598, 599, 600, 601, 604, 605, 608, 611, 620, 623, 624,
  625, 626, 627, 628, 629, 630, 631, 632, 633, 636, 639, 641, 642, 643, 644, 646, 648,
  650, 651, 654, 655, 656, 659, 660, 664, 665, 666, 667, 668, 670, 671,
  673, 675, 678, 679, 681, 682, 683, 684, 686, 689, 691, 696, 785, 799, 860, 873,
  893, 898, 899, 907, 913, 916, 949, 951, 952, 953, 954,
  /* found on a second pass (every present hold with a crown radius of 4 m or more), after the spot check of
     the broadleaf calls found chip 527 placed on a roof: wide roofs passed in the first pass */
  447, 527, 537, 557, 570, 578,
];
const NOT_TREE_NOTES = {
  470: 'caravans and vehicles', 571: 'a timber house frame under construction', 611: 'a small white building',
  624: 'a caravan', 627: 'a caravan', 630: 'a caravan', 646: 'a caravan', 650: 'a caravan', 654: 'a caravan',
  352: 'a jetty deck', 406: 'a vehicle or shed',
};
const MAST = { 892: 'a 14 m object standing in the sea, black water in both photos: a mast or a sea mark' };
const UNCLEAR = {
  31: 'a thin 3.6 m object by a track: a post or a thin tree',
  60: 'a thin 3.1 m object by a track: a post or a thin tree',
  156: 'a small pale 4.7 m object with no crown in either photo',
  202: 'a 4.8 m top in deep shadow beside a small white structure',
  525: 'a 4 m top at the corner of a new roof with a pine shadow beside it: roof edge or tree',
  594: 'a 4.2 m top beside a new roof on gravel: roof edge or tree',
  595: 'a dead pine snag, 7.4 m, grey and leafless in June 2024',
  606: 'a 5.1 m top at the edge of a new roof with a tree beside it: roof edge or tree',
  663: 'a 4.2 m top at the end of a new roof under a dark crown: roof edge or tree',
  710: 'a 4.3 m top on bare rock with no crown in either photo',
  792: 'a 6 m top on gravel beside a small building: bare in June 2024',
  886: 'a 4.2 m top on bare rock with no crown in either photo',
  901: 'a 5.3 m top at the corner of a building in shadow',
  918: 'a 3.2 m top on the edge of the hexagonal house\'s roof beside a broadleaf',
};
for (const n of [...Object.keys(BANK), ...NOT_TREE, ...Object.keys(MAST), ...Object.keys(UNCLEAR)].map(Number)) if (!(n >= 1 && n <= sorted.length)) throw new Error(`no chip ${n}`);
const listed = [...Object.keys(BANK), ...NOT_TREE.map(String), ...Object.keys(MAST), ...Object.keys(UNCLEAR)];
if (new Set(listed).size !== listed.length) throw new Error('a chip is listed twice');

const decisions = {};
sorted.forEach((t, i) => {
  const n = i + 1;
  let verdict, note;
  if (BANK[n]) [verdict, note] = ['bank', BANK[n]];
  else if (UNCLEAR[n]) [verdict, note] = ['unclear', UNCLEAR[n]];
  else if (MAST[n]) [verdict, note] = ['not-tree', MAST[n]];
  else if (NOT_TREE.includes(n)) [verdict, note] = ['not-tree', NOT_TREE_NOTES[n] || (t.kind === 'building' ? 'a roof (the pit-free CHM keeps roofs as canopy)' : 'a roof the June 2025 laser reads as canopy (a house most likely built after May 2020, not on the map), or a shed or deck')];
  else if (t.kind === 'building') [verdict, note] = ['not-tree', 'a roof (the pit-free CHM keeps roofs as canopy)'];
  else [verdict, note] = ['present', 'a crown in June 2024 (a pine in shade or on pale lichen rock, dark in the May 2020 colour infrared)'];
  if (verdict === 'bank' && t.kind !== 'building') throw new Error(`chip ${n} is not on a building`);
  decisions[t.key] = { index: n, kind: t.kind, verdict, note, easting: t.easting, northing: t.northing, heightMetres: t.heightMetres };
});
/* placed crowns the spot checks found not to be trees (kind 'spot'; no chip number: they were not holds) */
const SPOT = [
  { easting: 678057.25, northing: 6987936.75, heightMetres: 4.08, verdict: 'not-tree', note: 'the red roof of a house the map lacks, among green surroundings (found by the spot check of the broadleaf calls, 2026-11-09: called broadleaf because the roof is bare in May 2020)' },
];
for (const t of SPOT) decisions[`${t.easting.toFixed(1)}_${t.northing.toFixed(1)}`] = { index: null, kind: 'spot', ...t };
const counts = {};
for (const d of Object.values(decisions)) counts[`${d.kind}:${d.verdict}`] = (counts[`${d.kind}:${d.verdict}`] || 0) + 1;
const doc = {
  schemaVersion: 1,
  kind: 'tree-hold-review',
  reviewedAt,
  reviewer: 'agent-led visual review (Claude, main session, 2026-11-09) of compact chips (June 2024 colour and May 2020 colour infrared at native 0.16 m, centred between the laser base and the displaced top); not a field check',
  screen: 'hold-screen.json of the candidates (round r4, publishing the round-1 lock; bank rule on): crowns on a mapped building and crowns with no June 2024 vegetation in the crown disc',
  verdicts: {
    bank: 'a tree beside the building: its stem moves to the nearest cell of its own crown (or laser canopy within holds.bank.reachMetres) clear of every mapped surface, and it is placed',
    present: 'a crown stands in June 2024 (mostly heath pines in shade, dark in the May 2020 colour infrared): placed',
    absent: 'stood when the laser was flown, gone in the photo: not placed / removed (the owner confirms the list)',
    'not-tree': 'a roof, shed, deck, caravan, vehicle or mast the canopy model kept: not placed / removed',
    unclear: 'held',
  },
  counts,
  decisions,
};
fs.writeFileSync(R + 'hold-review.json', JSON.stringify(doc, null, 1) + '\n');
console.log(JSON.stringify(counts));
