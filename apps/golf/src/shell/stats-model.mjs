/* What a player's rounds and shots add up to, for the start menu's Statistik.
   Pure: the page draws, this counts, and the tests hold the counting.

   The sources are the light map's own records (map-rounds.mjs keeps a round
   when it ends, map-shots.mjs every locked shot) and the bag both programs
   share. Nothing here is stored: the page reads the same keys the map writes,
   so a round finished on the course is on this page the moment it is opened.

   Scores are compared per 18 holes, as the map's own trend is, so a nine
   stands beside a full round. A struck hole (picked) counts toward nothing
   here: it has no strokes to say how the hole went. */
import { clubStats, isMeasured, isPutt, LEAST_SHOTS, shotLength } from '../map/map-shots.mjs';
import { roundTotals, hitGreen } from '../map/map-score.mjs';

const DAY_MS = 86400000;
const FULL = 18;
/* The newest rounds against the ones before them, as map-rounds.mjs roundTrend. */
export const RECENT_ROUNDS = 5;
/* A gap in the bag worth a word: as the bag editor's own notes (ui/bag-editor.mjs). */
const WIDE_GAP_METRES = 25, NARROW_GAP_METRES = 5;

export const PERIODS = Object.freeze([
  { key: 'all', label: 'Allt', days: null },
  { key: 'year', label: '12 mån', days: 365 },
  { key: '90', label: '90 dagar', days: 90 },
]);

/* The score of a hole against its par, from the best to the worst. A diverging
   scale: blue under par, a neutral grey at par, orange over -- validated as a
   set against the stats panel's surface (#0f1d16) with the dataviz validator:
   lightness band, CVD and normal-vision separation pass; the grey midpoint is
   neutral on purpose. The darkest steps sit under 3:1, so every chart that uses
   them carries labels and a table. */
export const SCORE_KINDS = Object.freeze([
  { key: 'better', label: 'Eagle eller bättre', short: 'Eagle+', colour: '#285fbd', fits: d => d <= -2 },
  { key: 'birdie', label: 'Birdie', short: 'Birdie', colour: '#5096ea', fits: d => d === -1 },
  { key: 'par', label: 'Par', short: 'Par', colour: '#6b736e', fits: d => d === 0 },
  { key: 'bogey', label: 'Bogey', short: 'Bogey', colour: '#e26a32', fits: d => d === 1 },
  { key: 'double', label: 'Dubbel eller sämre', short: 'Dubbel+', colour: '#a8330f', fits: d => d >= 2 },
].map(Object.freeze));
export const kindOf = (strokes, par) => SCORE_KINDS.find(kind => kind.fits(strokes - par));

const sum = values => values.reduce((total, value) => total + value, 0);
const mean = values => (values.length ? sum(values) / values.length : null);
const share = (part, whole) => (whole ? part / whole : null);

export const roundTime = record => {
  const day = Date.parse(record.date);
  return Number.isFinite(day) ? day : Number(record.endedAt) || 0;
};
export const playedHoles = record => (record.holes || []).filter(hole => !hole.picked && Number.isFinite(hole.strokes));
/* to par, scaled to 18 holes */
export function perEighteen(record) {
  const holes = playedHoles(record);
  if (!holes.length) return null;
  return sum(holes.map(hole => hole.strokes - hole.par)) / holes.length * FULL;
}

/* The rounds a view is about, oldest first. */
export function selectRounds(rounds, { period = 'all', course = 'all', now = Date.now() } = {}) {
  const days = PERIODS.find(p => p.key === period)?.days ?? null;
  return rounds
    .filter(record => playedHoles(record).length > 0)
    .filter(record => course === 'all' || record.course === course)
    .filter(record => days === null || now - roundTime(record) <= days * DAY_MS)
    .sort((a, b) => roundTime(a) - roundTime(b) || (a.endedAt ?? 0) - (b.endedAt ?? 0));
}

const roundKey = (course, id) => `${course}|${id}`;

