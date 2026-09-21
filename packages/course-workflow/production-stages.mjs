import fs from 'node:fs';
import assert from 'node:assert/strict';
import { compileTerrainRings } from '../course-v2/terrain-rings.mjs';
import { decodeTerrainGrid } from '../course-v2/terrain-grid.mjs';
import { verifyChunkAsset } from '../course-v2/chunk-node.mjs';
import { emitGroundGraph, writeGroundGraphFiles } from '../course-v2/emit-ground-graph-node.mjs';
import { verifyAssetGraph } from '../course-v2/graph-node.mjs';
import { V2_SUPPORTED_FEATURES } from '../course-v2/schema.mjs';
import { compileVegetation, writeCompilation, readRawRaster, mergeCourseGeometries, MACHINE_REVIEW_RULES } from '../course-v2/vegetation/compile-vegetation.mjs';
import { createGroundHeightLookup } from '../course-v2/vegetation/ground-sampler.mjs';
import { compileObjectChunks } from '../course-v2/vegetation/object-compiler.mjs';
import { publishStartupPacks } from '../../tools/build-startup-packs.mjs';
import { readPack, inflateStream } from '../course-pack/lib.mjs';
import { loadGround, terrainErrors } from './audit.mjs';
import { safePath, readJson, writeJson, digest, fileDigest, inventory } from './io.mjs';
import { pinned, readPinned, rasterInputs, inspectInputs, validateCanopySidecar, stageOutput, writeBytes } from './production-inputs.mjs';
import { compileMapping } from './production-mapping.mjs';

export function readRingLevels(ctx) {
  return rasterInputs(ctx).filter(r => r.kind === 'terrain').map(ref => {
    const { level, evidence } = ref;
    const side = level.tilesPerSide * ctx.spec.tileSegments + 1;
    assert.equal(evidence.extent.minEasting, level.originEasting);
    assert.equal(evidence.extent.maxNorthing, level.originNorthing);
    const span = (side - 1) * level.sampleSpacingMetres;
    assert.equal(evidence.extent.maxEasting, level.originEasting + span);
    assert.equal(evidence.extent.minNorthing, level.originNorthing - span);
    assert.equal(evidence.finite, side * side, 'terrain evidence contains unfilled samples');
    assert.equal(evidence.extent.size, side);
    assert.equal(evidence.sampleSpacingMetres, level.sampleSpacingMetres);
    const bytes = fs.readFileSync(pinned(ctx.root, ref));
    assert.equal(bytes.length, side * side * 4, `${ref.path}: raster dimensions`);
    const values = new Float32Array(side * side);
    for (let i = 0; i < values.length; i++) {
      const h = bytes.readFloatLE(i * 4);
      assert(Number.isFinite(h) && h >= ctx.spec.coverageGate.minimumHeightRH2000 && h <= ctx.spec.coverageGate.maximumHeightRH2000,
        `${ref.path}: nodata/nonfinite/out-of-band sample ${i}`);
      values[i] = h;
    }
    return { ...level, heights: values };
  });
}

const asset = (ctx, directory, url) => fs.readFileSync(safePath(ctx.root, `${directory}/${url}`));
function terrainState(ctx) {
  const directory = `${ctx.stageRoot}/terrain`;
  const document = readJson(ctx.root, `${directory}/compilation.json`);
  assert.equal(document.groundId, ctx.groundId);
  const resources = new Map(document.resourceUrls.map(url => [url, asset(ctx, directory, url)]));
  for (const ref of [document.shell, ...document.tiles.map(t => t.layers.terrain)]) verifyChunkAsset(ref, resources.get(ref.url));
  return { ...document, resources };
}

