/* AN OWNER'S ACCEPTANCE of one new ground that cannot yet meet the full release check.

   A new ground needs the release check (release.mjs): independent survey control, a phone's timings, every hole
   reviewed. The owner may decide to publish one without them, as the ten grounds older than that check are
   published, and this is the only way in. It admits exactly one published generation, by its ground manifest's
   hash, of exactly the routings it names, and it must name every item that is still open: an acceptance that
   leaves one out is refused. The published ground's structure, sources and every byte are checked as any
   candidate's are. What the build read (raw laser, rasters, caches) is private and not in CI, so unlike the full
   release check this computes no candidate fingerprint: the ground manifest's own hash says what is admitted.
   A ground that has been mandatory can never be admitted this way, so it is no way to downgrade one. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectGround, loadGround } from './audit.mjs';
import { reviewErrors, verifyCandidateBytes } from './release.mjs';
import { exactKeys, nonempty, SHA } from './standard.mjs';
import { readJson, safePath } from './io.mjs';
import { assertWorkflow } from './standard.mjs';

export const acceptancePath = groundId => `course-workflows/${groundId}/owner-acceptance.json`;
const KEYS = ['schemaVersion', 'groundId', 'courses', 'groundManifestSha256', 'decision', 'acceptedBy', 'acceptedOn', 'basis', 'open'];

/** What the full release check would still refuse, by id. */
export function openItems(root, w, { publicRoot }) {
  const audit = inspectGround(root, w.groundId, { publicRoot, sourceManifest: w.sourceManifest });
  const items = audit.blockers.filter(b => b.severity === 'release-blocking').map(b => b.id);
  if (audit.frameStatus !== 'approved') items.push('canonical-frame');
  if (!audit.sourceSnapshotMatches) items.push('source-snapshot');
  let review = null;
  try { review = readJson(root, w.reviewFile); } catch { /* no review is an open review */ }
  if (!review || reviewErrors(root, w, review, review.candidateDigest).length) items.push('release-review');
  return { items: [...new Set(items)].sort(), audit };
}

export function admitAccepted(root, w, { publicRoot = 'apps/golf/public' } = {}) {
  const errors = [];
  let acceptance = null, byteVerification = 'not-run';
  try {
    const file = acceptancePath(w.groundId);
    if (!fs.existsSync(safePath(root, file))) throw new Error('new courses require the full release review or a recorded owner acceptance');
    acceptance = readJson(root, file);
    if (!exactKeys(acceptance, KEYS, 'acceptance', errors)) throw new Error('unreadable owner acceptance');
    if (acceptance.schemaVersion !== 1 || acceptance.groundId !== w.groundId || acceptance.decision !== 'admit-as-advisory') errors.push('acceptance identity mismatch');
    if (acceptance.acceptedBy !== 'owner' || !/^\d{4}-\d{2}-\d{2}$/.test(acceptance.acceptedOn || '') || !nonempty(acceptance.basis)) errors.push('acceptance needs the owner, a date and its basis');
    const graph = loadGround(root, w.groundId, publicRoot);
    const routings = list => JSON.stringify(list.map(c => [c.slug, c.holes]).sort());
    if (routings(w.courses) !== routings(graph.courses.map(c => ({ slug: c.slug, holes: c.holes.length })))) errors.push('workflow must include every shared routing and its exact hole count');
    const slugs = graph.courses.map(c => c.slug).sort();
    if (JSON.stringify(acceptance.courses) !== JSON.stringify(slugs)) errors.push('acceptance names other routings');
    const generation = new Set(graph.courses.map(c => c.groundManifest.sha256));
    if (!SHA.test(acceptance.groundManifestSha256 || '') || generation.size !== 1 || !generation.has(acceptance.groundManifestSha256)) errors.push('acceptance admits another generation of this ground');
    const { items, audit } = openItems(root, w, { publicRoot });
    errors.push(...audit.errors);
    if (items.includes('source-snapshot')) errors.push('source manifest changed since ground publication');
    for (const id of items) if (!nonempty(acceptance.open?.[id])) errors.push(`acceptance leaves out open item ${id}`);
    for (const id of Object.keys(acceptance.open || {})) if (!items.includes(id)) errors.push(`acceptance lists ${id}, which is not open`);
    if (!errors.length) byteVerification = verifyCandidateBytes(root, w, graph, publicRoot);
  } catch (e) { errors.push(e.message); }
  return { groundId: w.groundId, admittedBy: 'owner-acceptance', acceptance, byteVerification, ready: errors.length === 0, errors };
}

/** The acceptance record for what is published now. `reasons` gives, for every open item, why it is open; an item
 * without one, or a reason for an item that is not open, is refused, so the record cannot say less than the truth. */
export function draftAcceptance(root, w, { acceptedOn, basis, reasons, publicRoot = 'apps/golf/public' }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(acceptedOn || '')) throw new Error('--accepted-on needs the date the owner decided (YYYY-MM-DD)');
  if (!nonempty(basis) || basis.length < 30) throw new Error('--basis needs what the owner was asked and what they answered, in a sentence');
  const graph = loadGround(root, w.groundId, publicRoot), { items } = openItems(root, w, { publicRoot });
  for (const id of items) if (!nonempty(reasons?.[id])) throw new Error(`no reason given for open item ${id}`);
  for (const id of Object.keys(reasons ?? {})) if (!items.includes(id)) throw new Error(`${id} is not open; remove its reason`);
  return { schemaVersion: 1, groundId: w.groundId, courses: graph.courses.map(c => c.slug).sort(), groundManifestSha256: graph.courses[0].groundManifest.sha256,
    decision: 'admit-as-advisory', acceptedBy: 'owner', acceptedOn, basis, open: Object.fromEntries(items.map(id => [id, reasons[id]])) };
}

/* node packages/course-workflow/acceptance.mjs --ground <id>                                   what is open, and whether the record holds
   node packages/course-workflow/acceptance.mjs --ground <id> --record --accepted-on <date> --basis "<the owner's decision>" --reasons <file.json>
   The record is the owner's decision. Write it only after they have made it, in their words. */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const argv = process.argv.slice(2), flag = name => { const i = argv.indexOf(`--${name}`); return i < 0 ? null : argv[i + 1]; };
  const groundId = flag('ground');
  if (!groundId) throw new Error('usage: acceptance.mjs --ground <id> [--record --accepted-on <date> --basis "<decision>" --reasons <file.json>]');
  const w = assertWorkflow(readJson(root, `course-workflows/${groundId}/workflow.json`));
  if (argv.includes('--record')) {
    const record = draftAcceptance(root, w, { acceptedOn: flag('accepted-on'), basis: flag('basis'), reasons: JSON.parse(fs.readFileSync(flag('reasons'), 'utf8')) });
    fs.writeFileSync(safePath(root, acceptancePath(groundId)), `${JSON.stringify(record, null, 2)}\n`);
  }
  const result = admitAccepted(root, w), open = openItems(root, w, { publicRoot: 'apps/golf/public' }).items;
  console.log(JSON.stringify({ groundId, releasePolicy: w.releasePolicy, open, ready: result.ready, errors: result.errors }, null, 1));
  process.exitCode = result.ready ? 0 : 1;
}
