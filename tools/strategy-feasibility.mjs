/* Every number in docs/strategy-and-modes-audit.md, printed from the committed
   course models so the document can quote a tool instead of a scratch script
   (CLAUDE.md, "the committed tool prints them now, so quote the tool").

   It answers four questions about a per-handicap strategy feature:

     targets     how big are the things a strategy engine aims at?
     invert      can the infographic's hit rates be read as dispersion directly?
     forward     does published dispersion reproduce those rates on real ground?
     calibrate   what dispersion does reproduce them, and is it well behaved?
     reach       where is the mown fairway, measured along each hole?
     cost        what does an aim-point search cost?

   Nothing here is a player model we ship. It is a feasibility measurement:
   the geometry is read from committed data, the outcome rates come from the
   handicap infographic the owner supplied, and every assumption that is
   neither of those is named where it is used.

     node tools/strategy-feasibility.mjs [section ...]      (default: all) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pointInPoly, polyArea, polyLen, lcg } from '../geobuild/lib.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url)).replace(/[/\\]tools$/, '');

/* the ten eighteen/nine-hole models with traced play; the second courses share
   their parent's ground and would double-count its geometry */
export const BUILDS = ['geobuild', 'nvgkbuild', 'puttombuild', 'angsobuild', 'upsalabuild',
  'johannesbergbuild', 'ribbingsforsbuild', 'visbybuild', 'lidingobuild', 'tortunabuild'];

/* THE INFOGRAPHIC. Scoring, GIR, fairways and putts from BreakXGolf; strokes
   gained against the PGA Tour from StrokesGain.com; the HCP 30 and 40 columns
   are that source's own estimates, which is why they are round numbers. This
   is a model of PLAYERS and enters nothing that describes a PLACE. */
export const HANDICAP_TABLE = Object.freeze([
  { level: 'Scratch', hcp: 0,  score: 74.6, putts: 31.3, gir: 0.568, fairways: 0.565, girPerRound: 10.2,
    sg: { tee: -1.7, approach: -2.8, short: -1.5, putting: -1.0, total: -7.0 } },
  { level: 'HCP 10',  hcp: 10, score: 84.6, putts: 33.9, gir: 0.373, fairways: 0.493, girPerRound: 6.7,
    sg: { tee: -4.3, approach: -7.0, short: -3.8, putting: -2.5, total: -17.6 } },
  { level: 'HCP 20',  hcp: 20, score: 93.7, putts: 36.1, gir: 0.224, fairways: 0.428, girPerRound: 4.0,
    sg: { tee: -7.1, approach: -11.5, short: -6.0, putting: -4.0, total: -28.6 } },
  { level: 'HCP 30',  hcp: 30, score: 103,  putts: 38,   gir: 0.14,  fairways: 0.40,  girPerRound: 2.5,
    sg: { tee: -11.0, approach: -16.0, short: -8.2, putting: -5.6, total: -40.8 } },
  { level: 'HCP 40',  hcp: 40, score: 113,  putts: 40,   gir: 0.08,  fairways: 0.37,  girPerRound: 1.4,
    sg: { tee: -15.1, approach: -20.5, short: -10.3, putting: -7.0, total: -52.9 } },
]);

/* ASSUMED, and the only quantities here that are neither measured on this
   ground nor taken from the infographic. Carry by handicap and lateral spread
   as a share of carry are the shapes published shot-tracking studies report
   (tour lateral dispersion near 3.5% of carry, mid-handicap play 6-9%). They
   exist so the forward simulation has somewhere to start; `calibrate` then
   solves for the spread the geometry actually requires. */
export const ASSUMED = Object.freeze({
  Scratch: { carry: 230, lateral: 0.035, distance: 0.055 },
  'HCP 10': { carry: 205, lateral: 0.050, distance: 0.065 },
  'HCP 20': { carry: 180, lateral: 0.070, distance: 0.080 },
  'HCP 30': { carry: 160, lateral: 0.090, distance: 0.095 },
  'HCP 40': { carry: 140, lateral: 0.110, distance: 0.110 },
});

const models = BUILDS.map(build => ({ build,
  model: JSON.parse(fs.readFileSync(path.join(ROOT, build, 'course-model.json'), 'utf8')) }));

/* the point d metres along a polyline, with the unit forward vector there */
function along(line, d) {
  let left = d;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (left <= L || i === line.length - 2) {
      const t = L > 0 ? Math.min(1, left / L) : 0;
      return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
               f: L > 0 ? [(b[0] - a[0]) / L, (b[1] - a[1]) / L] : [0, 1] };
    }
    left -= L;
  }
  const a = line.at(-2), b = line.at(-1), L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return { p: [...b], f: [(b[0] - a[0]) / L, (b[1] - a[1]) / L] };
}

