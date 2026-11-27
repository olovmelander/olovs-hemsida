#!/usr/bin/env node
/* Ängsö's tee decisions (pipeline v2, 27 November 2026): which deck each colour stands on, and where on it.

   node angsobuild/mapping/make-tee-decisions.mjs            write tee-decisions.json and print every mark against the card
   node angsobuild/mapping/make-tee-decisions.mjs --check    fail when tee-decisions.json is not what this writes

   The review of 9 September (tee-placement-front9/back9.json) matched the club's schematic to the decks on the
   24 April 2025 photo, left six colours unresolved, and put each colour at a "representative" point on its deck.
   Measured against the card the way the shared tracer measures (straight to the first bend 25 m ahead, then along
   the hole line), 42 of the 90 marks stood more than 5 m from their card length; four were on the wrong deck or
   on none. The judgement is the table below: the deck each colour stands on, where it differs from September's,
   with what showed it (the card, the four photo years of angsobuild/run-ortho-intake.mjs, the laser). The rule
   for where on a deck is the one Tjusta's tracer uses: the point on the colour's own deck where its card length
   falls, at least 0.8 m in from the edge, and 3 m clear of another colour on the same deck; a fairway tee (no
   deck) stands on the hole's reviewed fairway at its card length, 2 m in from the fairway's edge. A deck too
   short for its card leaves the mark at the deck's end, and the walkthrough lists the rest. Decks never move. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { latLonToSweref99Tm } from '../../packages/course-geo/chmv2/projection.mjs';
import { ORIGIN, M_PER_LAT, M_PER_LON, pointInPoly } from '../lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'tee-decisions.json');
const STORED_M_PER_LON = Math.round(M_PER_LON * 100) / 100;
const DECIDED_ON = '2026-11-27';
const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/* ------------------------------------------------------------------ the judgement */

/** Holes whose marks stay as September placed them, and why. */
const KEEP = {
  5: 'Every colour on hole 5, decks and fairway alike, reads 11 to 16 m longer than its card. The decks stand in the card\'s order and each holds one colour, so the tees are not what is long: the drawn hole line (five legs round the dogleg) is longer than the line the club measured. Moving the marks forward would put them off their decks; the line is the fault, and the walkthrough keeps it.',
  14: 'Every colour on hole 14 reads 15 to 20 m longer than its card. The three decks stand in the card\'s order (Vit/Gul, Blå, Röd) on all four photo years; the drawn line turns the dogleg square (177 m south, then two bends), where the club\'s line cuts the corner. The tees stand; the line is the fault, and the walkthrough keeps it.',
};
/** Colours left unresolved, as September left them, and why they still are. */
const UNRESOLVED = {
  '8:Vit': 'Under the conifer canopy north of deck 1 on all four photo years; no deck shows, and the laser was not read for a platform there tonight.',
  '8:Gul': 'Under the conifer canopy north of deck 1 on all four photo years; no deck shows, and the laser was not read for a platform there tonight.',
  '9:Vit': 'No deck shows 143 m out on any photo year: the reviewed deck 1 ends at 137 m, and the ground behind it is under crowns.',
};
/** Colours that stand on another deck than September's (1-based deck numbers in the model's order), or on the fairway. */
const MOVE = {
  '1:Vit': { deck: 1, confidence: 'high', identity: 'card-and-photo-years',
    why: 'Hole 1 was lengthened between the 2020 and 2023 cards (Vit 355 to 386), after the club\'s 2021 plan to move the back tees. Deck 1, the isolated deck at the north-east spur, is forest on the 2019 photo, felled ground on 2021-04-14, and a mown deck with its own path on 2023-05-11 and 2025-04-24; it is the only ground 386 m out (379-394 m). The laser of 2021-03-20 shows it not level (4.4%, 0.22 m off a plane): built after the flight. September\'s candidate was this deck; the card settles the colour.' },
  '1:Gul': { deck: 2, confidence: 'high', identity: 'card-and-photo-years',
    why: 'The long strip east of the path (deck 2) reaches 328-348 m: its north end is Gul\'s 350 m and its south end Blå\'s 319, 31 m apart on the card and 30 m along the strip. September left Gul on the path, where no deck is.' },
  '1:Blå': { deck: 2, confidence: 'medium', identity: 'card-and-photo-years',
    why: 'The south end of deck 2, the strip that holds Gul at its north end. The card puts Blå 9 m further forward than the strip reaches; deck 3 (Röd, 262-275 m) is 50 m on.' },
  '8:Blå': { deck: 2, confidence: 'medium', identity: 'card-and-photo-years',
    why: 'Two small decks stand 10 m apart before the path crossing: deck 2 reaches 289-296 m and deck 1 299-306 m. Blå\'s card is 285 m, which deck 2 fits (4 m) and deck 1 does not (14 m). September read the schematic\'s intermediate oval as unmarked; the card says it is the blue tee.' },
  '10:Blå': { deck: 1, confidence: 'high', identity: 'card-and-photo-years',
    why: 'Deck 1, the small deck east of the line 90 m up the hole, reaches 433-445 m: Blå\'s card is 438 m. September put Röd on it (386 m, 53 m off) and left Blå unresolved as a point on the line beside it.' },
  '10:Röd': { surface: 'fairway', confidence: 'medium', identity: 'card-and-photo-years',
    why: 'No deck shows near 386 m on any photo year; the fairway\'s rear lobe begins 30 m behind the card length. Röd stands on the fairway at its card length, as the orange tees do; deck 1 is Blå\'s.' },
};

