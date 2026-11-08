/* Stage `publish`: the reviewed candidates compiled into a STAGING public root.

   Before anything is compiled the stage checks, and stops on the first that fails:
   1. the held-out gate: PASS, or FAIL with an owner exception in trees.json
      that pins this very benchmark file (gate.mjs) -- a FAIL is never relabelled;
   2. the review checklist: every item done, excepted or not applicable, person
      and owner marks with who and when (review.mjs);
   3. the receipts: candidates.csv, the summary and the residual rasters are
      the bytes the candidates stage wrote (no hand edits since);
   4. the staging root is not the live public root.
   Without --execute it prints the plan and stops for the owner. With
   --execute it runs the plan one step at a time: copy the live public root to
   the staging root if it is not there, compile-vegetation --reviewed into
   publication.compileOut, publish-vegetation into the staging root, the
   startup packs, then verifies the staged graph (from the pilot's
   verify-staging). Adopting staging into apps/golf/public, re-pinning
   production.json with record-artifact-checksum, and re-baking the map trees
   and prepared data stay the owner-authorised promotion of the course
   production workflow (docs/course-production-workflow.md); this stage never
   writes the live root.                                                    */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadGround } from '../../packages/course-workflow/audit.mjs';
import { verifyAssetGraph } from '../../packages/course-v2/graph-node.mjs';
import { readChunk } from '../../packages/course-v2/chunk-node.mjs';
import { V2_SUPPORTED_FEATURES } from '../../packages/course-v2/schema.mjs';
import { gateReport } from './benchmark.mjs';
import { changedOutputs, readReceipt, writeReceipt } from './receipts.mjs';
import { openItems } from './review.mjs';

/* checklist items only the owner can close (the held-out gate's exception and
   the species-mix flags he accepts are his too) */
const OWNER_ITEMS = new Set(['held-out-gate', 'species-mix-flags']);

/**
 * Every reason publication may not go ahead (empty when it may). With
 * pendingOwner, the reasons that are the owner's own decisions -- a failed
 * gate covered by a pendingOwnerApprovals record, and owner checklist items --
 * are returned separately as `pending`, so a round can be STAGED for him to
 * judge; they are never cleared or relabelled as decided.
 */
export function publicationBlockers(ctx, { gate, checklist, candidatesReceipt, changed }, { pendingOwner = false } = {}) {
  const blockers = [];
  const pending = [];
  if (!gate || gate.error) blockers.push(`no gate result: ${gate?.error || 'run --stage benchmark'}`);
  else if (!gate.verdict.allowed) (pendingOwner && gate.pending ? pending : blockers).push(gate.pending ? `${gate.verdict.note} PENDING OWNER APPROVAL (${gate.pending.recordedOn}, ${gate.pending.record})` : gate.verdict.note);
  if (!checklist) blockers.push('no review checklist: run --stage review');
  else for (const item of openItems(checklist)) (pendingOwner && (item.who === 'owner' || OWNER_ITEMS.has(item.id)) ? pending : blockers).push(`checklist ${item.id} [${item.who}] is ${item.status}${item.who !== 'auto' && item.status === 'done' ? ' without who and when' : ''}`);
  if (!candidatesReceipt) blockers.push('no candidates receipt: run --stage candidates (a candidate table without a receipt cannot be shown to be the stage\'s own output)');
  else if (candidatesReceipt.result?.round && candidatesReceipt.result.round !== ctx.round.id) blockers.push(`the candidates were built for round ${candidatesReceipt.result.round}, not ${ctx.round.id}`);
  for (const c of changed) blockers.push(`${c.path} ${c.why}`);
  const live = path.resolve(ctx.root, ctx.config.published.publicDir);
  if (path.resolve(ctx.root, ctx.config.publication.stagingRoot) === live) blockers.push('the staging root is the live public root');
  return pendingOwner ? { blockers, pending } : blockers;
}

