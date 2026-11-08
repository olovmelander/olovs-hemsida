/* Writes reference-annotations-r4b.json: rounds 1-4 windows verbatim from r4, and X1-X5 from the checked drafts (reference-draft.mjs) with the interpreter edits listed below. Run from the repository root. */
import fs from 'node:fs';
const R = 'geo_data/course-v2/johannesberg/vegetation/review-2026-11-08/';
const P = 'johannesbergbuild/cache/trees-2026-11-08/reference-panels/';
const a3 = JSON.parse(fs.readFileSync(R + 'reference-annotations-r4.json', 'utf8'));
const a4 = {
  schemaVersion: 1,
  reviewId: 'review-2026-11-08 round 4b',
  interpreter: 'agent-led interpretation (Claude) of the 0.5 m pit-free CHM and the 2025-06-14 and 2021-04-18 RGBI photos at their native 0.16 m (colour infrared and natural colour), each photo moved onto the canopy by its window relief displacement; not a survey and not human approval. Windows carried from rounds 1-4 keep their crown interpretation verbatim (copied from reference-annotations-r4.json).',
  protocol: [...a3.protocol,
    'Round 4b (X1-X5, frozen before any round-4b code ran): each window was first drafted by the round-3 rule written above (tools/tree-pipeline/photo/reference-draft.mjs: a numbered candidate within 2 m of a taller kept one, or less than 0.6 m above the dip toward a taller kept one within 3 m, is part of that crown; for a crown leafless in April 2021 within 3.5 m), with a type from the April 2021 vegetated share at the crown displaced position (>= 0.5 conifer, < 0.2 broadleaf, else unknown) and a stratum from the detect census rule (share of CHM >= 3 m in a 16 m square). The interpreter then checked every window on large single panels at 0.06 m (CHM hillshade, June 2025 natural colour and colour infrared, April 2021 natural colour, each photo moved onto the canopy) and changed what the panels contradicted; the changes are in each crown note. No detector output was looked at.',
    'Round 4 limitation: in closed stands the reference reads the same June 2025 photo the round-4 photo detector reads (and the same laser the laser detectors read), so where touching crowns share one laser maximum and one photo blob the split is a judgement that may favour the photo detector. A field check of X1 and X2 would settle it.',
    'Round 4: a tree felled after the 2021 laser (logs on the ground in June 2025) remains a reference crown when the April 2021 photo and the laser show it, by the first rule above; the scores are for the 2021 canopy the laser measured.'],
  windows: [...a3.windows],
};
const edits = {
  'X2-h9-closed': Object.fromEntries(['D22', 'D34', 'D38', 'D44', 'D45', 'D48'].map(l => [l, { stratum: 'edge', note: 'edge: on the gap inside the stand (CHM and June 2025 photo)' }])),
};
for (const id of ['X1-h8-closed', 'X2-h9-closed', 'X3-h12-edge', 'X4-h5-edge', 'X5-n9-2-4-groups']) {
  const d = JSON.parse(fs.readFileSync(P + id + '.draft.json', 'utf8'));
  const e = edits[id] || {};
  const crowns = d.crowns.map(c => {
    const x = e[c.label] || {};
    return { from: c.from, type: x.type || c.type, stratum: x.stratum || c.stratum, note: (x.note ? x.note + '; ' : '') + `draft ${c.label} (April share ${c.aprilShare})` + (c.inside ? '' : ', margin') };
  });
  a4.windows.push({ window: id, crowns, rejected: {}, ambiguous: [] });
}
fs.writeFileSync(R + 'reference-annotations-r4b.json', JSON.stringify(a4, null, 1) + '\n');
console.log(a4.windows.length, 'windows');
