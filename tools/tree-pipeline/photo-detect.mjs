/* Stage `photo-detect` (optional per ground; round 4 at Johannesberg): the
   learned crown detector on the presence photo, for a `fused` round.

   Configured by `photoDetect` in the ground's trees.json; a ground without it
   skips the stage. For every declared source (a patch size and pretrained or
   fine-tuned weights) it writes, in the ignored cache:
   - crowns-<source>-calibration.json: boxes over the CALIBRATION windows
     only. A fine-tuned source is cross-fitted: trained on one fold of the
     calibration windows and run on the other, and back, so the fusion is
     tuned on crowns the detector never trained on;
   - crowns-<source>-all.json: boxes over the whole inner window, from the
     pretrained weights or from weights fine-tuned on every calibration
     window. Held-out windows are never trained on.
   and records the run in photo-detect<suffix>.json (committed): model
   provenance, versions, every file's sha256, and how each was made.

   Photo pixels (the exported raster), crops and weights stay in the cache.
   The stage runs on the GPU (CUDA) through the ground's Python
   (photo/requirements-photo.txt); it is the only GPU stage.            */
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { writeReceipt } from './receipts.mjs';

const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Problems with a photoDetect config (empty when valid or absent). */
export function photoDetectProblems(config) {
  const p = config.photoDetect;
  if (p === undefined) return [];
  const problems = [];
  const allowed = ['$comment', 'rounds', 'python', 'requirements', 'model', 'sources', 'folds', 'halo', 'tuning'];
  for (const key of Object.keys(p || {})) if (!allowed.includes(key)) problems.push(`photoDetect.${key} is not a known setting`);
  if (!Array.isArray(p?.rounds) || !p.rounds.length) problems.push('photoDetect.rounds must list the fused rounds it serves');
  if (typeof p?.python !== 'string' || !/(^|\/)cache\//.test(p.python)) problems.push('photoDetect.python must be a Python inside an ignored cache');
  if (p?.model && Object.keys(p.model).some(k => !['id', 'revision', 'sha256', 'licence'].includes(k))) problems.push('photoDetect.model has an unknown setting');
  if (!p?.model || typeof p.model.id !== 'string' || !/^[0-9a-f]{40}$/.test(p.model.revision || '') || !/^[0-9a-f]{64}$/.test(p.model.sha256 || '')) problems.push('photoDetect.model needs id, a 40-hex revision and the weights sha256');
  if (!Array.isArray(p?.sources) || !p.sources.length) problems.push('photoDetect.sources must declare at least one source');
  for (const [i, s] of (p?.sources || []).entries()) {
    if (!/^[a-z0-9-]+$/.test(s.id || '')) problems.push(`photoDetect.sources[${i}].id must be a lower-case id`);
    if (!(s.patchMetres > 0)) problems.push(`photoDetect.sources[${i}].patchMetres must be > 0`);
    if (!['pretrained', 'finetuned'].includes(s.weights)) problems.push(`photoDetect.sources[${i}].weights must be pretrained or finetuned`);
  }
  if (!Array.isArray(p?.folds) || p.folds.length !== 2) problems.push('photoDetect.folds must split the calibration windows in two');
  return problems;
}

export const photoDir = ctx => path.join(ctx.paths.cacheDir, 'photo');
export const crownsFile = (ctx, source, part) => path.join(photoDir(ctx), `crowns-${source}-${part}.json`);
export const photoRecordPath = ctx => ctx.reviewFile(ctx.sampleFile('photo-detect'));

function run(cmd, args, ctx) {
  const env = { ...process.env, HF_HOME: path.join(ctx.paths.cacheDir, '..', 'hf'), PYTHONIOENCODING: 'utf-8' };
  const result = spawnSync(cmd, args, { cwd: ctx.root, env, encoding: 'utf8', maxBuffer: 1 << 26 });
  const out = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.status !== 0) throw new Error(`${path.basename(cmd)} ${args.slice(0, 2).join(' ')} failed:\n${out.split('\n').filter(l => !/warn/i.test(l)).slice(-15).join('\n')}`);
  return out.split('\n').filter(l => /crowns in|weights ->|snapped|^epoch/.test(l)).join('\n');
}