/** The staged commands, one at a time, as argument arrays (no shell). */
export function publicationPlan(ctx) {
  const pub = ctx.config.publication;
  const residual = name => ctx.rel(path.join(ctx.paths.rasters, name));
  return [
    { what: 'compile the reviewed candidates', command: [process.execPath, 'packages/course-v2/vegetation/compile-vegetation.mjs', '--ground', ctx.groundId, '--observed-on', pub.observedOn, '--out', pub.compileOut, '--public', pub.stagingRoot, '--campaigns', ctx.config.laser.campaigns, '--reviewed', ctx.rel(ctx.reviewFile('candidates.csv')), '--scope', pub.scope.join(','), '--residual-chm', residual('residual-chm-050.bin'), '--residual-labels', residual('residual-labels-050.bin'), '--review', pub.reviewStatement] },
    { what: 'publish the vegetation into the staging root (every routing)', command: [process.execPath, 'packages/course-v2/vegetation/publish-vegetation.mjs', '--ground', ctx.groundId, '--compile', pub.compileOut, '--public', pub.stagingRoot] },
    { what: 'rebuild the startup packs of the staging root', command: [process.execPath, 'tools/build-startup-packs.mjs', pub.stagingRoot] },
  ];
}

/** The staged root's graph integrity and its tree records (from the pilot's verify-staging). */
export function verifyStaging(ctx, publicRoot) {
  const graph = loadGround(ctx.root, ctx.groundId, publicRoot);
  const read = url => fs.readFileSync(path.join(ctx.root, publicRoot, url));
  const resources = new Map();
  const add = ref => resources.set(ref.url, read(ref.url));
  for (const entry of graph.index.courses) {
    add(entry.manifest);
    const course = JSON.parse(read(entry.manifest.url));
    add(course.groundManifest); add(course.routing);
    const ground = JSON.parse(read(course.groundManifest.url));
    add(ground.shell);
    for (const tile of ground.tiles) Object.values(tile.layers).filter(Boolean).forEach(add);
  }
  const integrity = verifyAssetGraph({ root: graph.index, resources, supportedFeatures: V2_SUPPORTED_FEATURES });
  const counts = { trees: 0, typed: { conifer: 0, broadleaf: 0, null: 0 }, play: { near: 0, woodland: 0, none: 0 }, objectTiles: 0, standTiles: 0, attributeTiles: 0 };
  for (const tile of graph.ground.tiles.filter(t => t.lod === 0)) {
    if (tile.layers.stands) counts.standTiles++;
    if (!tile.layers.objects) continue;
    counts.objectTiles++;
    const chunk = readChunk(read(tile.layers.objects.url));
    if (chunk.header.requiredFeatures.includes('object-registry-tree-attributes-v1')) counts.attributeTiles++;
    for (const record of chunk.content.records) {
      if (record.class !== 'tree') continue;
      counts.trees++;
      counts.typed[record.subtype ?? 'null'] = (counts.typed[record.subtype ?? 'null'] || 0) + 1;
      counts.play[record.play ?? 'none']++;
    }
  }
  return { publicRoot, groundId: ctx.groundId, courses: graph.courses.map(c => c.slug), groundManifest: graph.courses[0].groundManifest.url, integrity: Boolean(integrity), counts };
}

