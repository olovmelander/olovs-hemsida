/* The tree pipeline's stages, in order. Each stage names what it needs (files
   an earlier stage or a person writes) and what it produces; `kind` says
   whether it runs unattended, stops for a person, or is a gate.

   The order is fixed. A stage refuses to run while an earlier stage's
   products are missing, and the CLI says which stage to run instead. Human
   review stages prepare their material and stop with instructions; they
   never pretend to have reviewed anything.                                 */
import fs from 'node:fs';
import path from 'node:path';

export const STAGES = Object.freeze([
  Object.freeze({
    name: 'acquire', kind: 'automatic', network: 'with --fetch only',
    summary: 'Lantmäteriet laser (COPC) and RGBI orthophotos into the ignored cache; offline it verifies the cache against the pins',
    needs: ctx => [path.join(ctx.root, ctx.config.laser.campaigns)],
    produces: ctx => [path.join(ctx.paths.copc, 'ledger.json'), path.join(ctx.paths.ortho, 'ledger.json')],
  }),
  Object.freeze({
    name: 'canopy', kind: 'automatic',
    summary: 'pit-free CHM, return rasters and the 1 m published-method CHM; cloud ground against the published terrain (stops on a terrain revision)',
    needs: ctx => [path.join(ctx.paths.copc, 'ledger.json')],
    produces: ctx => [ctx.reviewFile('canopy-rasters.json'), path.join(ctx.paths.rasters, 'chm-pitfree-050.bin'), path.join(ctx.paths.rasters, 'points.bin')],
  }),
  Object.freeze({
    name: 'detect', kind: 'automatic',
    summary: 'detector-neutral treetop census and strata (isolated, group, edge, closed; leaf-off type; near play) to choose reference windows',
    needs: ctx => [path.join(ctx.paths.rasters, 'chm-pitfree-050.bin'), path.join(ctx.paths.ortho, 'ledger.json')],
    produces: ctx => [ctx.reviewFile('strata.json')],
  }),
  Object.freeze({
    name: 'verify', kind: 'automatic',
    summary: 'orthophotos registered against the laser on open ground; credential-free source inventory and source policy',
    needs: ctx => [path.join(ctx.paths.rasters, 'chm-pitfree-050.bin'), path.join(ctx.paths.ortho, 'ledger.json'), ctx.reviewFile('canopy-rasters.json')],
    produces: ctx => [ctx.reviewFile('registration.json'), ctx.reviewFile('source-inventory.json')],
  }),
  Object.freeze({
    name: 'reference', kind: 'human-review',
    summary: 'interpretation panels for the declared windows, then (after a person annotates them) the frozen reference sample and its lock',
    needs: ctx => [ctx.reviewFile('registration.json')],
    produces: ctx => [ctx.reviewFile(ctx.sampleFile('reference', 'geojson')), ctx.reviewFile(ctx.sampleFile('reference-lock'))],
  }),
  Object.freeze({
    name: 'benchmark', kind: 'gate',
    summary: 'tune on calibration windows only, calibrate the type rule, score every method on every role, evaluate the 90% held-out gate',
    needs: ctx => [ctx.reviewFile(ctx.sampleFile('reference-lock'))],
    produces: ctx => [ctx.reviewFile(ctx.sampleFile('detector-lock')), ctx.reviewFile(ctx.sampleFile('benchmark'))],
  }),
  Object.freeze({
    name: 'candidates', kind: 'automatic+review',
    summary: 'locked detector over the window, per-tree evidence, stable IDs, decisions and holds, residual rasters; stops while screened crowns are unreviewed',
    needs: ctx => [ctx.reviewFile(ctx.sampleFile('detector-lock')), ctx.reviewFile(ctx.sampleFile('type-rule', 'json', ctx.config.typeRule.round))],
    produces: ctx => [ctx.reviewFile('candidates.csv'), ctx.reviewFile('candidates-summary.json'), path.join(ctx.paths.candidates, 'candidates-full.json'), path.join(ctx.paths.rasters, 'residual-chm-050.bin'), path.join(ctx.paths.rasters, 'residual-labels-050.bin')],
  }),
  Object.freeze({
    name: 'review', kind: 'human-review',
    summary: 'before/after spot panels, species spot check on the photos, screened-crown chips, species mix by zone and the review checklist; stops for the person and the owner',
    needs: ctx => [ctx.reviewFile('candidates.csv'), path.join(ctx.paths.candidates, 'candidates-full.json')],
    produces: ctx => [ctx.reviewFile('review-checklist.json')],
  }),
  Object.freeze({
    name: 'publish', kind: 'gate',
    summary: 'gate PASS or a recorded owner exception, a complete checklist and unchanged receipts; then compile into a STAGING root (never the live one) and verify it',
    needs: ctx => [ctx.reviewFile('candidates.csv'), ctx.reviewFile(ctx.sampleFile('benchmark')), ctx.reviewFile('review-checklist.json')],
    produces: ctx => [path.join(ctx.root, ctx.config.publication.stagingRoot)],
  }),
]);

export const STAGE_NAMES = Object.freeze(STAGES.map(s => s.name));

export function stageIndex(name) {
  const index = STAGE_NAMES.indexOf(name);
  if (index < 0) throw new Error(`unknown stage ${name}; stages: ${STAGE_NAMES.join(', ')}`);
  return index;
}

export const stage = name => STAGES[stageIndex(name)];
export const stagesBefore = name => STAGES.slice(0, stageIndex(name));
export const nextStage = name => STAGES[stageIndex(name) + 1] ?? null;

/**
 * The files a stage needs that are missing, each with the stage (or person)
 * that makes it. Empty when the stage may run. `exists` is injectable for tests.
 */
export function missingPrerequisites(ctx, name, exists = file => fs.existsSync(file)) {
  const missing = [];
  for (const file of stage(name).needs(ctx)) {
    if (exists(file)) continue;
    const maker = STAGES.find(s => s.produces(ctx).includes(file));
    missing.push({ file, madeBy: maker ? maker.name : 'a person (see the stage instructions)' });
  }
  return missing;
}

/** The first stage whose products are not all present: where a run should continue. */
export function firstIncompleteStage(ctx, exists = file => fs.existsSync(file)) {
  return STAGES.find(s => !s.produces(ctx).every(exists)) ?? null;
}
