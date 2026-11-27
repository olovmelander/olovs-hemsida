#!/usr/bin/env node
/* The record of a look at every traced ring, kept ring by ring, and the rule that says which rings need a
   written verdict.

   node packages/course-geo/mapping/ring-review.mjs --build <build dir>            which rings need a look, and the command that draws them
   node packages/course-geo/mapping/ring-review.mjs --build <build dir> --record --reviewer "<who, on what>" [--redrawn id,id] [--accept id="why" ...]
   node packages/course-geo/mapping/ring-review.mjs --build <build dir> --second <verdicts.json>      a second reviewer's doubts
   node packages/course-geo/mapping/ring-review.mjs --build <build dir> --resolve id="why the ring stands"   answer one of them
   node packages/course-geo/mapping/ring-review.mjs --build <build dir> --fault id="what is wrong, and what will put it right"

   The tracer scores each tee and green by how clearly the photo shows its edge (dPrime). At Bro Hof that score
   sat in trace-report.json while thirteen wrong tee decks went unseen: a score nobody reads is not a gate. So:
   - every ring is looked at on the sheets render-ring-sheets.py draws, and the look is recorded here;
   - a ring under the line (dPrime below 2.2, or kept as it started because the photo gave no edge) needs a
     verdict in words: why it is right although the photo does not show it. A ring a reviewer drew and kept
     as drawn is its own verdict, in decisions.json.
   The score finds the doubtful rings; it did not find them all (four wrong decks scored above the line), which is
   why the whole sheet is looked at and not only its head.

   A LOOK HOLDS FOR A RING UNTIL THAT RING CHANGES. The record keeps, for each ring, where it lay and how large
   it was when it was looked at (ringSignature). A new trace then asks for a look at the rings that are new or
   moved, and at no others. Until 27 November 2026 the record held one hash of the whole outline file, so moving
   one green by 0.9 m voided the look at all 104 of Tjusta's rings, and the second look with every answer given
   to it: the sheets were drawn 14 times there and the blind look taken 7 times. A look that
   has to be repeated whole is recorded without being taken. A look is also of a ring ON A PHOTO: the record
   names the photo the outlines were traced on, and outlines traced again on another are looked at whole.

   A SECOND LOOK. The first look is taken by whoever traced, who sees what they meant to draw. A second reviewer
   who has seen neither the decisions nor the scores looks at the blind sheets (render-ring-sheets.py --blind) and
   names the rings they doubt, each with a reason: { reviewer, reviewedOn, sheets, doubts: { <ring id>: <reason> } }.
   Recorded here, each doubt stays open, and fails the review, until it is answered in one of three ways: the ring
   was redrawn (it then moves, the open doubt on the old line goes, and the ring is listed as not yet seen by the
   second reviewer); a reason says why it stands (--resolve); or the reviewer is right and the ring cannot be put
   right yet, and it is kept as a FAULT with what will put it right (--fault). A fault is not hidden: the ground's
   walkthrough prints every one. An answered doubt stays answered while its ring stays where it was, also when a
   later second look raises it again. What the reviewer could not judge (shade, crowns) is kept beside the doubts.
   A second look is not required of a build; once recorded, it binds. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const RING_SCORE_LINE = 2.2;
/* How far a ring may differ from what was looked at before it needs a new look: its centre or a side of its box
   by 0.3 m (two pixels of the photo), its area or the length of its edge by half a metre, squared for the area,
   or by half a percent. A trace again can shift a ring by a centimetre; a look cannot see that. */
export const LOOK_HOLDS = { movedMetres: 0.3, sizeMetres: 0.5, sizeShare: 0.005 };
const read = file => fs.readFileSync(path.join(ROOT, file));
const json = file => JSON.parse(read(file).toString('utf8'));
const round = value => Math.round(value * 100) / 100;

export const reviewPath = build => `${build}/mapping/ring-review.json`;
/** The record as it is written: a ring's eight numbers on one line, so that a ring that moved is one changed line. */
export function recordText(review) {
  const oneLine = (_, numbers) => `[${numbers.replace(/\n\s+/g, ' ')}]`;
  return `${JSON.stringify(review, null, 1).replace(/\[\n\s+(-?[\d.]+(?:,\n\s+-?[\d.]+)*)\n\s+\]/g, oneLine)}\n`;
}
/** A build's trace report; an older ground's exported outlines (export-model-surfaces.mjs) have none, and so no scores. */
export function traceOf(build) {
  if (fs.existsSync(path.join(ROOT, `${build}/mapping/trace-report.json`))) return json(`${build}/mapping/trace-report.json`);
  const surfaces = json(`${build}/mapping/playing-surfaces.geojson`);
  if (surfaces.status !== 'exported-from-model') throw new Error(`${build}: no trace report, and its outlines are not an export of its model`);
  return { slug: surfaces.slug, rows: [] };
}

