/* The measurement behind section 7.3 of docs/shot-tracking-plan-2026-09-23.md:
   how well does GPS dwell ALONE find where the ball was?

   Walks 52 simulated rounds (every course in the manifest x 4 seeds): a minute
   on the tee, the shots down the line with one in seven missed by 35 m, 40 s
   at each ball, two minutes on the green, straight to the next tee, 1.3 m/s,
   a fix every 2 s -- under three GPS error models, the third with the group
   ahead holding the player mid-walk on 30 % of shots. Then runs the prototype
   stop rule and prints recall (tee, ball and green positions found within
   8 m), position error, and the stops that are not a ball (drift, waits).

   A prototype, not an engine: the rule here is what M2 of the plan starts
   from, and recorded field rounds decide its final numbers.

   usage: node tools/sim-stop-detector.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPack, inflateStream } from '../packages/course-pack/lib.mjs';
import { pointAlongLine } from '../apps/golf/src/engine/caddie.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/golf/public/courses/index.json'), 'utf8'));

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const polyLength = line => line.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - line[i][0], p[1] - line[i][1]), 0);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const median = pts => {
  const xs = pts.map(p => p[0]).sort((a, b) => a - b), zs = pts.map(p => p[1]).sort((a, b) => a - b);
  const m = Math.floor(xs.length / 2);
  return [xs[m], zs[m]];
};

/* a round: fixes, the true tee/ball/green positions, and the mid-walk waits */
function simulateRound(course, seed, { phi, waitShare }) {
  const holes = JSON.parse(inflateStream(readPack(fs.readFileSync(
    path.join(ROOT, 'apps/golf/public', course.packUrl))).sv).toString('utf8')).holes;
  const r = rng(seed);
  const gauss = () => { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
  const sigma = 4, innov = sigma * Math.sqrt(1 - phi * phi);
  let t = 0, pos = null, bias = [gauss() * sigma, gauss() * sigma];
  const fixes = [], truth = [], waits = [];
  const fix = () => {
    bias = [bias[0] * phi + gauss() * innov, bias[1] * phi + gauss() * innov];
    fixes.push({ t, p: [pos[0] + bias[0], pos[1] + bias[1]] });
    t += 2;
  };
  const walk = to => {
    const from = [...pos], steps = Math.max(1, Math.ceil(dist(from, to) / 2.6));
    for (let k = 1; k <= steps; k++) { pos = [from[0] + (to[0] - from[0]) * k / steps, from[1] + (to[1] - from[1]) * k / steps]; fix(); }
  };
  const dwell = (seconds, jitter = 1.5) => {
    const c = [...pos];
    for (let s = 0; s < seconds; s += 2) { pos = [c[0] + gauss() * jitter, c[1] + gauss() * jitter]; fix(); }
    pos = c;
  };
  holes.forEach((h, i) => {
    const mark = h.tees.marks[Math.min(course.tees.def ?? 0, h.tees.marks.length - 1)].c;
    if (i === 0) pos = [...mark]; else walk(mark);
    truth.push([...mark]); dwell(60);
    const L = polyLength(h.line);
    const shots = h.par <= 3 ? [] : h.par === 4 ? [Math.min(230, L - 90)] : [Math.min(235, L - 250), Math.min(420, L - 100)];
    for (const d0 of shots) {
      const d = Math.max(60, d0), on = pointAlongLine(h.line, d);
      const a = pointAlongLine(h.line, Math.max(0, d - 2)), b = pointAlongLine(h.line, d + 2);
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, miss = r() < 0.15 ? gauss() * 35 : gauss() * 12;
      const ball = [on[0] - (b[1] - a[1]) / l * miss, on[1] + (b[0] - a[0]) / l * miss];
      if (r() < waitShare) {
        const mid = [(pos[0] + ball[0]) / 2, (pos[1] + ball[1]) / 2];
        walk(mid); waits.push(mid); dwell(30 + r() * 60);
      }
      walk(ball); truth.push(ball); dwell(40);
    }
    const green = [h.green.c[0] + gauss() * 4, h.green.c[1] + gauss() * 4];
    walk(green); truth.push(green); dwell(120, 4);
  });
  return { fixes, truth, waits, holes: holes.length };
}

/* the prototype rule of the plan's 7.3 */
export function detectStops(fixes, { windowS = 16, radius = 8, share = 0.8, drift = 5, join = 12, minS = 16, gapS = 30 } = {}) {
  const stops = [];
  let cur = null;
  for (let i = 0; i < fixes.length; i++) {
    const f = fixes[i], w = [];
    for (let k = i; k >= 0 && f.t - fixes[k].t <= windowS; k--) w.push(fixes[k].p);
    let still = false, m = null;
    if (w.length >= 5) {
      m = median(w);
      const half = Math.floor(w.length / 2);
      still = w.filter(p => dist(p, m) <= radius).length / w.length >= share &&
        dist(median(w.slice(0, half)), median(w.slice(half))) < drift;
    }
    if (still) {
      if (cur && dist(m, cur.p) < join) { cur.pts.push(f.p); cur.t1 = f.t; cur.p = median(cur.pts); }
      else { if (cur) stops.push(cur); cur = { pts: [...w], p: m, t0: f.t - windowS, t1: f.t }; }
    } else if (cur) { stops.push(cur); cur = null; }
  }
  if (cur) stops.push(cur);
  const merged = [];
  for (const s of stops.filter(x => x.t1 - x.t0 >= minS)) {
    const last = merged.at(-1);
    if (last && dist(last.p, s.p) < join && s.t0 - last.t1 < gapS) { last.pts.push(...s.pts); last.p = median(last.pts); last.t1 = s.t1; }
    else merged.push({ ...s, pts: [...s.pts] });
  }
  return merged.map(({ p, t0, t1 }) => ({ p, t0, t1 }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [label, phi, waitShare] of [['4 m, white', 0, 0], ['4 m, drifting', 0.82, 0], ['drifting + waits', 0.82, 0.3]]) {
    let found = 0, total = 0, other = 0, holes = 0, waitStops = 0, waitCount = 0;
    const errors = [];
    for (const course of MANIFEST.courses) for (let s = 1; s <= 4; s++) {
      const round = simulateRound(course, s * 7919, { phi, waitShare });
      const stops = detectStops(round.fixes), used = new Set();
      for (const p of round.truth) {
        total++;
        let best = -1, bestD = 8;
        stops.forEach((st, i) => { const dd = dist(st.p, p); if (!used.has(i) && dd < bestD) { bestD = dd; best = i; } });
        if (best >= 0) { used.add(best); found++; errors.push(bestD); }
      }
      for (const w of round.waits) {
        waitCount++;
        stops.forEach((st, i) => { if (!used.has(i) && dist(st.p, w) < 10) { used.add(i); waitStops++; } });
      }
      other += stops.length - used.size;
      holes += round.holes;
    }
    errors.sort((a, b) => a - b);
    console.log(`${label.padEnd(18)} recovered ${(found / total * 100).toFixed(1)}%  error median ${errors[Math.floor(errors.length / 2)].toFixed(1)} m` +
      ` p90 ${errors[Math.floor(errors.length * 0.9)].toFixed(1)} m  other stops/hole ${((other + waitStops) / holes).toFixed(2)}` +
      (waitCount ? ` (of which waits ${(waitStops / holes).toFixed(2)})` : ''));
  }
}
