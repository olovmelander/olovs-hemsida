/* Writes Norrfällsviken's reference-annotations.json (review-2026-11-09, the one sample of rounds r1-r4)
   from the checked drafts (reference-draft.mjs --ground norrfallsviken --round r1) with the interpreter's
   edits listed below. Run from the repository root after the drafts exist in the cache.

   A margin crown (outside its window, never scored) is checked against the mapped building footprints: on
   one, it is rejected as a roof without a crown-by-crown look. Inside crowns were each looked at; the run
   prints any inside crown on a footprint that is not rejected, and any rejected one that is not on one. */
import fs from 'node:fs';
import path from 'node:path';
import { loadGroundConfig, ROOT } from '../config.mjs';
import { buildingRings, playGeometry } from '../geometry.mjs';

const ctx = loadGroundConfig(ROOT, 'norrfallsviken');
const P = ctx.paths.referencePanels;
const windows = JSON.parse(fs.readFileSync(ctx.reviewFile('reference-windows.json'), 'utf8')).windows;
const rings = buildingRings(playGeometry(ctx).geometry);
const insideRing = (e, n, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > n) !== (yj > n) && e < ((xj - xi) * (n - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const onFootprint = (e, n) => rings.some(r => insideRing(e, n, r));

const ROOF = 'a roof the pit-free CHM keeps as canopy (on the mapped footprint; a roof in the June 2024 and May 2020 photos)';
const ROOF_PHOTO = 'a roof the pit-free CHM keeps as canopy (a roof in the June 2024 and May 2020 photos)';
const CIR_BROADLEAF = 'broadleaf: a rounded crown, bright red in the June 2024 colour infrared beside dark conifers (the May 2020 photo, flown as the birches came into leaf, reads it as vegetated)';
const edits = {
  'C4-h8-shore': {
    type: { D7: ['unknown', 'a broad 11 m crown by the pond: lighter and rounder than the pines, not decidable'] },
    ambiguous: { D6: 'a shoulder of D7\'s broad crown toward the water or a tree of its own, not decidable', D8: 'a shoulder of D7\'s broad crown toward the water or a tree of its own, not decidable' },
  },
  'C5-h9-garden': {
    reject: {
      D42: 'the north-east corner of the smaller building\'s roof (2.2 m)',
      D43: 'the padel court\'s glass wall and fence (about 3 m)', D44: 'the padel court\'s glass wall and fence (about 3 m)', D45: 'the padel court\'s glass wall and a lamp (about 3 m)',
      D46: `${ROOF_PHOTO}: the smaller building north of the clubhouse, which no mapped footprint covers (the nearest is 11 m away)`, D47: `${ROOF}: the clubhouse`, D48: `${ROOF_PHOTO}: the clubhouse, 0.3 m outside its mapped footprint`, D49: `${ROOF}: the clubhouse`, D50: `${ROOF}: the clubhouse`,
    },
  },
  'C6-h2-groups': { merge: [['D18', 'D20', 'two tops 2 m apart in one 6 m crown']] },
  'C7-h13-edge': {
    merge: [['D9', 'D10', 'a 3.3 m shoulder of the same small pine']],
    ambiguous: { D13: 'a pale 3.1 m object with no foliage in the June 2024 colour infrared: a dead snag or a boulder, not decidable', D23: 'a pale 3.6 m object with no foliage in the June 2024 colour infrared: a dead snag or a boulder, not decidable' },
  },
  'C8-h10-edge': { merge: [['D31', 'D32', 'two tops 2 m apart in one 5 m crown']] },
  'C10-h7-closed': {
    type: {
      ...Object.fromEntries(['D12', 'D13', 'D17', 'D21', 'D24', 'D28'].map(l => [l, ['broadleaf', `${CIR_BROADLEAF}; young trees under the tall conifers`]])),
      ...Object.fromEntries(['D7', 'D9', 'D11', 'D14', 'D15', 'D16', 'D22', 'D25', 'D30'].map(l => [l, ['unknown', 'young understorey crown between the tall conifers and the broadleaf thicket, not decidable']])),
    },
  },
  'C11-h1-village': {
    reject: { ...Object.fromEntries(['D28', 'D30', 'D31', 'D34', 'D46', 'D49', 'D51', 'D52', 'D54'].map(l => [l, ROOF])), D55: `${ROOF_PHOTO}: the south-east house, 5 m outside its mapped footprint (mapped short)` },
    ambiguous: Object.fromEntries(['D44', 'D45', 'D48', 'D50'].map(l => [l, 'a 9 x 10 m broadleaf mass with four tops 2-2.6 m apart at 12-13 m: one to four trees, not decidable'])),
    type: {
      ...Object.fromEntries(['D32', 'D33', 'D35', 'D43'].map(l => [l, ['broadleaf', `${CIR_BROADLEAF}; a garden tree`]])),
      D16: ['unknown', 'at the edge of the bright red broadleaf patch, not decidable'], D22: ['unknown', 'at the edge of the bright red broadleaf patch, not decidable'],
    },
  },
  'H3-h15-garden': { reject: Object.fromEntries(['D9', 'D10', 'D11', 'D13', 'D28', 'D40', 'D43'].map(l => [l, ROOF])) },
  'H4-h14-shore': {
    ambiguous: Object.fromEntries(['D17', 'D19', 'D20'].map(l => [l, 'three tops 2 m apart at 7.6-8.8 m at the window edge: one to three trees, not decidable'])),
    type: Object.fromEntries(['D26', 'D29', 'D31', 'D33', 'D34', 'D35'].map(l => [l, ['unknown', 'a small shore tree in the broadleaf shrub strip: birch or pine, not decidable']])),
  },
  'H6-h6-coast': {
    ambiguous: { D22: 'two tops 3.4 m apart at 13.2-13.6 m in a broadleaf mass: one crown or two, not decidable', D23: 'two tops 3.4 m apart at 13.2-13.6 m in a broadleaf mass: one crown or two, not decidable' },
    type: Object.fromEntries(['D30', 'D34', 'D40', 'D42'].map(l => [l, ['broadleaf', CIR_BROADLEAF]])),
  },
};

const out = {
  schemaVersion: 1,
  reviewId: 'review-2026-11-09',
  interpreter: 'agent-led interpretation (Claude, main session, 2026-11-09) of the 0.5 m pit-free CHM (June 2025 laser) and the 2024-06-27 and 2020-05-22 RGBI photos at their native 0.16 m (natural colour and colour infrared), each photo moved onto the canopy by its window relief displacement, and of the mapped building footprints; not a survey, not the club, not human approval.',
  protocol: [
    'Every window was drafted by Johannesberg\'s round-3 grouping rule (reference-draft.mjs: a numbered candidate within 2 m of a taller kept one, or less than 0.6 m above the dip toward a taller kept one within 3 m, is part of that crown; 3.5 m for a crown leafless in the leaf-off photo), typed from the May 2020 photo\'s vegetated share (>= 0.5 conifer, < 0.2 broadleaf, else unknown) and given the census stratum (share of CHM >= 3 m in a 16 m square), then checked crown by crown on the four panels at 0.08 m before any detector under test ran.',
    'The sample is the ground as the June 2025 laser and the June 2024 photo show it: many stands were thinned or felled between May 2020 and June 2024, and trees seen only in the 2020 photo are not crowns.',
    'Roofs, the padel court\'s walls and lamps that the pit-free CHM keeps as canopy are rejected; a top that may be a separate tree or part of a neighbour\'s crown, and a pale object with no foliage, is an ambiguity box scored for no one.',
    'Type: the 22 May 2020 photo was flown as the birches came into leaf, so a leafing broadleaf reads as vegetated there. Where the June 2024 colour infrared shows a rounded crown bright red beside dark conifers the crown is typed broadleaf; where neither photo decides, unknown. Pines are the rule here.',
    'Closed stands (C3, C10, H6): the drafted tops match separate CHM lobes and dark crowns in the June photo; touching crowns there cannot be confirmed one by one, as at Johannesberg.',
    'A margin crown (outside its window) on a mapped building footprint is rejected as a roof without a crown-by-crown look; margin crowns are never scored.',
  ],
  windows: [],
};

const unexpected = [];
for (const window of windows) {
  const draft = JSON.parse(fs.readFileSync(path.join(P, `${window.id}.draft.json`), 'utf8'));
  const e = edits[window.id] || {};
  const byLabel = new Map(draft.crowns.map(c => [c.label, c]));
  for (const l of [...Object.keys(e.reject || {}), ...Object.keys(e.ambiguous || {}), ...Object.keys(e.type || {}), ...(e.merge || []).flatMap(m => m.slice(0, 2))]) {
    if (!byLabel.has(l)) throw new Error(`${window.id}: no draft crown ${l}`);
    if (!byLabel.get(l).inside) throw new Error(`${window.id}: ${l} is a margin crown; edits are for checked inside crowns`);
  }
  const merged = new Map();
  for (const [a, b, why] of e.merge || []) merged.set(b, { into: a, why });
  const rejected = {}, ambiguous = [], crowns = [];
  for (const c of draft.crowns) {
    const at = [window.bbox[0] + c.at[0], window.bbox[1] + c.at[1]];
    const roof = onFootprint(at[0], at[1]);
    if (e.reject?.[c.label]) {
      if (!roof) unexpected.push(`${window.id} ${c.label} rejected (${e.reject[c.label]}) but not on a mapped footprint`);
      for (const n of c.from) rejected[String(n)] = `${e.reject[c.label]} (draft ${c.label})`;
      continue;
    }
    if (!c.inside && roof) { for (const n of c.from) rejected[String(n)] = `${ROOF}; margin, not checked one by one (draft ${c.label})`; continue; }
    if (roof) unexpected.push(`${window.id} ${c.label} (inside, ${c.height} m) on a mapped footprint but kept`);
    if (e.ambiguous?.[c.label]) { const [x, y] = c.at; ambiguous.push({ box: [x - 1.5, y - 1.5, x + 1.5, y + 1.5], reason: `${e.ambiguous[c.label]} (draft ${c.label})` }); continue; }
    if (merged.has(c.label)) continue;
    const members = [...c.from, ...[...merged.entries()].filter(([, m]) => m.into === c.label).flatMap(([b]) => byLabel.get(b).from)].sort((x, y) => x - y);
    const mergeNote = [...merged.entries()].filter(([, m]) => m.into === c.label).map(([b, m]) => `; ${b} merged (${m.why})`).join('');
    const [type, typeNote] = e.type?.[c.label] || [c.type, null];
    crowns.push({ from: members, type, stratum: c.stratum, note: `draft ${c.label} (May 2020 share ${c.aprilShare})${typeNote ? `; type ${type}: ${typeNote}` : ''}${mergeNote}${c.inside ? '' : ', margin'}` });
  }
  out.windows.push({ window: window.id, crowns, rejected, ambiguous });
  const inside = crowns.filter(c => !c.note.endsWith(', margin'));
  console.log(window.id.padEnd(18), String(inside.length).padStart(3), 'inside crowns,', String(Object.keys(rejected).length).padStart(2), 'rejected candidates,', ambiguous.length, 'ambiguity boxes');
}
for (const u of unexpected) console.log('CHECK', u);
fs.writeFileSync(ctx.reviewFile('reference-annotations.json'), JSON.stringify(out, null, 1) + '\n');
