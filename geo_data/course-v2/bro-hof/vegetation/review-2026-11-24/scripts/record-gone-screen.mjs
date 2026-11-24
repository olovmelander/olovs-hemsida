/* Writes hold-review.json for Bro Hof (review-2026-11-24): `spot` verdicts `absent` for placed crowns of the 2020/2021
   laser that the June 2025 photo does not show. The pipeline's own felling screen works outside closed stands only, and
   its no-vegetation hold passes lawn; here whole woods were felled for a building site and for new lawn. The rule is
   mechanical, set from the calibration and held-out reference crowns' own texture (no score is involved): at the laser
   base, and at half and three quarters of the way to where the photo draws the top, a disc of the crown's radius is
   smooth (near-infrared texture below 4.5, the reference crowns' 2nd percentile) and without shadow (dark share below
   0.1); or, on the western building site (E below 648600), the presence score is below 0.45 and the disc without shadow.
   The agent looked at 3 of the 8 chip sheets of the suspects (189 of 501 chips) and saw lawn, road, roof, water, bare
   ground or a gap on nearly all but the shadowed ones, which the rule leaves placed. It is not a crown-by-crown review.
   node geo_data/course-v2/bro-hof/vegetation/review-2026-11-24/scripts/record-gone-screen.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { loadGroundConfig, ROOT } from '../../../../../../tools/tree-pipeline/config.mjs';
import { loadMosaic } from '../../../../../../tools/tree-pipeline/panels.mjs';
import { fieldAt } from '../../../../../../tools/tree-pipeline/relief.mjs';
import { photoDisc } from '../../../../../../tools/tree-pipeline/crown-evidence.mjs';

const ctx = loadGroundConfig(ROOT, 'bro-hof');
const full = JSON.parse(fs.readFileSync(path.join(ctx.paths.candidates, 'candidates-full.json'), 'utf8'));
const m25 = loadMosaic(ctx, '2025');
const field = JSON.parse(fs.readFileSync(ctx.reviewFile('relief-displacement.json'), 'utf8')).campaigns['2025'].field;
const measure = (e, n, h, r) => {
  const k = fieldAt(field, e, n);
  const at = k ? [0, 0.5, 0.75].map(f => [e + f * k.kx * h, n + f * k.ky * h]) : [[e, n]];
  const d = at.map(([x, y]) => photoDisc(m25, x, y, Math.max(1.5, r))).filter(Boolean);
  return d.length ? { dark: Math.max(...d.map(x => x.darkShare)), texture: Math.max(...d.map(x => x.nirTexture)) } : null;
};
const decisions = {};
const counts = { near: 0, woodland: 0 };
for (const t of full) {
  if (!['retain', 'adjust', 'add'].includes(t.decision) || t.source !== 'detector') continue;
  const m = measure(t.easting, t.northing, t.objectHeightMetres, t.radiusMetres);
  if (!m || m.dark >= 0.1) continue;
  const presence = t.evidence.june2025?.presence ?? 1;
  if (!(m.texture < 4.5 && (m.texture < 2.8 || m.dark < 0.02)) && !(presence < 0.45 && t.easting < 648600)) continue;
  const at = t.evidence.bank?.from ?? t;
  decisions[`${at.easting.toFixed(1)}_${at.northing.toFixed(1)}`] = { kind: 'spot', verdict: 'absent', easting: at.easting, northing: at.northing, note: `mechanical screen: no crown in the June 2025 photo at any position it could draw this one (texture ${Math.round(m.texture * 10) / 10}, dark share ${Math.round(m.dark * 100) / 100}, presence ${presence}); not looked at one by one` };
  counts[t.play]++;
}
fs.writeFileSync(ctx.reviewFile('hold-review.json'), JSON.stringify({
  schemaVersion: 1, kind: 'tree-hold-review', reviewedAt: new Date().toISOString(),
  reviewer: 'mechanical screen with an agent spot check (Claude, 2026-11-24): 3 of 8 chip sheets of the suspects looked at; not a field check and not a crown-by-crown review',
  screen: 'placed crowns of the candidates (round r1) that the June 2025 photo does not show; the 1,737 crowns held on a mapped building or with no June 2025 vegetation have NO verdict here and stay held (not placed)',
  verdicts: { absent: 'stood when the laser was flown, gone in the photo: not placed / removed (the owner confirms the list)' },
  counts: { 'spot:absent': Object.keys(decisions).length, near: counts.near, woodland: counts.woodland },
  decisions,
}, null, 1) + '\n');
console.log(Object.keys(decisions).length, JSON.stringify(counts));
