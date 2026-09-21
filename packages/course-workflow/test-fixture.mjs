/* Synthetic test geography only. Never register this ground in the player. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { workflowTemplate, reviewTemplate, STAGES } from './standard.mjs';
import { sourceTemplate, intakePlan } from './setup.mjs';
import { runThrough } from './runner.mjs';
import { writeJson, safePath, fileDigest, digest } from './io.mjs';
import { candidate } from './audit.mjs';
import { STANDARD_RING_LEVELS } from '../course-v2/standard-ground-rings.mjs';
import { encodeTerrainGrid } from '../course-v2/terrain-grid.mjs';
import { writeChunk, assetReferenceForChunk } from '../course-v2/chunk-node.mjs';
import { emitGroundGraph } from '../course-v2/emit-ground-graph-node.mjs';
import { writePack } from '../course-pack/lib.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export function emptyRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'banvy-course-workflow-'));
  fs.mkdirSync(path.join(root, 'geo_data/course-v2'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'geo_data/course-v2/source-catalog.json'), path.join(root, 'geo_data/course-v2/source-catalog.json'));
  writeJson(root, 'apps/golf/public/courses/v2-index.json', { $schema: 'test-only', schemaVersion: 2, courses: [] });
  writeJson(root, 'apps/golf/public/courses/index.json', { fmt: 1, courses: [] });
  fs.mkdirSync(path.join(root, 'implementation'));
  fs.writeFileSync(path.join(root, 'implementation/adapter.mjs'), '// synthetic adapter v1\n');
  return root;
}
export function buildCandidateFixture(root) {
  const w = workflowTemplate({ groundId: 'fixture-ground', name: 'Synthetic workflow fixture', courses: [{ slug: 'fixture-main', holes: 2 }] });
  w.watch = ['implementation'];
  for (const stage of STAGES) {
    const script = `implementation/${stage}.mjs`, output = `output/receipts/${stage}.json`;
    fs.writeFileSync(safePath(root, script), `import fs from 'node:fs'; fs.mkdirSync('output/receipts',{recursive:true}); fs.writeFileSync('${output}', '{}');\n`);
    w.stages[stage] = { command: ['node', script], inputs: [script], outputs: [output] };
  }
  const source = sourceTemplate(root, w, [16, 59, 16.1, 59.1]);
  writeJson(root, `course-workflows/${w.groundId}/intake-plan.json`, intakePlan(w, [16, 59, 16.1, 59.1]));
  const origin = { easting: 600000.5, northing: 6600000.5, heightRH2000: 20 };
  source.canonicalFrame.originStatus = 'approved';
  source.canonicalFrame.origin = origin;
  source.blockers = [];
  for (const s of source.sources) { s.lifecycle = 'acquired'; s.acquiredAt = '2026-09-01'; s.capturedAt = '2026-09-01'; s.checksum = digest('synthetic source'); s.checksumReason = null; }
  writeJson(root, w.sourceManifest, source);
  writeJson(root, 'course-workflows/fixture-ground/workflow.json', w);
  const frame = { compoundCrs: 'EPSG:5845', horizontalCrs: 'EPSG:3006', verticalCrs: 'EPSG:5613', origin,
    axisMapping: source.canonicalFrame.axisMapping, fingerprint: digest('synthetic frame') };
  const bounds = { minEasting: origin.easting - 8192, maxEasting: origin.easting + 8192,
    minNorthing: origin.northing - 8192, maxNorthing: origin.northing + 8192, minHeightRH2000: 20, maxHeightRH2000: 20 };
  const resources = new Map(), tiles = [];
  const grid = encodeTerrainGrid({ heights: new Float32Array(257 * 257).fill(20), width: 257, height: 257, heightScaleMetres: 0.01 });
  function chunk(id, area, spacing) {
    const bytes = writeChunk({ header: { schemaVersion: 2, id, kind: 'terrain', owner: { type: 'ground', id: w.groundId }, bounds: area,
      payloadFormat: 'terrain-grid-u16-le-v1', requiredFeatures: ['chunk-envelope-v2', 'terrain-grid-u16-v1'],
      grid: { ...grid.grid, sampleSpacingMetres: spacing, geometricErrorMetres: 0.005 } }, payload: grid.payload });
    const ref = assetReferenceForChunk(bytes, { kind: 'terrain', directory: `grounds/${w.groundId}/terrain` });
    resources.set(ref.url, bytes); return ref;
  }
  for (const l of STANDARD_RING_LEVELS) for (let row = 0; row < l.tilesPerSide; row++) for (let col = 0; col < l.tilesPerSide; col++) {
    const span = l.sampleSpacingMetres * 256;
    const x = origin.easting - l.halfSpan + col * span, z = origin.northing + l.halfSpan - row * span;
    const id = `l${l.lod}/${col}/${row}`;
    const b = { minEasting: x, maxEasting: x + span, minNorthing: z - span, maxNorthing: z, minHeightRH2000: 20, maxHeightRH2000: 20 };
    const t = { id, lod: l.lod, bounds: b, geometricErrorMetres: 0.005, courses: ['fixture-main'],
      layers: { terrain: chunk(id, b, l.sampleSpacingMetres), surface: null, objects: null } };
    if (l.lod < 6) {
      const p = STANDARD_RING_LEVELS[l.lod + 1], pSpan = p.sampleSpacingMetres * 256;
      t.parentId = `l${p.lod}/${Math.floor((x - (origin.easting - p.halfSpan)) / pSpan)}/${Math.floor(((origin.northing + p.halfSpan) - z) / pSpan)}`;
    }
    tiles.push(t);
  }
  const fallback = writePack({ slug: 'fixture-main', geo: {}, hf0: {}, hf1: {},
    streams: [deflateRawSync(Buffer.alloc(8)), deflateRawSync(Buffer.alloc(8)), deflateRawSync(Buffer.from('{}'))] });
  const graph = emitGroundGraph({ compilation: { groundId: w.groundId, courseSlugs: ['fixture-main'], resources, tiles, bounds,
    shell: chunk('shell', bounds, 64) }, frame, sourceManifestSha256: fileDigest(root, w.sourceManifest),
    course: { slug: 'fixture-main', name: w.name, holes: [1, 2].map(n => ({ number: n, par: 3, strokeIndex: n,
      strokeIndexStatus: 'verified', accuracyTier: 'D', line: [[origin.easting + n, origin.northing + n], [origin.easting + n + 50, origin.northing + n + 50]] })) },
    fallbackV1: { format: 1, packUrl: 'courses/fixture-main/pack.bin', bytes: fallback.length, sha256: digest(fallback) }, heightAt: () => 20 });
  for (const [url, bytes] of graph.resources) { const file = safePath(root, `${w.publicRoot}/${url}`); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); }
  writeJson(root, `${w.publicRoot}/courses/v2-index.json`, graph.root);
  writeJson(root, `${w.publicRoot}/courses/index.json`, { fmt: 1, courses: [{ slug: 'fixture-main', holes: 2,
    packUrl: 'courses/fixture-main/pack.bin', bytes: fallback.length, sha256: digest(fallback) }] });
  fs.writeFileSync(safePath(root, `${w.publicRoot}/courses/fixture-main/pack.bin`), fallback);
  w.stages.assemble.outputs.push(w.publicRoot);
  w.stages.validate.inputs.push(`${w.publicRoot}/courses/v2-index.json`);
  writeJson(root, 'course-workflows/fixture-ground/workflow.json', w);
  runThrough(root, w, 'validate');
  const c = candidate(root, w);
  const review = reviewTemplate(w, c.candidateDigest);
  fs.writeFileSync(safePath(root, 'implementation/evidence.txt'), 'SYNTHETIC TEST EVIDENCE ONLY');
  // Evidence is deliberately outside the watched implementation in real use.
  // Exclude this one from the fixture implementation identity by moving it.
  fs.renameSync(safePath(root, 'implementation/evidence.txt'), safePath(root, 'course-workflows/fixture-ground/evidence.txt'));
  const evidence = [{ path: 'course-workflows/fixture-ground/evidence.txt', sha256: fileDigest(root, 'course-workflows/fixture-ground/evidence.txt') }];
  for (const g of Object.values(review.gates)) Object.assign(g, { status: 'passed', reviewer: 'Synthetic test', reviewedAt: '2026-09-01T12:00:00Z', notes: 'Synthetic evidence, not a real course approval.', evidence });
  for (const h of review.holes) for (const r of Object.values(h.categories)) Object.assign(r, { status: 'reviewed', notes: 'Synthetic fixture category inspected.', evidence });
  review.performance = ['webgpu', 'webgl2', 'mobile'].map(target => ({ target, device: 'Synthetic test device', scenario: 'Fixed test scene',
    baselineDigest: digest('baseline'), candidateDigest: c.candidateDigest, evidence,
    runs: [1, 2, 3].map(() => ({ baseline: { coldLoadMs: 1000, frameP95Ms: 10 }, candidate: { coldLoadMs: 1000, frameP95Ms: 10 } })) }));
  writeJson(root, w.reviewFile, review);
  return { w, graph, review, candidateDigest: c.candidateDigest };
}
