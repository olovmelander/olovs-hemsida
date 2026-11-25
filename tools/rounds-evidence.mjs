#!/usr/bin/env node
/* WHERE DO GOLFERS ACTUALLY TEE OFF AND PUTT?

   A course is traced from a photo and checked against a laser scan, and neither has stood on a tee. The app has:
   the map mode locks every shot of a real round to the phone's GPS, in the course's own frame. The first shot of a
   hole starts on the tee that was played; a putt starts on the green. Enough of them, and they are evidence that
   no photo gives, for exactly the places where a look could not settle it (a deck under crowns, a tee that was
   moved): a tee deck that golfers do not tee off from, or a spot they do tee off from where the model has no deck.

   node tools/rounds-evidence.mjs --ground <id> --shots <extract.json> [--json <out>]

   THE EXTRACT IS THE OWNER'S TO MAKE. Rounds are the players' own data. This tool never reads the database; it
   reads a file of positions with nothing in it that says whose they are: one row a shot,
   { "courseSlug", "hole", "kind": "tee" | "putt", "x", "z", "accuracy" }. From the production database that is
   (apps/worker, D1 `banvy-db`), run by whoever may:

     SELECT course_slug AS courseSlug, hole,
            CASE WHEN is_putt = 1 THEN 'putt' ELSE 'tee' END AS kind,
            json_extract(shot_json, '$.from[0]') AS x, json_extract(shot_json, '$.from[1]') AS z,
            json_extract(shot_json, '$.fromAccuracy') AS accuracy
       FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY user_id, course_slug, round_id, hole ORDER BY seq) AS nth FROM shots)
      WHERE suspect = 0 AND (is_putt = 1 OR nth = 1);

   No user, no round, no time, no club: positions on a golf course. Keep the file out of git all the same.

   A phone's fix is good to a few metres at best, so one shot proves nothing. A place is named only on several
   shots that agree, each with a fix of 10 m or better, and what is printed is a place to look at, not a verdict. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** A fix worse than this is not used; fewer shots than this prove nothing; farther than this from a deck is a doubt. */
export const EVIDENCE = Object.freeze({ accuracyMetres: 10, fewestTeeShots: 4, fewestPutts: 8, teeMetres: 6, greenMargin: 3, greenShare: 0.7, clusterMetres: 12 });

function inside(p, ring) {
  let odd = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) odd = !odd;
  }
  return odd;
}
function gap(p, ring) {
  if (inside(p, ring)) return 0;
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j], [bx, by] = ring[i], dx = bx - ax, dy = by - ay;
    const u = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p[0] - ax - u * dx, p[1] - ay - u * dy));
  }
  return best;
}
const median = list => [...list].sort((a, b) => a - b)[list.length >> 1];
const round = value => Math.round(value * 10) / 10;

/** What the shots say of one routing's tees and greens. `model` is its course model; `shots` are the extract's rows for
 * it. Returns [{ hole, about: 'tee' | 'green', shots, text, at? }], only where enough shots agree. */