export function compareFinest(ctx, compiled) {
  const ground = readPinned(ctx.root, ctx.config.baselineGround);
  let worst = 0, count = 0;
  for (const previous of ground.tiles.filter(t => t.lod === 0)) {
    const tile = compiled.tiles.find(t => t.id === previous.id);
    assert(tile, 'baseline tile missing');
    for (const key of ['minEasting', 'maxEasting', 'minNorthing', 'maxNorthing']) {
      assert.equal(tile.bounds[key], previous.bounds[key], 'baseline lattice moved');
    }
    const a = verifyChunkAsset(previous.layers.terrain, asset(ctx, 'apps/golf/public', previous.layers.terrain.url));
    const b = verifyChunkAsset(tile.layers.terrain, compiled.resources.get(tile.layers.terrain.url));
    const ah = decodeTerrainGrid(a.payload, a.header.grid), bh = decodeTerrainGrid(b.payload, b.header.grid);
    assert.equal(ah.length, bh.length);
    for (let i = 0; i < ah.length; i++) {
      assert(Number.isFinite(ah[i]) && Number.isFinite(bh[i]));
      worst = Math.max(worst, Math.abs(ah[i] - bh[i])); count++;
    }
  }
  assert(worst <= ctx.config.terrain.maximumBaselineDifferenceMetres,
    `retained terrain changed ${worst} m; an explicit reviewed source revision is required`);
  return { samples: count, maximumDifferenceMetres: worst, toleranceMetres: ctx.config.terrain.maximumBaselineDifferenceMetres,
    note: 'Source recompilation compared with retained quantized samples. This is regression evidence, not independent survey.' };
}

async function terrain(ctx, out) {
  const levels = readRingLevels(ctx);
  const compiled = compileTerrainRings({ groundId: ctx.groundId, courseSlugs: ctx.spec.courseSlugs,
    levels, tileSegments: ctx.spec.tileSegments });
  const comparison = compareFinest(ctx, compiled);
  const document = { groundId: ctx.groundId, courseSlugs: [...ctx.spec.courseSlugs], frame: ctx.config.frame,
    bounds: compiled.bounds, shell: compiled.shell, tiles: compiled.tiles, resourceUrls: [...compiled.resources.keys()].sort() };
  assert.deepEqual(terrainErrors(document), []);
  for (const [url, bytes] of compiled.resources) writeBytes(ctx.root, `${out}/${url}`, bytes);
  writeJson(ctx.root, `${out}/compilation.json`, document);
  const report = { groundId: ctx.groundId, geographicApproval: false, stats: compiled.stats, baselineComparison: comparison,
    source: ctx.config.terrain.evidence, frame: ctx.config.frame.fingerprint };
  writeJson(ctx.root, `${out}/terrain-report.json`, report);
  return { tiles: compiled.tiles.length, ...comparison };
}

async function vegetation(ctx, out) {
  const ground = terrainState(ctx), c = ctx.config.vegetation;
  assert.equal(c.reviewMode, 'machine-v1', 'unsupported review mode; implement its recorded approval adapter explicitly');
  const baseline = readPinned(ctx.root, ctx.config.baselineGround);
  const previous = baseline.tiles.flatMap(tile => {
    if (!tile.layers.objects) return [];
    return verifyChunkAsset(tile.layers.objects, asset(ctx, 'apps/golf/public', tile.layers.objects.url)).content.records;
  });
  assert.equal(new Set(previous.map(x => x.id)).size, previous.length, 'duplicate baseline identities');
  const geometry = mergeCourseGeometries(ctx.config.courses.map(course =>
    readJson(ctx.root, `${ctx.stageRoot}/mapping/models/${course.slug}.epsg3006.json`).geometry));
  const rasters = rasterInputs(ctx).filter(r => r.kind === 'canopy').map(ref => {
    validateCanopySidecar(ctx, ref, readJson(ctx.root, ref.sidecar));
    return { campaignId: ref.campaignId, raster: readRawRaster(pinned(ctx.root, ref), safePath(ctx.root, ref.sidecar)) };
  });
  const result = await compileVegetation({ groundId: ctx.groundId, observedOn: c.observedOn,
    campaigns: readPinned(ctx.root, c.campaigns), rasters, geometry, ground,
    readAsset: async url => ground.resources.get(url), previousRecords: previous.filter(r => r.class === 'tree'),
    machineReview: MACHINE_REVIEW_RULES });
  assert.equal(result.evidence.records.baseHeightMisses.length, 0, 'candidate tree bases missing terrain');
  // Preserve unrelated classes as records and recompile; never replace a mixed registry with trees alone.
  const other = previous.filter(r => r.class !== 'tree');
  const lookup = await createGroundHeightLookup(ground, async url => ground.resources.get(url));
  for (const r of other) {
    const height = lookup.heightAt(r.easting, r.northing);
    assert(Number.isFinite(height) && Math.abs(height - r.heightRH2000) <= ctx.config.terrain.maximumBaselineDifferenceMetres,
      `${r.id}: retained object base needs explicit review against rebuilt terrain`);
  }
  const records = [...result.records, ...other].sort((a, b) => a.id.localeCompare(b.id));
  const compiled = records.length ? compileObjectChunks({ groundId: ctx.groundId, tiles: ground.tiles, records }) : result.compiled;
  writeCompilation(safePath(ctx.root, out), { ...result, records, compiled });
  writeJson(ctx.root, `${out}/review-status.json`, { geographicApproval: false, mode: c.reviewMode,
    notes: c.reviewNote, retainedNonTreeRecords: other.length, independentCanopyEvaluation: 'pending', humanZoneAReview: 'pending' });
  return { candidates: result.candidates.length, records: records.length, standTiles: result.stands.chunks.length, geographicApproval: false };
}