/* ------------------------------------------------------------------ the measure */

function project(line, p) {
  let best = { gap: Infinity, s: 0 }, cum = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (l * l || 1)));
    const gap = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
    if (gap < best.gap) best = { gap, s: cum + t * l };
    cum += l;
  }
  return best;
}
/** The tracer's remaining(): straight to the first bend at least 25 m ahead, then along the line. */
export function remaining(line, p) {
  const { s } = project(line, p);
  let cum = 0, k = line.length - 1;
  for (let i = 1; i < line.length; i++) { cum += d(line[i], line[i - 1]); if (cum > s + 25 || i === line.length - 1) { k = i; break; } }
  let r = d(line[k], p);
  for (let i = k + 1; i < line.length; i++) r += d(line[i], line[i - 1]);
  return r;
}
function clearance(p, ring) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i], dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz));
  }
  return pointInPoly(...p, ring) ? best : -best;
}
function grid(rings, step, around = null, reach = 0) {
  const pts = rings.flat();
  let x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0]));
  let z0 = Math.min(...pts.map(p => p[1])), z1 = Math.max(...pts.map(p => p[1]));
  if (around) { x0 = Math.max(x0, around[0] - reach); x1 = Math.min(x1, around[0] + reach); z0 = Math.max(z0, around[1] - reach); z1 = Math.min(z1, around[1] + reach); }
  const out = [];
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) for (let z = Math.ceil(z0 / step) * step; z <= z1; z += step) out.push([x, z]);
  return out;
}
/** The point of a deck where the card length falls, clear of its edge and of colours already on it. */
function onDeck(ring, lineOf, card, taken) {
  const pts = grid([ring], 0.25).map(p => ({ p, c: clearance(p, ring) })).filter(q => q.c > 0);
  const inset = Math.min(0.8, Math.max(...pts.map(q => q.c)) * 0.6);
  for (const apart of [3, 1.5, 0.5]) {
    const ok = pts.filter(q => q.c >= inset && taken.every(t => d(t, q.p) >= apart));
    if (!ok.length) continue;
    return ok.map(q => ({ ...q, r: remaining(lineOf(q.p), q.p) })).sort((a, b) => (Math.abs(a.r - card) - 0.05 * a.c) - (Math.abs(b.r - card) - 0.05 * b.c))[0];
  }
  throw new Error('no room on the deck');
}
/** The point of the hole's fairway, 2 m in from its edge and near the line, where the card length falls. */
function onFairway(rings, line, card) {
  let best = null;
  for (const ring of rings) {
    for (const p of grid([ring], 0.5)) {
      const c = clearance(p, ring);
      if (c < 2) continue;
      const off = project(line, p).gap, r = remaining(line, p), score = Math.abs(r - card) + 0.3 * off;
      if (!best || score < best.score) best = { p, c, r, off, score };
    }
  }
  if (!best) throw new Error('no fairway');
  return best;
}
const toEpsg3006 = ([x, z]) => {
  const [easting, northing] = latLonToSweref99Tm(ORIGIN.lat - z / M_PER_LAT, ORIGIN.lon + x / STORED_M_PER_LON);
  return [Math.round(easting * 100) / 100, Math.round(northing * 100) / 100];
};

