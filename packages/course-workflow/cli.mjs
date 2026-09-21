#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertWorkflow, ID, reviewTemplate } from './standard.mjs';
import { readJson, safePath, writeJson, fileDigest } from './io.mjs';
import { catalogueAudit, inspectGround, candidate, markdownAudit } from './audit.mjs';
import { setupWorkflow } from './setup.mjs';
import { plan, runStage, runThrough } from './runner.mjs';
import { releaseCheck } from './release.mjs';
import { checkNewCourses } from './check-new.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HELP = `Course production workflow

  course init --ground <id> --name <name> --courses <slug:18,slug-nine:9> --bbox <west,south,east,north>
  course adopt --ground <existing-id>
  course check
  course audit [--ground <id>] [--public-root <relative-dir>] [--out <report.json>] [--markdown <report.md>] [--check]
  course plan --ground <id>
  course run --ground <id> (--stage <stage> | --through <stage>)
  course candidate --ground <id> [--public-root <relative-dir>]
  course review-template --ground <id> --out <new-review.json> [--public-root <relative-dir>]
  course evidence --path <repository-relative-file>
  course release --ground <id> [--public-root <relative-dir>] [--out <report.json>]
  course check-new --base-ref <full-commit-sha>

Stages: sources -> terrain -> mapping -> vegetation -> assemble -> validate.
init creates pending evidence and adapter slots; it does not invent course geometry.
release verifies readiness and asset integrity; it does not deploy or merge.
`;
function options(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!key.startsWith('--') || Object.hasOwn(parsed, key.slice(2))) throw new Error(`invalid/duplicate option ${key}`);
    if (key === '--check') parsed.check = true;
    else {
      if (args[i + 1] === undefined || args[i + 1].startsWith('--')) throw new Error(`missing value for ${key}`);
      parsed[key.slice(2)] = args[++i];
    }
  }
  return parsed;
}
export function main(argv = process.argv.slice(2), root = ROOT) {
  const [action, ...args] = argv;
  if (!action || action === 'help' || action === '--help') { console.log(HELP); return 0; }
  const o = options(args);
  const allowed = { init: ['ground', 'name', 'courses', 'bbox'], adopt: ['ground'], check: [],
    audit: ['ground', 'public-root', 'out', 'markdown', 'check'], plan: ['ground'], run: ['ground', 'stage', 'through'],
    candidate: ['ground', 'public-root'], 'review-template': ['ground', 'public-root', 'out'], evidence: ['path'],
    release: ['ground', 'public-root', 'out'], 'check-new': ['base-ref'] };
  if (!allowed[action]) throw new Error(`unknown action ${action}`);
  for (const k of Object.keys(o)) if (!allowed[action].includes(k)) throw new Error(`unknown ${action} option --${k}`);
  const workflow = () => {
    if (!ID.test(o.ground || '')) throw new Error('--ground required');
    const w = assertWorkflow(readJson(root, `course-workflows/${o.ground}/workflow.json`));
    if (w.groundId !== o.ground) throw new Error('workflow directory and ground identity differ');
    return w;
  };
  const emit = v => {
    if (o.out) {
      writeJson(root, o.out, v);
      console.log(JSON.stringify({ report: o.out, ...(v.ready !== undefined ? { ready: v.ready, errors: v.errors } : {}),
        ...(v.grounds ? { grounds: v.grounds.length, errors: v.grounds.flatMap(g => g.errors || []) } : {}) }, null, 2));
    } else console.log(JSON.stringify(v, null, 2));
  };
  if (action === 'init' || action === 'adopt') {
    const courses = o.courses?.split(',').map(s => {
      const pair = s.split(':');
      if (pair.length !== 2 || !/^\d+$/.test(pair[1])) throw new Error('--courses must use slug:hole-count');
      return { slug: pair[0], holes: Number(pair[1]) };
    });
    const w = setupWorkflow(root, { groundId: o.ground, name: o.name, courses,
      bbox: o.bbox?.split(',').map(Number), adopt: action === 'adopt' });
    emit({ groundId: w.groundId, workflow: `course-workflows/${w.groundId}/workflow.json`, releasePolicy: w.releasePolicy, status: 'pending-source-and-review' });
  } else if (action === 'check') {
    const dir = safePath(root, 'course-workflows');
    const configs = fs.existsSync(dir) ? fs.readdirSync(dir).filter(x => ID.test(x) && fs.statSync(safePath(root, `course-workflows/${x}`)).isDirectory()) : [];
    const errors = [];
    for (const id of configs) try {
      const w = assertWorkflow(readJson(root, `course-workflows/${id}/workflow.json`));
      if (w.groundId !== id) throw new Error('directory/ground identity mismatch');
    } catch (e) { errors.push(`${id}: ${e.message}`); }
    emit({ workflows: configs.length, errors }); return errors.length ? 1 : 0;
  } else if (action === 'audit') {
    if (o['public-root'] && !o.ground) throw new Error('--public-root requires --ground');
    let report;
    if (o.ground) {
      let sourceManifest;
      if (fs.existsSync(safePath(root, `course-workflows/${o.ground}/workflow.json`))) sourceManifest = workflow().sourceManifest;
      const ground = inspectGround(root, o.ground, { publicRoot: o['public-root'] || 'apps/golf/public', sourceManifest });
      report = { schemaVersion: 1, scope: 'Manifest and source metadata audit; no fresh visual review.', grounds: [ground] };
    } else report = catalogueAudit(root);
    emit(report);
    if (o.markdown) { const p = safePath(root, o.markdown); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, markdownAudit(report)); }
    return o.check && report.grounds.some(g => g.errors.length) ? 1 : 0;
  } else if (action === 'plan') emit(plan(root, workflow()));
  else if (action === 'run') {
    if (Boolean(o.stage) === Boolean(o.through)) throw new Error('supply exactly one of --stage or --through');
    const w = workflow(); emit(o.stage ? runStage(root, w, o.stage) : runThrough(root, w, o.through));
  } else if (action === 'candidate' || action === 'review-template') {
    const w = workflow(), c = candidate(root, w, { publicRoot: o['public-root'] || w.publicRoot });
    if (action === 'review-template') {
      if (!o.out) throw new Error('--out required; existing reviews are never overwritten');
      writeJson(root, o.out, reviewTemplate(w, c.candidateDigest), { exclusive: true });
      console.log(`Pending review written to ${o.out}`);
    } else emit({ groundId: w.groundId, candidateDigest: c.candidateDigest, courses: w.courses });
  } else if (action === 'evidence') emit({ path: o.path, sha256: fileDigest(root, o.path) });
  else if (action === 'release') {
    const w = workflow(); const result = releaseCheck(root, w, { publicRoot: o['public-root'] || w.publicRoot });
    emit(result); return result.ready ? 0 : 1;
  } else if (action === 'check-new') {
    const result = checkNewCourses(root, o['base-ref']); emit(result); return result.ready ? 0 : 1;
  }
  return 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