export async function run_(ctx, options) {
  const p = ctx.config.photoDetect;
  if (!p) return { status: 'done', message: 'no photoDetect in trees.json: this ground has no photo crown detector (the stage is optional)' };
  const problems = photoDetectProblems(ctx.config);
  if (problems.length) return { status: 'stop', message: `photoDetect: ${problems.join('; ')}` };
  if (!p.rounds.includes(ctx.round.id)) return { status: 'done', message: `round ${ctx.round.id} does not use the photo detector (photoDetect.rounds: ${p.rounds.join(', ')})` };
  const python = path.join(ctx.root, p.python);
  const script = path.join(ctx.root, 'tools/tree-pipeline/photo/crowns.py');
  const dir = photoDir(ctx);
  fs.mkdirSync(dir, { recursive: true });
  const raster = path.join(dir, `ortho-${ctx.presence.key}.json`);
  const train = path.join(dir, `train-${ctx.round.id}.json`);
  const log = [];
  /* the raster and the calibration training crops */
  const exportArgs = ['tools/tree-pipeline/photo/export-ortho.mjs', '--ground', ctx.groundId, '--round', ctx.round.id, '--raw', ctx.paths.rawDir, '--halo', String(p.halo ?? 64), ...(fs.existsSync(raster) && !options.reexport ? ['--skip-raster'] : [])];
  log.push(run(process.execPath, ['--max-old-space-size=6000', ...exportArgs], ctx) || 'export: done');
  const trainDoc = JSON.parse(fs.readFileSync(train, 'utf8'));
  const calibrationIds = trainDoc.crops.map(c => c.window);
  for (const fold of p.folds) for (const id of fold) if (!calibrationIds.includes(id)) throw new Error(`photoDetect.folds names ${id}, which is not a calibration window of round ${ctx.round.id}`);
  /* the calibration regions: each training crop grown by 20 m of context */
  const regionsFor = ids => trainDoc.crops.filter(c => ids.includes(c.window)).map(c => ({ id: c.window, bbox: [c.bbox[0] - 20, c.bbox[1] - 20, c.bbox[2] + 20, c.bbox[3] + 20] }));
  const regionFile = (name, ids) => { const f = path.join(dir, `regions-${name}.json`); fs.writeFileSync(f, JSON.stringify(regionsFor(ids))); return f; };
  const allRegions = regionFile('calibration', calibrationIds);
  const only = (options.only || '').split(',').filter(Boolean);
  const record = { schemaVersion: 1, kind: 'photo-crown-detection', round: ctx.round.id, madeAt: new Date().toISOString(), model: p.model, campaign: { key: ctx.presence.key, date: ctx.presence.date }, raster: JSON.parse(fs.readFileSync(raster, 'utf8')).sha256, train: { file: path.basename(train), sha256: sha(train), referenceLockSha256: trainDoc.referenceLockSha256, windows: calibrationIds }, folds: p.folds, sources: {} };
  const previous = fs.existsSync(photoRecordPath(ctx)) ? JSON.parse(fs.readFileSync(photoRecordPath(ctx), 'utf8')) : null;
  /* a source this run does not redo keeps the detections an earlier record (this round's, or another round's of the same calibration windows) made, when their files are unchanged */
  const earlier = [previous, ...ctx.config.rounds.filter(r => r.id !== ctx.round.id).map(r => ctx.reviewFile(ctx.sampleFile('photo-detect', 'json', r.id))).filter(f => fs.existsSync(f)).map(f => JSON.parse(fs.readFileSync(f, 'utf8')))].filter(Boolean);
  const reusable = id => earlier.map(r => r.sources?.[id]).find(e => e && ['calibration', 'all'].every(part => fs.existsSync(crownsFile(ctx, id, part)) && sha(crownsFile(ctx, id, part)) === e[part].sha256));
  for (const source of p.sources) {
    if (only.length && !only.includes(source.id)) { const kept = reusable(source.id); if (kept) record.sources[source.id] = { ...kept, reused: true }; continue; }
    const common = ['--raster', raster, '--patch-metres', String(source.patchMetres)];
    const tiling = source.offsets > 1 ? ['--offsets', String(source.offsets)] : [];
    const cal = crownsFile(ctx, source.id, 'calibration');
    const all = crownsFile(ctx, source.id, 'all');
    const entry = { ...source };
    if (source.weights === 'pretrained') {
      log.push(run(python, ['-I', script, 'detect', ...common, ...tiling, '--regions', allRegions, '--out', cal], ctx));
      log.push(run(python, ['-I', script, 'detect', ...common, ...tiling, '--region-size', '256', '--out', all], ctx));
    } else {
      const snap = source.snapTo ? ['--snap-to', crownsFile(ctx, source.snapTo, 'calibration')] : [];
      const trainArgs = ['--train', train, '--epochs', String(source.epochs ?? 12), '--lr', String(source.lr ?? 5e-5), '--per-crop', String(source.perCrop ?? 6), '--seed', String(source.seed ?? 7), ...snap];
      const parts = [];
      for (const [k, fold] of p.folds.entries()) {
        const other = p.folds[1 - k];
        const w = path.join(dir, `w-${source.id}-fold${k}.pt`);
        log.push(run(python, ['-I', script, 'train', ...common, ...trainArgs, '--windows', fold.join(','), '--out', w], ctx));
        const out = path.join(dir, `crowns-${source.id}-fold${k}-on-other.json`);
        log.push(run(python, ['-I', script, 'detect', ...common, '--regions', regionFile(`${source.id}-other${k}`, other), '--weights', w, '--out', out], ctx));
        parts.push(JSON.parse(fs.readFileSync(out, 'utf8')));
        entry[`fold${k}Weights`] = JSON.parse(fs.readFileSync(`${w}.json`, 'utf8'));
      }
      fs.writeFileSync(cal, JSON.stringify({ ...parts[0], weights: 'cross-fitted (two folds of the calibration windows)', weightsSha256: null, regions: [...parts[0].regions, ...parts[1].regions] }));
      const w = path.join(dir, `w-${source.id}-all.pt`);
      log.push(run(python, ['-I', script, 'train', ...common, ...trainArgs, '--windows', calibrationIds.join(','), '--out', w], ctx));
      entry.allWeights = JSON.parse(fs.readFileSync(`${w}.json`, 'utf8'));
      log.push(run(python, ['-I', script, 'detect', ...common, '--region-size', '256', '--weights', w, '--out', all], ctx));
    }
    const count = file => JSON.parse(fs.readFileSync(file, 'utf8')).regions.reduce((a, r) => a + r.crowns.length, 0);
    entry.calibration = { file: path.basename(cal), sha256: sha(cal), boxes: count(cal) };
    entry.all = { file: path.basename(all), sha256: sha(all), boxes: count(all) };
    record.sources[source.id] = entry;
  }
  record.environment = (() => { try { const o = JSON.parse(spawnSync(python, ['-I', script, 'info'], { cwd: ctx.root, env: { ...process.env, HF_HOME: path.join(ctx.paths.cacheDir, '..', 'hf') }, encoding: 'utf8' }).stdout); return o; } catch (error) { return { error: String(error) }; } })();
  fs.writeFileSync(photoRecordPath(ctx), JSON.stringify(record, null, 1) + '\n');
  writeReceipt(ctx, 'photo-detect', { inputs: [train, ctx.reviewFile(ctx.sampleFile('reference-lock'))], outputs: [photoRecordPath(ctx), ...Object.values(record.sources).flatMap(s => [crownsFile(ctx, s.id, 'calibration'), crownsFile(ctx, s.id, 'all')])], perRound: true, result: Object.fromEntries(Object.entries(record.sources).map(([k, v]) => [k, { calibration: v.calibration.boxes, all: v.all.boxes }])) });
  return { status: 'done', message: `${log.filter(Boolean).join('\n')}\nphoto crowns for ${Object.keys(record.sources).length} sources -> ${ctx.rel(photoRecordPath(ctx))}` };
}

export { run_ as run };
