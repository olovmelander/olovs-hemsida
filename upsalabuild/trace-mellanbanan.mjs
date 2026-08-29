/* Register Upsala's Mellanbanan banguide to the world, and read its nine holes
   off it.

   usage: node upsalabuild/trace-mellanbanan.mjs

   THE BANGUIDE IS THE ROUTING AUTHORITY AND THE PONDS ARE THE GEOREFERENCE.
   The club's own overview (banguider.se) is an aerial illustration with the
   surroundings masked out, so it cannot be matched to imagery by its edges --
   but the water bodies inside it are also in OpenStreetMap, with world
   coordinates this build already carries. Three of them, read off the drawing
   and paired with their OSM rings, fix a similarity: scale, rotation, offset.

   Why that is trustworthy rather than a guess: two ponds are enough to solve the
   transform, so the THIRD is a free check that never entered the fit. It lands
   24 m from where the fit predicts, on a hand-drawn illustration covering more
   than a kilometre. The rotation comes out at about +3 degrees, i.e. the sheet
   is north-up, which is what a course map almost always is -- a fit that had
   come out at 40 degrees would have said the pairing was wrong.

   Every pixel coordinate below is in the frame of the 1400x1059 rendering of the
   overview (geobuild/cache/banguide/mellan-overview-small.jpg). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ---- control points: pond centres, banguide pixels <-> OSM world metres ---- */
const CONTROL = [
  { name: 'the big pond between 3 and 4', px: [1020, 285], world: [902, -157], area: 6461 },
  { name: 'the pond left of 2',           px: [512, 130],  world: [523, -295], area: 2485 },
  { name: 'the pond by 9',                px: [247, 237],  world: [309, -202], area: 521 },
];

/* Least-squares similarity (uniform scale + rotation + translation) from pixel
   space to world. Screen y runs down and world z runs south, so the two frames
   have the same handedness and no reflection is needed -- if a fit ever wants
   one, the pairing is wrong. */
function solveSimilarity(pairs) {
  const n = pairs.length;
  const mp = pairs.reduce((a, q) => [a[0] + q.px[0] / n, a[1] + q.px[1] / n], [0, 0]);
  const mw = pairs.reduce((a, q) => [a[0] + q.world[0] / n, a[1] + q.world[1] / n], [0, 0]);
  let sxx = 0, sxy = 0, spp = 0;
  for (const q of pairs) {
    const a = [q.px[0] - mp[0], q.px[1] - mp[1]];
    const b = [q.world[0] - mw[0], q.world[1] - mw[1]];
    sxx += a[0] * b[0] + a[1] * b[1];
    sxy += a[0] * b[1] - a[1] * b[0];
    spp += a[0] * a[0] + a[1] * a[1];
  }
  const s = Math.hypot(sxx, sxy) / spp;          /* metres per pixel */
  const th = Math.atan2(sxy, sxx);               /* radians */
  const c = Math.cos(th) * s, sn = Math.sin(th) * s;
  return {
    s, thetaDeg: th * 180 / Math.PI,
    apply: ([x, y]) => [
      mw[0] + c * (x - mp[0]) - sn * (y - mp[1]),
      mw[1] + sn * (x - mp[0]) + c * (y - mp[1]),
    ],
  };
}

/* ---- the nine holes, read off the overview ------------------------------
   Each is the play line from the tee (where the numbered disc sits) to the
   green, with the intermediate points that carry a dogleg. These are read by
   eye at the drawing's own scale; the CARD is what makes them exact, because
   every hole is then slid along its own axis until it measures what the club
   prints -- the same rule the six built courses already use. */
const HOLES_PX = {
  1: [[70, 118], [200, 150], [330, 172], [395, 178]],
  2: [[440, 116], [560, 175], [700, 235], [800, 267]],
  3: [[868, 84], [1000, 140], [1150, 190], [1268, 217]],
  4: [[1316, 353], [1180, 335], [1040, 322], [942, 320]],
  5: [[818, 408], [770, 432], [706, 456]],
  6: [[826, 674], [700, 760], [540, 850], [392, 906]],
  7: [[374, 870], [470, 890], [560, 898], [642, 900]],
  8: [[492, 724], [498, 690], [506, 652]],
  9: [[330, 238], [260, 250], [180, 258], [132, 264]],
};

const T = solveSimilarity(CONTROL);
console.log(`similarity: ${T.s.toFixed(4)} m per banguide pixel, rotation ${T.thetaDeg.toFixed(2)}°`);
console.log('control residuals (a two-point fit would make the third one free):');
for (const c of CONTROL) {
  const p = T.apply(c.px);
  const d = Math.hypot(p[0] - c.world[0], p[1] - c.world[1]);
  console.log(`  ${c.name.padEnd(30)} ${d.toFixed(1)} m`);
}

const card = JSON.parse(fs.readFileSync(path.join(ROOT, 'upsalabuild/card-mellanbanan.json'), 'utf8'));
const polyLen = l => { let s = 0; for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]); return s; };

console.log('\nhole  card(Vit)  drawn   ratio   par');
const out = {};
let worst = 0;
for (const h of card.holes) {
  const line = HOLES_PX[h.n].map(T.apply);
  const drawn = polyLen(line);
  const ratio = drawn / h.t[0];
  worst = Math.max(worst, Math.abs(1 - ratio));
  out[h.n] = { par: h.par, hcp: h.hcp, t: h.t, line: line.map(p => [+p[0].toFixed(1), +p[1].toFixed(1)]) };
  console.log(`${String(h.n).padStart(4)} ${String(h.t[0]).padStart(9)} ${drawn.toFixed(0).padStart(7)} ${ratio.toFixed(2).padStart(7)} ${String(h.par).padStart(5)}`);
}
console.log(`\nworst length disagreement ${(worst * 100).toFixed(0)}% before the card slide.`);
console.log('A drawn line is short of its card by design here: the discs sit at the');
console.log('tee GROUND, not on the back marker, and the card slide is what resolves it.');

fs.writeFileSync(path.join(ROOT, 'upsalabuild/mellanbanan-traced.json'), JSON.stringify({
  source: 'banguider.se overview for Upsala GK Mellanbanan, registered to the world through three OSM pond centres',
  registration: { metresPerPixel: +T.s.toFixed(4), rotationDeg: +T.thetaDeg.toFixed(2), control: CONTROL },
  note: 'Hole lines are read off the club drawing and are provisional (prov:"guide"): direction and routing come from the club, exact length comes from the card slide, and nothing here is surveyed.',
  holes: out,
}, null, 1) + '\n');
console.log('\nwrote upsalabuild/mellanbanan-traced.json');