export function roundsEvidence(model, shots, lines = EVIDENCE) {
  const out = [];
  for (const hole of model.holes) {
    const good = shots.filter(shot => shot.hole === hole.n && Number.isFinite(shot.x) && Number.isFinite(shot.z) && Number.isFinite(shot.accuracy) && shot.accuracy <= lines.accuracyMetres);
    const decks = (hole.tees?.pads ?? []).map((pad, index) => ({ name: pad.id ?? `deck ${index + 1}`, ring: pad.ring })).filter(deck => deck.ring?.length >= 3);
    const tees = good.filter(shot => shot.kind === 'tee').map(shot => [shot.x, shot.z]);
    if (tees.length >= lines.fewestTeeShots && decks.length) {
      // Tee shots that start far from every deck, gathered where they agree with each other.
      const off = tees.filter(p => Math.min(...decks.map(deck => gap(p, deck.ring))) > lines.teeMetres), left = [...off];
      while (left.length) {
        const seed = left[0], cluster = left.filter(p => Math.hypot(p[0] - seed[0], p[1] - seed[1]) <= lines.clusterMetres);
        for (const p of cluster) left.splice(left.indexOf(p), 1);
        if (cluster.length < lines.fewestTeeShots) continue;
        const at = [round(median(cluster.map(p => p[0]))), round(median(cluster.map(p => p[1])))];
        const nearest = decks.map(deck => ({ deck, metres: gap(at, deck.ring) })).sort((a, b) => a.metres - b.metres)[0];
        out.push({ hole: hole.n, about: 'tee', shots: cluster.length, at,
          text: `${cluster.length} of ${tees.length} tee shots start round (${at.join(', ')}), ${round(nearest.metres)} m from the nearest deck (${nearest.deck.name}): a deck the model lacks, or one drawn in the wrong place` });
      }
      // A deck nobody tees off from says little by itself (a back tee is seldom played), so it is not named.
    }
    const putts = good.filter(shot => shot.kind === 'putt').map(shot => [shot.x, shot.z]);
    if (putts.length >= lines.fewestPutts && hole.green?.ring?.length >= 3) {
      const on = putts.filter(p => gap(p, hole.green.ring) <= lines.greenMargin).length, share = on / putts.length;
      if (share < lines.greenShare) {
        const away = putts.filter(p => gap(p, hole.green.ring) > lines.greenMargin), at = [round(median(away.map(p => p[0]))), round(median(away.map(p => p[1])))];
        out.push({ hole: hole.n, about: 'green', shots: putts.length, at,
          text: `${putts.length - on} of ${putts.length} putts start more than ${lines.greenMargin} m outside the green's outline, round (${at.join(', ')}): the outline may be off, or the green was moved` });
      }
    }
  }
  return out;
}

/** How much evidence there is, a hole: so that "nothing found" is not read where nothing was played. */
export function roundsCoverage(model, shots, lines = EVIDENCE) {
  return model.holes.map(hole => {
    const good = shots.filter(shot => shot.hole === hole.n && Number.isFinite(shot.accuracy) && shot.accuracy <= lines.accuracyMetres);
    return { hole: hole.n, teeShots: good.filter(shot => shot.kind === 'tee').length, putts: good.filter(shot => shot.kind === 'putt').length };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), flag = name => { const i = argv.indexOf(`--${name}`); return i < 0 ? null : argv[i + 1]; };
  if (!flag('ground') || !flag('shots')) throw new Error('usage: rounds-evidence.mjs --ground <id> --shots <extract.json> [--json <out>]');
  const json = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const rows = JSON.parse(fs.readFileSync(flag('shots'), 'utf8')), all = Array.isArray(rows) ? rows : rows.results ?? rows[0]?.results ?? [];
  const slugs = json('apps/golf/public/courses/v2-index.json').courses.filter(course => course.groundId === flag('ground')).map(course => course.slug);
  const report = slugs.map(slug => {
    const build = json('apps/golf/public/courses/index.json').courses.find(course => course.slug === slug).build, model = json(`${build}/course-model.json`);
    const shots = all.filter(shot => shot.courseSlug === slug), coverage = roundsCoverage(model, shots);
    return { slug, shots: shots.length, holesWithEnoughTeeShots: coverage.filter(c => c.teeShots >= EVIDENCE.fewestTeeShots).length, holesWithEnoughPutts: coverage.filter(c => c.putts >= EVIDENCE.fewestPutts).length,
      holes: model.holes.length, found: roundsEvidence(model, shots) };
  });
  for (const course of report) {
    console.log(`${course.slug}: ${course.shots} shots; enough tee shots on ${course.holesWithEnoughTeeShots} of ${course.holes} holes, enough putts on ${course.holesWithEnoughPutts}`);
    for (const found of course.found) console.log(`  hole ${found.hole} (${found.about}): ${found.text}`);
    if (!course.found.length) console.log(course.holesWithEnoughTeeShots || course.holesWithEnoughPutts ? '  where there were enough shots, they agree with the model' : '  too few shots to say anything');
  }
  if (flag('json')) fs.writeFileSync(flag('json'), `${JSON.stringify(report, null, 1)}\n`);
}
