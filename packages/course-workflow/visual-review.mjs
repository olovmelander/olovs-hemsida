/* THE REVIEWER'S VERDICT, AND A GROUND ADMITTED ON IT.

   The owner's decision (27 November 2026): a course is released on the automated reviewer's verdict alone, with no
   look of the owner's before it. tools/course-review-pictures.mjs draws every hole of every routing in both modes
   (Detaljerad 3D from the tee and from above, Lätt 3D's view of the hole, the photo with the outlines where there
   is one); the course-reviewer agent (.claude/agents/course-reviewer.md) looks at every sheet blind and names what
   it doubts; this records that look, bound to the generation it saw and to the bytes of every sheet, and holds every
   doubt open until it is resolved or written down as a fault, as the ring review's second look does.

   A ground is then admitted on the record as on an owner's acceptance (acceptance.mjs): exactly one published
   generation, every routing, every open release item named with its reason, and every byte verified. It is the
   reviewer's record, never the owner's: no acceptance is written in the owner's name.

     node packages/course-workflow/visual-review.mjs --ground <id>                     what holds and what is open
     node packages/course-workflow/visual-review.mjs --ground <id> --record <verdicts.json> [--sheets <dir>]
     node packages/course-workflow/visual-review.mjs --ground <id> --resolve <sheet>="why it stands" --fault <sheet>="what is wrong and what fixes it"
     node packages/course-workflow/visual-review.mjs --ground <id> --open <item>="why it is open"
     node packages/course-workflow/visual-review.mjs --ground <id> --check          fails unless the ground is admitted */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGround } from './audit.mjs';
import { acceptancePath, admitAccepted, openItems } from './acceptance.mjs';
import { verifyCandidateBytes } from './release.mjs';
import { assertWorkflow, exactKeys, nonempty, SHA } from './standard.mjs';
import { readJson, safePath } from './io.mjs';