/* ------------------------------------------------------------------ the decisions */

export function makeDecisions(model) {
  const names = model.card.teeNames, marks = [], table = [];
  for (const hole of model.holes) {
    if (KEEP[hole.n]) continue;
    const pads = hole.tees.pads, placed = new Map();
    let line = hole.line;
    hole.tees.marks.forEach((mark, i) => {
      const tee = names[i], key = `${hole.n}:${tee}`, card = hole.t[i];
      if (UNRESOLVED[key]) return;
      const ref = mark.orthophotoReference ?? {}, move = MOVE[key];
      const previousDeck = mark.sourcePadId ?? ref.selectedPadReviewId ?? null;
      const surface = move?.surface ?? (move?.deck ? 'platform' : mark.referenceSurfaceKind === 'fairway' ? 'fairway' : 'platform');
      const deck = surface === 'platform' ? (move?.deck ? pads[move.deck - 1]?.reviewId : previousDeck) : null;
      if (surface === 'platform' && !deck) throw new Error(`H${hole.n} ${tee}: no deck`);
      const lineOf = p => (i === 0 ? [p, ...hole.line.slice(1)] : line);
      let at;
      if (surface === 'platform') {
        const ring = pads.find(p => p.reviewId === deck).ring;
        at = onDeck(ring, lineOf, card, placed.get(deck) ?? []).p;
        placed.set(deck, [...(placed.get(deck) ?? []), at]);
      } else {
        at = onFairway(hole.fairway.rings, line, card).p;
      }
      if (i === 0) line = [at, ...hole.line.slice(1)];
      const measured = remaining(line, at);
      const why = move?.why ?? (surface === 'platform'
        ? `The deck September's review chose from the club's schematic (${ref.evidence?.confidence ?? 'no'} confidence); the mark stands where Ängsö's card length of ${card} m falls on it.`
        : `A fairway tee: no deck, so the mark stands on the hole's reviewed fairway at Ängsö's card length of ${card} m. September's point came from the schematic, which names a tee and does not place it.`);
      marks.push({ hole: hole.n, tee, surface, deck, at: toEpsg3006(at), confidence: move?.confidence ?? (surface === 'fairway' ? 'medium' : ref.evidence?.confidence === 'high' ? 'high' : 'medium'),
        identity: move?.identity ?? 'guide-orthophoto-correspondence', why });
      table.push({ hole: hole.n, tee, card, measured: Math.round(measured * 10) / 10, residual: Math.round((measured - card) * 10) / 10,
        surface, deck: deck ? `deck${pads.findIndex(p => p.reviewId === deck) + 1}` : 'fairway', moved: Math.round(d(at, mark.c) * 10) / 10 });
    });
  }
  return { decisions: { schemaVersion: 1, groundId: 'angso', decidedOn: DECIDED_ON,
    method: 'Pipeline v2: the deck from the evidence (September\'s review, or the card with four photo years and the laser where they disagree), the place on it from the card, measured as the shared tracer measures. Decks never move.',
    sources: { card: 'angsobuild/card.json (Scorekort-2023)', photos: 'angsobuild/run-ortho-intake.mjs: 2025-04-24, 2023-05-11, 2021-04-14, 2019-07-14', laser: 'angsobuild/mapping/trace-config.json terrain (2021-03-20 flight)', looks: 'angsobuild/cache/looks/tees/ (private crops)' },
    kept: KEEP, unresolved: UNRESOLVED, marks }, table };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const model = JSON.parse(fs.readFileSync(path.join(HERE, '../course-model.json'), 'utf8'));
  const { decisions, table } = makeDecisions(model);
  const text = `${JSON.stringify(decisions, null, 1)}\n`;
  if (process.argv.includes('--check')) {
    const same = fs.existsSync(OUT) && fs.readFileSync(OUT, 'utf8') === text;
    if (!same) console.error('angsobuild/mapping/tee-decisions.json is not what make-tee-decisions.mjs writes');
    process.exitCode = same ? 0 : 1;
  } else {
    fs.writeFileSync(OUT, text);
    for (const row of table) console.log([row.hole, row.tee, row.card, row.measured, (row.residual > 0 ? '+' : '') + row.residual, row.deck, `moved ${row.moved} m`].join('\t'));
    console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${decisions.marks.length} marks`);
  }
}
