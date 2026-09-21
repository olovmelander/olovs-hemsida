/* Explicit offline inputs; acquisition is a separate, deliberately reviewed act. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { digest, fileDigest, readJson, safePath } from './io.mjs';
import { ID, SHA } from './standard.mjs';
import { ringSpecFor } from '../course-v2/ground-rings-registry.mjs';
import { canonicalJson } from '../course-v2/canonical-json.mjs';
import { validateSourceManifest } from '../course-geo/manifest.mjs';
import { verifyChunkAsset } from '../course-v2/chunk-node.mjs';

const keys = (value, allowed, label) => {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label}: expected object`);
  assert.deepEqual(Object.keys(value).sort(), [...allowed].sort(), `${label}: missing or unknown configuration fields`);
};

export function loadProduction(root, groundId) {
  assert(ID.test(groundId), 'invalid ground identity');
  const configPath = `course-workflows/${groundId}/production.json`;
  const config = readJson(root, configPath);
  keys(config, ['schemaVersion', 'groundId', 'visualSetup', 'frame', 'baselineGround', 'terrain', 'vegetation', 'courses', 'mappingEvidence', 'review'], configPath);
  keys(config.terrain, ['directory', 'evidence', 'maximumBaselineDifferenceMetres'], 'terrain');
  keys(config.vegetation, ['directory', 'campaigns', 'evidence', 'reviewMode', 'observedOn', 'reviewNote'], 'vegetation');
  keys(config.review, ['sourceDirectory', 'captureBackend', 'captureQuality', 'capturePresets', 'notes', 'acquisition'], 'review');
  assert(Number.isFinite(config.terrain.maximumBaselineDifferenceMetres) && config.terrain.maximumBaselineDifferenceMetres >= 0);
  assert.equal(config.vegetation.reviewMode, 'machine-v1', 'implement and review any different vegetation decision adapter explicitly');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(config.vegetation.observedOn));
  for (const [field, allowed] of [['captureBackend', ['webgpu', 'webgl2']], ['captureQuality', ['hi', 'lo']],
    ['capturePresets', ['noon', 'golden', 'mist', 'dawn', 'host']]]) {
    const values = config.review[field];
    assert(Array.isArray(values) && values.length && new Set(values).size === values.length && values.every(x => allowed.includes(x)), `invalid ${field}`);
  }
  assert.equal(config.schemaVersion, 1);
  assert.equal(config.groundId, groundId);
  const workflow = readJson(root, `course-workflows/${groundId}/workflow.json`);
  const spec = ringSpecFor(groundId);
  assert.deepEqual(config.courses.map(c => ({ slug: c.slug, holes: c.holes })), workflow.courses);
  assert.deepEqual(config.courses.map(c => c.slug).sort(), [...spec.courseSlugs].sort());
  assert.equal(config.visualSetup, 'v2-ghibli');
  const { fingerprint, ...frame } = config.frame;
  assert.equal(digest(canonicalJson(frame)), fingerprint, 'frame fingerprint mismatch');
  assert.equal(frame.origin.easting, spec.centre.easting);
  assert.equal(frame.origin.northing, spec.centre.northing);
  for (const c of config.courses) {
    keys(c, ['slug', 'holes', 'model', 'heightfields', 'card', 'cover', 'strokeIndexStatus', 'accuracyTier', 'player', 'sidecars'], c.slug);
    assert(['A', 'B', 'C', 'D', 'unrated'].includes(c.accuracyTier));
    assert(Object.keys(c.sidecars).every(x => ['landcover', 'mown-surface', 'surroundings'].includes(x)), 'unsupported retained sidecar');
    assert.equal(c.player.slug, c.slug);
    assert.equal(c.strokeIndexStatus, spec.courseModels[c.slug].strokeIndexStatus);
  }
  assert.equal(workflow.publicRoot, `output/course-workflow/${groundId}/public`);
  for (const ref of inputReferences({ config })) {
    keys(ref, ['path', 'sha256'], 'pinned input');
    assert(SHA.test(ref.sha256), 'invalid input hash'); safePath(root, ref.path);
  }
  return { root, groundId, configPath, config, workflow, spec,
    stageRoot: `output/course-workflow/${groundId}/stages` };
}

export function pinned(root, reference) {
  assert(reference && SHA.test(reference.sha256), 'an exact input SHA-256 is required');
  const file = safePath(root, reference.path);
  assert.equal(fileDigest(root, reference.path), reference.sha256, `${reference.path}: pinned input changed; review the source revision`);
  return file;
}

export function readPinned(root, reference) { return JSON.parse(fs.readFileSync(pinned(root, reference), 'utf8')); }

export function inputReferences(ctx) {
  const c = ctx.config;
  return [c.baselineGround, c.terrain.evidence, c.vegetation.campaigns, c.vegetation.evidence,
    ...c.courses.flatMap(x => [x.model, x.card, x.heightfields, x.cover, ...Object.values(x.sidecars)].filter(Boolean)),
    ...c.mappingEvidence, c.review.acquisition];
}

export function rasterInputs(ctx) {
  const c = ctx.config;
  const evidence = readPinned(ctx.root, c.terrain.evidence);
  assert.equal(evidence.groundId, ctx.groundId);
  assert.equal(evidence.levels.length, ctx.spec.levels.length);
  const result = ctx.spec.levels.map(level => {
    const row = evidence.levels.find(x => x.lod === level.lod);
    assert(row, `missing ring evidence l${level.lod}`);
    return { path: `${c.terrain.directory}/l${level.lod}.f32`, sha256: row.rasterSha256,
      kind: 'terrain', level, evidence: row };
  });
  const canopy = readPinned(ctx.root, c.vegetation.evidence);
  const campaigns = readPinned(ctx.root, c.vegetation.campaigns);
  assert.equal(canopy.groundId, ctx.groundId);
  assert.equal(canopy.frameFingerprint, c.frame.fingerprint);
  assert.equal(canopy.campaignsSha256, c.vegetation.campaigns.sha256);
  assert.deepEqual(canopy.campaigns.map(x => x.campaignId).sort(), [...campaigns.activeItemIds].sort(),
    'every active canopy campaign needs evidence; explicitly adapt partial coverage');
  for (const row of canopy.campaigns) {
    const stem = row.campaignId.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    result.push({ path: `${c.vegetation.directory}/chm-${stem}.f32`, sha256: row.files.chm.sha256,
      sidecar: `${c.vegetation.directory}/chm-${stem}.json`, kind: 'canopy', campaignId: row.campaignId,
      evidence: row });
  }
  return result;
}

export function inspectInputs(ctx) {
  const { root, workflow, config } = ctx;
  const errors = [], checks = [];
  const check = (label, fn) => {
    try { fn(); checks.push({ input: label, status: 'verified' }); }
    catch (e) { errors.push({ input: label, reason: e.message }); }
  };
  let source;
  check(workflow.sourceManifest, () => {
    source = readJson(root, workflow.sourceManifest);
    assert.equal(source.groundId, ctx.groundId);
    assert.deepEqual([...source.courseSlugs].sort(), config.courses.map(c => c.slug).sort());
    assert.deepEqual(validateSourceManifest(source, { catalog: readJson(root, 'geo_data/course-v2/source-catalog.json') }), []);
  });
  for (const ref of inputReferences(ctx)) check(ref.path, () => pinned(root, ref));
  for (const a of source?.artifacts || []) check(a.path, () => pinned(root, { path: a.path, sha256: a.sha256 }));
  check('baseline frame', () => assert.deepEqual(readPinned(root, config.baselineGround).frame, config.frame));
  check('baseline resource inventory', () => {
    for (const ref of baselineAssets(ctx)) check(`apps/golf/public/${ref.url}`, () =>
      verifyChunkAsset(ref, fs.readFileSync(safePath(root, `apps/golf/public/${ref.url}`))));
  });
  let rasters = [];
  check('raster inventory', () => { rasters = rasterInputs(ctx); });
  for (const ref of rasters) {
    check(ref.path, () => pinned(root, ref));
    if (ref.sidecar) check(ref.sidecar, () => validateCanopySidecar(ctx, ref, readJson(root, ref.sidecar)));
  }
  return { schemaVersion: 1, groundId: ctx.groundId, configurationSha256: fileDigest(root, ctx.configPath),
    readyToBuild: errors.length === 0, geographicApproval: false, checks, errors,
    sourceBlockers: source?.blockers || [], frameStatus: source?.canonicalFrame.originStatus || 'unknown',
    limitations: ['Checks verify retained inputs, not source accuracy or contemporary completeness.',
      'Raw imagery, independent controls, per-object review and named-device acceptance remain separate.'] };
}

export function validateCanopySidecar(ctx, ref, sidecar) {
  assert.equal(sidecar.groundId, ctx.groundId);
  assert.equal(sidecar.campaignId, ref.campaignId);
  assert.equal(sidecar.frameFingerprint, ctx.config.frame.fingerprint);
  assert.equal(sidecar.layer, 'chm');
  assert.equal(sidecar.sampleSpacingMetres, 1);
  assert.equal(sidecar.noData, null);
  const boxes = ref.evidence.perTile.map(t => t.interiorBboxEpsg3006);
  const west = Math.min(...boxes.map(b => b[0])), east = Math.max(...boxes.map(b => b[2]));
  const south = Math.min(...boxes.map(b => b[1])), north = Math.max(...boxes.map(b => b[3]));
  // The reader's tile-aligned target can extend beyond the campaign boundary.
  assert(Number.isInteger(sidecar.width) && Number.isInteger(sidecar.height));
  assert(sidecar.width > 0 && sidecar.height > 0 && sidecar.width <= 16384 && sidecar.height <= 16384);
  const extent = [sidecar.originEasting, sidecar.originNorthing - sidecar.height,
    sidecar.originEasting + sidecar.width, sidecar.originNorthing];
  assert(extent[0] <= west && extent[1] <= south && extent[2] >= east && extent[3] >= north,
    'canopy sidecar does not cover its measured tile inventory');
  const core = ctx.spec.levels[0], world = readPinned(ctx.root, ctx.config.baselineGround).bounds;
  // Historical acquisitions use either the world rectangle or --tight-grid.
  // Campaign totals count only intersected cells and are NOT raster dimensions.
  const allowed = [[core.originEasting, core.originNorthing - 4096, core.originEasting + 4096, core.originNorthing],
    [world.minEasting, world.minNorthing, world.maxEasting, world.maxNorthing]];
  assert(allowed.some(bounds => bounds.every((v, i) => v === extent[i])), 'canopy grid is neither the recorded ground nor its full finest frontier');
  assert.equal(fs.statSync(safePath(ctx.root, ref.path)).size, sidecar.width * sidecar.height * 4, 'canopy byte count disagrees with sidecar');
  return sidecar;
}

export function baselineAssets(ctx) {
  const ground = readPinned(ctx.root, ctx.config.baselineGround);
  assert.deepEqual(ground.frame, ctx.config.frame);
  return ground.tiles.flatMap(t => [t.lod === 0 ? t.layers.terrain : null, t.layers.objects].filter(Boolean));
}

export function writeBytes(root, relative, bytes) {
  const target = safePath(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}

// Transactional stage directories: a failed build cannot leave plausible partial outputs.
export async function stageOutput(ctx, stage, build) {
  const relative = stage === 'assemble' ? ctx.workflow.publicRoot : `${ctx.stageRoot}/${stage}`;
  const target = safePath(ctx.root, relative), temporary = `${relative}.tmp-${process.pid}`;
  const scratch = safePath(ctx.root, temporary);
  const backup = `${target}.previous`;
  assert(!fs.existsSync(scratch), `interrupted stage exists: ${temporary}`);
  assert(!fs.existsSync(backup), `interrupted promotion exists: ${relative}.previous; inspect and recover it first`);
  fs.mkdirSync(scratch, { recursive: true });
  try {
    const result = await build(temporary);
    // Both paths are fixed, task-owned output directories, never caller-supplied source paths.
    if (fs.existsSync(target)) fs.renameSync(target, backup);
    try { fs.renameSync(scratch, target); }
    catch (e) { if (fs.existsSync(backup)) fs.renameSync(backup, target); throw e; }
    fs.rmSync(backup, { recursive: true, force: true });
    return result;
  } catch (e) { fs.rmSync(scratch, { recursive: true, force: true }); throw e; }
}

export function stageInputFiles(ctx) {
  const refs = inputReferences(ctx).map(x => x.path);
  const source = readJson(ctx.root, ctx.workflow.sourceManifest);
  const rasters = rasterInputs(ctx).flatMap(x => [x.path, x.sidecar].filter(Boolean));
  return [...new Set([ctx.configPath, ctx.workflow.sourceManifest, 'geo_data/course-v2/source-catalog.json',
    ...refs, ...source.artifacts.map(x => x.path), ...rasters,
    ...baselineAssets(ctx).map(r => `apps/golf/public/${r.url}`)])].sort();
}