export async function run(ctx, options) {
  let gate;
  try { gate = gateReport(ctx); } catch (error) { gate = { error: error.message }; }
  const checklistPath = ctx.reviewFile('review-checklist.json');
  const checklist = fs.existsSync(checklistPath) ? JSON.parse(fs.readFileSync(checklistPath, 'utf8')) : null;
  const candidatesReceipt = readReceipt(ctx, 'candidates');
  const changed = candidatesReceipt ? changedOutputs(ctx, candidatesReceipt) : [];
  const pendingOwner = Boolean(options['pending-owner']);
  const checked = publicationBlockers(ctx, { gate, checklist, candidatesReceipt, changed }, { pendingOwner });
  const blockers = pendingOwner ? checked.blockers : checked;
  const pending = pendingOwner ? checked.pending : [];
  const gateLine = gate?.gate ? `held-out gate ${gate.gate.status}${gate.gate.status === 'FAIL' && gate.verdict.allowed ? ` (owner exception of ${gate.verdict.ownerException.decidedOn})` : ''}${pending.length ? '; STAGED PENDING OWNER APPROVAL' : ''}` : 'held-out gate: no result';
  if (blockers.length) {
    return { status: gate?.gate && !gate.verdict.allowed ? 'gate-fail' : 'stop', message: `${gateLine}\nPUBLICATION BLOCKED:\n${blockers.map(b => `  - ${b}`).join('\n')}` };
  }
  const plan = publicationPlan(ctx);
  const planText = plan.map((step, i) => `  ${i + 1}. ${step.what}: node ${step.command.slice(1).map(a => (/[\s"]/.test(a) ? JSON.stringify(a) : a)).join(' ')}`).join('\n');
  const staging = ctx.config.publication.stagingRoot;
  const pendingText = pending.length ? `\nPENDING THE OWNER (not decided; staged for his review only):\n${pending.map(b => `  - ${b}`).join('\n')}` : '';
  if (!options.execute) {
    return { status: 'stop', message: `${gateLine}; ${pending.length ? 'every other check passes' : 'checklist closed'}; receipts unchanged.${pendingText}\nPLAN (staging only; the live root is never written):\n  0. copy ${ctx.config.published.publicDir} to ${staging} if it is not there\n${planText}\n  then verify the staged graph and its tree records.\nThe owner authorises the run: --stage publish --execute. Promotion into ${ctx.config.published.publicDir} follows the course production workflow.` };
  }
  const stagingAbs = path.resolve(ctx.root, staging);
  if (!fs.existsSync(stagingAbs)) {
    console.log(`copying ${ctx.config.published.publicDir} to ${staging}`);
    fs.cpSync(path.resolve(ctx.root, ctx.config.published.publicDir), stagingAbs, { recursive: true });
  }
  for (const step of plan) {
    console.log(`-- ${step.what}`);
    const result = spawnSync(step.command[0], step.command.slice(1), { cwd: ctx.root, stdio: 'inherit' });
    if (result.status !== 0) return { status: 'error', message: `${step.what} failed (exit ${result.status})` };
  }
  const verified = verifyStaging(ctx, staging);
  console.log(JSON.stringify(verified, null, 1));
  const reportPath = path.join(ctx.root, ctx.config.publication.compileOut, 'staging-verification.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const ownerApproval = pending.length ? { status: 'pending-owner-approval', record: gate.pending ?? null, pending } : { status: gate.verdict.allowed ? (gate.gate.status === 'PASS' ? 'not-needed' : 'owner-exception') : 'none' };
  fs.writeFileSync(reportPath, JSON.stringify({ ...verified, gate: gate.verdict, ownerApproval, verifiedAt: new Date().toISOString() }, null, 1) + '\n');
  writeReceipt(ctx, 'publish', { inputs: [ctx.reviewFile('candidates.csv'), path.join(ctx.paths.rasters, 'residual-chm-050.bin'), path.join(ctx.paths.rasters, 'residual-labels-050.bin'), checklistPath], outputs: [reportPath], result: { gate: gate.verdict, ownerApproval, integrity: verified.integrity, counts: verified.counts } });
  if (!verified.integrity) return { status: 'error', message: 'the staged graph does not verify' };
  return { status: 'done', message: `staged and verified: ${verified.counts.trees} tree records in ${staging}. Next (owner-authorised, course production workflow): review the staged root on the GPU, adopt it into ${ctx.config.published.publicDir}, re-pin production.json (vegetation.reviewMode reviewed-candidates-v1: candidates.csv and the residual rasters) with record-artifact-checksum, re-bake prepared data and map trees, and record it in the review README.` };
}