/** What a look remembers of one ring: [centre E, centre N, area, edge length, west, south, east, north], in metres. */
export function ringSignature(feature) {
  const g = feature.geometry;
  if (g.type === 'Point') { const [x, y] = g.coordinates; return [x, y, 0, 0, x, y, x, y].map(round); }
  if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') throw new Error(`${feature.id}: a ${g.type} is not a ring`);
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  // reckoned from the first vertex: the coordinates are six and seven digits, their products would lose the metres
  const [ox, oy] = polygons[0][0][0];
  let area = 0, mx = 0, my = 0, edge = 0, west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const rings of polygons) for (const [k, ring] of rings.entries()) {
    let twice = 0, sx = 0, sy = 0;
    for (let i = 0; i < ring.length; i++) {
      const x0 = ring[i][0] - ox, y0 = ring[i][1] - oy, x1 = ring[(i + 1) % ring.length][0] - ox, y1 = ring[(i + 1) % ring.length][1] - oy;
      const cross = x0 * y1 - x1 * y0;
      twice += cross; sx += (x0 + x1) * cross; sy += (y0 + y1) * cross; edge += Math.hypot(x1 - x0, y1 - y0);
      if (k === 0) { west = Math.min(west, ring[i][0]); east = Math.max(east, ring[i][0]); south = Math.min(south, ring[i][1]); north = Math.max(north, ring[i][1]); }
    }
    if (!twice) continue;
    const share = (k === 0 ? 1 : -1) * Math.abs(twice / 2); // a hole takes its area away
    area += share; mx += share * sx / (3 * twice); my += share * sy / (3 * twice);
  }
  if (!(area > 0)) throw new Error(`${feature.id}: a ring without area`);
  return [ox + mx / area, oy + my / area, area, edge, west, south, east, north].map(round);
}

/** Whether a ring is still the ring that was looked at. */
export function lookHolds(seen, now) {
  if (!Array.isArray(seen) || seen.length !== 8) return false;
  const size = i => Math.abs(seen[i] - now[i]) <= Math.max(LOOK_HOLDS.sizeMetres, LOOK_HOLDS.sizeShare * seen[i]);
  return [0, 1, 4, 5, 6, 7].every(i => Math.abs(seen[i] - now[i]) <= LOOK_HOLDS.movedMetres) && size(2) && size(3);
}

/** The photo the outlines were traced on, as a look remembers it; an older ground's exported outlines name none. */
export function photoOf(surfaces) {
  const rasters = surfaces.provenance?.imagerySha256;
  return rasters ? createHash('sha256').update(JSON.stringify(Object.entries(rasters).sort())).digest('hex').slice(0, 16) : null;
}

/** The rings of these outlines that a recorded look has not seen as they are now: new ones, and ones that moved.
 * A look is of a ring on a photo, so outlines traced again on another photo are looked at whole. */
export function ringsToLookAt(surfaces, review) {
  const seen = review && (review.photo ?? null) === photoOf(surfaces) ? review.seen ?? {} : {};
  return surfaces.features.filter(f => !lookHolds(seen[f.id], ringSignature(f))).map(f => f.id);
}
const signatures = surfaces => Object.fromEntries(surfaces.features.map(f => [f.id, ringSignature(f)]).sort(([a], [b]) => (a < b ? -1 : 1)));

/** The tees and greens whose edge the photo did not bear out, by ring id. */
export function ringsUnderTheLine(trace, prefix) {
  return trace.rows.filter(row => (row.kind === 'tee' || row.kind === 'green') && row.kept !== 'as-drawn' && (row.kept || row.dPrime < RING_SCORE_LINE))
    .map(row => ({ id: row.id ?? `${prefix}-${row.kind}-${String(row.hole).padStart(2, '0')}`, kind: row.kind, hole: row.hole, dPrime: row.dPrime, kept: row.kept ?? null }));
}