async function assemble(ctx, out) {
  const compilation = terrainState(ctx), veg = `${ctx.stageRoot}/vegetation`, mapping = `${ctx.stageRoot}/mapping`;
  const objects = readJson(ctx.root, `${veg}/layers.json`), stands = readJson(ctx.root, `${veg}/stand-layers.json`);
  for (const [kind, layers] of [['objects', objects], ['stands', stands]]) for (const ref of Object.values(layers)) {
    const bytes = asset(ctx, `${veg}/${kind}`, `${ref.sha256}.bvch`); verifyChunkAsset(ref, bytes);
    compilation.resources.set(ref.url, bytes);
  }
  compilation.tiles = compilation.tiles.map(t => ({ ...t, layers: { ...t.layers, objects: objects[t.id] || null, stands: stands[t.id] || null } }));
  const lookup = await createGroundHeightLookup(compilation, async url => compilation.resources.get(url));
  const catalog = readJson(ctx.root, `${mapping}/public/courses/index.json`);
  const groundHashes = new Set();
  for (const course of ctx.config.courses) {
    const model = readJson(ctx.root, `${mapping}/models/${course.slug}.epsg3006.json`);
    const entry = catalog.courses.find(x => x.slug === course.slug);
    const { packUrl, bytes, sha256 } = entry;
    const pack = asset(ctx, `${mapping}/public`, packUrl);
    assert.equal(digest(pack), sha256); assert.equal(pack.length, bytes);
    writeBytes(ctx.root, `${out}/${packUrl}`, pack);
    for (const key of ['landcover', 'mownSurface', 'surroundings']) if (entry[key]) {
      const ref = entry[key], data = asset(ctx, `${mapping}/public`, ref.url);
      assert.equal(digest(data), ref.sha256); writeBytes(ctx.root, `${out}/${ref.url}`, data);
    }
    const graph = emitGroundGraph({ compilation, frame: ctx.config.frame,
      sourceManifestSha256: fileDigest(ctx.root, ctx.workflow.sourceManifest),
      course: { slug: course.slug, name: entry.name, holes: model.geometry.holes.map(h => ({
        number: h.n, par: h.par, strokeIndex: course.strokeIndexStatus === 'not-applicable' ? null : h.idx,
        strokeIndexStatus: course.strokeIndexStatus, accuracyTier: course.accuracyTier, line: h.line })) },
      fallbackV1: { format: 1, packUrl, bytes, sha256 }, heightAt: lookup.heightAt });
    groundHashes.add(graph.references.ground.sha256);
    await writeGroundGraphFiles(safePath(ctx.root, out), graph);
  }
  assert.equal(groundHashes.size, 1, 'shared layouts must reference exactly one ground generation');
  writeJson(ctx.root, `${out}/courses/index.json`, catalog);
  const startup = await publishStartupPacks(safePath(ctx.root, out));
  writeJson(ctx.root, `${out}/assembly-report.json`, { groundId: ctx.groundId, groundManifestSha256: [...groundHashes][0],
    startup, geographicApproval: false, playerAcceptance: 'pending',
    limitations: [...(ctx.groundId === 'puttom' ? ['Puttom migration surface preview requires separate player preparation.'] : []),
      'Existing exported app/Hero assets must be supplied for player preparation.',
      'Prepared tint/water acceleration assets are not inherited from the baseline. Measure candidate startup on named hardware.'] });
  return { groundManifestSha256: [...groundHashes][0], courses: ctx.config.courses.length, startup };
}

