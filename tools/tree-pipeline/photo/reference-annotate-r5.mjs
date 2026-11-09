/* Writes reference-annotations-r5.json: every round 1-4b window verbatim from
   r4b, and Y1-Y8 from the checked drafts (reference-draft.mjs --round r5)
   with the interpreter's edits listed below. Run from the repository root. */
import fs from 'node:fs';
const R = 'geo_data/course-v2/johannesberg/vegetation/review-2026-11-08/';
const P = 'johannesbergbuild/cache/trees-2026-11-08/reference-panels/';
const previous = JSON.parse(fs.readFileSync(R + 'reference-annotations-r4b.json', 'utf8'));
const out = {
  schemaVersion: 1,
  reviewId: 'review-2026-11-08 round 5',
  interpreter: 'agent-led interpretation (Claude, main session) of the 0.5 m pit-free CHM and the 2025-06-14 and 2021-04-18 RGBI photos at their native 0.16 m (colour infrared and natural colour), each photo moved onto the canopy by its window relief displacement; not a survey and not human approval. Windows carried from rounds 1-4b keep their crown interpretation verbatim (copied from reference-annotations-r4b.json).',
  protocol: [...previous.protocol,
    'Round 5 (Y1-Y8, frozen before any round-5 code ran): drafted by the round-3 grouping rule exactly as round 4b (reference-draft.mjs), then checked on the 0.06 m CHM, June 2025 natural colour and colour infrared, and April 2021 natural colour panels. No detector output, candidate decision or photo crown box was looked at in these windows.',
    'Round 5: the pit-free CHM keeps roofs, vehicles and machines (Y8, a farmyard: every draft crown inside it lay on a barn roof or a machine in the April 2021 photo, taken the day after the laser). Such candidates are rejected, not reference crowns; a detector crown there is an extra.',
    'Round 5: two tops of one broadleaf crown (one crown on the photos, one CHM blob, about 2 m apart) are one tree, as the leafless-crown rule (3.5 m) reads them, also when one of the two has no type call.',
  ],
  windows: [...previous.windows],
};
const edits = {
  'Y2-h2-edge': {
    merge: { D6: ['D5'] },
    set: { D6: { type: 'broadleaf', note: 'one broadleaf crown on the June 2025 photos and one CHM blob: draft D5 (2.1 m away) merged into it' } },
  },
  'Y8-h1-garden': {
    reject: {
      D1: 'barn roof (ridge line on both photos)', D2: 'barn roof', D3: 'barn roof', D4: 'barn roof', D6: 'barn roof (its south-east end)',
      D10: 'barn roof', D12: 'barn roof', D13: 'barn roof', D14: 'barn roof', D15: 'barn roof', D16: 'barn roof', D17: 'barn roof', D18: 'barn roof',
      D5: 'a blue machine and white stacks on the lawn in April 2021 (the day after the laser); grass in June 2025',
      D7: 'a trailer beside the green tractor in April 2021; open yard in June 2025',
      D8: 'vehicles and a shed corner in April 2021; a white car in June 2025',
    },
  },
};
const Y = ['Y1-h10-closed', 'Y2-h2-edge', 'Y3-h17-edge', 'Y4-h5-edge', 'Y5-h13-groups', 'Y6-n9-3-shore', 'Y7-n9-8-shore', 'Y8-h1-garden'];
for (const id of Y) {
  const draft = JSON.parse(fs.readFileSync(P + id + '.draft.json', 'utf8'));
  const e = edits[id] || {};
  const byLabel = new Map(draft.crowns.map(c => [c.label, c]));
  const absorbed = new Set(Object.values(e.merge || {}).flat());
  const rejected = {};
  const crowns = [];
  for (const c of draft.crowns) {
    if (absorbed.has(c.label)) continue;
    if (e.reject?.[c.label]) { for (const n of c.from) rejected[String(n)] = `${e.reject[c.label]} (draft ${c.label})`; continue; }
    const from = [...c.from, ...(e.merge?.[c.label] || []).flatMap(l => byLabel.get(l).from)].sort((a, b) => a - b);
    const x = e.set?.[c.label] || {};
    crowns.push({ from, type: x.type || c.type, stratum: x.stratum || c.stratum, note: (x.note ? x.note + '; ' : '') + `draft ${c.label} (April share ${c.aprilShare})` + (c.inside ? '' : ', margin') });
  }
  out.windows.push({ window: id, crowns, rejected, ambiguous: [] });
  console.log(id, crowns.length, 'crowns,', Object.keys(rejected).length, 'rejected candidates');
}
fs.writeFileSync(R + 'reference-annotations-r5.json', JSON.stringify(out, null, 1) + '\n');
console.log(out.windows.length, 'windows');
