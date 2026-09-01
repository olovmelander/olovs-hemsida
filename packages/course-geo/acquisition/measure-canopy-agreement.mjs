#!/usr/bin/env node
/* Does the authorized point cloud resolve this course's canopy, and where does
   it agree with the satellite raster the planter currently obeys?
 *
 * This is the third question in the same series, asked with the same
 * statistic so the three answers are comparable. The bare-earth DTM could not
 * resolve golf surfaces; the orthophoto is refused to this account; Laserdata
 * Skog is authorized and covers the whole AOI.
 *
 * Direction of evidence matters here. The LiDAR is authenticated and carries
 * its own ground returns, so it needs no second product to be georeferenced
 * against. The satellite tree-cover raster is a LEGACY derived artifact and is
 * not authoritative -- so a disagreement is evidence about the raster, and the
 * report says so rather than scoring the LiDAR against it.
 *
 * Nothing but statistics leaves the runner: no points, no raster, no tile.  */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { separabilitySummary } from '../../course-v2/terrain-derivatives.mjs';
import { runGeoCommand } from '../proj.mjs';
import { authorizationHeaders, lantmaterietCredentials } from './credentials.mjs';
import { probeLantmaterietLaserAccess } from './access-preflight.mjs';
import { laserWindowPlan } from './laser-window.mjs';
import {
  CANOPY_RESOLUTION_METRES,
  CANOPY_THRESHOLD_METRES,
  canopyAgreement,
  canopyHeightPipeline,
  chooseBalancedWindow,
  classifyProbes,
  probeLattice,
  treeCoverIndex,
} from './canopy-window.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODEL = path.join(ROOT, 'geo_data/course-v2/puttom/migration/course-model.epsg3006.json');
const TREE_COVER = path.join(ROOT, 'puttombuild/tree-cover.json');
const SPAN_METRES = 512;
const PROBE_LATTICE = 48;
/* A probe counts for a class only where the raster says the same thing across
   this radius. Stand edges are exactly where a 3 m satellite classification
   and a metre-accurate point cloud may legitimately differ. */
const PROBE_UNIFORM_RADIUS_METRES = 6;
/* The canopy value at a probe is the median over a small disc, so one missing
   cell or one unusually tall crown does not decide a probe on its own. */
const PROBE_SAMPLE_RADIUS_METRES = 3;
/* A verdict needs enough of both classes to mean anything. The first run
   returned 108 tree and 21 open probes out of 1890 because the canopy raster
   came back 98.7% nodata, and an agreement figure computed on 21 samples reads
   like a finding while being nearly noise. Below these it reports the
   diagnostics and no verdict. */
const MINIMUM_PROBES_PER_CLASS = 60;
const MINIMUM_CANOPY_COVERAGE = 0.5;

/** PDAL nests filters.stats output differently across versions and keys the
    stages by tag; collect every statistic block it emitted rather than
    assuming a path, and keep the tag when there is one. */
function collectStatistics(node, found = [], tag = null, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return found;
  if (Array.isArray(node.statistic)) found.push({ tag, statistic: node.statistic });
  for (const [key, value] of Object.entries(node)) {
    collectStatistics(value, found, /^[a-zA-Z]/.test(key) ? key : tag, depth + 1);
  }
  return found;
}

/** filters.stats reports enumerated counts as either {value, count} or a
    packed "value/count" string depending on version; the first parser read
    only the packed form and reported an empty histogram, which is exactly the
    kind of silent blank a diagnostic must not produce. */
function enumeratedCounts(item) {
  const counts = {};
  for (const entry of item?.counts || []) {
    if (entry && typeof entry === 'object' && entry.value !== undefined && entry.count !== undefined) {
      counts[Number(entry.value)] = Number(entry.count);
      continue;
    }
    const [value, count] = String(entry?.value ?? entry ?? '').split('/');
    if (value !== undefined && count !== undefined && value !== '') counts[Number(value)] = Number(count);
  }
  return counts;
}

function summarizeStatistics({ tag, statistic }) {
  const byName = new Map(statistic.map(item => [item.name, item]));
  const hag = byName.get('HeightAboveGround');
  return {
    tag,
    points: Number(hag?.count ?? byName.get('Z')?.count ?? 0),
    heightAboveGroundMetres: hag ? {
      minimum: hag.minimum, maximum: hag.maximum, mean: hag.average,
    } : null,
    classificationCounts: enumeratedCounts(byName.get('Classification')),
  };
}

