#!/usr/bin/env node
/* The record of a look at every traced ring, and the rule that says which rings need a written verdict.

   node packages/course-geo/mapping/ring-review.mjs --build <build dir>            what is under the line, and whether the record is current
   node packages/course-geo/mapping/ring-review.mjs --build <build dir> --record --reviewer "<who, on what>" [--redrawn id,id] [--accept id="why" ...]

   The tracer scores each tee and green by how clearly the photo shows its edge (dPrime). At Bro Hof that score
   sat in trace-report.json while thirteen wrong tee decks went unseen: a score nobody reads is not a gate. So:
   - every ring is looked at on the sheets render-ring-sheets.py draws, and the look is recorded here against
     the exact outlines it saw (the hash of playing-surfaces.geojson), so a new trace needs a new look;
   - a ring under the line (dPrime below 2.2, or kept as it started because the photo gave no edge) needs a
     verdict in words: why it is right although the photo does not show it. A ring a reviewer drew and kept
     as drawn is its own verdict, in decisions.json.
   The score finds the doubtful rings; it did not find them all (four wrong decks scored above the line), which is
   why the whole sheet is looked at and not only its head. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const RING_SCORE_LINE = 2.2;
const read = file => fs.readFileSync(path.join(ROOT, file));
const json = file => JSON.parse(read(file).toString('utf8'));

export const reviewPath = build => `${build}/mapping/ring-review.json`;
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
  const surfaces = json(`${build}/mapping/playing-surfaces.geojson`), trace = json(`${build}/mapping/trace-report.json`);
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
  return errors;
}

/** The builds traced with the shared tracer, from the published catalogue. */
export function tracedBuilds() {
  return json('apps/golf/public/courses/index.json').courses.map(c => c.build).filter(build => fs.existsSync(path.join(ROOT, `${build}/mapping/trace-report.json`)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), flag = name => { const i = argv.indexOf(`--${name}`); return i < 0 ? null : argv[i + 1]; };
  const build = flag('build');
  if (!build) throw new Error('usage: ring-review.mjs --build <build dir> [--record --reviewer "<who, on what>" [--redrawn id,id] [--accept id="why" ...]]');
  const surfaces = json(`${build}/mapping/playing-surfaces.geojson`), trace = json(`${build}/mapping/trace-report.json`);
  if (argv.includes('--record')) {
    const previous = fs.existsSync(path.join(ROOT, reviewPath(build))) ? json(reviewPath(build)) : {};
    const accepted = { ...(previous.accepted ?? {}) };
    argv.forEach((arg, i) => { if (arg === '--accept') { const [id, ...why] = argv[i + 1].split('='); accepted[id] = why.join('='); } });
    const low = new Set(ringsUnderTheLine(trace, prefixOf(surfaces)).map(ring => ring.id));
    const review = { schemaVersion: 1, slug: trace.slug, surfacesSha256: surfacesSha256(build), reviewedOn: flag('on') ?? new Date().toISOString().slice(0, 10),
      reviewer: flag('reviewer'), rings: ringCounts(surfaces), redrawn: (flag('redrawn') ?? (previous.redrawn ?? []).join(',')).split(',').filter(Boolean),
      accepted: Object.fromEntries(Object.entries(accepted).filter(([id]) => low.has(id)).sort(([a], [b]) => (a < b ? -1 : 1))) };
    fs.writeFileSync(path.join(ROOT, reviewPath(build)), `${JSON.stringify(review, null, 1)}\n`);
  }
  const errors = reviewErrors(build);
  console.log(JSON.stringify({ build, rings: ringCounts(surfaces), underTheLine: ringsUnderTheLine(trace, prefixOf(surfaces)), errors }, null, 1));
  process.exitCode = errors.length ? 1 : 0;
}
