#!/usr/bin/env node
/* The first look's changes to the sand (27 November 2026), applied once to what make-sand-decisions.py wrote:

   node upsalabuild/mapping/edit-sand-2026-11-27.mjs

   - Stora 17's "bunker" south-west of the green (OSM w438981590, kept by the old model) is a granite outcrop: pale,
     mottled with lichen, the same on the 2023 and 2025 photos, and 0.53 m ABOVE the ground round it in the laser
     (deck-ground.mjs). It is left out.
   - Two bunkers lie half in a tree's shade on the 2025 photo, and the extracted sand stops at the shadow: Stora 12's
     right-hand greenside bunker and Mellanbanan 6's bunker short of the green. Each is drawn whole by hand, read off
     the photo where it is lit (2025 for Stora 12, where the shaded sand still shows grey-blue; May 2023 for
     Mellanbanan 6), and refined at most 0.8 m. */
import fs from 'node:fs';

const file = 'upsalabuild/mapping/sand-decisions.json';
const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
const near = (at, e, n) => Math.hypot(at[0] - e, at[1] - n);
const drop = [
  ['upsala', 17, 639667.9, 6635682.7],
  ['upsala', 12, 639421.7, 6636369.4],
  ['upsala-mellanbanan', 6, 640260, 6635762],
];
for (const [course, hole, e, n] of drop) {
  const i = doc.keep.findIndex(k => k.course === course && k.hole === hole && near(k.at, e, n) < 4);
  if (i < 0) throw new Error(`no kept bunker of ${course} ${hole} near ${e} ${n}`);
  doc.keep.splice(i, 1);
}
const ellipse = (ce, cn, a, b, k = 20) => Array.from({ length: k }, (_, i) => {
  const t = (2 * Math.PI * i) / k;
  return [Math.round((ce + a * Math.cos(t)) * 10) / 10, Math.round((cn + b * Math.sin(t)) * 10) / 10];
});
doc.add = [
  {
    kind: 'bunker', course: 'upsala', hole: 12, material: 'white-sand', reach: 0.5,
    ring: [[639416, 6636370.5], [639417.5, 6636372], [639420.5, 6636372.5], [639423.5, 6636372], [639425.5, 6636370.5], [639425.9, 6636368.5],
      [639425, 6636366.5], [639423, 6636365.5], [639421, 6636365.4], [639418.5, 6636365.8], [639416, 6636365.1], [639414.5, 6636365.8],
      [639413.9, 6636367.3], [639414.5, 6636369]],
    why: "the right-hand greenside bunker of the 12th (OSM w438982469), whole: its west half lies in a tree's shadow on the 2025 photo, grey-blue sand that the extraction stopped at; read off the 2025 photo by eye",
  },
  {
    kind: 'bunker', course: 'upsala-mellanbanan', hole: 6, material: 'tan-sand', reach: 0.5,
    ring: ellipse(640259.7, 6635759.5, 3.4, 5.1),
    why: "the bunker short of the 6th green, whole: an oval 7 m by 10 m, lit on the May 2023 photo; on the 2025 photo its southern two-thirds lie in a tree's shadow and the extraction kept only the sunlit crescent",
  },
];
doc.note = "Candidates of extract_sand with Upsala's two-sand bands (trace-config sand): 609 over the box. Kept: the 77 that overlap a bunker OSM or the reviewed model already had, and three no map had (EXTRA in make-sand-decisions.py), each looked at on the 2025 and 2021 photos; two bunkers in shade drawn whole by hand (add), and one OSM bunker left out as rock (edit-sand-2026-11-27.mjs). Left out after a look: cart paths, rock outcrops, roofs, patios, a road bridge, floating pond weed, the practice ground's bunkers and range discs, and bare patches. OSM's w438984738 by Mellanbanan 4 is turf (the September review retired it), and w438993028/29 lie north of the box, on Lilla banan.";
fs.writeFileSync(file, `${JSON.stringify(doc, null, 1)}\n`);
console.log('kept', doc.keep.length, 'added', doc.add.length);
