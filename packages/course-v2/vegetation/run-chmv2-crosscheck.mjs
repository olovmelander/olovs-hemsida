#!/usr/bin/env node
/* Run the independent-sensor cross-check for a ground and write its
   evidence: the two campaign canopy rasters against the CHMv2 window on the
   same grid, per campaign, per finest tile, across the seam, and per
   published individual.

   node packages/course-v2/vegetation/run-chmv2-crosscheck.mjs --ground puttom \
     [--compile <dir>] [--out <evidence path>]                                  */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  binnedHeights, clearedBlocks, disagreementProfile, heightAgreement, presenceConfusion, recordAgreement, seamProfile, tileCrosscheck,
} from './chmv2-crosscheck.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const groundId = arg('--ground', 'puttom');
const cacheDir = path.resolve(ROOT, 'packages/course-geo/toolchain/.cache/acquisition', `${groundId}-vegetation`);
const compileDir = path.resolve(ROOT, arg('--compile', path.join(cacheDir, 'compile-machine')));
const outPath = path.resolve(ROOT, arg('--out', `geo_data/course-v2/${groundId}/vegetation/chmv2-crosscheck.json`));
const startedAt = Date.now();

const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const relative = file => path.relative(ROOT, file).replaceAll('\\', '/');

function readRaster(base) {
  const sidecar = JSON.parse(fs.readFileSync(`${base}.json`, 'utf8'));
  const bytes = fs.readFileSync(`${base}.f32`);
  const values = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  if (values.length !== sidecar.width * sidecar.height) throw new Error(`${base}.f32 holds ${values.length} values; sidecar says ${sidecar.width * sidecar.height}`);
  return { ...sidecar, values, sha256: sha256(`${base}.f32`), path: relative(`${base}.f32`) };
}

const campaigns = JSON.parse(fs.readFileSync(path.resolve(ROOT, `geo_data/course-v2/${groundId}/acquisition/laser-campaigns.json`), 'utf8'));
const seam = campaigns.seams?.[0];
const seamNorthing = seam?.axis === "northing" ? seam.value : undefined;
if (!Number.isFinite(seamNorthing)) throw new Error('the campaign inventory carries no seam northing');

const lasers = campaigns.activeItemIds.map(id => {
  const base = path.join(cacheDir, `chm-${id.replace(/_/g, '-')}`);
  return readRaster(base);
});
const other = readRaster(path.join(cacheDir, `chmv2-${arg('--tile', '1200130303')}`));
for (const laser of lasers) {
  for (const key of ['width', 'height', 'sampleSpacingMetres', 'originEasting', 'originNorthing']) {
    if (laser[key] !== other[key]) throw new Error(`campaign ${laser.campaignId} raster differs from the CHMv2 window in ${key}`);
  }
}

/* one laser raster: each cell from the campaign that owns its side of the seam */
const merged = { ...other, campaignId: null, values: new Float32Array(other.width * other.height).fill(Number.NaN) };
const ownership = new Uint8Array(other.width * other.height);
/* an item is north of the seam when its bbox starts there */
const northCampaign = lasers.map(laser => (campaigns.items.find(item => item.id === laser.campaignId)?.projBbox?.[1] ?? 0) >= seamNorthing - 1);
for (let row = 0; row < other.height; row++) {
  const northing = other.originNorthing - (row + 0.5) * other.sampleSpacingMetres;
  const north = northing >= seamNorthing;
  for (let column = 0; column < other.width; column++) {
    const i = row * other.width + column;
    let chosen = -1;
    for (let k = 0; k < lasers.length; k++) {
      const value = lasers[k].values[i];
      if (!Number.isFinite(value)) continue;
      const isNorthCampaign = northCampaign[k];
      if (chosen < 0 || (isNorthCampaign === north)) chosen = k;
    }
    if (chosen >= 0) { merged.values[i] = lasers[chosen].values[i]; ownership[i] = chosen + 1; }
  }
}

const perCampaign = lasers.map((laser, k) => {
  const cells = i => ownership[i] === k + 1;
  return {
    campaignId: laser.campaignId,
    raster: { path: laser.path, sha256: laser.sha256 },
    presence: presenceConfusion(merged, other, { cells }),
    heights: heightAgreement(merged, other, { cells }),
  };
});

const overall = {
  presence: presenceConfusion(merged, other),
  heights: heightAgreement(merged, other),
  byLaserHeightBin: binnedHeights(merged, other),
};

const tiles = tileCrosscheck(merged, other, { tileCells: 256 }).map(tile => ({ tileId: `l0/${tile.column}/${tile.row}`, ...tile }));
/* kappa is ill-conditioned in a tile that is nearly all forest or nearly all
   open ground, so a tile is flagged on raw agreement and on its height bias
   relative to the ground-wide calibration, never on kappa */