export function capturePlan(ctx) {
  return { schemaVersion: 1, groundId: ctx.groundId, status: 'pending-player-preparation', geographicApproval: false,
    scope: 'Software-rendered diagnostic captures only; not hardware performance or physical-device acceptance.',
    prerequisite: 'Build and serve the player with this candidate public root, matching Puttom preview if applicable, and existing exported Hero assets. Verify served catalogue/graph identity before capture.',
    jobs: ctx.config.courses.flatMap(c => ctx.config.review.captureBackend.flatMap(backend =>
      ctx.config.review.captureQuality.map(quality => ({ id: `${c.slug}-${backend}-${quality}`, slug: c.slug, backend, quality, status: 'not-run',
        command: ['node', 'tools/v2-graphics-review.mjs', '--course', c.slug, '--backend', backend, '--q', quality,
          '--graphics', '1', '--views', Array.from({ length: c.holes }, (_, i) =>
            ctx.config.review.capturePresets.flatMap(p => [`${i+1}:tee:${p}`, `${i+1}:top:${p}`])).flat().join(','),
          '--out', `output/course-production/${ctx.groundId}/captures/${c.slug}-${backend}-${quality}`] })))) };
}

async function validate(ctx, out) {
  const publicRoot = ctx.workflow.publicRoot;
  const graph = loadGround(ctx.root, ctx.groundId, publicRoot);
  assert.deepEqual(terrainErrors(graph.ground), []);
  assert.deepEqual(graph.courses.map(c => ({ slug: c.slug, holes: c.holes.length })).sort((a,b) => a.slug.localeCompare(b.slug)),
    [...ctx.workflow.courses].sort((a,b) => a.slug.localeCompare(b.slug)));
  const resources = new Map();
  const add = ref => resources.set(ref.url, asset(ctx, publicRoot, ref.url));
  graph.entries.forEach(e => add(e.manifest));
  graph.courses.forEach(c => { add(c.groundManifest); add(c.routing); });
  add(graph.ground.shell);
  for (const t of graph.ground.tiles) Object.values(t.layers).filter(Boolean).forEach(add);
  const integrity = verifyAssetGraph({ root: graph.index, resources, supportedFeatures: V2_SUPPORTED_FEATURES });
  for (const e of graph.playerEntries) {
    const bytes = asset(ctx, publicRoot, e.packUrl); assert.equal(digest(bytes), e.sha256); assert.equal(bytes.length, e.bytes);
    const pack = readPack(bytes); assert.equal(pack.header.slug, e.slug);
    assert.equal(JSON.parse(inflateStream(pack.sv)).holes.length, e.holes);
    for (const [field, stream] of [['HF0', pack.s0], ['HF1', pack.s1]]) assert.equal(inflateStream(stream).length, pack.header[field].nx * pack.header[field].nz * 2);
  }
  const review = readJson(ctx.root, `${ctx.stageRoot}/mapping/review/review.json`);
  const structural = review.discrepancies.filter(x => x.kind === 'invalid-ring');
  const report = { schemaVersion: 1, groundId: ctx.groundId, graphIntegrity: integrity,
    candidateFiles: inventory(ctx.root, [publicRoot]),
    structuralMappingErrors: structural, geographicApproval: false, releaseReady: false,
    frameStatus: readJson(ctx.root, ctx.workflow.sourceManifest).canonicalFrame.originStatus,
    remaining: ['Independent controls', 'Source overlays and every-hole geographic review', 'Held-out canopy evaluation',
      'WebGPU/WebGL2 and physical mobile visual acceptance', 'Named-device paired performance', 'Offline and rollback checks'] };
  writeJson(ctx.root, `${out}/validation.json`, report);
  writeJson(ctx.root, `${out}/capture-plan.json`, capturePlan(ctx));
  // Geography is not automatically approved, including when these structural checks pass.
  assert.equal(structural.length, 0, 'invalid mapped rings remain; inspect the mapping discrepancy report');
  return { graphIntegrity: true, courses: graph.courses.length, geographicApproval: false, releaseReady: false };
}

export async function executeProductionStage(ctx, stage) {
  return stageOutput(ctx, stage, async out => {
    if (stage === 'sources') {
      const report = inspectInputs(ctx);
      assert(report.readyToBuild, `source preflight failed (${report.errors.length} inputs); run production.mjs --ground ${ctx.groundId} --inspect`);
      writeJson(ctx.root, `${out}/sources.json`, report); return { inputs: report.checks.length, geographicApproval: false };
    }
    if (stage === 'terrain') return terrain(ctx, out);
    if (stage === 'mapping') return compileMapping(ctx, out);
    if (stage === 'vegetation') return vegetation(ctx, out);
    if (stage === 'assemble') return assemble(ctx, out);
    if (stage === 'validate') return validate(ctx, out);
    throw new Error(`unknown stage ${stage}`);
  });
}
