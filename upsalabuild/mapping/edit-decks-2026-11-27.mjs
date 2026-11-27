#!/usr/bin/env node
/* The first look's changes to the decks (27 November 2026), applied once to the decisions make-decisions.mjs wrote.
   Each is a deck whose ring the laser shows hanging over its bank, so it is drawn as the laser's level platform:

   node upsalabuild/mapping/edit-decks-2026-11-27.mjs                                                          */
import fs from 'node:fs';

const centroid = ring => [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length].map(v => Math.round(v * 10) / 10);
const EDITS = [
  { file: 'upsalabuild/mapping/decisions.json', hole: '3', pad: 0, why: "the back deck as the laser's level platform: the September ring takes in the mown bank on its west side, which falls 1 m in 3 m (deck-ground.mjs, 3.5% under the ring); the deck is the same on the 2021 and 2025 photos, so it was not rebuilt" },
  { file: 'upsalabuild/mapping/decisions.json', hole: '7', pad: 3, why: "the 62 deck as the laser's level platform: the September ring lies 2-3 m west of it, over the bank (deck-ground.mjs, 5.1% under the ring), and leaves level deck uncovered on the east; the deck is the same on the 2021 and 2025 photos" },
  { file: 'upsalamellanbuild/mapping/decisions.json', hole: '8', pad: 0, why: "the Vit/Gul deck as the laser's level platform: the September ring lies 3-4 m west of it, on the slope (deck-ground.mjs, 3.3% under the ring)" },
];
for (const edit of EDITS) {
  const doc = JSON.parse(fs.readFileSync(edit.file, 'utf8'));
  const pad = doc.holes[edit.hole].pads[edit.pad];
  if (pad.src !== 'ring') throw new Error(`${edit.file} ${edit.hole}/${edit.pad + 1} is ${pad.src}, already edited?`);
  doc.holes[edit.hole].pads[edit.pad] = { src: 'platform', at: centroid(pad.ring), tees: pad.tees, why: edit.why };
  fs.writeFileSync(edit.file, `${JSON.stringify(doc, null, 1)}\n`);
  console.log('edited', edit.file, edit.hole, edit.pad + 1);
}

/* Stora 15: the provisional box of the old model (no card tee on it) and the small site deck drawn for the 62 tee
   inside it become one deck, the laser's level platform under the canopy at the box's centre. */
const file = 'upsalabuild/mapping/decisions.json';
const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
const pads = doc.holes['15'].pads;
const box = pads[0], site = pads.findIndex(p => p.src === 'ellipse' && p.tees.includes('62'));
if (box.src !== 'ring' || box.tees.length || site < 0) throw new Error('hole 15 is not as make-decisions.mjs wrote it');
pads[0] = {
  src: 'platform', at: centroid(box.ring.slice(0, 4)), tees: ['62'],
  why: "the upper deck under the canopy, as the laser's level platform (29-30 dm over 12 m by 12 m round the old model's provisional box, deck-ground.mjs --around): the box covered a path and trees, and no card tee stood on it; the 62 tee's visible turf (the September site review) lies on this platform",
};
pads.splice(site, 1);
fs.writeFileSync(file, `${JSON.stringify(doc, null, 1)}\n`);
console.log('edited', file, '15');