/* Everything the page shows, for one filter. */
export function playerStats({ rounds = [], shots = [], bag = [], filter = {}, now = Date.now() } = {}) {
  const list = selectRounds(rounds, { ...filter, now });
  const keys = new Set(list.map(record => roundKey(record.course, record.id)));
  const narrowed = (filter.period && filter.period !== 'all') || (filter.course && filter.course !== 'all');
  /* a club's lengths come from every shot of the rounds in view; with no
     filter, from the whole log, the round under way included */
  const own = narrowed ? shots.filter(shot => keys.has(roundKey(shot.course, shot.round))) : shots;
  const holes = list.flatMap(record => playedHoles(record).map(hole => ({ ...hole, record })));

  const trend = list.map(record => {
    const played = playedHoles(record);
    return {
      id: record.id, course: record.course, courseName: record.courseName, date: record.date, at: roundTime(record),
      strokes: sum(played.map(hole => hole.strokes)), toPar: sum(played.map(hole => hole.strokes - hole.par)),
      perEighteen: perEighteen(record), holes: played.length, of: record.holeCount ?? played.length,
      points: record.totals?.points ?? null, putts: sum(played.map(hole => hole.putts ?? 0)),
    };
  });
  const averages = trend.map(row => row.perEighteen).filter(Number.isFinite);
  const recent = averages.slice(-RECENT_ROUNDS), before = averages.slice(0, -RECENT_ROUNDS);

  /* the best round is a real one: at least nine holes played */
  const full = trend.filter(row => row.holes >= 9);
  const best = full.reduce((top, row) => (!top || row.perEighteen < top.perEighteen ? row : top), null);

  const fairwayHoles = holes.filter(hole => hole.par >= 4 && hole.fairway);
  const fairways = {
    hit: fairwayHoles.filter(hole => hole.fairway === 'hit').length,
    left: fairwayHoles.filter(hole => hole.fairway === 'left').length,
    right: fairwayHoles.filter(hole => hole.fairway === 'right').length,
    tried: fairwayHoles.length,
  };
  const puttHoles = holes.filter(hole => Number.isFinite(hole.putts));
  const greens = { hit: puttHoles.filter(hole => hitGreen(hole, hole.par)).length, tried: puttHoles.length };
  const putts = {
    total: sum(puttHoles.map(hole => hole.putts)),
    holes: puttHoles.length,
    perGreen: mean(puttHoles.map(hole => hole.putts)),
    one: puttHoles.filter(hole => hole.putts <= 1).length,
    two: puttHoles.filter(hole => hole.putts === 2).length,
    three: puttHoles.filter(hole => hole.putts >= 3).length,
  };

  const distribution = SCORE_KINDS.map(kind => ({ key: kind.key, label: kind.label, short: kind.short, colour: kind.colour,
    count: holes.filter(hole => kind.fits(hole.strokes - hole.par)).length }));
  const byPar = [3, 4, 5].map(par => {
    const these = holes.filter(hole => hole.par === par);
    return { par, holes: these.length, average: mean(these.map(hole => hole.strokes)), toPar: mean(these.map(hole => hole.strokes - par)) };
  });
  const points = trend.map(row => row.points).filter(Number.isFinite);

  /* ------------------------------------------------------------- clubs */
  const stats = clubStats(own);
  const inBag = new Set(bag.map(club => club.id));
  const clubs = [
    ...bag.map(club => ({ id: club.id, name: club.name, carry: club.carry, putter: !(club.carry > 0), stat: stats.get(club.id) ?? null })),
    /* a club taken out of the bag keeps the lengths it was struck to */
    ...[...stats.keys()].filter(id => !inBag.has(id)).map(id => ({ id, name: id, carry: null, putter: false, stat: stats.get(id) })),
  ];
  const measured = own.filter(isMeasured);
  const longestShot = measured.reduce((top, shot) => (!top || shotLength(shot) > shotLength(top) ? shot : top), null);
  const nameOf = id => clubs.find(club => club.id === id)?.name ?? id;
  const ladder = clubs.filter(club => !club.putter && club.stat?.known).sort((a, b) => b.stat.typical - a.stat.typical);
  const gaps = [];
  for (let i = 1; i < ladder.length; i++) {
    const gap = ladder[i - 1].stat.typical - ladder[i].stat.typical;
    if (gap > WIDE_GAP_METRES || gap < NARROW_GAP_METRES) gaps.push({ longer: ladder[i - 1].name, shorter: ladder[i].name, metres: Math.round(gap), wide: gap > WIDE_GAP_METRES });
  }

  /* ----------------------------------------------------------- courses */
  const byCourse = new Map();
  for (const row of trend) {
    if (!byCourse.has(row.course)) byCourse.set(row.course, []);
    byCourse.get(row.course).push(row);
  }
  const courses = [...byCourse].map(([slug, rows]) => {
    const fullRows = rows.filter(row => row.holes >= 9);
    const top = fullRows.reduce((b, row) => (!b || row.toPar < b.toPar ? row : b), null);
    return {
      slug, name: rows.at(-1).courseName ?? slug, rounds: rows.length,
      average: mean(rows.map(row => row.perEighteen).filter(Number.isFinite)),
      best: top ? { strokes: top.strokes, toPar: top.toPar, holes: top.holes } : null,
      last: rows.at(-1).date,
    };
  }).sort((a, b) => b.rounds - a.rounds || a.name.localeCompare(b.name, 'sv'));

  /* ------------------------------------------------------- hole by hole
     Only for one course: a hole's number means nothing across two. */
  const byHoleNumber = filter.course && filter.course !== 'all' ? perHole(list) : null;

  const stat = {
    byHoleNumber,
    rounds: list.length, holes: holes.length, strokes: sum(holes.map(hole => hole.strokes)),
    average: mean(averages), recent: mean(recent), before: before.length ? mean(before) : null,
    delta: before.length && recent.length ? mean(recent) - mean(before) : null,
    best, trend, fairways, greens, putts, distribution, byPar,
    points: points.length ? mean(points) : null,
    penalties: sum(own.map(shot => shot.penalty || 0)),
    shotsLogged: own.filter(shot => !isPutt(shot)).length, shotsMeasured: measured.length,
    clubs, gaps, longest: longestShot ? { club: nameOf(longestShot.club), metres: shotLength(longestShot),
      course: list.find(record => record.course === longestShot.course && record.id === longestShot.round)?.courseName ?? null } : null,
    courses, playedCourses: [...new Map(rounds.map(record => [record.course, record.courseName ?? record.course]))].map(([slug, name]) => ({ slug, name })),
  };
  stat.insights = insights(stat);
  return stat;
}

