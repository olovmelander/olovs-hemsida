/* Stages Bro Hof's reviewed candidates (review-2026-11-24) the way production.mjs's reviewed-candidates-v1 does:
   compileReviewedVegetation on candidates.csv and the residual rasters against the published ground, with the two
   routings' geometry from the cache (the ground has no committed migration directory, which the compile-vegetation CLI
   reads), written to output/course-workflow/bro-hof/reviewed-compile. It writes nothing under apps/.
   node geo_data/course-v2/bro-hof/vegetation/review-2026-11-24/scripts/stage-reviewed.mjs */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadGroundConfig, ROOT } from '../../../../../../tools/tree-pipeline/config.mjs';
import { loadGroundGeometry, compileReviewedVegetation, parseCandidateCsv, writeCompilation } from '../../../../../../packages/course-v2/vegetation/compile-vegetation.mjs';
import { createRaster } from '../../../../../../packages/course-v2/vegetation/canopy-fields.mjs';

const ctx = loadGroundConfig(ROOT, 'bro-hof');
const publicDir = ctx.paths.publicDir;
const ground = JSON.parse(fs.readFileSync(path.join(publicDir, ctx.config.published.baselineGroundManifest), 'utf8'));
const binary = (name, Type) => {
  const file = path.join(ctx.paths.rasters, name), bytes = fs.readFileSync(file);
  return { sidecar: JSON.parse(fs.readFileSync(file.replace(/\.bin$/, '.json'), 'utf8')), values: new Type(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
};
const chm = binary('residual-chm-050.bin', Float32Array), labels = binary('residual-labels-050.bin', Int32Array);
for (const key of ['width', 'height', 'sampleSpacingMetres', 'originEasting', 'originNorthing']) if (chm.sidecar[key] !== labels.sidecar[key]) throw new Error(`residual rasters differ in ${key}`);
const raster = createRaster({ width: chm.sidecar.width, height: chm.sidecar.height, sampleSpacingMetres: chm.sidecar.sampleSpacingMetres, originEasting: chm.sidecar.originEasting, originNorthing: chm.sidecar.originNorthing, values: chm.values });
const csv = fs.readFileSync(ctx.reviewFile('candidates.csv'), 'utf8');
const result = await compileReviewedVegetation({
  groundId: 'bro-hof', observedOn: ctx.config.publication.observedOn,
  campaigns: JSON.parse(fs.readFileSync(path.join(ROOT, ctx.config.laser.campaigns), 'utf8')),
  rows: parseCandidateCsv(csv), scope: ctx.config.publication.scope, residual: { raster, labels: labels.values },
  geometry: loadGroundGeometry(ctx.paths.geometryDir, 'bro-hof'), ground,
  readAsset: async url => fs.readFileSync(path.join(publicDir, url)), review: ctx.config.publication.reviewStatement,
});
const out = path.join(ROOT, ctx.config.publication.compileOut);
fs.rmSync(out, { recursive: true, force: true });
writeCompilation(out, result);
const byTile = result.records.length;
console.log(JSON.stringify({ records: byTile, evidenceRecords: result.evidence.records, rows: result.evidence.rows, candidatesSha256: crypto.createHash('sha256').update(csv).digest('hex'), residualChm: chm.sha256, residualLabels: labels.sha256, out: ctx.config.publication.compileOut }, null, 1));
