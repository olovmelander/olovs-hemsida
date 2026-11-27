#!/usr/bin/env node
/* The record of a look at every traced ring, and the rule that says which rings need a written verdict.

   node packages/course-geo/mapping/ring-review.mjs --build <build dir>            what is under the line, and whether the record is current
   node packages/course-geo/mapping/ring-review.mjs --build <build dir> --record --reviewer "<who, on what>" [--redrawn id,id] [--accept id="why" ...]
   node packages/course-geo/mapping/ring-review.mjs --build <build dir> --second <verdicts.json>      a second reviewer's doubts
   node packages/course-geo/mapping/ring-review.mjs --build <build dir> --resolve id="why the ring stands"   answer one of them
   node packages/course-geo/mapping/ring-review.mjs --build <build dir> --fault id="what is wrong, and what will put it right"

   The tracer scores each tee and green by how clearly the photo shows its edge (dPrime). At Bro Hof that score
   sat in trace-report.json while thirteen wrong tee decks went unseen: a score nobody reads is not a gate. So:
   - every ring is looked at on the sheets render-ring-sheets.py draws, and the look is recorded here against
     the exact outlines it saw (the hash of playing-surfaces.geojson), so a new trace needs a new look;
   - a ring under the line (dPrime below 2.2, or kept as it started because the photo gave no edge) needs a
     verdict in words: why it is right although the photo does not show it. A ring a reviewer drew and kept
     as drawn is its own verdict, in decisions.json.
   The score finds the doubtful rings; it did not find them all (four wrong decks scored above the line), which is
   why the whole sheet is looked at and not only its head.

   A SECOND LOOK. The first look is taken by whoever traced, who sees what they meant to draw. A second reviewer
   who has seen neither the decisions nor the scores looks at the blind sheets (render-ring-sheets.py --blind) and
   names the rings they doubt, each with a reason: { reviewer, reviewedOn, sheets, doubts: { <ring id>: <reason> } }.
   Recorded here, each doubt stays open, and fails the review, until it is answered in one of three ways: the ring
   was redrawn (which changes the outlines and asks for both looks again); a reason says why it stands (--resolve);
   or the reviewer is right and the ring cannot be put right yet, and it is kept as a FAULT with what will put it
   right (--fault). A fault is not hidden: the ground's walkthrough prints every one. What the reviewer could not
   judge (shade, crowns) is kept beside the doubts. A second look is not required of a build; once recorded, it binds. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const RING_SCORE_LINE = 2.2;
const read = file => fs.readFileSync(path.join(ROOT, file));
const json = file => JSON.parse(read(file).toString('utf8'));

export const reviewPath = build => `${build}/mapping/ring-review.json`;
/** A build's trace report; an older ground's exported outlines (export-model-surfaces.mjs) have none, and so no scores. */
export function traceOf(build) {
  if (fs.existsSync(path.join(ROOT, `${build}/mapping/trace-report.json`))) return json(`${build}/mapping/trace-report.json`);
  const surfaces = json(`${build}/mapping/playing-surfaces.geojson`);
  if (surfaces.status !== 'exported-from-model') throw new Error(`${build}: no trace report, and its outlines are not an export of its model`);
  return { slug: surfaces.slug, rows: [] };
}
export const surfacesSha256 = build => createHash('sha256').update(read(`${build}/mapping/playing-surfaces.geojson`)).digest('hex');

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

/** Why a build's ring review does not hold, as a list (empty when it holds). */
export function reviewErrors(build) {
  const surfaces = json(`${build}/mapping/playing-surfaces.geojson`), trace = traceOf(build);
  if (!fs.existsSync(path.join(ROOT, reviewPath(build)))) return [`${build}: no ring review; draw the sheets, look at them and record it`];
  const review = json(reviewPath(build)), errors = [];
  if (review.schemaVersion !== 1 || review.slug !== trace.slug) errors.push(`${build}: the ring review belongs to another course`);
  if (review.surfacesSha256 !== surfacesSha256(build)) errors.push(`${build}: the outlines changed since they were looked at (${review.reviewedOn}); look again`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(review.reviewedOn ?? '') || typeof review.reviewer !== 'string' || review.reviewer.length < 12) errors.push(`${build}: the ring review needs a date and who looked, on what`);
  if (JSON.stringify(review.rings) !== JSON.stringify(ringCounts(surfaces))) errors.push(`${build}: the ring review counted other rings than the outlines hold`);
  const ids = new Set(surfaces.features.map(f => f.id));
  for (const id of review.redrawn ?? []) if (!ids.has(id)) errors.push(`${build}: redrawn ring ${id} is not in the outlines`);
  const low = ringsUnderTheLine(trace, prefixOf(surfaces));
  for (const ring of low) if (!(typeof review.accepted?.[ring.id] === 'string' && review.accepted[ring.id].length >= 20)) errors.push(`${build}: ${ring.id} is under the line (dPrime ${ring.dPrime}${ring.kept ? `, kept ${ring.kept}` : ''}) and has no verdict`);
  for (const id of Object.keys(review.accepted ?? {})) if (!low.some(ring => ring.id === id)) errors.push(`${build}: the review gives a verdict on ${id}, which is not under the line`);
  errors.push(...secondLookErrors(build, review, ids));
  return errors;
}

