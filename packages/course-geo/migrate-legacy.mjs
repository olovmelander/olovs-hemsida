import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectCoordinatePairs,
  coordinatePathCounts,
  localToLatLon,
  localToProjected,
  migrationResiduals,
  roundedCoordinate,
} from './migration.mjs';
import { latLonToSweref99Tm } from './proj.mjs';
import { selectMigrationInputs } from './migration-inputs.mjs';

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(PACKAGE_DIR, '..', '..');
const GEO_ROOT = join(REPO_ROOT, 'geo_data', 'course-v2');
const GENERATOR = 'course-geo/legacy-vector-migrator@1';
const CS2CS_IMPLEMENTATION = 'PROJ cs2cs with authority axis order [latitude,longitude] -> [northing,easting]';
const PYPROJ_IMPLEMENTATION = 'PROJ through pyproj.Transformer.from_crs with authority axis order [latitude,longitude] -> [northing,easting]; always_xy=False; PROJ_NETWORK=OFF';
const mode = process.argv.includes('--write') ? 'write'
  : process.argv.includes('--check') ? 'check'
    : null;
const groundArgument = process.argv.indexOf('--ground');
const selectedGround = groundArgument >= 0 ? process.argv[groundArgument + 1] : null;

if (!mode || (process.argv.includes('--write') && process.argv.includes('--check'))) {
  throw new Error('Use exactly one of --write or --check');
}
if (groundArgument >= 0 && !selectedGround) throw new Error('--ground requires a ground id');

const stableJson = value => JSON.stringify(value, null, 2) + '\n';
const compactJson = value => JSON.stringify(value) + '\n';
const hash = text => createHash('sha256').update(text).digest('hex');
const repoPath = path => relative(REPO_ROOT, path).split('\\').join('/');

function checkFrame(manifest, model, sourcePath) {
  const expected = manifest.legacyFrame;
  const actualOrigin = model.origin;
  if (!actualOrigin || !Number.isFinite(actualOrigin.lat) || !Number.isFinite(actualOrigin.lon)) {
    throw new Error(`${sourcePath} has no finite legacy origin`);
  }
  const checks = [
    ['latitude', actualOrigin.lat, expected.originWgs84.latitude],
    ['longitude', actualOrigin.lon, expected.originWgs84.longitude],
    ['metresPerLatitude', model.mPerLat, expected.metresPerLatitude],
    ['metresPerLongitude', model.mPerLon, expected.metresPerLongitude],
  ];
  for (const [label, actual, wanted] of checks) {
    if (!Number.isFinite(actual) || Math.abs(actual - wanted) > 1e-9) {
      throw new Error(`${sourcePath} ${label} ${actual} does not match manifest value ${wanted}`);
    }
  }
}

function scopeReport(localPairs, projected, coordinatePaths, origin) {
  const scopes = {
    playingGeometry: [],
    courseVicinity5km: [],
    allInventoriedGeometry: localPairs.map((_, index) => index),
  };
  localPairs.forEach(([x, z], index) => {
    if (coordinatePaths[index].startsWith('holes.') || coordinatePaths[index].startsWith('marking.')) {
      scopes.playingGeometry.push(index);
    }
    if (Math.hypot(x, z) <= 5000) scopes.courseVicinity5km.push(index);
  });
  return Object.fromEntries(Object.entries(scopes).map(([name, indexes]) => {
    if (indexes.length < 2) throw new Error(`${name} has fewer than two coordinates`);
    const residuals = migrationResiduals(
      indexes.map(index => localPairs[index]),
      indexes.map(index => projected[index]),
      origin,
    );
    return [name, {
      coordinatePairCount: indexes.length,
      directFrameDelta: residuals.direct,
      bestFitSimilarity: residuals.bestFitSimilarity,
    }];
  }));
}

function aggregateScopes(modelResults) {
  const localPairs = modelResults.flatMap(result => result.localPairs);
  const projected = modelResults.flatMap(result => result.projected);
  const coordinatePaths = modelResults.flatMap(result => result.coordinatePaths);
  return scopeReport(localPairs, projected, coordinatePaths, modelResults[0].origin);
}

async function emit(path, content) {
  if (mode === 'write') {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
    return;
  }
  if (!existsSync(path)) throw new Error(`Generated artifact is missing: ${repoPath(path)}`);
  const current = await readFile(path, 'utf8');
  if (current !== content) throw new Error(`Generated artifact is stale: ${repoPath(path)}`);
}