function pipelineDiagnostics(metadata) {
  const blocks = collectStatistics(metadata);
  if (!blocks.length) return { available: false, note: 'PDAL returned no filters.stats metadata' };
  const stages = blocks.map(summarizeStatistics);
  /* The reader stage is the one with no HeightAboveGround: that dimension does
     not exist until hag_nn has run. */
  const afterReader = stages.find(stage => !stage.heightAboveGroundMetres) || null;
  const beforeWriter = stages.find(stage => stage.heightAboveGroundMetres) || null;
  return {
    available: true,
    pointsFromReader: afterReader?.points ?? null,
    pointsReachingWriter: beforeWriter?.points ?? null,
    /* Which side of hag_nn lost them, stated rather than inferred by a reader
       of this report. */
    lostInFilters: afterReader && beforeWriter ? afterReader.points - beforeWriter.points : null,
    readerClassificationCounts: afterReader?.classificationCounts ?? null,
    heightAboveGroundMetres: beforeWriter?.heightAboveGroundMetres ?? null,
    stages,
  };
}

function argumentValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function centroid(ring) {
  let easting = 0;
  let northing = 0;
  for (const [x, y] of ring) { easting += x; northing += y; }
  return { easting: easting / ring.length, northing: northing / ring.length };
}

/** The played ground's centre, as a stated rule rather than a fitted choice:
    a window centred on the course inevitably spans both mown turf and the
    stands around it, without anyone choosing where to look. */
function courseCentre(model) {
  const points = [];
  for (const hole of model.geometry.holes) {
    for (const ring of [hole.green?.ring, hole.fairway?.ring]) {
      if (Array.isArray(ring) && ring.length >= 3) points.push(centroid(ring));
    }
  }
  if (points.length < 10) throw new Error('the migration model has too few recorded surfaces to centre a window');
  return [
    points.reduce((sum, point) => sum + point.easting, 0) / points.length,
    points.reduce((sum, point) => sum + point.northing, 0) / points.length,
  ];
}

async function readGrid(xyzPath, resolutionMetres) {
  const values = new Map();
  let totalCells = 0;
  const lines = createInterface({
    input: createReadStream(xyzPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 3) continue;
    totalCells++;
    const value = Number(parts[2]);
    /* writers.gdal writes -9999 where no return landed. A nodata cell is a
       gap in the record, never a canopy height of zero -- and the ratio of the
       two is what says whether this window was surveyed or merely requested. */
    if (!Number.isFinite(value) || value <= -9998) continue;
    values.set(`${Math.round(Number(parts[0]) / resolutionMetres)}/${Math.round(Number(parts[1]) / resolutionMetres)}`, value);
  }
  return { values, totalCells };
}

function sampleDisc(values, easting, northing, resolutionMetres, radiusMetres) {
  const reach = Math.ceil(radiusMetres / resolutionMetres);
  const samples = [];
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (Math.hypot(dx, dy) * resolutionMetres > radiusMetres) continue;
      const value = values.get(`${Math.round(easting / resolutionMetres) + dx}/${Math.round(northing / resolutionMetres) + dy}`);
      if (Number.isFinite(value)) samples.push(value);
    }
  }
  if (!samples.length) return Number.NaN;
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length / 2)];
}