const prefixOf = surfaces => surfaces.features.find(f => f.properties.kind === 'green').id.replace(/-green-\d+$/, '');

export function ringCounts(surfaces) {
  const counts = {};
  for (const f of surfaces.features) counts[f.properties.kind] = (counts[f.properties.kind] ?? 0) + 1;
  return counts;
}

const listed = ids => `${ids.slice(0, 8).join(', ')}${ids.length > 8 ? `, and ${ids.length - 8} more` : ''}`;

/** Why a review does not hold for these outlines, as a list (empty when it holds). */
export function reviewProblems(build, review, surfaces, trace) {
  const errors = [];
  if (review.schemaVersion !== 2 || review.slug !== trace.slug) errors.push(`${build}: the ring review belongs to another course, or is in the form before 27 November 2026`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(review.reviewedOn ?? '') || typeof review.reviewer !== 'string' || review.reviewer.length < 12) errors.push(`${build}: the ring review needs a date and who looked, on what`);
  const toLook = ringsToLookAt(surfaces, review);
  if ((review.photo ?? null) !== photoOf(surfaces)) errors.push(`${build}: the outlines were traced on another photo than the one they were looked at on (${review.reviewedOn}); look at every ring on it and record it`);
  else if (toLook.length) errors.push(`${build}: ${toLook.length} of ${surfaces.features.length} rings are new or have moved since the look of ${review.reviewedOn} (${listed(toLook)}); look at those and record it`);
  const ids = new Set(surfaces.features.map(f => f.id));
  for (const id of review.redrawn ?? []) if (!ids.has(id)) errors.push(`${build}: redrawn ring ${id} is not in the outlines`);
  const low = ringsUnderTheLine(trace, prefixOf(surfaces));
  for (const ring of low) if (!(typeof review.accepted?.[ring.id] === 'string' && review.accepted[ring.id].length >= 20)) errors.push(`${build}: ${ring.id} is under the line (dPrime ${ring.dPrime}${ring.kept ? `, kept ${ring.kept}` : ''}) and has no verdict`);
  for (const id of Object.keys(review.accepted ?? {})) if (!low.some(ring => ring.id === id)) errors.push(`${build}: the review gives a verdict on ${id}, which is not under the line`);
  errors.push(...secondLookErrors(build, review, ids));
  return errors;
}

/** Why a build's ring review does not hold, as a list (empty when it holds). */
export function reviewErrors(build) {
  if (!fs.existsSync(path.join(ROOT, reviewPath(build)))) return [`${build}: no ring review; draw the sheets, look at them and record it`];
  return reviewProblems(build, json(reviewPath(build)), json(`${build}/mapping/playing-surfaces.geojson`), traceOf(build));
}

/** Why a recorded second look does not hold: one of its doubts is unanswered. */
export function secondLookErrors(build, review, ids) {
  const second = review.second, errors = [];
  if (!second) return errors;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(second.reviewedOn ?? '') || typeof second.reviewer !== 'string' || second.reviewer.length < 12) errors.push(`${build}: the second look needs a date and who looked`);
  for (const [id, doubt] of Object.entries(second.doubts ?? {})) {
    if (!ids.has(id)) errors.push(`${build}: the second look doubts ${id}, which is not in the outlines`);
    else if (![doubt.resolution, doubt.fault].some(said => typeof said === 'string' && said.length >= 20)) errors.push(`${build}: the second look doubts ${id} (${doubt.reason}); redraw it, or answer it with --resolve or --fault`);
    else if (doubt.resolution && doubt.fault) errors.push(`${build}: ${id} both stands and is a fault; it is one or the other`);
  }
  return errors;
}

const answered = doubt => Boolean(doubt && (doubt.resolution || doubt.fault));

/** A second reviewer's verdicts as the record keeps them. Every new doubt is open until it is answered; a doubt
 * that was answered stays answered while its ring is the ring the answer was given for (`unseen` names the others). */
