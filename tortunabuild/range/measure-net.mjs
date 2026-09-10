/* The net is a continuous mesh, so it casts a continuous shadow BAND, not
 * separable post shadows. Sweep stations along the net's chord; from each,
 * start 10 m on the sunlit side and scan along the solar bearing. The run the
 * scanline darkens is the net's height x cot(elevation), and the run's start
 * traces the net's own base line -- so the curve is measured, not assumed.
 * Every scanline is normalised against its own sunlit grass, so a slope or a
 * mowing change along the boundary cannot be read as a taller net. */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { sampleWindow, luminance, toWorld, toPixel, TILE } from './ortho-sample.mjs';
import { SUN, BEARING, dirPixel, CAPTURE, heightFromShadow } from './measure-shadows.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/* Approximate chord, read off the 0.032 m/px review crops; the measurement
 * below recovers the true base line and does not inherit these two points. */
const CHORD = [[597581, 6615334], [597666, 6615286]];
const WIN = { x: 2130, y: 2440, w: 470, h: 350 };
const s = await sampleWindow(WIN);
const at = (i, j) => {
  const x = Math.round(i), y = Math.round(j);
  return x >= 0 && y >= 0 && x < s.w && y < s.h ? luminance(s, x, y) : NaN;
};
const local = ([e, n]) => { const [px, py] = toPixel([e, n]); return [px - WIN.x, py - WIN.y]; };

const A = local(CHORD[0]), B = local(CHORD[1]);
const chordLen = Math.hypot(B[0] - A[0], B[1] - A[1]);
const along = [(B[0] - A[0]) / chordLen, (B[1] - A[1]) / chordLen];
const BACK = 12 / TILE.metresPerPixel, RUN = 40 / TILE.metresPerPixel;

const stations = [];
for (let t = 0; t <= chordLen; t += 0.5 / TILE.metresPerPixel) {
  const ox = A[0] + along[0] * t - dirPixel[0] * BACK, oy = A[1] + along[1] * t - dirPixel[1] * BACK;
  const profile = [];
  for (let u = 0; u < RUN; u++) profile.push(at(ox + dirPixel[0] * u, oy + dirPixel[1] * u));
  if (profile.some(v => !Number.isFinite(v))) continue;
  const sorted = [...profile].sort((a, b) => a - b);
  const bright = sorted[Math.floor(0.9 * (sorted.length - 1))];
  const dark = sorted[Math.floor(0.05 * (sorted.length - 1))];
  if (bright - dark < 10) continue;
  const cut = bright - (bright - dark) * 0.5;
  let bestStart = -1, bestLen = 0, start = -1;
  for (let u = 0; u <= profile.length; u++) {
    const below = u < profile.length && profile[u] < cut;
    if (below) { if (start < 0) start = u; }
    else if (start >= 0) { if (u - start > bestLen) { bestLen = u - start; bestStart = start; } start = -1; }
  }
  if (bestLen < 4) continue;
  const base = [ox + dirPixel[0] * bestStart, oy + dirPixel[1] * bestStart];
  stations.push({
    chordMetres: Math.round(t * TILE.metresPerPixel * 100) / 100,
    epsg3006: toWorld([WIN.x + base[0], WIN.y + base[1]]).map(v => Math.round(v * 100) / 100),
    shadowMetres: Math.round(bestLen * TILE.metresPerPixel * 100) / 100,
    heightMetres: Math.round(heightFromShadow(bestLen * TILE.metresPerPixel, SUN) * 100) / 100,
    contrast: Math.round((bright - dark) * 10) / 10,
    clipped: bestStart + bestLen >= profile.length - 1,
  });
}
const clean = stations.filter(p => !p.clipped);
const heights = clean.map(p => p.heightMetres).sort((a, b) => a - b);
const pick = p => heights[Math.floor(p * (heights.length - 1))];
const median = pick(0.5);
const mad = heights.map(h => Math.abs(h - median)).sort((a, b) => a - b)[Math.floor(heights.length / 2)];
console.log('stations %s   usable %s   clipped %s', stations.length, clean.length, stations.length - clean.length);
console.log('height  p10 %s  median %s  p90 %s   MAD %s',
  pick(.1)?.toFixed(2), median?.toFixed(2), pick(.9)?.toFixed(2), mad?.toFixed(2));
console.log('base line  first %s   last %s', JSON.stringify(clean[0]?.epsg3006), JSON.stringify(clean.at(-1)?.epsg3006));
console.log('contrast  min %s  median %s', Math.min(...clean.map(p => p.contrast)).toFixed(1),
  clean.map(p => p.contrast).sort((a, b) => a - b)[Math.floor(clean.length / 2)].toFixed(1));
writeFileSync(resolve(HERE, '../cache/range/net-band.json'), JSON.stringify({
  capture: CAPTURE, sun: SUN, shadowBearingDeg: BEARING, window: WIN, chordEpsg3006: CHORD,
  method: 'per-scanline shadow band along the solar bearing, normalised to that scanline own sunlit grass',
  medianHeightMetres: median, madMetres: mad, stations,
}, null, 2) + '\n');
