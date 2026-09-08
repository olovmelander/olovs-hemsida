#!/usr/bin/env node
/* Reproducible browser proof for retained Lidingo terrain, water and canopy.
 * BANVY_GPU=1 node lidingobuild/check-runtime.mjs [baseUrl] [--gl]
 * node lidingobuild/check-runtime.mjs --source-only  (no browser)
 * Serve apps/golf/dist first; this reads the retained source rasters. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { browserArgs } from '../tools/browser-args.mjs';
import { collectCoordinatePairs } from '../packages/course-geo/migration.mjs';
import { measuredRoofGeometry } from '../apps/golf/src/engine/measured-roof.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'lidingobuild/cache/review');
fs.mkdirSync(OUT, { recursive: true });
const useGl = process.argv.includes('--gl');
const name = useGl ? 'lidingo-measured-runtime-webgl' : 'lidingo-measured-runtime';
const BASE = (process.argv.find(argument => /^https?:/.test(argument)) || 'http://127.0.0.1:8634').replace(/\/$/, '');
const reviewBuildContext = new URL(BASE).port === '8638' || process.argv.includes('--isolated-review')
  ? { isolated: true, reason: 'Temporary ignored Vite review plugin excludes an unrelated missing Visby configuration; shared source files remain unchanged.' }
  : { isolated: false };
const read = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = fs.readFileSync(path.join(ROOT, 'lidingobuild/cache/terrain-review/terrain-1m.f32'));
const water = read('geo_data/course-v2/lidingo/mapping/water-breakgeometry-epsg3006.geojson');
const model = read('lidingobuild/course-model.json');
const roofSourcePath = 'lidingobuild/mapping/building-roof-meshes.json';
const roofSource = read(roofSourcePath);
const migrated = read('geo_data/course-v2/lidingo/migration/course-model.epsg3006.json').geometry;
const checks = [];
const gate = (ok, message, details = undefined) => checks.push({ ok: !!ok, message, details });
const roofTotals = roofSource.buildings.reduce((sum, building) => ({ buildings: sum.buildings + 1,
  vertices: sum.vertices + building.mesh.verticesEpsg3006RH2000.length,
  triangles: sum.triangles + building.mesh.triangleIndices.length / 3,
  wallSegments: sum.wallSegments + building.mesh.boundaryWallSegmentsEpsg3006RH2000.length }),
{ buildings: 0, vertices: 0, triangles: 0, wallSegments: 0 });

function compareRoof(actualBuilding, sourceBuilding, projected = false) {
  const surface = actualBuilding?.roofSurface;
  const mesh = sourceBuilding.mesh;
  const result = { id: sourceBuilding.id, exists: !!surface, comparedVertices: 0, comparedWallEndpoints: 0,
    maximumHorizontalDifferenceMetres: 0, maximumHeightDifferenceMetres: 0, exactHeights: true,
    triangleIndicesEqual: JSON.stringify(surface?.triangleIndices) === JSON.stringify(mesh.triangleIndices),
    metadataEqual: surface?.sourceId === sourceBuilding.sourceId && surface?.sourceEpoch === sourceBuilding.sourceEpoch &&
      surface?.state === sourceBuilding.state && surface?.verticalCrs === 'EPSG:5613' &&
      surface?.coverageFraction === mesh.statistics.footprintCoverageFraction,
    genericHeightRemoved: actualBuilding != null && !Object.hasOwn(actualBuilding, 'h') };
  function pairs(actual, expected, wall = false) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every(([e, n, height], index) => {
      const vertex = actual[index];
      if (!Array.isArray(vertex?.c) || vertex.c.length !== 2 || !vertex.c.every(Number.isFinite) || !Number.isFinite(vertex.heightRH2000)) return false;
      const horizontal = projected ? [e, n] : [e - 677700.5, 6586399.5 - n];
      result.maximumHorizontalDifferenceMetres = Math.max(result.maximumHorizontalDifferenceMetres,
        Math.abs(horizontal[0] - vertex.c[0]), Math.abs(horizontal[1] - vertex.c[1]));
      result.maximumHeightDifferenceMetres = Math.max(result.maximumHeightDifferenceMetres, Math.abs(height - vertex.heightRH2000));
      result.exactHeights &&= height === vertex.heightRH2000;
      if (wall) result.comparedWallEndpoints++; else result.comparedVertices++;
      return true;
    });
  }
  const vertices = pairs(surface?.vertices, mesh.verticesEpsg3006RH2000);
  const walls = Array.isArray(surface?.boundaryWallSegments) && surface.boundaryWallSegments.length === mesh.boundaryWallSegmentsEpsg3006RH2000.length &&
    mesh.boundaryWallSegmentsEpsg3006RH2000.every((segment, index) => pairs(surface.boundaryWallSegments[index], segment, true));
  result.ok = vertices && walls && result.metadataEqual && result.triangleIndicesEqual && result.genericHeightRemoved &&
    result.exactHeights && result.maximumHorizontalDifferenceMetres <= (projected ? 0.000501 : 0);
  return result;
}

const modelRoofs = model.infra.buildings.filter(building => building.roofSurface);
const expectedGenericBuildings = model.infra.buildings.filter(building => building.ring?.length >= 3 &&
  building.amenity !== 'place_of_worship' && building.kind !== 'roof' && !building.roofSurface).length;
const migrationRoofs = migrated.infra.buildings.filter(building => building.roofSurface);
const modelRoofComparison = roofSource.buildings.map(building => compareRoof(modelRoofs.find(b => b.id === building.id), building));
const migrationRoofComparison = roofSource.buildings.map(building => compareRoof(migrationRoofs.find(b => b.id === building.id), building, true));
const roofCoordinatePairs = collectCoordinatePairs(model).coordinates.filter(entry => entry.path.includes('.roofSurface.'));
const expectedRoofCoordinatePairs = roofTotals.vertices + 2 * roofTotals.wallSegments;
gate(roofTotals.buildings === 5 && roofTotals.triangles === 7069 && modelRoofs.length === 5 && modelRoofComparison.every(r => r.ok),
  'Source model retains all five measured roofs, exact RH2000 heights and only supported wall endpoints', modelRoofComparison);
gate(migrationRoofs.length === 5 && migrationRoofComparison.every(r => r.ok) && roofCoordinatePairs.length === expectedRoofCoordinatePairs,
  'Every roof coordinate and wall endpoint survives canonical migration at documented millimetre rounding',
  { coordinatePairs: roofCoordinatePairs.length, expectedCoordinatePairs: expectedRoofCoordinatePairs, roofs: migrationRoofComparison });

function sourceDtmHeight(x, z) {
  const col = x + 1024, row = z + 1024;
  if (col < 0 || row < 0 || col > 2048 || row > 2048) return NaN;
  const ix = Math.min(2047, Math.floor(col)), iy = Math.min(2047, Math.floor(row));
  const u = col - ix, v = row - iy, k = iy * 2049 + ix;
  const h = i => source.readFloatLE(i * 4);
  return (h(k) * (1-u) + h(k+1) * u) * (1-v) + (h(k+2049) * (1-u) + h(k+2050) * u) * v;
}
const roofGeometryReview = modelRoofs.map(building => {
  const geometry = measuredRoofGeometry(building.roofSurface, sourceDtmHeight);
  return { id: building.id, triangles: geometry.triangles.length, walls: geometry.walls.length,
    upwardTriangles: geometry.triangles.filter(([a, b, c]) => (b[2]-a[2])*(c[0]-a[0]) - (b[0]-a[0])*(c[2]-a[2]) > 0).length,
    finiteWalls: geometry.walls.every(wall => wall.flat().every(Number.isFinite)),
    wallTopsExact: geometry.walls.every((wall, index) => wall[2][1] === building.roofSurface.boundaryWallSegments[index][1].heightRH2000 && wall[3][1] === building.roofSurface.boundaryWallSegments[index][0].heightRH2000) };
});
gate(roofGeometryReview.every(r => r.triangles === r.upwardTriangles && r.finiteWalls && r.wallTopsExact) &&
  roofGeometryReview.reduce((sum, r) => sum + r.walls, 0) === roofTotals.wallSegments,
  'Renderer roof conversion keeps upward winding, exact top heights and the supported partial wall inventory', roofGeometryReview);
const samplePoints = [];
for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
  samplePoints.push({ label: `tile-centre-${row}-${col}`, x: -896 + col * 256, z: -896 + row * 256 });
}
for (const hole of model.holes) for (const [label, point] of [['green', hole.green.ring[0]], ['tee', hole.line[0]]]) {
  samplePoints.push({ label: `hole-${hole.n}-${label}`, x: Math.round(point[0]), z: Math.round(point[1]) });
}
for (const point of samplePoints) point.expectedRH2000 = source.readFloatLE(((point.z + 1024) * 2049 + point.x + 1024) * 4);
if (process.argv.includes('--source-only')) {
  const sourceReview = { schemaVersion: 1, groundId: 'lidingo', checks, roofTotals, expectedGenericBuildings,
    sourceModelSha256: hash(fs.readFileSync(path.join(ROOT, 'lidingobuild/course-model.json'))),
    roofMeshSha256: hash(fs.readFileSync(path.join(ROOT, roofSourcePath))),
    limitations: ['Source/model/renderer-helper review only; no browser was started.'] };
  fs.writeFileSync(path.join(OUT, 'roof-source-runtime-review.json'), JSON.stringify(sourceReview, null, 2) + '\n');
  console.log(JSON.stringify({ passed: checks.every(check => check.ok), roofTotals, expectedGenericBuildings, checks }, null, 2));
  process.exit(checks.some(check => !check.ok) ? 1 : 0);
}
const errors = [], logs = [], requests = [];
const startedAt = new Date().toISOString();
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
let report;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => errors.push(String(e).slice(0, 400)));
  page.on('console', msg => { if (msg.type() === 'error' || /v2 water|v2 vegetation|provisional/i.test(msg.text())) logs.push(msg.text().slice(0, 500)); });
  page.on('response', response => { if (/v2-index|grounds\/lidingo|courses\/lidingo|lidingo-ground-graph/.test(response.url())) requests.push({ url: response.url(), status: response.status() }); });
  const url = `${BASE}/?bana=lidingo&v2=require&det=1&ljus=dag${useGl ? '&gl=1' : ''}`;
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForSelector('#boot.done', { timeout: 420000 });
  await page.waitForFunction(() => window.V3D?.settled(), null, { timeout: 120000 });
  console.log('Measured runtime boot completed; reading source proof.');
  const state = await page.evaluate(points => {
    const V = window.V3D;
    return {
      terrain: V.v2Terrain(), objects: V.v2Objects(), trees: V.legacyTrees(),
      water: V.waterLevels(), sheets: V.waterSheets(), flatWater: V.flatWater(), carvedGpuTiles: V.carvedGpuTiles(),
      samples: points.map(p => ({ ...p, height: V.probeH(p.x, p.z), inspected: V.heightSample(p.x, p.z), waterBed: V.waterBedAt(p.x, p.z) })),
      renderer: V.rendererInfo(), quality: V.quality(), course: V.course(),
      roofs: { measuredBuildings: V.stats.measuredRoofBuildings ?? null, measuredTriangles: V.stats.measuredRoofTriangles ?? null,
        genericBuildings: V.stats.genericRoofBuildings ?? null,
        buildings: V.M.infra.buildings.filter(b => b.roofSurface).map(b => ({ id: b.id, roofSurface: b.roofSurface, ...(Object.hasOwn(b, 'h') ? { h: b.h } : {}) })) },
      waterBedSamples: V.waterLevels().map(w => ({ id: w.id, result: V.waterBedAt((w.bb.x0 + w.bb.x1) / 2, (w.bb.z0 + w.bb.z1) / 2) })),
    };
  }, samplePoints);
  fs.writeFileSync(path.join(OUT, `${name}-state.json`), JSON.stringify(state, null, 2) + '\n');
  const sourcePolygons = water.features.flatMap(f => (f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]).map((poly, index) => {
    const ring = poly[0].map(([e, n]) => [e - 677700.5, 6586399.5 - n]);
    return { id: `${f.id ?? f.properties.id}-part-${index + 1}`, level: f.properties.heightRH2000,
      bounds: [Math.min(...ring.map(p => p[0])), Math.min(...ring.map(p => p[1])), Math.max(...ring.map(p => p[0])), Math.max(...ring.map(p => p[1]))] };
  }));
  const waterChecks = state.water.map(w => {
    const bounds = [w.bb.x0, w.bb.z0, w.bb.x1, w.bb.z1];
    const matches = sourcePolygons.map(source => ({ source, boundsError: Math.max(...source.bounds.map((v, i) => Math.abs(v - bounds[i]))) })).sort((a, b) => a.boundsError - b.boundsError);
    const { source: matched, boundsError } = matches[0];
    return { id: matched.id, matchMethod: 'EPSG3006 local ring bounds (pack omits IDs)', boundsErrorMetres: boundsError, expectedRH2000: matched.level, runtimeLevel: w.level, difference: w.level - matched.level };
  });
  for (const s of state.samples) s.errorMetres = s.height - s.expectedRH2000;
  const maxHeightError = Math.max(...state.samples.map(s => Math.abs(s.errorMetres)));
  gate(errors.length === 0, 'No uncaught browser exceptions', errors);
  const published = read('apps/golf/public/lidingo-ground-graph-report.json');
  const standIndex = read('lidingobuild/cache/vegetation/stands-stage/layer-index.json');
  const expectedStandBytes = standIndex.assets.reduce((sum, a) => sum + a.reference.bytes, 0);
  gate(requests.some(r => r.url.includes(published.graph.courseManifestSha256)) && requests.some(r => r.url.includes(published.graph.groundManifestSha256)), 'Browser loaded the final published course and ground manifest identities');
  gate(state.objects.loaded.bytes === expectedStandBytes && state.objects.loaded.records === 0 && standIndex.assets.every(asset => requests.some(r => r.status === 200 && r.url.includes(asset.reference.sha256))), 'Browser loaded every final measured stand chunk identity without individual records', { expectedStandBytes, loadedBytes: state.objects.loaded.bytes, chunks: standIndex.assets.length });
  gate(state.terrain.backend === (useGl ? 'webgl2' : 'webgpu'), 'Requested graphics backend is active', { expected: useGl ? 'webgl2' : 'webgpu', actual: state.terrain.backend });
  gate(state.terrain.ready && state.terrain.status === 'ready', 'Measured v2 terrain is active');
  gate(state.terrain.renderer.meshResolutionMetres === 1, 'Runtime mesh resolution is 1 metre');
  gate(Number.isFinite(maxHeightError) && maxHeightError <= 0.01001, '100 source-grid probes preserve RH2000 within centimetre quantization', { probes: state.samples.length, maxHeightErrorMetres: maxHeightError });
  gate(waterChecks.length === 7 && new Set(waterChecks.map(w => w.id)).size === 7 && waterChecks.every(w => w.boundsErrorMetres < 0.011 && Math.abs(w.difference) < 0.000001), 'All seven source water polygons retain their exact LM RH2000 levels', waterChecks);
  gate(state.flatWater === null && state.carvedGpuTiles === null && state.samples.every(s => s.waterBed === null) && state.waterBedSamples.every(s => s.result === null), 'No inferred flat-water field or carved water bed is active');
  gate(state.objects.coverageTiles === 64 && state.objects.graphStandTiles === 64, 'Measured stand fields cover all 64 finest terrain tiles, including void cells');
  gate(state.trees.legacyInsideCoverage === 0, 'Legacy vegetation does not leak into measured coverage');
  gate(state.trees.reasons.v2Individual === 0 && state.objects.planned?.individuals === 0, 'No individual tree records are rendered');
  gate(state.trees.total > 0 && state.trees.reasons.v2Stand === state.trees.total && Object.entries(state.trees.reasons).every(([key, value]) => key === 'v2Stand' || value === 0), 'Every rendered tree is a representative derived from measured stand cells');
  const browserRoofComparison = roofSource.buildings.map(building => compareRoof(state.roofs.buildings.find(b => b.id === building.id), building));
  gate(state.roofs.buildings.length === 5 && browserRoofComparison.every(r => r.ok),
    'Loaded browser pack preserves every measured roof vertex, RH2000 height, triangle and supported wall endpoint exactly', browserRoofComparison);
  gate(state.roofs.measuredBuildings === 5 && state.roofs.measuredTriangles === 7069 && state.roofs.genericBuildings === expectedGenericBuildings,
    'Five measured roofs render 7069 triangles while the generic path renders only the other eligible buildings',
    { measuredBuildings: state.roofs.measuredBuildings, measuredTriangles: state.roofs.measuredTriangles,
      genericBuildings: state.roofs.genericBuildings, expectedGenericBuildings });
  await page.evaluate(() => { window.V3D.setPreset('noon'); window.V3D.setView(700, 850, 950, 0, 15, 0); });
  await page.waitForFunction(() => window.V3D.settled(), null, { timeout: 120000 });
  await page.waitForFunction(() => !document.querySelector('#boot') || Number(getComputedStyle(document.querySelector('#boot')).opacity) === 0, null, { timeout: 10000 });
  await page.screenshot({ path: path.join(OUT, `${name}-overview.png`) });
  const screenshots = [`lidingobuild/cache/review/${name}-overview.png`];
  if (!useGl) {
    for (const hole of [7, 12, 18]) {
      await page.evaluate(hole => { window.V3D.goHole(hole, false, true); window.V3D.setCam('green', true); }, hole);
      await page.waitForFunction(() => window.V3D.settled(), null, { timeout: 120000 });
      await page.screenshot({ path: path.join(OUT, `${name}-hole-${hole}.png`) });
      screenshots.push(`lidingobuild/cache/review/${name}-hole-${hole}.png`);
    }
  }
  report = { schemaVersion: 1, groundId: 'lidingo', startedAt, completedAt: new Date().toISOString(), url, reviewBuildContext,
    sources: { terrainFloat32Sha256: hash(source), waterGeojsonSha256: hash(fs.readFileSync(path.join(ROOT, 'geo_data/course-v2/lidingo/mapping/water-breakgeometry-epsg3006.geojson'))),
      graph: published.graph,
      roofMeshSha256: hash(fs.readFileSync(path.join(ROOT, roofSourcePath))),
      standLayerIndexSha256AtReview: hash(fs.readFileSync(path.join(ROOT, 'lidingobuild/cache/vegetation/stands-stage/layer-index.json'))) },
    checks, state, errors, logs, requests,
    roofReview: { sourceTotals: roofTotals, model: modelRoofComparison, migration: migrationRoofComparison, geometry: roofGeometryReview, browser: browserRoofComparison },
    limitations: ['These checks prove source preservation and rendering provenance, not independent survey accuracy or current tree presence.', 'Rendered trees are stand representatives from 2021 canopy measurements; no measured stem positions are claimed.', 'The source-ground water level has no bathymetry. No physical depth is inferred.', 'The clubhouse and northern facility roofs remain partial source-supported meshes; unsupported roof areas and wall segments are omitted.'],
    screenshots };
} catch (error) {
  report = { startedAt, completedAt: new Date().toISOString(), failed: true, reviewBuildContext, error: error.stack, checks, errors, logs, requests };
} finally { await browser.close(); }
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(report, null, 2) + '\n');
const compact = { schemaVersion: 1, groundId: 'lidingo', status: report.failed || checks.some(check => !check.ok) ? 'failed' : 'passed',
  startedAt, completedAt: report.completedAt, url: report.url, backend: report.state?.terrain.backend ?? null, reviewBuildContext,
  sources: report.sources, checks, vegetation: report.state ? {
    coverageTiles: report.state.objects.coverageTiles, loadedRecords: report.state.objects.loaded.records,
    renderedStandRepresentatives: report.state.trees.reasons.v2Stand,
    renderedIndividualTrees: report.state.trees.reasons.v2Individual,
    legacyInsideCoverage: report.state.trees.legacyInsideCoverage,
  } : null, roofs: report.state ? { measuredBuildings: report.state.roofs.measuredBuildings,
    measuredTriangles: report.state.roofs.measuredTriangles, genericBuildings: report.state.roofs.genericBuildings, expectedGenericBuildings,
    sourceTotals: roofTotals, browserChecks: report.roofReview?.browser } : null,
  screenshots: report.screenshots, detailedReport: `lidingobuild/cache/review/${name}.json`,
  limitations: report.limitations, error: report.error };
fs.writeFileSync(path.join(ROOT, `lidingobuild/mapping/3d-validation${useGl ? '-webgl' : ''}.json`), JSON.stringify(compact, null, 2) + '\n');
console.log(JSON.stringify({ failed: report.failed ?? false, checks: report.checks, report: `lidingobuild/cache/review/${name}.json` }, null, 2));
if (report.failed || checks.some(check => !check.ok)) process.exitCode = 1;