/* a hole a drive is actually played on: par 4 or 5, traced fairway, and long
   enough that the carry under test is not already at the green */
const drivingHole = (hole, carry) => hole.par >= 4 && (hole.fairway?.rings || []).length > 0 &&
  (hole.lineLen || hole.t?.[0] || 0) >= carry + 30;

const quantile = (values, q) => {
  const v = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.min(v.length - 1, Math.floor((v.length - 1) * q))] : null;
};
const pct = (v, w = 5) => (100 * v).toFixed(1).padStart(w);

/* ------------------------------------------------------------- targets */
export function targets() {
  const greens = [], widths = [], bunkers = [];
  const perCourse = [];
  for (const { build, model } of models) {
    const g = [], w = [];
    for (const hole of model.holes) {
      const area = hole.green?.ring ? Math.abs(polyArea(hole.green.ring)) : null;
      if (area) { greens.push(area); g.push(area); }
      bunkers.push((hole.bunkers || []).length);
      const len = hole.lineLen || hole.t?.[0] || 0;
      const at = Math.min(210, Math.max(120, len - 110));
      if (!drivingHole(hole, at + 10)) continue;
      const { p, f } = along(hole.line, at);
      const rings = hole.fairway.rings;
      const reach = sign => {
        let out = 0;
        for (let s = 0; s <= 60; s += 0.5) {
          const x = p[0] - f[1] * s * sign, z = p[1] + f[0] * s * sign;
          if (rings.some(r => pointInPoly(x, z, r))) out = s; else if (out > 0) break;
        }
        return out;
      };
      const total = reach(1) + reach(-1);
      if (total > 0) { widths.push(total); w.push(total); }
    }
    perCourse.push({ build, holes: model.holes.length, greenMedian: quantile(g, 0.5), widthMedian: quantile(w, 0.5), widths: w.length });
  }
  return { greens, widths, bunkers, perCourse,
    greenRadius: greens.map(a => Math.sqrt(a / Math.PI)) };
}

/* -------------------------------------------------------------- invert
   The closed form a designer reaches for first: treat "fairway hit" as one
   lateral Gaussian crossing a band of the measured width, and "GIR" as an
   isotropic Gaussian inside a disc of the measured effective radius. */
const erf = x => {                                    // Abramowitz & Stegun 7.1.26
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
};
const bisect = (f, target, lo, hi, steps = 60) => {
  for (let i = 0; i < steps; i++) { const m = (lo + hi) / 2; if (f(m) > target) lo = m; else hi = m; }
  return (lo + hi) / 2;
};
export function invert(geometry) {
  const W = quantile(geometry.widths, 0.5), R = quantile(geometry.greenRadius, 0.5);
  return HANDICAP_TABLE.map(row => ({
    level: row.level,
    lateral: bisect(s => erf((W / 2) / (s * Math.SQRT2)), row.fairways, 0.5, 200),
    approach: bisect(s => 1 - Math.exp(-(R * R) / (2 * s * s)), row.gir, 0.5, 200),
    carry: ASSUMED[row.level].carry,
  }));
}

/* ------------------------------------------------------------- forward
   The same question asked the other way: sample the shot in two dimensions on
   the real hole and see where it finishes. Seeded, so a rerun reproduces. */