export const visualReviewPath = groundId => `course-workflows/${groundId}/visual-review.json`;
const KEYS = ['schemaVersion', 'groundId', 'courses', 'groundManifestSha256', 'drawn', 'reviewer', 'reviewedOn', 'looked', 'doubts', 'cannotTell', 'open'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/* An answer says something: a resolution why the picture is right after all, or a fault and what would fix it. */
const ANSWER = 20;
const sheetIds = graph => graph.courses.flatMap(course => course.holes.map((_, i) => `${course.slug}-h${String(i + 1).padStart(2, '0')}`));

/** Everything that keeps the record from admitting the ground as it is published now. */
export function verdictProblems(root, w, record, { publicRoot = 'apps/golf/public' } = {}) {
  const errors = [];
  if (!exactKeys(record, KEYS, 'visual review', errors)) return errors;
  if (record.schemaVersion !== 1 || record.groundId !== w.groundId) errors.push('visual review identity mismatch');
  const graph = loadGround(root, w.groundId, publicRoot);
  const slugs = graph.courses.map(c => c.slug).sort();
  if (JSON.stringify(record.courses) !== JSON.stringify(slugs)) errors.push('the review names other routings than are published');
  const generation = new Set(graph.courses.map(c => c.groundManifest.sha256));
  if (!SHA.test(record.groundManifestSha256 || '') || generation.size !== 1 || !generation.has(record.groundManifestSha256)) errors.push('the review looked at another generation of this ground: draw and look again');
  if (!nonempty(record.reviewer) || record.reviewer.length < 12 || !DATE.test(record.reviewedOn || '')) errors.push('the review needs its reviewer and the day it looked');
  const sheets = record.drawn?.sheets ?? {}, looked = new Set(record.looked ?? []);
  for (const id of sheetIds(graph)) {
    if (!SHA.test(sheets[id] || '')) errors.push(`${id} was not drawn`);
    else if (!looked.has(id)) errors.push(`${id} was not looked at`);
  }
  for (const [kind, list] of [['doubt', record.doubts], ['cannot tell', record.cannotTell]]) {
    for (const [id, item] of Object.entries(list ?? {})) {
      if (!(id in sheets)) errors.push(`${kind} on ${id}, which was not drawn`);
      const resolved = nonempty(item?.resolution) && item.resolution.length >= ANSWER, faulted = nonempty(item?.fault) && item.fault.length >= ANSWER;
      if (resolved === faulted) errors.push(`${id}: ${kind} "${item?.reason ?? ''}" needs a resolution or a fault (${ANSWER}+ characters, not both)`);
    }
  }
  const { items } = openItems(root, w, { publicRoot });
  for (const id of items) if (!nonempty(record.open?.[id])) errors.push(`open release item ${id} needs its reason`);
  for (const id of Object.keys(record.open ?? {})) if (!items.includes(id)) errors.push(`the review lists ${id}, which is not open`);
  return errors;
}

/** A new ground admitted on the reviewer's verdict: its record holds and every published byte is the candidate's. */
export function admitReviewed(root, w, { publicRoot = 'apps/golf/public' } = {}) {
  const errors = [];
  let record = null, byteVerification = 'not-run';
  try {
    const file = visualReviewPath(w.groundId);
    if (!fs.existsSync(safePath(root, file))) throw new Error('no reviewer\'s verdict: draw every hole (tools/course-review-pictures.mjs) and record the course-reviewer\'s look');
    record = readJson(root, file);
    errors.push(...verdictProblems(root, w, record, { publicRoot }));
    if (!errors.length) byteVerification = verifyCandidateBytes(root, w, loadGround(root, w.groundId, publicRoot), publicRoot);
  } catch (e) { errors.push(e.message); }
  return { groundId: w.groundId, admittedBy: 'reviewer', review: record, byteVerification, ready: errors.length === 0, errors };
}

/** An advisory ground comes in on the reviewer's verdict, or on an owner's acceptance where one was recorded. */
export function admitAdvisory(root, w, options = {}) {
  const tried = [];
  for (const [file, admit] of [[visualReviewPath(w.groundId), admitReviewed], [acceptancePath(w.groundId), admitAccepted]]) {
    if (!fs.existsSync(safePath(root, file))) continue;
    const result = admit(root, w, options);
    if (result.ready) return result;
    tried.push(result);
  }
  if (!tried.length) return { groundId: w.groundId, ready: false, errors: ['new courses require the full release review, the reviewer\'s verdict (visual-review.json) or a recorded owner acceptance'] };
  return { groundId: w.groundId, ready: false, errors: tried.flatMap(result => result.errors.map(error => `${result.admittedBy}: ${error}`)) };
}

/** The reviewer's look recorded over the sheets it saw. An answered doubt on a sheet whose bytes did not change is
 * kept, so a look taken again does not undo the work on what stayed; a sheet that changed is a new picture. */
export function recordVerdicts({ groundId, graph, report, verdicts, previous = null }) {
  if (report.groundId !== groundId) throw new Error(`the sheets are ${report.groundId}'s`);
  const sheets = Object.fromEntries(report.sheets.map(sheet => [sheet.id, sheet.sha256]));
  const unknown = [...(verdicts.sheets ?? []), ...Object.keys(verdicts.doubts ?? {}), ...Object.keys(verdicts.cannotTell ?? {})].filter(id => !(id in sheets));
  if (unknown.length) throw new Error(`the verdicts name sheets that were not drawn: ${unknown.slice(0, 4).join(', ')}`);
  const looked = Object.keys(verdicts.looked ?? {}).filter(id => id in sheets);
  const carry = (list, before) => Object.fromEntries(Object.entries(list ?? {}).map(([id, reason]) => {
    if (typeof reason !== 'string' || reason.length < 10) throw new Error(`${id}: a doubt needs its reason in a sentence`);
    const old = before?.[id], same = old && previous?.drawn?.sheets?.[id] === sheets[id];
    return [id, { reason, resolution: same ? old.resolution ?? null : null, fault: same ? old.fault ?? null : null }];
  }));
  return {
    schemaVersion: 1, groundId, courses: graph.courses.map(c => c.slug).sort(), groundManifestSha256: graph.courses[0].groundManifest.sha256,
    drawn: { drawnOn: report.drawnOn, gpu: report.gpu, sheets },
    reviewer: verdicts.reviewer, reviewedOn: verdicts.reviewedOn,
    looked: looked.sort(),
    doubts: carry(verdicts.doubts, previous?.doubts), cannotTell: carry(verdicts.cannotTell, previous?.cannotTell),
    open: previous?.groundManifestSha256 === graph.courses[0].groundManifest.sha256 ? previous.open ?? {} : {},
  };
}

/** A resolution or a fault on one doubt; each clears the other. */
export function answer(record, id, field, text) {
  const item = record.doubts[id] ?? record.cannotTell[id];
  if (!item) throw new Error(`${id} has no doubt to answer`);
  if (!nonempty(text) || text.length < ANSWER) throw new Error(`${id}: say it in a sentence (${ANSWER}+ characters)`);
  item.resolution = field === 'resolution' ? text : null;
  item.fault = field === 'fault' ? text : null;
  return record;
}

const writeRecord = (root, groundId, record) => fs.writeFileSync(safePath(root, visualReviewPath(groundId)), `${JSON.stringify(record, null, 1)}\n`);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const args = process.argv.slice(2);
  const flag = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
  const pairs = name => args.flatMap((arg, i) => (arg === name ? [args[i + 1]] : [])).map(pair => { const at = pair.indexOf('='); return [pair.slice(0, at), pair.slice(at + 1)]; });
  const groundId = flag('--ground');
  if (!groundId) throw new Error('usage: visual-review.mjs --ground <id> [--record <verdicts.json> [--sheets <dir>] | --resolve id=why | --fault id=what | --open item=why | --check]');
  const w = assertWorkflow(readJson(root, `course-workflows/${groundId}/workflow.json`));
  const file = safePath(root, visualReviewPath(groundId));
  let record = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  if (flag('--record')) {
    const production = readJson(root, `course-workflows/${groundId}/production.json`);
    const sheetsDir = flag('--sheets') ?? path.join(root, path.posix.dirname(production.courses[0].model.path), 'cache', 'visual-review');
    const report = JSON.parse(fs.readFileSync(path.join(sheetsDir, 'report.json'), 'utf8'));
    if (report.problems?.length) throw new Error(`the sheets were drawn with ${report.problems.length} problems: fix them and draw again`);
    const verdicts = JSON.parse(fs.readFileSync(path.resolve(flag('--record')), 'utf8'));
    record = recordVerdicts({ groundId, graph: loadGround(root, groundId, 'apps/golf/public'), report, verdicts, previous: record });
    writeRecord(root, groundId, record);
  }
  if (!record) throw new Error(`${groundId}: no visual review yet; draw the sheets and record the course-reviewer's look`);
  const changed = pairs('--resolve').length + pairs('--fault').length + pairs('--open').length;
  for (const [id, text] of pairs('--resolve')) answer(record, id, 'resolution', text);
  for (const [id, text] of pairs('--fault')) answer(record, id, 'fault', text);
  for (const [id, text] of pairs('--open')) { if (!nonempty(text) || text.length < ANSWER) throw new Error(`${id}: say why it is open in a sentence`); record.open[id] = text; }
  if (changed) writeRecord(root, groundId, record);
  const admitted = admitReviewed(root, w);
  const doubts = Object.entries({ ...record.doubts, ...record.cannotTell });
  console.log(JSON.stringify({ groundId, reviewedOn: record.reviewedOn, looked: record.looked.length, sheets: Object.keys(record.drawn.sheets).length,
    doubts: doubts.length, answered: doubts.filter(([, d]) => d.resolution || d.fault).length, faults: doubts.filter(([, d]) => d.fault).map(([id, d]) => `${id}: ${d.fault}`),
    admitted: admitted.ready, errors: admitted.errors }, null, 1));
  if (args.includes('--check') && !admitted.ready) process.exitCode = 1;
}
