/* Independent, reproducible Ängsö tee audit. Writes only its report with --write.
 * Coordinate fidelity and evidence for a tee's identity are separate results.
 * PROJ is used independently of the JavaScript trace-authoring projection. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readPack, inflateStream } from '../../packages/course-pack/lib.mjs';
import { verifyChunkAsset } from '../../packages/course-v2/chunk-node.mjs';
import { legacyGridBridge } from '../../apps/golf/src/engine/geodetic-frame.mjs';
import { ANGSO_V2_CONFIG } from '../../apps/golf/src/engine/v2-angso-config.mjs';
import { withInferredTeePads } from '../../apps/golf/src/engine/tee-pads.mjs';
import { teeView } from '../../apps/golf/src/engine/tee-view.mjs';
import { teeMarkerPositions } from '../../apps/golf/src/engine/tee-marker-placement.mjs';
import { inRing, ringSD } from '../../apps/golf/src/engine/geom.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hashes = {};
const sha = value => createHash('sha256').update(value).digest('hex');
const read = relative => {
  const bytes = fs.readFileSync(path.join(ROOT, relative));
  hashes[relative] = sha(bytes);
  return bytes;
};
const json = relative => JSON.parse(read(relative));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const round = value => Number(value.toFixed(9));
function stats(values) {
  if (!values.length) return { count: 0, minimum: null, median: null, maximum: null, rms: null };
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return { count: sorted.length, minimum: round(sorted[0]),
    median: round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2),
    maximum: round(sorted.at(-1)), rms: round(Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length)) };
}
const countBy = (rows, field) => Object.fromEntries([...new Set(rows.map(row => row[field]))]
  .map(value => [String(value), rows.filter(row => row[field] === value).length]));

const model = json('angsobuild/course-model.json');
const review = json('angsobuild/mapping/orthophoto-review.json');
const migration = json('geo_data/course-v2/angso/migration/course-model.epsg3006.json');
const index = json('apps/golf/public/courses/index.json').courses.find(course => course.slug === 'angso');
const packBytes = read(`apps/golf/public/${index.packUrl.replace(/^\//, '')}`);
const packed = readPack(packBytes), vectors = JSON.parse(inflateStream(packed.sv));
const runtimeHoles = withInferredTeePads(vectors.holes);
const v2Entry = json('apps/golf/public/courses/v2-index.json').courses.find(course => course.slug === 'angso');
function checkedReference(ref) {
  const bytes = read(`apps/golf/public/${ref.url}`);
  if (bytes.length !== ref.bytes || sha(bytes) !== ref.sha256) throw new Error(`Stale published reference: ${ref.url}`);
  return bytes;
}
const course = JSON.parse(checkedReference(v2Entry.manifest));
const routing = verifyChunkAsset(course.routing, checkedReference(course.routing)).content;
for (const file of ['apps/golf/src/main.js', 'apps/golf/src/engine/tee-pads.mjs',
  'apps/golf/src/engine/tee-marker-placement.mjs',
  'apps/golf/src/engine/tee-view.mjs', 'apps/golf/src/engine/geodetic-frame.mjs',
  'apps/golf/src/engine/v2-angso-config.mjs', 'angsobuild/check3d.mjs']) read(file);

// Build one fixed order for every tee platform vertex, virtual reference, and
// route vertex. PROJ sees coordinates from the current model and frame only.
const points = [], pointIndices = new Map();
function add(key, point) { pointIndices.set(key, points.length); points.push(point); }
for (const hole of model.holes) {
  hole.tees.pads.forEach((pad, i) => pad.ring.forEach((point, j) => add(`${hole.n}:pad:${i}:${j}`, point)));
  hole.tees.marks.forEach((mark, i) => add(`${hole.n}:mark:${i}`, mark.c));
  hole.line.forEach((point, i) => add(`${hole.n}:route:${i}`, point));
}
const python = process.env.COURSE_GEO_PYPROJ_PYTHON || path.join(ROOT, 'upsalabuild/cache/review-venv/Scripts/python.exe');
const proc = spawnSync(python, ['-c',
  'import json,sys,pyproj\na=json.load(sys.stdin)\np=pyproj.Transformer.from_crs(4326,3006,always_xy=True)\nprint(json.dumps([p.transform(a["origin"]["lon"]+x/a["mPerLon"],a["origin"]["lat"]-z/a["mPerLat"]) for x,z in a["points"]]))'],
{ input: JSON.stringify({ origin: model.origin, mPerLat: model.mPerLat, mPerLon: model.mPerLon, points }),
  encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, windowsHide: true });
if (proc.error || proc.status !== 0) throw new Error(`Independent PROJ unavailable: ${proc.error?.message || proc.stderr}`);
const projected = JSON.parse(proc.stdout);
const project = key => projected[pointIndices.get(key)];
const bridge = legacyGridBridge(ANGSO_V2_CONFIG.legacyFrame);
const origin = ANGSO_V2_CONFIG.legacyOriginEpsg3006;
const toRuntime = point => bridge.toLegacy(point[0] - origin.easting, origin.northing - point[1]);
const gates = [];
const gate = (name, pass) => gates.push({ name, pass: Boolean(pass) });
gate('pack index identifies current exact bytes', index.bytes === packBytes.length && index.sha256 === sha(packBytes));
gate('migration identifies current model bytes', migration.source.sha256 === sha(fs.readFileSync(path.join(ROOT, 'angsobuild/course-model.json'), 'utf8').replace(/\r\n/g, '\n')));
gate('runtime pack retains the frozen frame', equal(packed.header.GEO.origin, model.origin) && packed.header.GEO.mPerLon === model.mPerLon);
gate('v2 fallback identifies current pack', course.fallbackV1?.sha256 === index.sha256);
const pads = [], marks = [], routeRows = [];
for (const hole of model.holes) {
  const migrated = migration.geometry.holes.find(item => item.n === hole.n);
  const packedHole = vectors.holes.find(item => item.n === hole.n);
  const runtimeHole = runtimeHoles.find(item => item.n === hole.n);
  const reviewed = review.holes.find(item => item.n === hole.n);
  const routed = routing.holes.find(item => item.number === hole.n);
  gate(`hole ${hole.n}: pack and runtime retain the reviewed platform rings`,
    equal(hole.tees.pads.map(p => p.ring), packedHole.tees.pads.map(p => p.ring)) &&
    equal(hole.tees.pads.map(p => p.ring), runtimeHole.tees.pads.map(p => p.ring)) && runtimeHole.tees.inferPads === false);
  hole.tees.pads.forEach((pad, i) => {
    const trace = reviewed.tees.accepted.find(item => item.id === pad.reviewId);
    const source = review.sources[trace.sourceKey ?? reviewed.tees.sourceKey], t = source.geoTransform;
    const native = trace.ringPixels.map(([column, row]) => [t[0] + column * t[1] + row * t[2], t[3] + column * t[4] + row * t[5]]);
    const grid = pad.ring.map((_, j) => project(`${hole.n}:pad:${i}:${j}`));
    const migrationRing = migrated.tees.pads[i].ring;
    const nativeResiduals = grid.map((p, j) => dist(p, native[j]));
    const migrationResiduals = grid.map((p, j) => dist(p, migrationRing[j]));
    const runtimeResiduals = grid.map((p, j) => dist(toRuntime(p), pad.ring[j]));
    pads.push({ hole: hole.n, reviewId: pad.reviewId, sourceKey: trace.sourceKey ?? reviewed.tees.sourceKey,
      verticesIncludingClosure: pad.ring.length, nativeToModelMetres: stats(nativeResiduals),
      modelToMigrationMetres: stats(migrationResiduals), exactProjectionToRuntimeBridgeMetres: stats(runtimeResiduals),
      preserveTerrain: pad.preserveTerrain === true });
  });
  hole.tees.marks.forEach((mark, i) => {
    const runtimeMark = runtimeHole.tees.marks[i], p = project(`${hole.n}:mark:${i}`);
    const decision = reviewed.teeReferences?.find(item => item.index === i);
    let nativeReference = null;
    if (decision && decision.pixel !== null) {
      const t = review.sources[decision.sourceKey].geoTransform, [column, row] = decision.pixel;
      nativeReference = [t[0] + column * t[1] + row * t[2], t[3] + column * t[4] + row * t[5]];
    }
    const camera = teeView(runtimeHole, runtimeMark);
    // Invoke the same placement implementation as main.js. No returned pair
    // means no drawn symbols; that is distinct from drawing symbols off turf.
    const balls = vectors.infra.objectPlacement === 'mapped-only' ? [] : teeMarkerPositions(runtimeHole, runtimeMark);
    const fairwayReference = runtimeMark.referenceSurfaceKind === 'fairway' &&
      runtimeMark.orthophotoReference?.kind === 'guide-orthophoto-reference';
    const sourceRings = fairwayReference ? runtimeHole.fairway.rings : runtimeHole.tees.pads
      .filter(pad => runtimeMark.sourcePadId === undefined || pad.id === runtimeMark.sourcePadId || pad.reviewId === runtimeMark.sourcePadId)
      .map(pad => pad.ring);
    const containing = runtimeHole.tees.pads.filter(pad => inRing(...runtimeMark.c, pad.ring));
    const clearance = point => -Math.min(...runtimeHole.tees.pads.map(pad => ringSD(...point, pad.ring)));
    const sourceClearance = point => -Math.min(...sourceRings.map(ring => ringSD(...point, ring)));
    const ballClearances = balls.map(clearance), ballSourceClearances = balls.map(sourceClearance);
    const ref = mark.orthophotoReference ?? {};
    marks.push({ hole: hole.n, markIndex: i, teeName: model.card.teeNames[i],
      defaultSelected: index.tees.def === i, coordinate: mark.c, projectedEpsg3006: p.map(round),
      sourceIdentity: ref.identityStatus ?? null, sourcePosition: ref.positionStatus ?? null,
      referenceKind: ref.kind ?? null, selectedPadReviewId: ref.selectedPadReviewId ?? null,
      explicitReviewDecision: decision ? decision.pixel === null ? 'unresolved' : 'accepted' : null,
      nativeReferenceEpsg3006: nativeReference?.map(round) ?? null,
      nativeReferenceToModelMetres: nativeReference ? round(dist(nativeReference, p)) : null,
      retainedOriginalReference: equal(mark.c, ref.originalPosition),
      referenceSurfaceKind: runtimeMark.referenceSurfaceKind ?? 'platform',
      guideAssociatedFairway: fairwayReference,
      modelToPackMetres: round(dist(mark.c, packedHole.tees.marks[i].c)),
      packToRuntimeMetres: round(dist(packedHole.tees.marks[i].c, runtimeMark.c)),
      modelToMigrationMetres: round(dist(p, migrated.tees.marks[i].c)),
      exactProjectionToRuntimeBridgeMetres: round(dist(toRuntime(p), mark.c)),
      cameraToRuntimeReferenceMetres: round(dist(camera.position, runtimeMark.c)),
      insideReviewedPlatform: containing.length > 0,
      insideReferenceSurface: sourceRings.some(ring => inRing(...runtimeMark.c, ring)),
      nearestPlatformEdgeMetres: round(Math.max(0, -clearance(runtimeMark.c))),
      markerPairRendered: balls.length === 2,
      proceduralBallCentres: balls, proceduralBallClearanceMetres: ballClearances.map(round),
      proceduralBallReferenceSurfaceClearanceMetres: ballSourceClearances.map(round),
      proceduralBallCentresInsidePlatforms: balls.length === 2 && ballClearances.every(value => value > 0),
      proceduralBallFootprintsInsidePlatforms: balls.length === 2 && ballClearances.every(value => value >= 0.13),
      proceduralBallCentresInsideReferenceSurface: balls.length === 2 && ballSourceClearances.every(value => value > 0),
      proceduralBallFootprintsInsideReferenceSurface: balls.length === 2 && ballSourceClearances.every(value => value >= 0.13),
      explicitReferenceEvidenceSurvivesPack: Boolean(packedHole.tees.marks[i].orthophotoReference),
      packedEvidenceMatchesModel: equal(packedHole.tees.marks[i].orthophotoReference, mark.orthophotoReference),
      packedReferenceSurfaceMatchesModel: equal(packedHole.tees.marks[i].referenceSurfaceKind, mark.referenceSurfaceKind) &&
        equal(packedHole.tees.marks[i].sourcePadId, mark.sourcePadId),
    });
  });
  hole.line.forEach((point, i) => {
    const p = project(`${hole.n}:route:${i}`);
    routeRows.push({ hole: hole.n, pointIndex: i,
      modelToMigrationMetres: round(dist(p, migrated.line[i])),
      migrationToPublishedRoutingMetres: round(dist(migrated.line[i], routed.line[i])) });
  });
}
gate('every tee reference survives packing without coordinate change', marks.every(row => row.modelToPackMetres === 0));
gate('all tee vertices reproduce independent native EPSG3006 within 2 mm', pads.every(row => row.nativeToModelMetres.maximum < 0.002));
gate('all tee vertices and references reproduce independent migration within 2 mm',
  pads.every(row => row.modelToMigrationMetres.maximum < 0.002) && marks.every(row => row.modelToMigrationMetres < 0.002));
gate('runtime linear bridge stays below one 16 cm image pixel for every tee vertex and reference',
  pads.every(row => row.exactProjectionToRuntimeBridgeMetres.maximum < 0.16) && marks.every(row => row.exactProjectionToRuntimeBridgeMetres < 0.16));
gate('published v2 routing reproduces independent coordinates within 2 mm', routeRows.every(row => row.modelToMigrationMetres < 0.002 && row.migrationToPublishedRoutingMetres === 0));
gate('tee camera is at the runtime reference', marks.every(row => row.cameraToRuntimeReferenceMetres === 0));
gate('accepted explicit reference pixels reproduce the model through independent PROJ within 2 mm',
  marks.every(row => row.explicitReviewDecision !== 'accepted' || row.nativeReferenceToModelMetres < 0.002));
gate('explicit unresolved decisions retain original coordinates and unresolved identity',
  marks.every(row => row.explicitReviewDecision !== 'unresolved' || row.retainedOriginalReference && row.referenceKind === 'unresolved-guide-tee-reference'));
gate('guide reference evidence and surface association survive packing',
  marks.every(row => !row.explicitReviewDecision || row.packedEvidenceMatchesModel && row.packedReferenceSurfaceMatchesModel));
const placementChecks = [
  { name: 'every drawn marker sphere fits its permitted source surface',
    pass: marks.every(row => !row.markerPairRendered || row.proceduralBallFootprintsInsideReferenceSurface) },
  { name: 'explicitly unresolved guide references do not draw a colour marker pair',
    pass: marks.every(row => row.referenceKind !== 'unresolved-guide-tee-reference' || !row.markerPairRendered) },
];
const coincidentPairs = [];
for (let i = 0; i < marks.length; i++) for (let j = i + 1; j < marks.length; j++) {
  if (marks[i].hole === marks[j].hole && equal(marks[i].coordinate, marks[j].coordinate)) {
    coincidentPairs.push({ hole: marks[i].hole, tees: [marks[i].teeName, marks[j].teeName] });
  }
}
const report = {
  schemaVersion: 1, groundId: 'angso', auditedAt: new Date().toISOString(),
  purpose: 'Separate numerical coordinate agreement from tee-platform association and procedural marker placement.',
  independentProjection: 'pyproj Transformer EPSG:4326 to EPSG:3006, always_xy=True; no fitted translation, scale or rotation',
  coordinateChecksPass: gates.every(item => item.pass),
  markerPlacementChecksPass: placementChecks.every(item => item.pass),
  inputsSha256: hashes,
  frame: { origin: model.origin, mPerLat: model.mPerLat, mPerLon: model.mPerLon,
    runtimeRotationDegrees: bridge.rotationDegrees, runtimeScaleX: bridge.scaleX, runtimeScaleZ: bridge.scaleZ },
  summary: {
    physicalPlatforms: pads.length, platformVerticesIncludingClosure: pads.reduce((sum, row) => sum + row.verticesIncludingClosure, 0),
    references: marks.length, referencesOnReviewedPlatforms: marks.filter(row => row.insideReviewedPlatform).length,
    referencesOnGuideAssociatedFairway: marks.filter(row => row.guideAssociatedFairway && row.insideReferenceSurface).length,
    referencesOnSupportedSurfaces: marks.filter(row => row.insideReferenceSurface).length,
    defaultReferencesOnReviewedPlatforms: marks.filter(row => row.defaultSelected && row.insideReviewedPlatform).length,
    defaultReferencesOutsideReviewedPlatforms: marks.filter(row => row.defaultSelected && !row.insideReviewedPlatform)
      .map(row => ({ hole: row.hole, tee: row.teeName, distanceMetres: row.nearestPlatformEdgeMetres })),
    coincidentColourReferences: coincidentPairs,
    referenceKinds: countBy(marks, 'referenceKind'),
    explicitReviewDecisions: countBy(marks, 'explicitReviewDecision'),
    explicitReferenceNativeResidualMetres: stats(marks.map(row => row.nativeReferenceToModelMetres).filter(value => value !== null)),
    maximumPadNativeResidualMetres: Math.max(...pads.map(row => row.nativeToModelMetres.maximum)),
    maximumPadRuntimeBridgeResidualMetres: Math.max(...pads.map(row => row.exactProjectionToRuntimeBridgeMetres.maximum)),
    referenceRuntimeBridgeResidualMetres: stats(marks.map(row => row.exactProjectionToRuntimeBridgeMetres)),
    renderedProceduralPairs: marks.filter(row => row.markerPairRendered).length,
    referencesWithNoDrawnPair: marks.filter(row => !row.markerPairRendered).map(row => ({ hole: row.hole,
      tee: row.teeName, referenceKind: row.referenceKind, referenceSurfaceKind: row.referenceSurfaceKind,
      insideReferenceSurface: row.insideReferenceSurface })),
    renderedPairsWithBothCentresInsidePlatforms: marks.filter(row => row.markerPairRendered && row.proceduralBallCentresInsidePlatforms).length,
    renderedPairsWithBothFootprintsInsidePlatforms: marks.filter(row => row.markerPairRendered && row.proceduralBallFootprintsInsidePlatforms).length,
    renderedPairsWithBothCentresInsideReferenceSurface: marks.filter(row => row.markerPairRendered && row.proceduralBallCentresInsideReferenceSurface).length,
    renderedPairsWithBothFootprintsInsideReferenceSurface: marks.filter(row => row.markerPairRendered && row.proceduralBallFootprintsInsideReferenceSurface).length,
    onPlatformReferencesWithProceduralBallsOutside: marks.filter(row => row.markerPairRendered && row.insideReviewedPlatform && !row.proceduralBallCentresInsidePlatforms).map(row => ({ hole: row.hole, tee: row.teeName, clearances: row.proceduralBallClearanceMetres })),
    renderedPairsOutsideReferenceSurface: marks.filter(row => row.markerPairRendered && !row.proceduralBallFootprintsInsideReferenceSurface)
      .map(row => ({ hole: row.hole, tee: row.teeName, clearances: row.proceduralBallReferenceSurfaceClearanceMetres })),
    perReferenceEvidenceSurvivesPack: marks.filter(row => row.explicitReferenceEvidenceSurvivesPack).length,
  },
  gates, placementChecks, pads, marks, routeRows,
  limitations: [
    'Numerical residuals do not establish absolute source accuracy or the accuracy of manual platform interpretation.',
    'A platform contains multiple possible tee-marker positions; a platform centroid does not identify a tee colour.',
    'The marker-ball audit invokes the same teeMarkerPositions helper as main.js and checks the actual 0.13 m sphere footprint. These are decorative pairs, not observed current marker positions.',
    'Fairway turf is eligible only when the reference explicitly carries both referenceSurfaceKind=fairway and orthophotoReference.kind=guide-orthophoto-reference; no platform is synthesized.',
    'A green or routing audit alone does not certify selectable tee references; check3d currently accepts retained unresolved references by design.',
  ],
};
if (process.argv.includes('--write')) fs.writeFileSync(path.join(ROOT, 'angsobuild/mapping/tee-coordinate-audit.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ coordinateChecksPass: report.coordinateChecksPass, markerPlacementChecksPass: report.markerPlacementChecksPass,
  summary: report.summary, failedGates: [...gates, ...placementChecks].filter(item => !item.pass) }, null, 2));
if (!report.coordinateChecksPass || !report.markerPlacementChecksPass) process.exitCode = 1;
