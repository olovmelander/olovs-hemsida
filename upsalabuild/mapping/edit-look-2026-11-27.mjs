#!/usr/bin/env node
/* The second round of the first look's changes (27 November 2026), after a first blind pass over the sheets named the
   same rings. Applied once, after edit-decks-2026-11-27.mjs and edit-sand-2026-11-27.mjs:

   node upsalabuild/mapping/edit-look-2026-11-27.mjs

   - Stora 13: the provisional deck of the old model (no card tee on it) hangs down the slope west of the forward
     deck, and the 51/47 site drawn on the deck's west edge half off it. The laser has one level platform there, at
     19.4-19.5 m over 15 m by 13 m (E 639477-639492, N 6636366-6636379), the round mown deck of both photo years: the
     two become that platform, for the 51 and 47 tees.
   - Stora 15: the laser platform drawn for the 62 tee in the first round ran on into the lower deck and down to the
     cart path (the platform finder joins ground at the same level). The upper deck is drawn from the laser's levels
     instead: 29-30 dm above 29 m over E 639703-639716, N 6636349-6636363 (deck-ground.mjs --around), kept as drawn,
     since it lies under crowns on both photos.
   - Two more bunkers half in shade on the 2025 photo, drawn whole from the May 2023 photo where they are lit:
     Stora 3's left greenside bunker (its south-west lobe) and Stora 10's front-right greenside bunker. */
import fs from 'node:fs';

const file = 'upsalabuild/mapping/decisions.json';
const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
const h13 = doc.holes['13'].pads;
const old13 = h13.findIndex(p => p.src === 'ring' && p.tees.length === 0);
const site13 = h13.findIndex(p => p.src === 'ellipse' && p.tees.includes('51'));
if (old13 < 0 || site13 < 0) throw new Error('hole 13 is not as make-decisions.mjs wrote it');
export const FORWARD_13 = {
  src: 'ring', tees: ['51', '47'],
  ring: Array.from({ length: 20 }, (_, k) => {
    const t = (2 * Math.PI * k) / 20;
    return [Math.round((639485 + 6.5 * Math.cos(t)) * 10) / 10, Math.round((6636372.5 + 6 * Math.sin(t)) * 10) / 10];
  }),
  why: "the forward deck, drawn round the laser's level ground (19.4-19.5 m over E 639478-639492, N 6636366-6636379, deck-ground.mjs --around) and refined on the photo, where it shows as the round mown deck of both photo years: the old model's provisional deck hung down the slope west of it, and the 51/47 site lay on its west edge. The tracer's platform finder does not take this ground as a platform",
};
h13[old13] = FORWARD_13;
h13.splice(site13, 1);
const h15 = doc.holes['15'].pads;
const up15 = h15.findIndex(p => p.src === 'platform' && p.tees.includes('62'));
if (up15 < 0) throw new Error('hole 15 is not as edit-decks-2026-11-27.mjs left it');
h15[up15] = {
  src: 'ring', reach: 0, tees: ['62'],
  ring: [[639704, 6636362], [639712, 6636363], [639716, 6636359], [639716, 6636351], [639712, 6636348.5], [639706, 6636349], [639703, 6636353], [639703, 6636359]],
  why: "the upper deck under the canopy, drawn from the laser's levels (29-30 dm above 29 m over E 639703-639716, N 6636349-6636363, deck-ground.mjs --around) and kept as drawn: no photo shows its edge, and the platform finder ran it on into the lower deck and the cart path. The 62 tee's visible turf (the September site review) lies on it",
};
fs.writeFileSync(file, `${JSON.stringify(doc, null, 1)}\n`);
console.log('edited', file, '13 and 15');

const sandFile = 'upsalabuild/mapping/sand-decisions.json';
const sand = JSON.parse(fs.readFileSync(sandFile, 'utf8'));
for (const [hole, e, n] of [[3, 640173, 6636270], [10, 640110, 6636663]]) {
  const i = sand.keep.findIndex(k => k.course === 'upsala' && k.hole === hole && Math.hypot(k.at[0] - e, k.at[1] - n) < 4);
  if (i < 0) throw new Error(`no kept bunker on ${hole} near ${e} ${n}`);
  sand.keep.splice(i, 1);
}
sand.add.push(
  {
    kind: 'bunker', course: 'upsala', hole: 3, material: 'white-sand', reach: 0.5,
    ring: [[640170.8, 6636275.5], [640174.8, 6636275.3], [640177, 6636271.9], [640176.2, 6636268.7], [640174.2, 6636265.1], [640172.6, 6636262.7],
      [640171, 6636260.3], [640169, 6636259.3], [640168, 6636261.1], [640168.6, 6636263.5], [640169.8, 6636266.7], [640170.2, 6636269.9], [640170.4, 6636273.5]],
    why: "the left greenside bunker of the 3rd, whole: its south-west lobe lies in a tree's shadow on the 2025 photo and the extraction stopped at it; read off the May 2023 photo, where it is lit",
  },
  {
    kind: 'bunker', course: 'upsala', hole: 10, material: 'white-sand', reach: 0.5,
    ring: [[640105.2, 6636666.7], [640106.8, 6636666.9], [640109.6, 6636665.3], [640112.4, 6636664.6], [640115.2, 6636664.8], [640116.6, 6636663.1],
      [640116.4, 6636661.5], [640114.8, 6636660], [640112, 6636659.4], [640109.6, 6636658.9], [640108.4, 6636659.2], [640106.4, 6636660.5],
      [640105.2, 6636662.3], [640104.8, 6636664.7]],
    why: "the front-right greenside bunker of the 10th, whole: its south half lies in a tree's shadow on the 2025 photo and the extraction cut a notch there; read off the May 2023 photo, where it is lit",
  },
);
fs.writeFileSync(sandFile, `${JSON.stringify(sand, null, 1)}\n`);
console.log('kept', sand.keep.length, 'added', sand.add.length);
