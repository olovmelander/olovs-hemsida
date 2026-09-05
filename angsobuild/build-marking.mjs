#!/usr/bin/env node
/* Penalty and out-of-bounds marking from the club's Lokala regler -> marking.json.

   The club publishes WHICH sides are marked and in what colour (Lokala regler
   2026, and its hole texts); it publishes no coordinates. So each run is placed
   by a rule the note beside it states, and the model carries the rule as well
   as the stakes:

     pond      red stakes 2.5 m outside every pond on the course, every 7 m --
               a stake traces the margin of the water it marks, so it can never
               stand away from its hazard
     edge      a run along one side of a hole at the fairway's own edge plus a
               margin, between two fractions of the hole (the 17th's endless red
               area, the 5/6 internal stakes)
     fence     a white run at the WOODLAND EDGE on one side of a hole: the boar
               fence and the property line here run where the rough meets the
               trees, and the satellite tree-cover raster is the only record of
               that edge (a fence returns nothing to a laser). From the fairway
               edge outward in 3 m steps until canopy, the stake 3 m short of it;
               20 m out where no canopy is found within 60 m.

   Sides are the PLAYER'S, facing down the hole: right = (-dz, dx), left =
   (dz, -dx) for a direction (dx, dz) in this z-south frame. CLAUDE.md records
   how the reflected formula once mirrored every sided feature on a course.

     node angsobuild/build-marking.mjs                                        */
import path from 'node:path';
import { readJSON, writeJSON, bbox } from './lib.mjs';
import { HERE } from './lib-v2.mjs';

const model = readJSON(path.join(HERE, 'course-model.json'));
const cover = readJSON(path.join(HERE, 'tree-cover.json'));
const coverBytes = Buffer.from(cover.b64, 'base64');
const coverAt = (x, z) => {
  const i = Math.floor((x - cover.x0) / cover.cell), j = Math.floor((z - cover.z0) / cover.cell);
  if (i < 0 || j < 0 || i >= cover.nx || j >= cover.nz) return 0;
  const k = j * cover.nx + i;
  return (coverBytes[k >> 2] >> ((k & 3) * 2)) & 3;   /* 2 open, 3 trees */
};

const STEP = 7;
const holes = Object.fromEntries(model.holes.map(h => [h.n, h]));
const polyLen = line => { let l = 0; for (let i = 1; i < line.length; i++) l += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]); return l; };
/* point and unit direction at distance s along a polyline */
function along(line, s) {
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + l >= s || i === line.length - 1) {
      const t = Math.min(1, Math.max(0, (s - acc) / l));
      return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx: (b[0] - a[0]) / l, dz: (b[1] - a[1]) / l };
    }
    acc += l;
  }
  return null;
}
const sideNormal = (p, side) => (side === 'right' ? [-p.dz, p.dx] : [p.dz, -p.dx]);

/* the fairway's half-width on one side at a station: the farthest fairway ring
   vertex within +-12 m along the hole, projected onto the side normal */
function fairwayHalfWidth(hole, p, n) {
  const rings = hole.fairway.rings || [hole.fairway.ring];
  let best = 0;
  for (const ring of rings) for (const q of ring) {
    const vx = q[0] - p.x, vz = q[1] - p.z;
    const alongT = vx * p.dx + vz * p.dz;
    if (Math.abs(alongT) > 12) continue;
    const off = vx * n[0] + vz * n[1];
    if (off > best) best = off;
  }
  return best;
}

function edgeRun({ hole: n, side, from = 0, to = 1, margin = 4, fence = false }) {
  const hole = holes[n];
  const L = polyLen(hole.line);
  const pts = [];
  for (let s = from * L; s <= to * L; s += STEP) {
    const p = along(hole.line, s);
    const nrm = sideNormal(p, side);
    /* never inside 12 m of the centreline: a par 3 has no fairway ring and a
       traced ring can end short of the green, and a stake on the mown line
       would be a placement error, not a rule */
    let off = Math.max(12, fairwayHalfWidth(hole, p, nrm)) + margin;
    if (fence) {
      let found = null;
      for (let d = off + 6; d <= off + 60; d += 3) {
        if (coverAt(p.x + nrm[0] * d, p.z + nrm[1] * d) === 3) { found = d - 3; break; }
      }
      off = found ?? off + 20;
    }
    pts.push([Math.round((p.x + nrm[0] * off) * 10) / 10, Math.round((p.z + nrm[1] * off) * 10) / 10]);
  }
  return pts;
}

