/* Writes reference-annotations-r6.json: every round 1-5 window verbatim from
   r5, and Z1-Z6 from the checked drafts (reference-draft.mjs --round r6) with
   the interpreter's edits listed below. Run from the repository root. */
import fs from 'node:fs';
const R = 'geo_data/course-v2/johannesberg/vegetation/review-2026-11-08/';
const P = 'johannesbergbuild/cache/trees-2026-11-08/reference-panels/';
const previous = JSON.parse(fs.readFileSync(R + 'reference-annotations-r5.json', 'utf8'));
const out = {
  schemaVersion: 1,
  reviewId: 'review-2026-11-08 round 6',
  interpreter: 'agent-led interpretation (Claude, main session) of the 0.5 m pit-free CHM and the 2025-06-14 and 2021-04-18 RGBI photos at their native 0.16 m (colour infrared and natural colour), each photo moved onto the canopy by its window relief displacement, and of the mapped building footprints; not a survey and not human approval. Windows carried from rounds 1-5 keep their crown interpretation verbatim (copied from reference-annotations-r5.json).',
  protocol: [...previous.protocol,
    'Round 6 (Z1-Z6, frozen before any round-6 code ran): drafted by the round-3 grouping rule as rounds 4b and 5, then checked on the 0.06 m panels. Draft crowns on or within 1.5 m of a mapped building footprint were listed (no detector output) and decided on the photos: a draft on a roof is rejected; a draft at a wall that may be a roof edge or a low tree is an ambiguity box, scored for no one.',
  ],
  windows: [...previous.windows],
};
const ROOF = 'a roof the pit-free CHM keeps as canopy (on the mapped footprint; a roof in the April 2021 photo)';
const edits = {
  'Z5-h1-garden': {
    reject: Object.fromEntries(['D3', 'D4', 'D5', 'D7', 'D8', 'D12'].map(l => [l, ROOF])),
    ambiguous: { D10: 'a 3.6 m top 0.7 m from the house wall: a roof edge or a low tree, not decidable', D14: 'a 3.8 m top on the footprint of a low annex under tree crowns: not decidable' },
  },
  'Z6-n9-1-garden': {
    reject: Object.fromEntries(['D9', 'D10', 'D12', 'D14', 'D15', 'D16', 'D18', 'D20', 'D25', 'D26'].map(l => [l, `${ROOF}: the clubhouse`])),
  },
};
const Z = ['Z1-h12-closed', 'Z2-h3-edge', 'Z3-h11-edge', 'Z4-h12-groups', 'Z5-h1-garden', 'Z6-n9-1-garden'];
for (const id of Z) {
  const draft = JSON.parse(fs.readFileSync(P + id + '.draft.json', 'utf8'));
  const e = edits[id] || {};
  const rejected = {}, ambiguous = [], crowns = [];
  for (const c of draft.crowns) {
    if (e.reject?.[c.label]) { for (const n of c.from) rejected[String(n)] = `${e.reject[c.label]} (draft ${c.label})`; continue; }
    if (e.ambiguous?.[c.label]) { const [x, y] = c.at; ambiguous.push({ box: [x - 2, y - 2, x + 2, y + 2], reason: `${e.ambiguous[c.label]} (draft ${c.label})` }); continue; }
    crowns.push({ from: c.from, type: c.type, stratum: c.stratum, note: `draft ${c.label} (April share ${c.aprilShare})` + (c.inside ? '' : ', margin') });
  }
  out.windows.push({ window: id, crowns, rejected, ambiguous });
  console.log(id, crowns.length, 'crowns,', Object.keys(rejected).length, 'rejected candidates,', ambiguous.length, 'ambiguity boxes');
}
fs.writeFileSync(R + 'reference-annotations-r6.json', JSON.stringify(out, null, 1) + '\n');