const manifestPaths = readdir(GEO_ROOT, { withFileTypes: true })
  .then(entries => entries
    .filter(entry => entry.isDirectory())
    .filter(entry => !selectedGround || entry.name === selectedGround)
    .map(entry => join(GEO_ROOT, entry.name, 'source-manifest.json'))
    .filter(existsSync)
    .sort());

const groundReports = [];
for (const manifestPath of await manifestPaths) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const modelInputs = selectMigrationInputs(manifest);

  const projectedFrame = manifest.legacyFrame.projectedOriginEpsg3006;
  const [origin] = projectedFrame
    ? [{ easting: projectedFrame.easting, northing: projectedFrame.northing }]
    : latLonToSweref99Tm([manifest.legacyFrame.originWgs84], {
      sourceCrs: 'EPSG:4326',
      decimals: 6,
    });
  const candidateOrigin = {
    easting: roundedCoordinate(origin.easting),
    northing: roundedCoordinate(origin.northing),
    heightRH2000: null,
    status: projectedFrame
      ? 'projected-source-frame-pending-independent-control'
      : 'horizontal-seed-only-pending-independent-control',
    source: projectedFrame
      ? 'legacyFrame.projectedOriginEpsg3006'
      : 'legacyFrame.originWgs84',
  };

  const modelResults = [];
  for (const { artifact, outputName } of modelInputs) {
    const sourceFile = join(REPO_ROOT, artifact.path);
    const sourceText = await readFile(sourceFile, 'utf8');
    const sourceSha256 = hash(sourceText);
    if (sourceSha256 !== artifact.sha256) {
      throw new Error(`${artifact.path} checksum differs from its source manifest`);
    }
    const legacyModel = JSON.parse(sourceText);
    checkFrame(manifest, legacyModel, artifact.path);
    const migratedModel = structuredClone(legacyModel);
    const collected = collectCoordinatePairs(migratedModel);
    const localPairs = collected.coordinates.map(({ pair }) => [...pair]);
    const coordinatePaths = collected.coordinates.map(({ path }) => path);
    const projected = projectedFrame
      ? localPairs.map(pair => {
        const coordinate = localToProjected(pair, manifest.legacyFrame);
        return {
          easting: roundedCoordinate(coordinate.easting),
          northing: roundedCoordinate(coordinate.northing),
        };
      })
      : latLonToSweref99Tm(
        localPairs.map(pair => localToLatLon(pair, manifest.legacyFrame)),
        { sourceCrs: 'EPSG:4326', decimals: 6 },
      );
    const residuals = migrationResiduals(localPairs, projected, origin);

    collected.coordinates.forEach(({ pair }, index) => {
      pair[0] = roundedCoordinate(projected[index].easting);
      pair[1] = roundedCoordinate(projected[index].northing);
    });
    delete migratedModel.mPerLat;
    delete migratedModel.mPerLon;
    delete migratedModel.origin;
    migratedModel.frame = projectedFrame
      ? 'absolute EPSG:3006 coordinate pairs [easting,northing] translated exactly from the recorded projected source frame; scalar RH 2000 heights are unchanged and unapproved'
      : 'absolute EPSG:3006 coordinate pairs [easting,northing]; legacy scalar heights are unapproved and unchanged';

    const outputFile = join(dirname(manifestPath), 'migration', outputName);
    const converted = {
      schemaVersion: 1,
      generator: GENERATOR,
      groundId: manifest.groundId,
      source: {
        path: artifact.path,
        sha256: sourceSha256,
        localFrame: manifest.legacyFrame,
      },
      target: {
        horizontalCrs: 'EPSG:3006',
        coordinateOrder: ['easting', 'northing'],
        verticalStatus: projectedFrame
          ? 'source-model-rh2000-heights-not-promoted-to-canonical-frame'
          : 'legacy-height-datum-unknown-not-converted',
        approvalStatus: 'migration-only-pending-independent-control',
      },
      candidateOrigin,
      coordinatePairCount: collected.coordinates.length,
      ignoredMetadataPairCount: collected.ignored.length,
      geometry: migratedModel,
    };
    const outputContent = compactJson(converted);
    await emit(outputFile, outputContent);

    modelResults.push({
      source: { path: artifact.path, sha256: sourceSha256 },
      output: { path: repoPath(outputFile), sha256: hash(outputContent) },
      coordinatePairCount: collected.coordinates.length,
      ignoredMetadataPairCount: collected.ignored.length,
      coordinatePathCounts: coordinatePathCounts(collected.coordinates),
      directFrameDelta: residuals.direct,
      bestFitSimilarity: residuals.bestFitSimilarity,
      scopes: scopeReport(localPairs, projected, coordinatePaths, origin),
      localPairs,
      projected,
      coordinatePaths,
      origin,
    });
  }

  const aggregate = aggregateScopes(modelResults);
  const reportFile = join(dirname(manifestPath), 'migration', 'residual-report.json');
  let implementation = process.env.COURSE_GEO_PYPROJ_PYTHON ? PYPROJ_IMPLEMENTATION : CS2CS_IMPLEMENTATION;
  if (mode === 'check' && existsSync(reportFile)) {
    // A check reproduces every coordinate and statistic using its selected
    // backend, while retaining the report's recorded generation provenance.
    // This lets real cs2cs verify a pyproj-generated report, and vice versa.
    const previous = JSON.parse(await readFile(reportFile, 'utf8')).transform?.implementation;
    if ([CS2CS_IMPLEMENTATION, PYPROJ_IMPLEMENTATION].includes(previous)) implementation = previous;
  }
  const report = {
    schemaVersion: 1,
    generator: GENERATOR,
    groundId: manifest.groundId,
    courseSlugs: manifest.courseSlugs,
    status: 'blocked-pending-independent-control-and-rh2000-height',
    transform: projectedFrame ? {
      source: 'local metres about an explicit EPSG:3006 source-frame origin',
      target: 'absolute EPSG:3006 coordinate pairs [easting,northing]',
      implementation: 'exact translation: easting = originEasting + x; northing = originNorthing - z',
      datumCaveat: 'The projected source frame avoids the approximate metres-per-degree legacy converter, but independent controls are still required before canonical-origin approval.',
    } : {
      source: 'EPSG:4326 legacy WGS84-like seed coordinates',
      target: 'EPSG:3006 SWEREF99 TM',
      implementation,
      datumCaveat: 'The legacy origins were not surveyed SWEREF 99 controls. These values seed migration only and cannot approve the canonical origin.',
    },
    candidateOrigin,
    independentControlAnchors: 0,
    canonicalOriginPromoted: false,
    aggregate: {
      coordinatePairCount: modelResults.reduce((sum, result) => sum + result.coordinatePairCount, 0),
      outsideCourseVicinity5km: modelResults.reduce(
        (sum, result) => sum + result.coordinatePairCount - result.scopes.courseVicinity5km.coordinatePairCount,
        0,
      ),
      scopes: aggregate,
    },
    models: modelResults.map(({
      localPairs,
      projected,
      coordinatePaths,
      origin: ignoredOrigin,
      ...result
    }) => result),
    blockers: [
      'Measure and review independent control anchors distributed across the physical ground.',
      'Acquire authoritative RH 2000 terrain/control height before assigning originHeightRH2000.',
      'Keep all converted vectors migration-only until residuals are checked against authoritative imagery or survey data.',
    ],
  };
  const reportContent = stableJson(report);
  await emit(reportFile, reportContent);
  groundReports.push({
    groundId: manifest.groundId,
    courseSlugs: manifest.courseSlugs,
    status: report.status,
    candidateOrigin,
    coordinatePairCount: report.aggregate.coordinatePairCount,
    outsideCourseVicinity5km: report.aggregate.outsideCourseVicinity5km,
    scopes: report.aggregate.scopes,
    report: { path: repoPath(reportFile), sha256: hash(reportContent) },
    outputs: modelResults.map(result => result.output),
  });
}