export function secondLook(verdicts, ids, previous = null) {
  const moved = new Set(previous?.unseen ?? []), doubts = {};
  for (const [id, doubt] of Object.entries(previous?.doubts ?? {})) if (ids.has(id) && answered(doubt)) doubts[id] = doubt;
  for (const [id, reason] of Object.entries(verdicts.doubts ?? {})) {
    if (!ids.has(id)) continue; // a ring of another build on the same sheets
    if (typeof reason !== 'string' || reason.length < 10) throw new Error(`the doubt on ${id} needs a reason`);
    // an answer was given for the line that was doubted: on a ring that has moved since, the doubt is a new one
    if (!doubts[id] || moved.has(id)) doubts[id] = { reason, resolution: null, fault: null };
  }
  const kept = Object.entries(previous?.cannotTell ?? {}).filter(([id]) => ids.has(id) && !moved.has(id));
  const cannotTell = Object.fromEntries([...kept, ...Object.entries(verdicts.cannotTell ?? {}).filter(([id]) => ids.has(id))]);
  // nothing is left unseen: the reviewer is given the sheets this tool names, which hold every ring they had not seen
  return { reviewer: verdicts.reviewer, reviewedOn: verdicts.reviewedOn, sheets: verdicts.sheets ?? null, looked: verdicts.looked ?? null, unseen: [], doubts, cannotTell };
}

/** A second look after the first look was taken again: the rings that moved are ones the second reviewer has not
 * seen, an open doubt on one of them went with the line it doubted, and what was said of a ring that is gone goes. */
export function carrySecondLook(second, moved, ids) {
  if (!second) return null;
  const gone = new Set(moved);
  const keep = entries => Object.fromEntries(Object.entries(entries ?? {}).filter(([id, value]) => ids.has(id) && !(gone.has(id) && !answered(value))));
  return { ...second, unseen: [...new Set([...(second.unseen ?? []), ...moved])].filter(id => ids.has(id)).sort(),
    doubts: keep(second.doubts), cannotTell: Object.fromEntries(Object.entries(second.cannotTell ?? {}).filter(([id]) => ids.has(id) && !gone.has(id))) };
}

/** The first look, recorded: every ring of these outlines as it is now. A ring whose look still held keeps what
 * that look saw, and is not measured afresh: or a ring could creep a quarter of a metre a trace, each step under
 * what asks for a look, and be metres from where anyone looked at it. */
export function recordLook(previous, surfaces, trace, { reviewer, reviewedOn, redrawn = null, accept = {} }) {
  const ids = new Set(surfaces.features.map(f => f.id));
  const moved = previous ? ringsToLookAt(surfaces, previous) : [];
  const looked = new Set(previous ? moved : ids);
  const seen = Object.fromEntries(Object.entries(signatures(surfaces)).map(([id, now]) => [id, looked.has(id) ? now : previous.seen[id]]));
  const low = new Set(ringsUnderTheLine(trace, prefixOf(surfaces)).map(ring => ring.id));
  const accepted = { ...(previous?.accepted ?? {}), ...accept };
  const second = carrySecondLook(previous?.second, moved, ids);
  return { schemaVersion: 2, slug: trace.slug, reviewedOn, reviewer, photo: photoOf(surfaces), seen,
    redrawn: (redrawn ?? previous?.redrawn ?? []).filter(id => ids.has(id)),
    accepted: Object.fromEntries(Object.entries(accepted).filter(([id]) => low.has(id)).sort(([a], [b]) => (a < b ? -1 : 1))),
    ...(second ? { second } : {}) };
}

/** A recorded second look in numbers: its doubts that stand answered, and those kept as faults, by ring id. */
export function secondLookSummary(second) {
  if (!second) return null;
  const doubts = Object.entries(second.doubts ?? {});
  return { reviewer: second.reviewer, reviewedOn: second.reviewedOn, doubts: doubts.length, stand: doubts.filter(([, d]) => d.resolution).map(([id]) => id),
    faults: doubts.filter(([, d]) => d.fault).map(([id, d]) => ({ id, fault: d.fault })), open: doubts.filter(([, d]) => !d.resolution && !d.fault).map(([id]) => id),
    cannotTell: Object.keys(second.cannotTell ?? {}).length, unseen: second.unseen ?? [] };
}

/** What a build's looks still owe: the rings the first look has not seen as they are, and those the second has not. */
export function looksOwed(build) {
  const surfaces = json(`${build}/mapping/playing-surfaces.geojson`);
  const review = fs.existsSync(path.join(ROOT, reviewPath(build))) ? json(reviewPath(build)) : null;
  return { ids: surfaces.features.map(f => f.id), first: ringsToLookAt(surfaces, review), second: review?.second ? review.second.unseen ?? [] : null };
}

