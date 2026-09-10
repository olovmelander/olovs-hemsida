#!/usr/bin/env node
/* Lidingö source -> published pack -> runtime reference and furniture audit.
 * No coordinate or playing geometry is changed by this command. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readPack, inflateStream } from '../../packages/course-pack/lib.mjs';
import { withInferredTeePads } from '../../apps/golf/src/engine/tee-pads.mjs';
import { teeMarkerPlacement } from '../../apps/golf/src/engine/tee-marker-placement.mjs';
import { reviewedTeeMarkerPositions } from '../../apps/golf/src/engine/reviewed-tee-marker-placement.mjs';
import { canRenderTeeMarker } from '../../apps/golf/src/engine/tee-marker-visibility.mjs';
import { inRing, ringSD, lineBearingAt, centroidOf } from '../../apps/golf/src/engine/geom.js';
import { FRAME } from '../build-course.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const projected = ([x, z]) => [FRAME.easting + x, FRAME.northing - z];
const nearestAlong = (line, point) => {
  let closest = Infinity, along = 0, travelled = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], dx = b[0] - a[0], dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    const t = length ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / length ** 2)) : 0;
    const d = distance(point, [a[0] + t * dx, a[1] + t * dz]);
    if (d < closest) { closest = d; along = travelled + t * length; }
    travelled += length;
  }
  return { distanceFromRouteM: closest, alongM: along, remainingM: travelled - along };
};

export function auditLidingoTees(model, vectors, card, surfaces = [], runtimeHoles = withInferredTeePads(vectors.holes)) {
  const issues = [];
  const holes = model.holes.map(source => {
    const packed = vectors.holes.find(h => h.n === source.n), runtime = runtimeHoles.find(h => h.n === source.n);
    if (!packed || !runtime) throw new Error(`Missing source/pack/runtime hole ${source.n}`);
    const pads = source.tees.pads.map((pad, index) => {
      const feature = surfaces.find(f => f.id === pad.sourceFeatureId || f.id === pad.id);
      return { index, id: pad.id ?? null, sourceFeatureId: pad.sourceFeatureId ?? null,
        centreEpsg3006: projected(centroidOf(pad.ring)),
        sourceId: feature?.properties.sourceId ?? null, observedYear: feature?.properties.observedYear ?? null,
        packRingMatches: same(pad.ring, packed.tees.pads[index]?.ring) };
    });
    if (pads.some(p => !p.packRingMatches)) issues.push(`Hole ${source.n}: published platforms differ from source`);
    if (runtime.tees.pads.length !== source.tees.pads.length) issues.push(`Hole ${source.n}: runtime inferred a tee platform`);
    const positions = [];
    const marks = source.tees.marks.map((sourceMark, index) => {
      const packedMark = packed.tees.marks[index], mark = runtime.tees.marks[index];
      if (!packedMark || !mark) throw new Error(`Hole ${source.n}: missing colour ${index}`);
      const contained = source.tees.pads.flatMap((p, i) => inRing(...mark.c, p.ring) ? [i] : []);
      const nominee = runtime.tees.pads.find(p => p.id === mark.sourcePadId || p.reviewId === mark.sourcePadId);
      const placement = teeMarkerPlacement(runtime, mark);
      const allowed = canRenderTeeMarker(runtime, mark, vectors.infra.objectPlacement);
      const pair = allowed ? reviewedTeeMarkerPositions(runtime, mark) : [];
      const forward = [Math.sin(mark.b * Math.PI / 180), Math.cos(mark.b * Math.PI / 180)];
      const axisErrorM = pair.length === 2 ? Math.abs((pair[1][0] - pair[0][0]) * forward[0] + (pair[1][1] - pair[0][1]) * forward[1]) : null;
      const containingPairPads = runtime.tees.pads.filter(p => pair.length === 2 && pair.every(c => inRing(...c, p.ring)));
      const clearanceM = pair.length === 2 && containingPairPads.length ? Math.max(...containingPairPads.map(p => Math.min(...pair.map(c => -ringSD(...c, p.ring))))) : null;
      const overlaps = pair.flatMap(p => positions.filter(q => distance(p, q) < .35));
      positions.push(...pair);
      if (!same(sourceMark.c, packedMark.c)) issues.push(`Hole ${source.n} ${index}: pack reference differs from source`);
      if (!same(packedMark.displayC ?? packedMark.c, mark.c)) issues.push(`Hole ${source.n} ${index}: runtime moved the reference`);
      if (sourceMark.sourcePadId !== packedMark.sourcePadId) issues.push(`Hole ${source.n} ${index}: pack lost platform identity`);
      if (allowed && !pair.length) issues.push(`Hole ${source.n} ${index}: reviewed marker pair was omitted`);
      if (pair.length && (!containingPairPads.length || clearanceM < .14999)) issues.push(`Hole ${source.n} ${index}: marker sphere leaves the platform`);
      if (pair.length && mark.sourcePadId && (!nominee || !pair.every(p => inRing(...p, nominee.ring)))) issues.push(`Hole ${source.n} ${index}: marker pair leaves its nominated platform`);
      if (axisErrorM > 1e-6) issues.push(`Hole ${source.n} ${index}: markers are not perpendicular to play`);
      if (overlaps.length) issues.push(`Hole ${source.n} ${index}: colour marker spheres overlap`);
      const route = nearestAlong(source.line, mark.c);
      return { index, colour: card.tees[index].id, officialDistanceM: sourceMark.m,
        sourceC: sourceMark.c, packC: packedMark.c, runtimeC: mark.c, epsg3006: projected(mark.c),
        sourcePadId: sourceMark.sourcePadId ?? null, sourcePadIndices: contained,
        sharesReferenceWith: source.tees.marks.flatMap((other, k) => k !== index && distance(sourceMark.c, other.c) < .01 ? [card.tees[k].id] : []),
        sourceBearingDegrees: sourceMark.b, runtimeBearingDegrees: mark.b,
        expectedRuntimeBearingDegrees: lineBearingAt(runtime.line, mark.c) * 180 / Math.PI,
        referenceKind: sourceMark.orthophotoReference?.kind ?? sourceMark.placement ?? 'unreviewed',
        approximateRemainingRouteM: route.remainingM, scorecardResidualM: route.remainingM - sourceMark.m,
        distanceFromRouteM: route.distanceFromRouteM,
        eligible: allowed, potentialPair: placement.positions, potentialPairReason: placement.reason,
        pair, minimumSphereEdgeClearanceM: clearanceM, transverseAxisErrorM: axisErrorM,
        pairReferenceDisplacementM: pair.length === 2 ? distance(mark.c, [(pair[0][0] + pair[1][0]) / 2, (pair[0][1] + pair[1][1]) / 2]) : null,
        overlapCount: overlaps.length };
    });
    return { hole: source.n, padCount: pads.length, runtimePadCount: runtime.tees.pads.length,
      inferPads: runtime.tees.inferPads !== false, markerPlacement: runtime.tees.markerPlacement ?? null,
      markerLayout: runtime.tees.markerLayout ?? null, pads, marks };
  });
  const marks = holes.flatMap(h => h.marks);
  const furniture = holes.flatMap(h => h.marks.flatMap(m => m.pair.map(position => ({ hole: h.hole, colour: m.colour, position }))));
  const crossHoleOverlaps = [];
  for (let i = 0; i < furniture.length; i++) for (let j = i + 1; j < furniture.length; j++) {
    const a = furniture[i], b = furniture[j];
    if (a.hole === b.hole) continue;
    const residual = distance(a.position, b.position);
    if (residual < .3) crossHoleOverlaps.push({ first: a, second: b, distanceM: residual });
  }
  if (crossHoleOverlaps.length) issues.push(`${crossHoleOverlaps.length} marker spheres from different holes overlap`);
  return { schemaVersion: 1, groundId: 'lidingo', kind: 'tee-runtime-alignment-audit',
    frame: { horizontalCrs: 'EPSG:3006', originEasting: FRAME.easting, originNorthing: FRAME.northing, axisOrder: 'east +x, north -z' },
    interpretation: 'References and decorative colour pairs are representative starts on reviewed platforms. Scorecard residuals diagnose inherited distance-based associations; they do not establish surveyed distances or daily physical marker coordinates.',
    objectPlacement: vectors.infra.objectPlacement,
    summary: { holes: holes.length, platforms: holes.reduce((sum, h) => sum + h.padCount, 0), references: marks.length,
      referencesOutsidePlatforms: marks.filter(m => !m.sourcePadIndices.length).length,
      referencesWithPadIdentity: marks.filter(m => m.sourcePadId).length,
      referencesSharingCoordinates: marks.filter(m => m.sharesReferenceWith.length).length,
      uniqueReferenceCoordinates: new Set(marks.map(m => JSON.stringify(m.runtimeC))).size,
      markerPairsRendered: marks.filter(m => m.pair.length).length,
      markerInstancesRendered: marks.reduce((sum, m) => sum + m.pair.length, 0),
      eligiblePairsOmitted: marks.filter(m => m.eligible && !m.pair.length).length,
      crossHoleMarkerOverlaps: crossHoleOverlaps.length,
      maxAbsoluteScorecardRouteResidualM: Math.max(...marks.map(m => Math.abs(m.scorecardResidualM))),
      issues: issues.length }, holes, crossHoleOverlaps, issues };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const read = relative => fs.readFileSync(path.join(ROOT, relative));
  const modelPath = 'lidingobuild/course-model.json', packPath = 'apps/golf/public/courses/lidingo/pack.bin';
  const modelBytes = read(modelPath), packBytes = read(packPath);
  const report = auditLidingoTees(JSON.parse(modelBytes), JSON.parse(inflateStream(readPack(packBytes).sv)),
    JSON.parse(read('lidingobuild/reference/club-scorecard.json')), JSON.parse(read('lidingobuild/mapping/playing-surfaces.geojson')).features);
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  report.inputs = { modelPath, modelSha256: sha(modelBytes.toString('utf8').replace(/\r\n/g, '\n')), packPath, packSha256: sha(packBytes) };
  const i = process.argv.indexOf('--out');
  const output = path.resolve(ROOT, i < 0 ? 'lidingobuild/mapping/tee-runtime-validation.json' : process.argv[i + 1]);
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, summary: report.summary, issues: report.issues }, null, 2));
  if (report.issues.length) process.exitCode = 1;
}
