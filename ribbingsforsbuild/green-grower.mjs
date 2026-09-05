/* The green grower: the collar-bounded mown patch around a surveyed green
   centre, read off an orthoimage. Split out of trace-surfaces.mjs so the same
   rule can be run against a second, dated image (wayback-greens.mjs) and the
   two readings compared — a green traced in one image and reproduced in
   another, years apart, is measured, not eyeballed. */
import { gridOver, labelComponents, open, close, fillHoles, outerRing, simplifyRing, polygonArea, centroid } from './raster-shapes.mjs';
import { excessGreen, brightness } from './imagery.mjs';
import { planeResidualAt } from './laser-lib.mjs';
import { r1 } from '../geobuild/lib.mjs';

export const hull = pts => { pts = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo = [], hi = []; for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); } for (const p of [...pts].reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); } return lo.slice(0, -1).concat(hi.slice(0, -1)); };
const round = ring => ring.map(p => [r1(p[0]), r1(p[1])]);

/* Colour fields around a centre, box-smoothed: the collar is a ring a few
   pixels wide and noise in it is what let the first grower leak through. */
export function colourFields(IMG, c, R, S, smooth) {
  const G = gridOver({ x0: c[0] - R, x1: c[0] + R, z0: c[1] - R, z1: c[1] + R }, S, 0);
  const eg = new Float32Array(G.width * G.height).fill(NaN), br = new Float32Array(G.width * G.height).fill(NaN);
  for (let i = 0; i < eg.length; i++) { const [x, z] = G.centre(i); const p = IMG.rgbAt(x, z); if (p) { eg[i] = excessGreen(p); br[i] = brightness(p); } }
  const box = (src, r) => { if (!r) return src; const out = new Float32Array(src.length); for (let row = 0; row < G.height; row++) for (let col = 0; col < G.width; col++) { let sum = 0, n = 0; for (let dr = -r; dr <= r; dr++) for (let dc = -r; dc <= r; dc++) { const rr = row + dr, cc = col + dc; if (rr < 0 || cc < 0 || rr >= G.height || cc >= G.width) continue; const v = src[rr * G.width + cc]; if (Number.isFinite(v)) { sum += v; n++; } } out[row * G.width + col] = n ? sum / n : NaN; } return out; };
  return { G, eg: box(eg, smooth), br: box(br, smooth) };
}
/* Six readings of the same rule, from loose to tight. A green's approach can
   be as green as its putting surface, so a loose reading leaks down the
   fairway and fails the compactness test; the tightest readings erode the
   green's own edge. The LARGEST result that stays compact is taken. */
export const GREEN_SETS = [
  { id: 'B', egDrop: 22, brCap: 5, smooth: 2, openR: 3 }, { id: 'C', egDrop: 15, brCap: 4, smooth: 2, openR: 3 },
  { id: 'D', egDrop: 18, brCap: 6, smooth: 3, openR: 4 }, { id: 'E', egDrop: 10, brCap: 3, smooth: 2, openR: 4 },
  { id: 'F', egDrop: 12, brCap: 2, smooth: 3, openR: 5 }, { id: 'G', egDrop: 8, brCap: 2, smooth: 2, openR: 4 },
];
export const GREEN_AREA = [180, 800], GREEN_SOLIDITY = 0.85, GREEN_SHIFT = 6;
export function growGreen(IMG, T, c, { egDrop, brCap, smooth, openR }, R = 32, S = 0.5) {
  const { G, eg, br } = colourFields(IMG, c, R, S, smooth);
  let coreE = 0, coreB = 0, n = 0;
  for (let i = 0; i < eg.length; i++) { const [x, z] = G.centre(i); if (Math.hypot(x - c[0], z - c[1]) <= 4 && Number.isFinite(eg[i])) { coreE += eg[i]; coreB += br[i]; n++; } }
  if (!n) return null;
  coreE /= n; coreB /= n;
  const mask = new Uint8Array(eg.length);
  for (let i = 0; i < mask.length; i++) if (eg[i] >= coreE - egDrop && br[i] <= coreB + brCap) mask[i] = 1;
  const opened = open(mask, G.width, G.height, openR);
  const { label } = labelComponents(opened, G.width, G.height);
  const seed = label[G.cellOf(c[0], c[1])];
  if (!seed) return null;
  const member = new Uint8Array(mask.length); for (let i = 0; i < member.length; i++) member[i] = label[i] === seed ? 1 : 0;
  const filled = close(fillHoles(member, G.width, G.height), G.width, G.height, 1);
  const ring0 = outerRing(i => filled[i], G); if (!ring0) return null;
  const ring = round(simplifyRing(ring0, 0.6));
  const area = polygonArea(ring), cen = centroid(ring0);
  let rough = 0, rn = 0; for (let i = 0; i < member.length; i += 4) if (member[i]) { const [x, z] = G.centre(i); const r = planeResidualAt(T, x, z, 1); if (Number.isFinite(r)) { rough += r; rn++; } }
  return { ring, area: Math.round(area), solidity: +(area / polygonArea(hull(ring))).toFixed(3), centroidShift: +Math.hypot(cen[0] - c[0], cen[1] - c[1]).toFixed(1), coreExg: Math.round(coreE), coreBright: Math.round(coreB), laserRoughness: +(rough / (rn || 1)).toFixed(3) };
}

/* the six readings of one centre, and the one the rule accepts */
export function readGreen(IMG, T, c) {
  const readings = GREEN_SETS.map(set => ({ set: set.id, ...(growGreen(IMG, T, c, set) || { ring: null }) }));
  const passing = readings.filter(r => r.ring && r.area >= GREEN_AREA[0] && r.area <= GREEN_AREA[1] && r.solidity >= GREEN_SOLIDITY && r.centroidShift <= GREEN_SHIFT);
  passing.sort((p, q) => q.area - p.area);
  return { readings, chosen: passing[0] || null, summary: readings.map(r => `${r.set}:${r.ring ? `${r.area}/${r.solidity}/${r.centroidShift}` : '-'}`).join(' ') };
}