/** The trace configuration that draws a build's sheets: its own, or its ground's (two routings share one). */
export function sheetConfigOf(build) {
  const own = `${build}/mapping/trace-config.json`;
  if (fs.existsSync(path.join(ROOT, own))) return own;
  for (const dir of fs.readdirSync(ROOT, { withFileTypes: true })) {
    const file = `${dir.name}/mapping/trace-config.json`;
    if (dir.isDirectory() && fs.existsSync(path.join(ROOT, file)) && json(file).courses?.some(course => course.outDir === `${build}/mapping`)) return file;
  }
  return null;
}

/** The older grounds' builds whose published outlines are exported for the looks (export-model-surfaces.mjs). */
export function exportedBuilds() {
  return [...new Set(json('apps/golf/public/courses/index.json').courses.map(c => c.build))].filter(build => {
    const file = path.join(ROOT, `${build}/mapping/playing-surfaces.geojson`);
    return fs.existsSync(file) && !fs.existsSync(path.join(ROOT, `${build}/mapping/trace-report.json`)) && JSON.parse(fs.readFileSync(file, 'utf8')).status === 'exported-from-model';
  });
}

/** The builds traced with the shared tracer, from the published catalogue. */
export function tracedBuilds() {
  return json('apps/golf/public/courses/index.json').courses.map(c => c.build).filter(build => fs.existsSync(path.join(ROOT, `${build}/mapping/trace-report.json`)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), flag = name => { const i = argv.indexOf(`--${name}`); return i < 0 ? null : argv[i + 1]; };
  const build = flag('build');
  if (!build) throw new Error('usage: ring-review.mjs --build <build dir> [--record --reviewer "<who, on what>" [--redrawn id,id] [--accept id="why" ...]]');
  const surfaces = json(`${build}/mapping/playing-surfaces.geojson`), trace = traceOf(build), ids = new Set(surfaces.features.map(f => f.id));
  const stored = () => (fs.existsSync(path.join(ROOT, reviewPath(build))) ? json(reviewPath(build)) : null);
  const write = review => fs.writeFileSync(path.join(ROOT, reviewPath(build)), recordText(review));
  const pairs = name => Object.fromEntries(argv.flatMap((arg, i) => { if (arg !== `--${name}`) return []; const [id, ...said] = argv[i + 1].split('='); return [[id, said.join('=')]]; }));
  if (argv.includes('--record')) {
    write(recordLook(stored(), surfaces, trace, { reviewer: flag('reviewer'), reviewedOn: flag('on') ?? new Date().toISOString().slice(0, 10),
      redrawn: flag('redrawn') === null ? null : flag('redrawn').split(',').filter(Boolean), accept: pairs('accept') }));
  }
  if (flag('second') || flag('resolve') || flag('fault')) {
    const review = stored();
    if (!review) throw new Error(`${build}: record the first look before a second`);
    if (flag('second')) {
      const owed = ringsToLookAt(surfaces, review);
      if (owed.length) throw new Error(`${build}: the first look has not seen ${owed.length} rings as they are now (${listed(owed)}); record it first`);
      review.second = secondLook(JSON.parse(fs.readFileSync(flag('second'), 'utf8')), ids, review.second ?? null);
    }
    for (const [name, key] of [['resolve', 'resolution'], ['fault', 'fault']]) for (const [id, said] of Object.entries(pairs(name))) {
      const doubt = review.second?.doubts?.[id];
      if (!doubt) throw new Error(`the second look has no doubt on ${id}`);
      Object.assign(doubt, { resolution: null, fault: null, [key]: said });
    }
    write(review);
  }
  const errors = reviewErrors(build), owed = looksOwed(build), second = stored()?.second ?? null;
  const config = sheetConfigOf(build) ?? '<trace-config.json>';
  const draw = (only, blind) => (only.length ? `python packages/course-geo/mapping/render-ring-sheets.py --config ${config}${blind ? ' --blind' : ''}${only.length < owed.ids.length ? ` --only ${only.join(',')}` : ''}` : null);
  console.log(JSON.stringify({ build, rings: ringCounts(surfaces), underTheLine: ringsUnderTheLine(trace, prefixOf(surfaces)),
    toLookAt: owed.first, draw: draw(owed.first, false),
    secondLook: secondLookSummary(second) ?? 'none recorded', ...(owed.second?.length ? { drawBlind: draw(owed.second, true) } : {}), errors }, null, 1));
  process.exitCode = errors.length ? 1 : 0;
}