if (selectedGround && groundReports.length !== 1) {
  throw new Error(`No source manifest found for selected ground ${selectedGround}`);
}
const combinedFile = join(GEO_ROOT, 'migration-residual-report.json');
const combinedGrounds = selectedGround && existsSync(combinedFile)
  ? [
    ...JSON.parse(await readFile(combinedFile, 'utf8')).grounds
      .filter(report => report.groundId !== selectedGround),
    ...groundReports,
  ].sort((left, right) => left.groundId.localeCompare(right.groundId))
  : groundReports;
const combined = {
  schemaVersion: 1,
  generator: GENERATOR,
  status: 'migration-candidates-generated-canonical-origins-not-approved',
  crs: {
    horizontal: 'EPSG:3006',
    compoundTargetAfterHeightApproval: 'EPSG:5845',
  },
  groundCount: combinedGrounds.length,
  courseSlugCount: new Set(combinedGrounds.flatMap(report => report.courseSlugs)).size,
  grounds: combinedGrounds,
};
await emit(combinedFile, stableJson(combined));

console.log(`${mode === 'write' ? 'Generated' : 'Verified'} ${groundReports.length} ground reports, ${groundReports.reduce((sum, report) => sum + report.outputs.length, 0)} converted vector models and ${combined.courseSlugCount} total course slugs`);