function pondRun(w, outside = 2.5) {
  const ring = w.ring;
  const c = [ring.reduce((s, q) => s + q[0], 0) / ring.length, ring.reduce((s, q) => s + q[1], 0) / ring.length];
  const pts = [];
  let carry = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let s = carry; s < l; s += STEP) {
      const t = s / l, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      const ox = x - c[0], oz = z - c[1], ol = Math.hypot(ox, oz) || 1;
      pts.push([Math.round((x + ox / ol * outside) * 10) / 10, Math.round((z + oz / ol * outside) * 10) / 10]);
    }
    carry = (carry - l) % STEP; if (carry < 0) carry += STEP;
  }
  return pts;
}

const runs = [];
/* red: every pond the course plays round -- the 2nd/3rd's, the 4th's two, the
   6th's, the 15th's, the 17th's three, the 18th's two */
for (const w of model.water) {
  if (w.isSea || w.isLake || w.area > 3000) continue;
  const b = bbox(w.ring);
  if (b.x0 < -500 || b.x1 > 500 || b.z0 < -1400 || b.z1 > 800) continue;
  runs.push({ color: 'r', hole: null, rule: 'pond', ref: w.id, pts: pondRun(w) });
}
/* red: the endless penalty area along the whole left of the 17th */
runs.push({ color: 'r', hole: 17, rule: 'edge', side: 'left', pts: edgeRun({ hole: 17, side: 'left', margin: 5 }),
  basis: 'Lokala regler 2026: rött pliktområde längs hela vänstersidan; the 17th\'s three ponds lie on that side' });
/* white: out of bounds and the boar fence */
const fence = (hole, side, from, to, basis) => runs.push({ color: 'w', hole, rule: 'fence', side, pts: edgeRun({ hole, side, from, to, fence: true }), basis });
fence(2, 'right', 0.15, 1.0, 'hole text: se upp för out till höger');
fence(6, 'right', 0.0, 0.95, 'Lokala regler 2026: vildsvinsstängslet är out of bounds till höger om hål 6');
fence(7, 'right', 0.0, 0.95, 'Lokala regler 2026: vildsvinsstängslet är out of bounds till höger om hål 7');
fence(16, 'left', 0.0, 0.55, 'hole text: out of bounds till vänster om tee och fairway; white stakes shared with the 15th');
fence(16, 'right', 0.45, 0.95, 'Lokala regler 2026: vildsvinsstängslet är out of bounds till höger om hål 16');
fence(17, 'right', 0.0, 0.95, 'Lokala regler 2026: vildsvinsstängslet är out of bounds till höger om hål 17');
fence(15, 'left', 0.0, 0.9, 'Lokala regler 2026: white-stake out of bounds shared by the 15th and 16th');
/* the black-and-white internal stakes between the 5th and the 6th: OB from the
   5th, immovable obstructions from the 6th; the nearest colour the engine has */
runs.push({ color: 'w', hole: 5, rule: 'edge', side: 'left', pts: edgeRun({ hole: 5, side: 'left', from: 0.1, to: 0.85, margin: 8 }),
  basis: 'Lokala regler 2026: vit-svarta pinnar mot hål 6 är out of bounds från hål 5 (oflyttbara hindrande föremål från hål 6)' });

const out = {
  source: 'Ängsö GK Lokala regler 2026 and the club\'s hole texts (guide-notes.json) for WHICH sides are marked and in what colour; positions by the rules stated in build-marking.mjs -- pond margins from the model\'s own rings, fairway edges from the traced fairways, the fence and property line at the satellite tree-cover raster\'s woodland edge. No stake here is surveyed.',
  stakeSpacingMetres: STEP,
  runs,
};
writeJSON(path.join(HERE, 'marking.json'), out);
const byColor = {};
for (const r of runs) byColor[r.color] = (byColor[r.color] || 0) + r.pts.length;
console.log(`marking: ${runs.length} runs, stakes ${Object.entries(byColor).map(([c, n]) => `${c} ${n}`).join(', ')}`);
for (const r of runs) console.log(`  ${r.color} ${String(r.rule).padEnd(5)} ${r.hole ? 'hole ' + String(r.hole).padStart(2) : (r.ref || '').padEnd(7)} ${r.side || ''} ${r.pts.length} stakes`);