const FLAG_RULE = { minAgreement: 0.6, maxBiasFromOverallMetres: 3, minCells: 1000 };
const overallBias = overall.heights.n ? overall.heights.biasMetres : 0;
const flaggedTiles = tiles.filter(tile => tile.n >= FLAG_RULE.minCells && ((tile.agreement !== null && tile.agreement < FLAG_RULE.minAgreement) || (tile.biasMetres !== null && Math.abs(tile.biasMetres - overallBias) > FLAG_RULE.maxBiasFromOverallMetres)));
const disagreement = disagreementProfile(merged, other);
/* stands felled after the imagery: a contiguous block of half a hectare or more */
const cleared = clearedBlocks(merged, other, { tileCells: 256 }).map(block => ({ tileId: `l0/${block.column}/${block.row}`, ...block }));
const felledSinceImagery = cleared.filter(block => block.largestBlockHectares >= 0.5).map(block => ({ tileId: block.tileId, largestBlockHectares: Number(block.largestBlockHectares.toFixed(2)) }));

const seamReport = seamProfile(merged, other, { seamNorthing, bandMetres: 100, stepMetres: 10 });

const registryPath = path.join(compileDir, 'registry.json');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
const records = registry.map(record => ({
  easting: record.easting, northing: record.northing,
  crownRadiusMetres: record.radiusMetres, heightMetres: record.objectHeightMetres,
  campaignId: String(record.sourceId || '').replace(/^laser-lm-skog-/, '').replace(/-(\d+)$/, '_$1'),
}));
const individuals = recordAgreement(records, other);

const evidence = {
  kind: 'chmv2-crosscheck',
  groundId,
  observedOn: new Date().toISOString().slice(0, 10),
  inputs: {
    campaigns: lasers.map(laser => ({ campaignId: laser.campaignId, path: laser.path, sha256: laser.sha256 })),
    chmv2: { path: other.path, sha256: other.sha256, source: other.source },
    registry: { path: relative(registryPath), sha256: sha256(registryPath), records: registry.length },
    seamNorthing,
  },
  thresholdMetres: 2,
  reading: 'CHMv2 is an optical model (2020s imagery, ~0.5 m) and reads lower than a leaf-on laser CHM on tall canopy; presence agreement (kappa) is the check, height bias per bin is the calibration, and the seam attribution says whether the campaigns or the forest own a step',
  overall,
  perCampaign,
  tiles,
  flagRule: FLAG_RULE,
  flaggedTiles: flaggedTiles.map(tile => tile.tileId),
  disagreement,
  clearedBlocks: cleared,
  felledSinceImagery,
  seam: seamReport,
  individuals,
  elapsedSeconds: (Date.now() - startedAt) / 1000,
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + '\n');

const round = (value, digits = 3) => (value === null || value === undefined ? null : Number(value.toFixed(digits)));
console.log(JSON.stringify({
  overall: { n: overall.presence.n, agreement: round(overall.presence.agreement), kappa: round(overall.presence.kappa), laserCanopy: round(overall.presence.laserCanopyFraction), otherCanopy: round(overall.presence.otherCanopyFraction), heightN: overall.heights.n, bias: round(overall.heights.biasMetres, 2), pearson: round(overall.heights.pearson), p50Abs: round(overall.heights.p50AbsMetres, 2) },
  perCampaign: perCampaign.map(c => ({ id: c.campaignId, n: c.presence.n, kappa: round(c.presence.kappa), bias: round(c.heights.biasMetres, 2), pearson: round(c.heights.pearson) })),
  flaggedTiles: evidence.flaggedTiles,
  disagreement: { laserOnly: { n: disagreement.laserOnly.n, besideOtherCanopy: round(disagreement.laserOnly.besideOtherCanopyFraction), heights: disagreement.laserOnly.heights }, otherOnly: { n: disagreement.otherOnly.n, besideLaserCanopy: round(disagreement.otherOnly.besideLaserCanopyFraction), heights: disagreement.otherOnly.heights } },
  felledSinceImagery,
  seam: { fraction: { laser: round(seamReport.steps.canopyFraction.laser), other: round(seamReport.steps.canopyFraction.other), attribution: seamReport.steps.canopyFraction.attribution }, height: { laser: round(seamReport.steps.meanHeightMetres.laser, 2), other: round(seamReport.steps.meanHeightMetres.other, 2), attribution: seamReport.steps.meanHeightMetres.attribution } },
  individuals: { n: individuals.n, fraction: round(individuals.fraction), bias: round(individuals.heightBiasMetres, 2), byCampaign: Object.fromEntries(Object.entries(individuals.byCampaign).map(([k, v]) => [k, { n: v.n, fraction: round(v.fraction), bias: round(v.heightBiasMetres, 2) }])) },
  elapsedSeconds: evidence.elapsedSeconds,
}, null, 1));