export function simulateDrives({ carry, lateral, distance, samples = 300, seed = 20260912 }) {
  const rnd = lcg(seed);
  const gauss = () => {
    const u = Math.max(1e-9, rnd()), v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  let fairway = 0, water = 0, bunker = 0, elsewhere = 0, shots = 0, holes = 0;
  for (const { model } of models) for (const hole of model.holes) {
    if (!drivingHole(hole, carry)) continue;
    holes++;
    const aimAt = Math.min(carry, (hole.lineLen || hole.t[0]) - 60);
    for (let i = 0; i < samples; i++) {
      const { p, f } = along(hole.line, Math.max(20, aimAt + gauss() * distance * carry));
      const off = gauss() * lateral * carry;
      const x = p[0] - f[1] * off, z = p[1] + f[0] * off;
      shots++;
      if (hole.fairway.rings.some(r => pointInPoly(x, z, r))) fairway++;
      else if ((model.water || []).some(w => w.ring && pointInPoly(x, z, w.ring))) water++;
      else if ((hole.bunkers || []).some(b => pointInPoly(x, z, b.ring))) bunker++;
      else elsewhere++;
    }
  }
  return { rate: fairway / shots, water: water / shots, bunker: bunker / shots,
           elsewhere: elsewhere / shots, shots, holes };
}

/* ----------------------------------------------------------- calibrate */
export function calibrate(samples = 300) {
  return HANDICAP_TABLE.map(row => {
    const { carry } = ASSUMED[row.level];
    const lateral = bisect(
      s => simulateDrives({ carry, lateral: s, distance: s * 1.3, samples }).rate,
      row.fairways, 0.01, 0.40, 22);
    const out = simulateDrives({ carry, lateral, distance: lateral * 1.3, samples: samples * 2 });
    return { level: row.level, carry, target: row.fairways, assumed: ASSUMED[row.level].lateral,
             lateral, sigma: lateral * carry, ...out };
  });
}

/* --------------------------------------------------------------- reach */
export function reach() {
  const coverage = [];
  for (const carry of [120, 140, 160, 180, 200, 230, 250]) {
    let on = 0, n = 0;
    for (const { model } of models) for (const hole of model.holes) {
      if (!drivingHole(hole, carry)) continue;
      n++;
      const { p } = along(hole.line, carry);
      if (hole.fairway.rings.some(r => pointInPoly(p[0], p[1], r))) on++;
    }
    coverage.push({ carry, holes: n, onFairway: n ? on / n : null });
  }
  const starts = [], tails = [];
  for (const { model } of models) for (const hole of model.holes) {
    const rings = hole.fairway?.rings || [];
    if (hole.par < 4 || !rings.length) continue;
    const len = hole.lineLen || hole.t?.[0] || 0;
    let first = null, last = null;
    for (let d = 20; d <= len; d += 5) {
      const { p } = along(hole.line, d);
      if (rings.some(r => pointInPoly(p[0], p[1], r))) { if (first === null) first = d; last = d; }
    }
    if (first !== null) { starts.push(first); tails.push(len - last); }
  }
  return { coverage, starts, tails };
}

/* ---------------------------------------------------------------- cost
   An aim search on the heaviest geometry here, with raw ring tests. The engine
   has an O(1) atlas lookup for the same question inside CORE, so this is an
   upper bound on the geometry half of the cost. */
export function cost() {
  const { model } = models.find(m => m.build === 'angsobuild');
  const hole = model.holes.find(h => h.par >= 4 && h.fairway?.rings?.length);
  const water = model.water || [], bunkers = hole.bunkers || [];
  const waterPoints = water.reduce((s, w) => s + (w.ring?.length || 0), 0);
  const runs = [];
  for (const [grid, samples] of [[21, 200], [41, 400], [81, 800]]) {
    const rnd = lcg(7);
    const gauss = () => { const u = Math.max(1e-9, rnd()), v = rnd();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const t0 = performance.now();
    let best = null;
    for (let g = 0; g < grid; g++) {
      const aim = -30 + 60 * g / (grid - 1);
      let fw = 0, wet = 0, sand = 0;
      for (let i = 0; i < samples; i++) {
        const { p, f } = along(hole.line, Math.max(20, 180 + gauss() * 18));
        const off = aim + gauss() * 14;
        const x = p[0] - f[1] * off, z = p[1] + f[0] * off;
        if (hole.fairway.rings.some(r => pointInPoly(x, z, r))) fw++;
        else if (water.some(w => w.ring && pointInPoly(x, z, w.ring))) wet++;
        else if (bunkers.some(b => pointInPoly(x, z, b.ring))) sand++;
      }
      const score = (fw - 2.5 * wet - 0.6 * sand) / samples;   // illustrative weights
      if (!best || score > best.score) best = { aim, score, fairway: fw / samples };
    }
    runs.push({ grid, samples, shots: grid * samples, ms: performance.now() - t0, best });
  }
  return { hole: hole.n, par: hole.par, length: Math.round(hole.lineLen || 0),
           waterRings: water.length, waterPoints, bunkers: bunkers.length, runs };
}

/* ---------------------------------------------------------------- main */
const SECTIONS = {
  targets() {
    const g = targets();
    console.log(`# targets — read from ${g.perCourse.length} committed models, ${g.bunkers.length} holes\n`);
    const line = (label, values, unit) =>
      console.log(`  ${label.padEnd(26)} p10 ${String(quantile(values, 0.1)?.toFixed(1)).padStart(6)}   ` +
        `median ${String(quantile(values, 0.5)?.toFixed(1)).padStart(6)}   p90 ${String(quantile(values, 0.9)?.toFixed(1)).padStart(6)}  ${unit}`);
    line('green area', g.greens, 'm2');
    line('green effective radius', g.greenRadius, 'm');
    line('fairway width at the drive', g.widths, `m  (n=${g.widths.length})`);
    line('bunkers per hole', g.bunkers, '');
    console.log('\n  per course');
    for (const c of g.perCourse)
      console.log(`    ${c.build.padEnd(20)} holes ${String(c.holes).padStart(2)}   ` +
        `green median ${String(Math.round(c.greenMedian)).padStart(4)} m2   ` +
        `fairway median ${c.widthMedian ? c.widthMedian.toFixed(0).padStart(3) : '  —'} m (n=${c.widths})`);
  },
  invert() {
    const g = targets();
    console.log(`# invert — the closed form, against the median target (fairway ` +
      `${quantile(g.widths, 0.5).toFixed(1)} m, green r ${quantile(g.greenRadius, 0.5).toFixed(1)} m)\n`);
    console.log('  level      fairway%   implied lateral sigma      GIR%   implied approach sigma   share of carry');
    for (const row of invert(g)) {
      const t = HANDICAP_TABLE.find(r => r.level === row.level);
      console.log(`  ${row.level.padEnd(9)} ${pct(t.fairways)}      ${row.lateral.toFixed(1).padStart(6)} m          ` +
        `${pct(t.gir)}       ${row.approach.toFixed(1).padStart(6)} m           ${pct(row.lateral / row.carry)}%`);
    }
    console.log('\n  published shot tracking puts tour lateral dispersion near 3.5% of carry');
    console.log('  and mid-handicap play at 6-9%. Every row above is wider than that.');
  },
  forward() {
    console.log('# forward — published dispersion, simulated in two dimensions on real holes\n');
    console.log('  level      simulated   table    diff    water%  bunker%  other%   holes  shots');
    for (const row of HANDICAP_TABLE) {
      const a = ASSUMED[row.level];
      const out = simulateDrives({ carry: a.carry, lateral: a.lateral, distance: a.distance });
      console.log(`  ${row.level.padEnd(9)} ${pct(out.rate, 8)}%  ${pct(row.fairways)}%  ` +
        `${(100 * (out.rate - row.fairways)).toFixed(1).padStart(6)}  ${pct(out.water)}   ${pct(out.bunker)}   ` +
        `${pct(out.elsewhere)}   ${String(out.holes).padStart(4)}  ${String(out.shots).padStart(6)}`);
    }
  },
  calibrate() {
    console.log('# calibrate — the lateral spread that reproduces the table on this ground\n');
    console.log('  level      target   assumed   calibrated   ratio    sigma     water%  bunker%  other%   check');
    for (const row of calibrate()) {
      console.log(`  ${row.level.padEnd(9)} ${pct(row.target)}%  ${pct(row.assumed)}%  ${pct(row.lateral, 9)}%  ` +
        `${(row.lateral / row.assumed).toFixed(2).padStart(5)}   ${row.sigma.toFixed(1).padStart(5)} m   ` +
        `${pct(row.water)}   ${pct(row.bunker)}   ${pct(row.elsewhere)}   ${pct(row.rate)}%`);
    }
    console.log('\n  a spread that stops growing with handicap is a structural error, not a');
    console.log('  constant to retune: see the reach section.');
  },
  reach() {
    const r = reach();
    console.log('# reach — where the mown fairway actually is, measured along each hole\n');
    console.log('  carry   holes   centreline on fairway');
    for (const c of r.coverage)
      console.log(`  ${String(c.carry).padStart(4)} m   ${String(c.holes).padStart(4)}   ${pct(c.onFairway)}%`);
    console.log(`\n  fairway starts    p10 ${quantile(r.starts, 0.1)} m   median ${quantile(r.starts, 0.5)} m   ` +
      `p90 ${quantile(r.starts, 0.9)} m from the tee   (n=${r.starts.length})`);
    console.log(`  fairway ends      p10 ${quantile(r.tails, 0.1).toFixed(0)} m   median ${quantile(r.tails, 0.5).toFixed(0)} m   ` +
      `p90 ${quantile(r.tails, 0.9).toFixed(0)} m short of the green`);
  },
  cost() {
    const c = cost();
    console.log(`# cost — aim search on hole ${c.hole} of Ängsö (par ${c.par}, ${c.length} m, ` +
      `${c.waterRings} water rings / ${c.waterPoints} pts, ${c.bunkers} bunkers)\n`);
    console.log('  grid   samples     shots      ms    best aim   fairway');
    for (const run of c.runs)
      console.log(`  ${String(run.grid).padStart(4)}   ${String(run.samples).padStart(7)}   ${String(run.shots).padStart(7)}   ` +
        `${run.ms.toFixed(1).padStart(5)}   ${run.best.aim.toFixed(1).padStart(6)} m   ${pct(run.best.fairway)}%`);
    console.log('\n  raw ring tests. classify() answers the same question from the atlas in');
    console.log('  O(1) inside CORE, so the engine pays less than this.');
  },
};

const wanted = process.argv.slice(2).filter(a => !a.startsWith('-'));
const run = wanted.length ? wanted : Object.keys(SECTIONS);
for (const name of run) {
  if (!SECTIONS[name]) { console.error(`unknown section: ${name} (have ${Object.keys(SECTIONS).join(', ')})`); process.exitCode = 1; continue; }
  SECTIONS[name]();
  console.log('');
}