/* Each hole of one course across the rounds kept: how it is usually played.
   A hole needs a score in at least one round to be in it. */
export function perHole(rounds) {
  const byNumber = new Map();
  for (const record of rounds) {
    for (const hole of playedHoles(record)) {
      if (!byNumber.has(hole.n)) byNumber.set(hole.n, { n: hole.n, par: hole.par, scores: [], putts: [], fairways: [] });
      const entry = byNumber.get(hole.n);
      entry.scores.push(hole.strokes);
      if (Number.isFinite(hole.putts)) entry.putts.push(hole.putts);
      if (hole.par >= 4 && hole.fairway) entry.fairways.push(hole.fairway);
    }
  }
  return [...byNumber.values()].sort((a, b) => a.n - b.n).map(entry => ({
    n: entry.n,
    par: entry.par,
    rounds: entry.scores.length,
    average: mean(entry.scores),
    toPar: mean(entry.scores) - entry.par,
    best: Math.min(...entry.scores),
    putts: entry.putts.length ? mean(entry.putts) : null,
    fairway: entry.fairways.length ? entry.fairways.filter(side => side === 'hit').length / entry.fairways.length : null,
  }));
}

const signed = (value, digits = 1) => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toFixed(digits).replace('.', ',')}`;
const percent = value => `${Math.round(value * 100)} %`;

/* How the player plays, in words: the few things worth knowing, most telling
   first. Each needs enough holes behind it to mean something. */
export function insights(stat) {
  const out = [];
  const { fairways, byPar, putts, greens } = stat;
  const misses = fairways.left + fairways.right;
  if (misses >= 6) {
    const right = fairways.right / misses;
    if (right >= 0.6 || right <= 0.4) {
      const side = right >= 0.6 ? 'höger' : 'vänster';
      out.push({ key: 'miss', tone: 'note', title: `Utslagen missar till ${side}`,
        text: `${percent(Math.max(right, 1 - right))} av dina missade fairways hamnar till ${side}. Sikta lite ${side === 'höger' ? 'vänster' : 'höger'} om mitten.` });
    }
  }
  const pars = byPar.filter(entry => entry.holes >= 6);
  if (pars.length >= 2) {
    const worst = pars.reduce((a, b) => (b.toPar > a.toPar ? b : a));
    const bestPar = pars.reduce((a, b) => (b.toPar < a.toPar ? b : a));
    if (worst.toPar - bestPar.toPar >= 0.3) {
      out.push({ key: 'par', tone: 'note', title: `Par ${worst.par}:orna kostar mest`,
        text: `${signed(worst.toPar)} slag över par i snitt, mot ${signed(bestPar.toPar)} på par ${bestPar.par}:orna.` });
    }
  }
  if (putts.holes >= 18 && putts.perGreen !== null) {
    const threes = putts.three / putts.holes;
    out.push(putts.perGreen > 2
      ? { key: 'putt', tone: 'note', title: 'Puttarna är nyckeln', text: `${putts.perGreen.toFixed(2).replace('.', ',')} puttar per green, och treputtar på ${percent(threes)} av hålen.` }
      : { key: 'putt', tone: 'good', title: 'Puttningen håller', text: `${putts.perGreen.toFixed(2).replace('.', ',')} puttar per green och enputtar på ${percent(putts.one / putts.holes)} av hålen.` });
  }
  if (stat.delta !== null && Math.abs(stat.delta) >= 1) {
    out.push(stat.delta < 0
      ? { key: 'trend', tone: 'good', title: 'Formen är på väg upp', text: `Dina ${RECENT_ROUNDS} senaste rundor är ${signed(-stat.delta)} slag bättre per 18 hål än rundorna före.` }
      : { key: 'trend', tone: 'note', title: 'Formen har dalat', text: `Dina ${RECENT_ROUNDS} senaste rundor är ${signed(stat.delta)} slag sämre per 18 hål än rundorna före.` });
  }
  const wide = stat.gaps.filter(gap => gap.wide).sort((a, b) => b.metres - a.metres)[0];
  if (wide) out.push({ key: 'gap', tone: 'note', title: 'En lucka i bagen', text: `${wide.metres} m mellan ${wide.longer} och ${wide.shorter}, så som du faktiskt slår dem.` });
  if (greens.tried >= 18 && !out.some(entry => entry.key === 'putt')) {
    out.push({ key: 'gir', tone: 'note', title: 'Greener i regulation', text: `${percent(greens.hit / greens.tried)} av greenerna nås med två puttar kvar till par.` });
  }
  if (stat.longest) out.push({ key: 'long', tone: 'good', title: 'Längsta slaget', text: `${stat.longest.club}, ${Math.round(stat.longest.metres)} m${stat.longest.course ? ` på ${stat.longest.course}` : ''}.` });
  return out.slice(0, 4);
}

/* ------------------------------------------------------------- the example
   What the page looks like once a player has played, for the player who has
   not yet. Deterministic, clearly an example, never stored and never mixed
   with a real record: the page labels it and offers to hide it. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const PAR_PATTERN = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 4, 5];
function parsFor(par, holes) {
  const pars = PAR_PATTERN.slice(0, holes);
  let off = sum(pars) - par;
  for (let i = pars.length - 1; off !== 0 && i >= 0; i--) {
    if (off > 0 && pars[i] === 5) { pars[i] = 4; off--; } else if (off < 0 && pars[i] === 3) { pars[i] = 4; off++; }
  }
  return pars;
}
const pick = (random, weighted) => {
  let r = random() * sum(weighted.map(([, w]) => w));
  for (const [value, w] of weighted) { r -= w; if (r <= 0) return value; }
  return weighted.at(-1)[0];
};

export function exampleData({ courses, bag, now = Date.now(), seed = 7 }) {
  const random = rng(seed);
  const eighteens = courses.filter(c => c.status !== 'mapping' && c.holes === FULL).slice(0, 3);
  const rounds = [], shots = [];
  const clubs = bag.filter(club => club.carry > 0);
  const byId = id => clubs.find(club => club.id === id) || clubs[0];
  const ROUNDS = 16;
  for (let r = 0; r < ROUNDS; r++) {
    const course = eighteens[r % eighteens.length];
    const pars = parsFor(course.par, FULL);
    const day = new Date(now - (ROUNDS - r) * 9.5 * DAY_MS);
    const id = 1000 + r;
    const skill = 1 - r / ROUNDS; /* the example player improves */
    const scores = {};
    const holeList = pars.map((par, i) => ({ n: i + 1, par, index: ((i * 7) % FULL) + 1 }));
    for (const hole of holeList) {
      const over = pick(random, [[-1, 0.08 + 0.05 * (1 - skill)], [0, 0.34 + 0.06 * (1 - skill)], [1, 0.36], [2, 0.14 * skill + 0.05], [3, 0.05 * skill]]);
      const strokes = Math.max(2, hole.par + over);
      const putts = Math.min(strokes - 1, pick(random, [[1, 0.2], [2, 0.62], [3, 0.18 - 0.06 * (1 - skill)]]));
      const fairway = hole.par >= 4 ? pick(random, [['hit', 0.48], ['right', 0.33], ['left', 0.19]]) : null;
      scores[hole.n] = { strokes, putts, fairway, picked: false };
      /* the strokes before the putts, as locked shots with their lengths */
      const strokesToGreen = strokes - putts;
      for (let s = 0; s < strokesToGreen; s++) {
        let club;
        if (s === 0) club = hole.par === 3 ? byId(pick(random, [['iron-7', 3], ['iron-6', 2], ['iron-8', 2], ['hybrid-4', 1]])) : byId(pick(random, [['driver', 6], ['wood-3', 2], ['hybrid-4', 1]]));
        else club = byId(pick(random, [['iron-5', 1], ['iron-6', 2], ['iron-7', 2], ['iron-8', 2], ['iron-9', 2], ['pw', 2], ['gw', 1], ['sw', 2], ['lw', 1], ['wood-5', 1]]));
        const mishit = random() < 0.12;
        const metres = club.carry * (mishit ? 0.55 + random() * 0.25 : 0.93 + random() * 0.12) + (random() - 0.5) * 8;
        shots.push({ course: course.slug, round: id, hole: hole.n, club: club.id, at: day.getTime() + hole.n * 600000 + s,
          from: [0, 0], fromAccuracy: 4, fromLie: s ? 'fairway' : 'tee', to: [Math.round(metres * 10) / 10, 0], toAccuracy: 4, toLie: 'fairway',
          outcome: 'played', penalty: 0, rise: 0, suspect: false });
      }
    }
    const handicap = 18;
    const round = { handicap, scores };
    rounds.push({
      id, course: course.slug, courseName: course.name, date: day.toISOString().slice(0, 10), endedAt: day.getTime() + 4.2 * 3600000,
      tee: null, handicap, holeCount: FULL, pars,
      holes: holeList.map(hole => ({ n: hole.n, par: hole.par, ...scores[hole.n] })),
      totals: roundTotals(round, holeList),
    });
  }
  return { rounds, shots };
}

export const LEAST_CLUB_SHOTS = LEAST_SHOTS;