async function main() {
  const out = argumentValue('--out');
  const discoveryPath = argumentValue('--discovery',
    path.join(ROOT, 'geo_data/course-v2/puttom/acquisition/d2-discovery.json'));
  const report = JSON.parse(fs.readFileSync(discoveryPath, 'utf8'));
  const model = JSON.parse(fs.readFileSync(MODEL, 'utf8'));
  const raster = JSON.parse(fs.readFileSync(TREE_COVER, 'utf8'));
  const credentials = lantmaterietCredentials();

  /* Ask before reading, the way the orthophoto step does: an entitlement
     answer is a recorded fact, while the same refusal discovered inside PDAL
     is a stack trace. */
  let access;
  try {
    access = await probeLantmaterietLaserAccess(report, { credentials });
  } catch (error) {
    const blocked = {
      schemaVersion: 1,
      kind: 'puttom-canopy-agreement',
      measured: false,
      blocked: 'source-not-authorized',
      reason: String(error?.message || error).slice(0, 300),
      nextAction: 'Laserdata Skog is normally readable by this account; re-run, and if it persists check the Geotorget order',
    };
    if (out) {
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(path.resolve(out), `${JSON.stringify(blocked, null, 2)}\n`);
    }
    console.log(JSON.stringify(blocked, null, 2));
    /* Unlike the orthophoto, where refusal is the KNOWN state of this account
       and a recorded fact, Laserdata Skog is entitled and has read cleanly on
       every run. Losing it is a regression, so this exits non-zero: the two
       steps look alike and must not behave alike. */
    process.exitCode = 1;
    return;
  }

  /* Decide where to look from the legacy raster alone, before a single point
     is read: a window on the course centre is 90% mown ground and measures the
     forest side on a handful of probes. */
  const origin = model.candidateOrigin;
  const cover = treeCoverIndex(raster);
  const toWorld = (easting, northing) => [easting - origin.easting, origin.northing - northing];
  const chosen = chooseBalancedWindow({
    centreEpsg3006: courseCentre(model),
    cover,
    toWorld,
    spanMetres: SPAN_METRES,
    lattice: PROBE_LATTICE,
    uniformRadiusMetres: PROBE_UNIFORM_RADIUS_METRES,
  });
  const plan = laserWindowPlan(report, { spanMetres: SPAN_METRES, focusEpsg3006: chosen.focusEpsg3006 });
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'banvy-canopy-'));
  const rasterPath = path.join(temporaryDirectory, 'chm.tif');
  const xyzPath = path.join(temporaryDirectory, 'chm.xyz');
  const pipeline = canopyHeightPipeline(plan, credentials, {
    outputPath: rasterPath,
    authorizationHeaders,
  });
  const secrets = Object.values(pipeline[0].filename.headers);
  const redact = value => {
    let text = String(value);
    for (const secret of secrets.filter(Boolean)) text = text.replaceAll(secret, '<redacted>');
    return text;
  };
  const metadataFile = path.join(temporaryDirectory, 'pdal.json');
  const started = performance.now();
  let values;
  let totalCells = 0;
  let diagnostics;
  try {
    try {
      /* No --stream, unlike the sibling statistics pipeline: hag_nn has to see
         the window's ground returns before it can measure anything above
         them, so it cannot run point-at-a-time. */
      runGeoCommand('pdal', ['pipeline', '--stdin', '--metadata', metadataFile], { input: JSON.stringify(pipeline) });
    } catch (error) {
      throw new Error(`PDAL canopy rasterisation failed: ${redact(error.message)}`);
    }
    diagnostics = pipelineDiagnostics(JSON.parse(fs.readFileSync(metadataFile, 'utf8')));
    runGeoCommand('gdal_translate', ['-of', 'XYZ', rasterPath, xyzPath]);
    const grid = await readGrid(xyzPath, CANOPY_RESOLUTION_METRES);
    values = grid.values;
    totalCells = grid.totalCells;
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  /* The window PDAL actually read may be clamped inside the source tile, so
     the probes are rebuilt on the plan's own bounds rather than on the focus
     that was asked for. */
  const [minX, minY, maxX, maxY] = plan.boundsEpsg3006;
  const split = classifyProbes({
    probes: probeLattice({
      centreEpsg3006: [(minX + maxX) / 2, (minY + maxY) / 2],
      spanMetres: Math.min(maxX - minX, maxY - minY),
      lattice: PROBE_LATTICE,
    }),
    cover,
    toWorld,
    uniformRadiusMetres: PROBE_UNIFORM_RADIUS_METRES,
  });
  const treeHeights = [];
  const openHeights = [];
  let missingCanopy = 0;
  for (const [label, probes, sink] of [['trees', split.trees, treeHeights], ['open', split.open, openHeights]]) {
    void label;
    for (const probe of probes) {
      const height = sampleDisc(values, probe.easting, probe.northing, CANOPY_RESOLUTION_METRES, PROBE_SAMPLE_RADIUS_METRES);
      if (!Number.isFinite(height)) { missingCanopy++; continue; }
      sink.push(height);
    }
  }
  const canopyCoverage = totalCells ? +(values.size / totalCells).toFixed(4) : 0;
  const diagnosticBlock = {
    canopyCells: values.size,
    rasterCells: totalCells,
    canopyCoverage,
    pipeline: diagnostics,
    unusableProbes: split.unusable,
    missingCanopyProbes: missingCanopy,
    treeProbes: treeHeights.length,
    openProbes: openHeights.length,
  };
  /* A thin raster must not be dressed up as a finding. Report what was
     measured about the INSTRUMENT and stop, rather than publish an agreement
     figure computed on a handful of probes. */
  if (canopyCoverage < MINIMUM_CANOPY_COVERAGE ||
      treeHeights.length < MINIMUM_PROBES_PER_CLASS ||
      openHeights.length < MINIMUM_PROBES_PER_CLASS) {
    const thin = {
      schemaVersion: 1,
      kind: 'puttom-canopy-agreement',
      measured: false,
      blocked: 'insufficient-canopy-coverage',
      window: {
        boundsEpsg3006: plan.boundsEpsg3006,
        spanMetres: plan.spanMetres,
        canopyResolutionMetres: CANOPY_RESOLUTION_METRES,
        sourceItemId: plan.source.id,
        advertisedPointDensityPerSquareMetre: plan.source.pointDensityPerSquareMetre,
        elapsedMilliseconds: Math.round(performance.now() - started),
      },
      expected: {
        canopyCoverage: MINIMUM_CANOPY_COVERAGE,
        probesPerClass: MINIMUM_PROBES_PER_CLASS,
        predictedTreeProbes: chosen.treeProbes,
        predictedOpenProbes: chosen.openProbes,
      },
      observed: diagnosticBlock,
      note: 'the point cloud was read and rasterised, but too little of the window carries canopy height for an agreement figure to mean anything; the diagnostics above say which stage lost it',
    };
    if (out) {
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(path.resolve(out), `${JSON.stringify(thin, null, 2)}\n`);
    }
    console.log(JSON.stringify(thin, null, 2));
    process.exitCode = 1;
    return;
  }

  const separability = separabilitySummary(treeHeights, openHeights, { direction: 'greater' });
  const agreement = canopyAgreement({ treeHeights, openHeights });
  const result = {
    schemaVersion: 1,
    kind: 'puttom-canopy-agreement',
    accuracyTier: 'C',
    claim: 'does the authorized point cloud resolve canopy, and where does it agree with the legacy satellite raster the planter obeys?',
    measured: true,
    retainedPointCloudBytes: 0,
    retainedRasterBytes: 0,
    retentionNote: 'COPC was range-streamed and the canopy raster was derived and discarded in a temporary directory; only statistics are retained',
    access: { ready: access.ready, collection: access.collection, assetId: access.assetId, pointDataRecordFormat: access.pointDataRecordFormat },
    window: {
      boundsEpsg3006: plan.boundsEpsg3006,
      focusEpsg3006: plan.focusEpsg3006,
      focusRule: chosen.rule,
      focusOffsetFromCourseCentreMetres: chosen.offsetMetres,
      focusPredictedTreeProbes: chosen.treeProbes,
      focusPredictedOpenProbes: chosen.openProbes,
      focusSearchConverged: chosen.searchConverged,
      spanMetres: plan.spanMetres,
      canopyResolutionMetres: CANOPY_RESOLUTION_METRES,
      sourceItemId: plan.source.id,
      sourceSha256: plan.source.sourceSha256,
      advertisedPointDensityPerSquareMetre: plan.source.pointDensityPerSquareMetre,
      canopyCells: values.size,
      elapsedMilliseconds: Math.round(performance.now() - started),
    },
    comparison: {
      legacyRaster: 'puttombuild/tree-cover.json',
      legacyRasterCellMetres: raster.cell,
      legacyRasterAuthority: 'legacy derived satellite classification; NOT authoritative, and it is the side under test here',
      frameBridge: {
        easting: origin.easting,
        northing: origin.northing,
        status: origin.status,
        note: 'the satellite raster lives in the legacy local frame, so its alignment to the point cloud is only as good as this unapproved origin',
      },
      probeLattice: PROBE_LATTICE,
      uniformRadiusMetres: PROBE_UNIFORM_RADIUS_METRES,
      unusableProbes: split.unusable,
      missingCanopyProbes: missingCanopy,
      canopyCoverage,
      rasterCells: totalCells,
      pipeline: diagnostics,
    },
    canopyHeightMetres: {
      trees: separability.reference,
      open: separability.control,
      medianExcess: separability.medianExcess,
      separable: separability.separable,
    },
    agreement,
    declaredThresholdMetres: CANOPY_THRESHOLD_METRES,
  };
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(path.resolve(out), `${JSON.stringify(result, null, 2)}\n`);
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(`canopy agreement measurement failed: ${error.message}`);
  process.exitCode = 1;
});
