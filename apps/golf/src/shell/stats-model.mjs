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
import { roundTotals, hitGreen, puttCoverage } from '../map/map-score.mjs';

const DAY_MS = 86400000;
const FULL = 18;
const HALF_ROUND = 9;
/* The newest rounds against the ones before them, as map-rounds.mjs roundTrend. */
export const RECENT_ROUNDS = 5;
/* A gap in the bag worth a word: as the bag editor's own notes (ui/bag-editor.mjs). */
const WIDE_GAP_METRES = 25, NARROW_GAP_METRES = 5;

export const PERIODS = Object.freeze([
  { key: 'all', label: 'Allt', days: null },
  { key: 'season', label: 'I år', season: true },
  { key: 'last5', label: 'Senaste 5', count: 5 },
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

/* The share printed inside a block takes whichever ink reads better on its
   colour: white on the deep blues and reds and on the par grey, near-black on
   the mid birdie blue and bogey orange, where white fell to 3:1 (WCAG wants 4.5). */
const luminance = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const inkOn = hex => {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return '#ffffff';
  const l = luminance(hex);
  return (1.05 / (l + 0.05)) >= ((l + 0.05) / (luminance('#06140c') + 0.05)) ? '#ffffff' : '#06140c';
};

const sum = values => values.reduce((total, value) => total + value, 0);
const mean = values => (values.length ? sum(values) / values.length : null);
const share = (part, whole) => (whole ? part / whole : null);

export const roundTime = record => {
  const day = Date.parse(record.date);
  return Number.isFinite(day) ? day : Number(record.endedAt) || 0;
};
export const playedHoles = record => (record.holes || []).filter(hole => !hole.picked && Number.isFinite(hole.strokes))
  .map(hole => Number.isFinite(hole.par) ? hole : { ...hole, par: record.pars?.[hole.n - 1] });
export const scoreToPar = holes => holes.length && holes.every(hole => Number.isFinite(hole.par))
  ? sum(holes.map(hole => hole.strokes - hole.par)) : null;
const scaledToEighteen = (toPar, count) => toPar !== null && count >= HALF_ROUND ? toPar / count * FULL : null;
export function perEighteen(record) {
  const played = playedHoles(record);
  return scaledToEighteen(scoreToPar(played), played.length);
}

/* The rounds a view is about, oldest first. */
function selectActivity(rounds, { period = 'all', course = 'all', now = Date.now() } = {}) {
  const spec = PERIODS.find(p => p.key === period) || PERIODS[0];
  const currentYear = new Date(now).getUTCFullYear();
  let list = rounds
    .filter(record => course === 'all' || record.course === course)
    .filter(record => {
      if (spec.season) return new Date(roundTime(record)).getUTCFullYear() === currentYear;
      if (spec.days !== null && spec.days !== undefined) return now - roundTime(record) <= spec.days * DAY_MS;
      return true;
    })
    .sort((a, b) => roundTime(a) - roundTime(b) || (a.endedAt ?? 0) - (b.endedAt ?? 0));
  if (spec.count) list = list.slice(-spec.count);
  return list;
}

const roundKey = (course, id) => `${course}|${id}`;

export function selectRounds(rounds, filter) {
  return selectActivity(rounds.filter(record => playedHoles(record).length), filter);
}

/* A logged round can have no saved scorecard yet. Group those shots before
   applying "Senaste 5" so every view refers to the same five sessions. */
function activityInView(rounds, shots, filter, now) {
  const activity = new Map(rounds.map(record => [roundKey(record.course, record.id), record]));
  const latestShot = new Map();
  for (const shot of shots) {
    if (!shot.course || shot.round == null) continue;
    const key = roundKey(shot.course, shot.round);
    if (!activity.has(key) && (!latestShot.has(key) || shot.at > latestShot.get(key).at)) latestShot.set(key, shot);
  }
  for (const [key, shot] of latestShot) {
    activity.set(key, { id: shot.round, course: shot.course, endedAt: shot.at });
  }
  return selectActivity([...activity.values()], { ...filter, now });
}

function scoreRow(record, index) {
  const played = playedHoles(record);
  const toPar = scoreToPar(played);
  return {
    id: record.id, course: record.course, courseName: record.courseName, date: record.date, at: roundTime(record),
    strokes: sum(played.map(hole => hole.strokes)), toPar,
    // Keep the actual score for short cards. A single bogey should not enter
    // round averages or trend charts as an estimated +18.
    perEighteen: scaledToEighteen(toPar, played.length),
    holes: played.length, of: record.holeCount ?? record.pars?.length ?? played.length,
    singleHole: played.length === 1 ? played[0] : null,
    points: Number.isFinite(record.totals?.points) ? record.totals.points : null, putts: puttCoverage(played),
    rolling: null, rollingPoints: null, index,
  };
}

const bestRound = rows => rows.filter(row => Number.isFinite(row.perEighteen)).reduce((best, row) =>
  (!best || row.perEighteen < best.perEighteen || (row.perEighteen === best.perEighteen && row.holes > best.holes)) ? row : best, null);


/* The course sheet and full dashboard rank the same scorecards. */
export const bestScorecard = records => bestRound(records.map(scoreRow));

function sliceMetrics(records) {
  const holes = records.flatMap(playedHoles);
  const fw = holes.filter(h => h.par >= 4 && h.fairway);
  const pt = holes.filter(h => Number.isFinite(h.putts));
  const gir = pt.filter(h => Number.isFinite(h.par));
  const pts = records.map(r => r.totals?.points).filter(Number.isFinite);
  return {
    fairways: fw.length >= 6 ? fw.filter(h => h.fairway === 'hit').length / fw.length : null,
    greens: gir.length >= 9 ? gir.filter(h => hitGreen(h, h.par)).length / gir.length : null,
    putts: pt.length >= 9 ? mean(pt.map(h => h.putts)) : null,
    points: pts.length ? mean(pts) : null,
  };
}

/* Everything the page shows, for one filter. */
export function playerStats({ rounds = [], shots = [], bag = [], courses: catalogue = [], filter = {}, now = Date.now() } = {}) {
  const activity = activityInView(rounds, shots, filter, now);
  const keys = new Set(activity.map(record => roundKey(record.course, record.id)));
  const saved = activity.filter(record => Array.isArray(record.holes));
  const list = saved.filter(record => playedHoles(record).length);
  const narrowed = (filter.period && filter.period !== 'all') || (filter.course && filter.course !== 'all');
  const own = narrowed ? shots.filter(shot => keys.has(roundKey(shot.course, shot.round))) : shots;
  const shotsByRound = new Map();
  for (const shot of own) {
    const key = roundKey(shot.course, shot.round);
    if (!shotsByRound.has(key)) shotsByRound.set(key, []);
    shotsByRound.get(key).push(shot);
  }
  const sessions = activity.map(record => ({ record, shots: shotsByRound.get(roundKey(record.course, record.id)) || [], saved: Array.isArray(record.holes) }));
  const history = sessions.filter(session => session.saved);
  const holes = list.flatMap(record => playedHoles(record).map(hole => ({ ...hole, record })));

  const trend = list.map(scoreRow);
  const comparable = trend.filter(row => Number.isFinite(row.perEighteen));
  /* Compare the same qualifying rounds on the line, in the rolling average
     and in the summary, even if short practice cards occur between them. */
  for (let i = 0; i < comparable.length; i++) {
    const window = comparable.slice(Math.max(0, i - RECENT_ROUNDS + 1), i + 1);
    const vals = window.map(row => row.perEighteen).filter(Number.isFinite);
    const pts = window.map(row => row.points).filter(Number.isFinite);
    comparable[i].rolling = mean(vals);
    comparable[i].rollingPoints = mean(pts);
  }

  const averages = comparable.map(row => row.perEighteen);
  const recent = averages.slice(-RECENT_ROUNDS), before = averages.slice(0, -RECENT_ROUNDS);

  /* Recent-5 vs earlier deltas for each KPI tile. */
  let tileDeltas = { fairways: null, greens: null, putts: null, points: null };
  if (list.length > RECENT_ROUNDS) {
    const recM = sliceMetrics(list.slice(-RECENT_ROUNDS));
    const befM = sliceMetrics(list.slice(0, -RECENT_ROUNDS));
    const diff = (a, b) => (a !== null && b !== null ? a - b : null);
    tileDeltas = {
      fairways: diff(recM.fairways, befM.fairways),
      greens: diff(recM.greens, befM.greens),
      putts: diff(recM.putts, befM.putts),
      points: diff(recM.points, befM.points),
    };
  }

  /* the best round is a real one: at least nine holes played */
  const best = bestRound(trend);

  /* --------------------------------------------------- tee / greens / putts */
  const fairwayHoles = holes.filter(hole => hole.par >= 4 && hole.fairway);
  const fwHit = fairwayHoles.filter(hole => hole.fairway === 'hit');
  const fwLeft = fairwayHoles.filter(hole => hole.fairway === 'left');
  const fwRight = fairwayHoles.filter(hole => hole.fairway === 'right');
  const fwMiss = fairwayHoles.filter(hole => hole.fairway !== 'hit');
  const fwHitToPar = mean(fwHit.map(h => h.strokes - h.par));
  const fwMissToPar = mean(fwMiss.map(h => h.strokes - h.par));
  const fairways = {
    hit: fwHit.length,
    left: fwLeft.length,
    right: fwRight.length,
    tried: fairwayHoles.length,
    scoring: {
      hit: fwHitToPar,
      left: mean(fwLeft.map(h => h.strokes - h.par)),
      right: mean(fwRight.map(h => h.strokes - h.par)),
      miss: fwMissToPar,
      gain: fwHitToPar !== null && fwMissToPar !== null ? fwMissToPar - fwHitToPar : null,
    },
  };

  const puttHoles = holes.filter(hole => Number.isFinite(hole.putts));
  const girEligible = puttHoles.filter(h => Number.isFinite(h.par));
  const girHoles = girEligible.filter(hole => hitGreen(hole, hole.par));
  const missedGirHoles = girEligible.filter(hole => !hitGreen(hole, hole.par));
  const scrambleSaves = missedGirHoles.filter(hole => hole.strokes <= hole.par).length;
  const greens = {
    hit: girHoles.length,
    tried: girEligible.length,
    scrambling: {
      saved: scrambleSaves,
      opportunities: missedGirHoles.length,
      rate: share(scrambleSaves, missedGirHoles.length),
    },
  };
  const putts = {
    total: puttCoverage(holes).total,
    holes: puttHoles.length,
    perGreen: mean(puttHoles.map(hole => hole.putts)),
    onGir: mean(girHoles.map(hole => hole.putts)),
    onGirHoles: girHoles.length,
    missedGir: mean(missedGirHoles.map(hole => hole.putts)),
    missedGirHoles: missedGirHoles.length,
    one: puttHoles.filter(hole => hole.putts <= 1).length,
    two: puttHoles.filter(hole => hole.putts === 2).length,
    three: puttHoles.filter(hole => hole.putts >= 3).length,
  };

  /* --------------------------------------------------- stroke-cost levers */
  const holesWithPar = holes.filter(h => Number.isFinite(h.par));
  const roundFactor = holesWithPar.length ? FULL / holesWithPar.length : 0;
  const puttFactor = puttHoles.length ? FULL / puttHoles.length : 0;
  const penalties = sum(own.map(shot => shot.penalty || 0));
  const scoredHoleKeys = new Set(holes.map(h => `${roundKey(h.record.course, h.record.id)}|${h.n}`));
  const loggedScoredHoles = new Set();
  let scoredPenalties = 0;
  for (const shot of own) {
    const key = `${roundKey(shot.course, shot.round)}|${shot.hole}`;
    if (scoredHoleKeys.has(key)) {
      loggedScoredHoles.add(key);
      scoredPenalties += shot.penalty || 0;
    }
  }
  const doubleHoles = holesWithPar.filter(h => h.strokes - h.par >= 2);
  const doubleExtra = sum(doubleHoles.map(h => (h.strokes - h.par) - 1));
  const threePuttExtra = sum(puttHoles.map(h => Math.max(0, h.putts - 2)));
  const strokeCosts = {
    doubles: {
      holes: doubleHoles.length,
      extra: doubleExtra,
      perEighteen: holesWithPar.length ? doubleExtra * roundFactor : null,
    },
    threePutts: {
      holes: putts.three,
      extra: threePuttExtra,
      perEighteen: puttHoles.length ? threePuttExtra * puttFactor : null,
    },
    penalties: {
      total: scoredPenalties, holes: loggedScoredHoles.size,
      perEighteen: loggedScoredHoles.size ? FULL * scoredPenalties / loggedScoredHoles.size : null,
    },
  };

  const distribution = SCORE_KINDS.map(kind => ({ key: kind.key, label: kind.label, short: kind.short, colour: kind.colour,
    count: holesWithPar.filter(hole => kind.fits(hole.strokes - hole.par)).length }));
  const byPar = [3, 4, 5].map(par => {
    const these = holes.filter(hole => hole.par === par);
    return { par, holes: these.length, average: mean(these.map(hole => hole.strokes)), toPar: mean(these.map(hole => hole.strokes - par)) };
  });
  const points = trend.map(row => row.points).filter(Number.isFinite);

  /* ------------------------------------------------------------- latest */
  let latest = null;
  if (list.length) {
    const record = list.at(-1);
    const row = trend.at(-1);
    const lh = playedHoles(record);
    const lfw = lh.filter(h => h.par >= 4 && h.fairway);
    const lpt = lh.filter(h => Number.isFinite(h.putts));
    const lGirEligible = lpt.filter(h => Number.isFinite(h.par));
    const lgir = lGirEligible.filter(h => hitGreen(h, h.par));
    const lPuttsPerGreen = mean(lpt.map(h => h.putts));
    latest = {
      record,
      row,
      vsAverage: row.perEighteen != null && averages.length > 1 ? row.perEighteen - mean(averages.slice(0, -1)) : null,
      fairwayRate: share(lfw.filter(h => h.fairway === 'hit').length, lfw.length),
      girRate: share(lgir.length, lGirEligible.length),
      puttsPerGreen: lPuttsPerGreen,
      puttsDiff: lPuttsPerGreen !== null && putts.perGreen !== null ? (lPuttsPerGreen - putts.perGreen) * FULL : null,
      birdies: lh.filter(h => h.strokes - h.par <= -1).length,
      pars: lh.filter(h => h.strokes === h.par).length,
      doubles: lh.filter(h => h.strokes - h.par >= 2).length,
    };
  }

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
  const courseNames = new Map(catalogue.map(c => [c.slug, c.name]));
  for (const record of rounds) if (record.courseName) courseNames.set(record.course, record.courseName);
  const byCourse = new Map();
  for (const { record, shots: logged, saved: kept } of sessions) {
    const slug = record.course;
    if (!byCourse.has(slug)) byCourse.set(slug, { slug, name: courseNames.get(slug) || slug, rounds: 0, shots: 0, rows: [] });
    const course = byCourse.get(slug);
    if (kept) course.rounds += 1;
    course.shots += logged.length;
    course.last = record.date || record.endedAt;
  }
  for (const row of trend) byCourse.get(row.course).rows.push(row);
  const courses = [...byCourse.values()].map(({ rows, ...course }) => ({
    ...course, average: mean(rows.map(row => row.perEighteen).filter(Number.isFinite)), best: bestRound(rows),
  })).sort((a, b) => b.rounds - a.rounds || b.shots - a.shots || a.name.localeCompare(b.name, 'sv'));

  /* ------------------------------------------------------- hole by hole
     Only for one course: a hole's number means nothing across two. */
  const byHoleNumber = filter.course && filter.course !== 'all' ? perHole(list) : null;

  const playedSlugs = new Set([...rounds, ...shots].map(item => item.course).filter(Boolean));
  const stat = {
    byHoleNumber, history, sessions, shotCount: own.length,
    rounds: list.length, holes: holes.length, strokes: sum(holes.map(hole => hole.strokes)),
    average: mean(averages), recent: mean(recent), before: before.length ? mean(before) : null,
    delta: before.length && recent.length ? mean(recent) - mean(before) : null,
    tileDeltas, latest, strokeCosts,
    best, trend, fairways, greens, putts, distribution, byPar,
    points: points.length ? mean(points) : null,
    penalties,
    shotsLogged: own.filter(shot => !isPutt(shot)).length, shotsMeasured: measured.length,
    clubs, gaps, longest: longestShot ? { club: nameOf(longestShot.club), metres: shotLength(longestShot),
      course: courseNames.get(longestShot.course) ?? null } : null,
    courses, playedCourses: [...playedSlugs].map(slug => ({ slug, name: courseNames.get(slug) || slug })),
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
      if (!Number.isFinite(hole.par)) continue;
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
/* a count of strokes said in words ("3,6 slag bättre"): the word carries the sign */
const strokes = value => Math.abs(value).toFixed(1).replace('.', ',');
const percent = value => `${Math.round(value * 100)}\u00a0%`;

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
        text: `${percent(Math.max(right, 1 - right))} av dina ${misses} missade fairways hamnar till ${side}. Sikta lite ${side === 'höger' ? 'vänster' : 'höger'} om mitten.` });
    }
  }
  const pars = byPar.filter(entry => entry.holes >= 6);
  if (pars.length >= 2) {
    const worst = pars.reduce((a, b) => (b.toPar > a.toPar ? b : a));
    const bestPar = pars.reduce((a, b) => (b.toPar < a.toPar ? b : a));
    if (worst.toPar - bestPar.toPar >= 0.3) {
      out.push({ key: 'par', tone: 'note', title: `Par ${worst.par}:orna kostar mest`,
        text: `I snitt ${signed(worst.toPar)} mot par, och ${signed(bestPar.toPar)} på par ${bestPar.par}:orna.` });
    }
  }
  if (putts.holes >= 18 && putts.perGreen !== null) {
    const threes = putts.three / putts.holes;
    out.push(putts.perGreen > 2
      ? { key: 'putt', tone: 'note', title: 'Puttarna är nyckeln', text: `${putts.perGreen.toFixed(2).replace('.', ',')} puttar per green, och treputtar på ${percent(threes)} av de ${putts.holes} förda hålen.` }
      : { key: 'putt', tone: 'good', title: 'Puttningen håller', text: `${putts.perGreen.toFixed(2).replace('.', ',')} puttar per green och högst en putt på ${percent(putts.one / putts.holes)} av de ${putts.holes} förda hålen.` });
  }
  if (stat.delta !== null && Math.abs(stat.delta) >= 1) {
    out.push(stat.delta < 0
      ? { key: 'trend', tone: 'good', title: 'Formen är på väg upp', text: `Dina ${RECENT_ROUNDS} senaste rundor är ${strokes(stat.delta)} slag bättre per 18 hål än rundorna före.` }
      : { key: 'trend', tone: 'note', title: 'Formen har dalat', text: `Dina ${RECENT_ROUNDS} senaste rundor är ${strokes(stat.delta)} slag sämre per 18 hål än rundorna före.` });
  }
  const scramble = greens.scrambling;
  if (scramble && scramble.opportunities >= 15 && scramble.rate !== null) {
    if (scramble.rate >= 0.35) {
      out.push({ key: 'scramble', tone: 'good', title: 'Starkt närspel', text: `Du räddar par på ${percent(scramble.rate)} av hålen där du missar green.` });
    } else if (scramble.rate <= 0.18) {
      out.push({ key: 'scramble', tone: 'note', title: 'Närspelet kan spara slag', text: `Du räddar par på ${percent(scramble.rate)} vid missad green — inspel och chippar ger snabbast utdelning.` });
    }
  }
  if (fairways.scoring?.gain !== null && fairways.scoring?.gain >= 0.35 && fairways.tried >= 18) {
    out.push({ key: 'fwgain', tone: 'note', title: 'Fairwayträff lönar sig', text: `Du är ${strokes(fairways.scoring.gain)} slag bättre per hål när utslaget stannar på fairway.` });
  }
  const wide = stat.gaps.filter(gap => gap.wide).sort((a, b) => b.metres - a.metres)[0];
  if (wide) out.push({ key: 'gap', tone: 'note', title: 'En lucka i bagen', text: `${wide.metres} m mellan ${wide.longer} och ${wide.shorter}, så som du faktiskt slår dem.` });
  if (greens.tried >= 18 && !out.some(entry => entry.key === 'putt')) {
    out.push({ key: 'gir', tone: 'note', title: 'Greener i regulation', text: `${percent(greens.hit / greens.tried)} av greenerna nås med två puttar kvar till par.` });
  }
  if (stat.longest) out.push({ key: 'long', tone: 'good', title: 'Längsta slaget', text: `${stat.longest.club}, ${Math.round(stat.longest.metres)} m${stat.longest.course ? ` på ${stat.longest.course}` : ''}.` });
  if (!out.length && stat.holes && putts.holes < stat.holes) {
    out.push({ key: 'coverage', tone: 'note', title: 'Fyll i puttar efter hålet',
      text: `Puttar är förda på ${putts.holes} av ${stat.holes} hål med score. Antalet behövs för att räkna puttsnitt och träffade greener.` });
  }
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
