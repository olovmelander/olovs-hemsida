/* Stage receipts: what a stage read and wrote, by SHA-256, with the code and
   config it ran under. Receipts go to <reviewDir>/pipeline/<stage><suffix>.json
   beside the evidence they describe (committed); the raw cache stays ignored
   but its hashes are recorded. A later stage, and publish above all, checks
   that every recorded output still has its recorded hash: a derived file
   edited by hand after the stage wrote it fails the check.                 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** The pipeline's own code and the shared vegetation modules it runs. */
export const PIPELINE_CODE = Object.freeze([
  'tools/tree-pipeline.mjs',
  'tools/tree-pipeline/config.mjs',
  'tools/tree-pipeline/stages.mjs',
  'tools/tree-pipeline/gate.mjs',
  'tools/tree-pipeline/source-policy.mjs',
  'tools/tree-pipeline/receipts.mjs',
  'tools/tree-pipeline/ortho-store.mjs',
  'tools/tree-pipeline/panels.mjs',
  'tools/tree-pipeline/crown-evidence.mjs',
  'tools/tree-pipeline/published-population.mjs',
  'tools/tree-pipeline/geometry.mjs',
  'tools/tree-pipeline/acquire.mjs',
  'tools/tree-pipeline/canopy.mjs',
  'tools/tree-pipeline/detect.mjs',
  'tools/tree-pipeline/verify.mjs',
  'tools/tree-pipeline/reference.mjs',
  'tools/tree-pipeline/benchmark.mjs',
  'tools/tree-pipeline/candidates.mjs',
  'tools/tree-pipeline/review.mjs',
  'tools/tree-pipeline/publish.mjs',
  'packages/course-v2/vegetation/pit-free-chm.mjs',
  'packages/course-v2/vegetation/tree-detect-v2.mjs',
  'packages/course-v2/vegetation/crown-detect.mjs',
  'packages/course-v2/vegetation/canopy-fields.mjs',
  'packages/course-geo/copc-reader/canopy-build.mjs',
]);

export function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(8 << 20);
  try {
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

export const sha256Text = text => crypto.createHash('sha256').update(text).digest('hex');

function describe(ctx, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return { path: ctx.rel(file), missing: true };
  return { path: ctx.rel(file), bytes: fs.statSync(file).size, sha256: sha256File(file) };
}

export function receiptPath(ctx, stage, { perRound = false } = {}) {
  return path.join(ctx.paths.reviewDir, 'pipeline', perRound ? `${stage}${ctx.round.sampleSuffix}.json` : `${stage}.json`);
}

/**
 * Write a stage receipt. inputs/outputs are absolute file paths; result is the
 * stage's own small summary (status, counts).
 */
export function writeReceipt(ctx, stage, { inputs = [], outputs = [], result = {}, options = {}, perRound = false } = {}) {
  const configFile = path.join(ctx.root, `course-workflows/${ctx.groundId}/trees.json`);
  const receipt = {
    schemaVersion: 1,
    kind: 'tree-pipeline-receipt',
    stage,
    groundId: ctx.groundId,
    reviewId: ctx.config.reviewId,
    round: perRound ? ctx.round.id : null,
    ranAt: new Date().toISOString(),
    node: process.version,
    config: describe(ctx, configFile),
    options,
    code: Object.fromEntries(PIPELINE_CODE.map(file => [file, fs.existsSync(path.join(ctx.root, file)) ? sha256File(path.join(ctx.root, file)) : null])),
    inputs: inputs.map(file => describe(ctx, file)),
    outputs: outputs.map(file => describe(ctx, file)),
    result,
  };
  const file = receiptPath(ctx, stage, { perRound });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(receipt, null, 1) + '\n');
  return { file, receipt };
}

export function readReceipt(ctx, stage, { perRound = false } = {}) {
  const file = receiptPath(ctx, stage, { perRound });
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

/**
 * Outputs of a receipt whose bytes changed since the stage wrote them (or that
 * are gone). Empty when every recorded output is as written.
 */
export function changedOutputs(ctx, receipt) {
  if (!receipt) return [{ path: '(no receipt)', why: 'the stage has no receipt' }];
  const changed = [];
  for (const output of receipt.outputs) {
    if (output.missing) continue;
    const file = path.resolve(ctx.root, output.path);
    if (!fs.existsSync(file)) { changed.push({ path: output.path, why: 'missing' }); continue; }
    if (sha256File(file) !== output.sha256) changed.push({ path: output.path, why: 'changed after the stage wrote it' });
  }
  return changed;
}
