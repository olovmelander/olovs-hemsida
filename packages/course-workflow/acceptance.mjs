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
import { inspectGround, loadGround } from './audit.mjs';
import { reviewErrors, verifyCandidateBytes } from './release.mjs';
import { exactKeys, nonempty, SHA } from './standard.mjs';
import { readJson, safePath } from './io.mjs';

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
