import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { STAGES, assertWorkflow } from './standard.mjs';
import { inventory, candidateInventory, hashObject, readJson, writeJson, safePath } from './io.mjs';

const recordPath = (w, stage) => `course-workflows/${w.groundId}/build-records/${stage}.json`;
function stamp(root, w, stage, prior, publicRoot = w.publicRoot) {
  const s = w.stages[stage];
  return hashObject({ standard: w.standard, groundId: w.groundId, publicRoot: w.publicRoot, stage, specification: s,
    code: inventory(root, w.watch), inputs: candidateInventory(root, s.inputs, w.publicRoot, publicRoot), prior });
}
export function plan(root, w, { publicRoot = w.publicRoot } = {}) {
  assertWorkflow(w);
  const result = [];
  let prior = null;
  for (const stage of STAGES) {
    const s = w.stages[stage];
    const item = { stage, command: s.command, status: 'pending', reason: '', fingerprint: null };
    if (s.command === null) { item.status = 'unconfigured'; item.reason = 'Supply a reviewed adapter command and its inputs/outputs.'; }
    else if (result.length && result.at(-1).status !== 'current') { item.status = 'blocked'; item.reason = `Complete ${result.at(-1).stage} first.`; }
    else {
      try {
        item.fingerprint = stamp(root, w, stage, prior, publicRoot);
        const p = recordPath(w, stage);
        if (fs.existsSync(safePath(root, p))) {
          const receipt = readJson(root, p);
          const outputs = candidateInventory(root, s.outputs, w.publicRoot, publicRoot);
          if (receipt.status === 'passed' && receipt.fingerprint === item.fingerprint &&
            hashObject(receipt.outputs) === hashObject(outputs)) {
            item.status = 'current'; prior = hashObject(receipt);
          } else { item.status = 'stale'; item.reason = 'Inputs, outputs, command, dependencies or implementation changed, or the last run failed.'; }
        }
      } catch (e) { item.status = 'blocked'; item.reason = e.message; }
    }
    result.push(item);
  }
  return result;
}
export function runStage(root, w, stage, { execute = spawnSync } = {}) {
  assertWorkflow(w);
  if (!STAGES.includes(stage)) throw new Error(`unknown stage ${stage}`);
  const steps = plan(root, w);
  const at = STAGES.indexOf(stage);
  const current = steps[at];
  if (current.status === 'current') return { stage, status: 'skipped', reason: 'verified inputs and outputs are unchanged' };
  if (w.stages[stage].command === null) throw new Error(`${stage}: adapter is not configured`);
  if (at > 0 && steps[at - 1].status !== 'current') throw new Error(`${stage}: prerequisite ${STAGES[at - 1]} is not current`);
  // Existence checks happen before starting a subprocess. This runner executes
  // trusted repository adapters, not arbitrary shell expressions.
  const s = w.stages[stage];
  inventory(root, w.watch);
  const inputsBefore = inventory(root, s.inputs);
  for (const p of s.outputs) safePath(root, p);
  const lock = safePath(root, `course-workflows/${w.groundId}/.run-lock`);
  const handle = fs.openSync(lock, 'wx');
  let receipt;
  try {
    const startedAt = new Date().toISOString();
    const previous = at ? hashObject(readJson(root, recordPath(w, STAGES[at - 1]))) : null;
    const fingerprint = stamp(root, w, stage, previous);
    const [command, ...args] = s.command.map(v => v.replaceAll('{ground}', w.groundId).replaceAll('{public}', w.publicRoot));
    const run = execute(command === 'node' ? process.execPath : command, args, {
      cwd: root, shell: false, stdio: 'inherit',
      env: { ...process.env, BANVY_WORKFLOW_GROUND: w.groundId, BANVY_WORKFLOW_PUBLIC_ROOT: safePath(root, w.publicRoot) },
    });
    if (run.error || run.status !== 0 || run.signal) throw new Error(`${stage}: ${run.error?.message || run.signal || `exit ${run.status}`}`);
    const outputs = inventory(root, s.outputs);
    if (stamp(root, w, stage, previous) !== fingerprint) throw new Error(`${stage}: modified its own inputs or watched implementation`);
    receipt = { schemaVersion: 1, stage, status: 'passed', startedAt, finishedAt: new Date().toISOString(),
      command: [command, ...args], inputsBefore, fingerprint, outputs };
    writeJson(root, recordPath(w, stage), receipt);
    // A downstream adapter must not invalidate previously completed work.
    const after = plan(root, w);
    if (after.slice(0, at + 1).some(x => x.status !== 'current')) throw new Error(`${stage}: changed an earlier stage's inputs or outputs; rebuild from the first stale stage`);
    return receipt;
  } catch (e) {
    writeJson(root, recordPath(w, stage), { schemaVersion: 1, stage, status: 'failed', finishedAt: new Date().toISOString(), error: e.message });
    throw e;
  } finally { fs.closeSync(handle); fs.unlinkSync(lock); }
}
export function runThrough(root, w, through, options) {
  if (!STAGES.includes(through)) throw new Error(`unknown stage ${through}`);
  return STAGES.slice(0, STAGES.indexOf(through) + 1).map(stage => runStage(root, w, stage, options));
}
