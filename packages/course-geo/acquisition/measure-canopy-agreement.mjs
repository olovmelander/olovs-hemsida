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
  const lines = createInterface({
    input: createReadStream(xyzPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 3) continue;
    const value = Number(parts[2]);
    /* writers.gdal writes -9999 where no return landed. A nodata cell is a
       gap in the record, never a canopy height of zero. */
    if (!Number.isFinite(value) || value <= -9998) continue;
    values.set(`${Math.round(Number(parts[0]) / resolutionMetres)}/${Math.round(Number(parts[1]) / resolutionMetres)}`, value);
  }
  return values;
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
  const started = performance.now();
  let values;
  try {
    try {
      /* No --stream, unlike the sibling statistics pipeline: hag_nn has to see
         the window's ground returns before it can measure anything above
         them, so it cannot run point-at-a-time. */
      runGeoCommand('pdal', ['pipeline', '--stdin'], { input: JSON.stringify(pipeline) });
    } catch (error) {
      throw new Error(`PDAL canopy rasterisation failed: ${redact(error.message)}`);
    }
    runGeoCommand('gdal_translate', ['-of', 'XYZ', rasterPath, xyzPath]);
    values = await readGrid(xyzPath, CANOPY_RESOLUTION_METRES);
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
  if (treeHeights.length < 20 || openHeights.length < 20) {
    throw new Error(`this window yielded ${treeHeights.length} tree and ${openHeights.length} open probes; too few of either to measure`);
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