/** Why a recorded second look does not hold: it saw other outlines, or one of its doubts is unanswered. */
export function secondLookErrors(build, review, ids) {
  const second = review.second, errors = [];
  if (!second) return errors;
  if (second.surfacesSha256 !== review.surfacesSha256) errors.push(`${build}: the second look saw other outlines than the first`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(second.reviewedOn ?? '') || typeof second.reviewer !== 'string' || second.reviewer.length < 12) errors.push(`${build}: the second look needs a date and who looked`);
  for (const [id, doubt] of Object.entries(second.doubts ?? {})) {
    if (!ids.has(id)) errors.push(`${build}: the second look doubts ${id}, which is not in the outlines`);
    else if (![doubt.resolution, doubt.fault].some(said => typeof said === 'string' && said.length >= 20)) errors.push(`${build}: the second look doubts ${id} (${doubt.reason}); redraw it, or answer it with --resolve or --fault`);
    else if (doubt.resolution && doubt.fault) errors.push(`${build}: ${id} both stands and is a fault; it is one or the other`);
  }
  return errors;
}

/** A second reviewer's verdicts as the record keeps them: every doubt open until it is answered. */
export function secondLook(verdicts, surfacesSha256, ids) {
  const doubts = {};
  for (const [id, reason] of Object.entries(verdicts.doubts ?? {})) {
    if (!ids.has(id)) continue; // a ring of another build on the same sheets
    if (typeof reason !== 'string' || reason.length < 10) throw new Error(`the doubt on ${id} needs a reason`);
    doubts[id] = { reason, resolution: null, fault: null };
  }
  const cannotTell = Object.fromEntries(Object.entries(verdicts.cannotTell ?? {}).filter(([id]) => ids.has(id)));
  return { reviewer: verdicts.reviewer, reviewedOn: verdicts.reviewedOn, sheets: verdicts.sheets ?? null, looked: verdicts.looked ?? null, surfacesSha256, doubts, cannotTell };
}

/** A recorded second look in numbers: its doubts that stand answered, and those kept as faults, by ring id. */
export function secondLookSummary(second) {
  if (!second) return null;
  const doubts = Object.entries(second.doubts ?? {});
  return { reviewer: second.reviewer, reviewedOn: second.reviewedOn, doubts: doubts.length, stand: doubts.filter(([, d]) => d.resolution).map(([id]) => id),
    faults: doubts.filter(([, d]) => d.fault).map(([id, d]) => ({ id, fault: d.fault })), open: doubts.filter(([, d]) => !d.resolution && !d.fault).map(([id]) => id),
    cannotTell: Object.keys(second.cannotTell ?? {}).length };
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
  const surfaces = json(`${build}/mapping/playing-surfaces.geojson`), trace = traceOf(build);
  if (flag('second') || flag('resolve') || flag('fault')) {
    const review = json(reviewPath(build)), ids = new Set(surfaces.features.map(f => f.id));
    if (flag('second')) review.second = secondLook(JSON.parse(fs.readFileSync(flag('second'), 'utf8')), surfacesSha256(build), ids);
    argv.forEach((arg, i) => {
      if (arg !== '--resolve' && arg !== '--fault') return;
      const [id, ...what] = argv[i + 1].split('='), doubt = review.second?.doubts?.[id];
      if (!doubt) throw new Error(`the second look has no doubt on ${id}`);
      Object.assign(doubt, arg === '--resolve' ? { resolution: what.join('='), fault: null } : { resolution: null, fault: what.join('=') });
    });
    fs.writeFileSync(path.join(ROOT, reviewPath(build)), `${JSON.stringify(review, null, 1)}\n`);
  }
  if (argv.includes('--record')) {
    const previous = fs.existsSync(path.join(ROOT, reviewPath(build))) ? json(reviewPath(build)) : {};
    const accepted = { ...(previous.accepted ?? {}) };
    argv.forEach((arg, i) => { if (arg === '--accept') { const [id, ...why] = argv[i + 1].split('='); accepted[id] = why.join('='); } });
    const low = new Set(ringsUnderTheLine(trace, prefixOf(surfaces)).map(ring => ring.id));
    const review = { schemaVersion: 1, slug: trace.slug, surfacesSha256: surfacesSha256(build), reviewedOn: flag('on') ?? new Date().toISOString().slice(0, 10),
      reviewer: flag('reviewer'), rings: ringCounts(surfaces), redrawn: (flag('redrawn') ?? (previous.redrawn ?? []).join(',')).split(',').filter(Boolean),
      accepted: Object.fromEntries(Object.entries(accepted).filter(([id]) => low.has(id)).sort(([a], [b]) => (a < b ? -1 : 1))),
      // a second look holds only for the outlines it saw
      ...(previous.second?.surfacesSha256 === surfacesSha256(build) ? { second: previous.second } : {}) };
    fs.writeFileSync(path.join(ROOT, reviewPath(build)), `${JSON.stringify(review, null, 1)}\n`);
  }
  const errors = reviewErrors(build);
  const second = fs.existsSync(path.join(ROOT, reviewPath(build))) ? json(reviewPath(build)).second ?? null : null;
  console.log(JSON.stringify({ build, rings: ringCounts(surfaces), underTheLine: ringsUnderTheLine(trace, prefixOf(surfaces)),
    secondLook: secondLookSummary(second) ?? 'none recorded', errors }, null, 1));
  process.exitCode = errors.length ? 1 : 0;
}
