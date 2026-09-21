import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { assertWorkflow } from './standard.mjs';
import { readJson, safePath } from './io.mjs';
import { releaseCheck } from './release.mjs';

export function checkNewCourses(root, baseRef, { checkRelease = releaseCheck } = {}) {
  if (!/^[a-f0-9]{40}$/.test(baseRef || '')) throw new Error('--base-ref must be a resolved full commit SHA');
  const baseRead = p => JSON.parse(execFileSync('git', ['show', `${baseRef}:${p}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 }));
  const previous = baseRead('apps/golf/public/courses/v2-index.json');
  const current = readJson(root, 'apps/golf/public/courses/v2-index.json');
  const previousPlayer = baseRead('apps/golf/public/courses/index.json');
  const currentPlayer = readJson(root, 'apps/golf/public/courses/index.json');
  const old = new Map(previous.courses.map(c => [c.slug, c.groundId]));
  const required = new Set(current.courses.filter(c => !old.has(c.slug) || old.get(c.slug) !== c.groundId).map(c => c.groundId));
  const results = [];
  const oldPlayerSlugs = new Set(previousPlayer.courses.map(c => c.slug));
  for (const c of currentPlayer.courses.filter(c => !oldPlayerSlugs.has(c.slug))) {
    const entry = current.courses.find(e => e.slug === c.slug);
    if (entry) required.add(entry.groundId);
    else results.push({ slug: c.slug, ready: false, errors: ['new player courses require a v2 ground and mandatory workflow'] });
  }
  // Once a course adopts mandatory release checks, removing its workflow or
  // flipping it back to advisory cannot silently downgrade the policy.
  for (const id of new Set(previous.courses.map(c => c.groundId))) {
    const p = `course-workflows/${id}/workflow.json`;
    const exists = execFileSync('git', ['ls-tree', '--name-only', baseRef, '--', p], { cwd: root, encoding: 'utf8' }).trim();
    if (exists && baseRead(p).releasePolicy === 'required') required.add(id);
  }
  for (const id of new Set(current.courses.map(c => c.groundId))) {
    const p = `course-workflows/${id}/workflow.json`;
    if (fs.existsSync(safePath(root, p)) && readJson(root, p).releasePolicy === 'required') required.add(id);
  }
  for (const groundId of [...required].sort()) {
    try {
      const w = assertWorkflow(readJson(root, `course-workflows/${groundId}/workflow.json`));
      if (w.groundId !== groundId || w.releasePolicy !== 'required') throw new Error('new or previously qualified courses require a matching mandatory workflow');
      results.push(checkRelease(root, w, { publicRoot: 'apps/golf/public' }));
    } catch (e) { results.push({ groundId, ready: false, errors: [e.message] }); }
  }
  return { ready: results.every(r => r.ready), grounds: results };
}
