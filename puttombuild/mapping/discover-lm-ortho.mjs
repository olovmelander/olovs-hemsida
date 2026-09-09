#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { STAC_ENDPOINTS, stacSearch, selectLatestCampaign, summarizeFeature } from '../../packages/course-geo/acquisition/stac.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const baselinePath = path.join(root, 'geo_data/course-v2/puttom/acquisition/d2-discovery.json');
const baselineBytes = fs.readFileSync(baselinePath);
const baseline = JSON.parse(baselineBytes);
const args = process.argv.slice(2);
if (args.length > 1 || args.some(a => a.startsWith('--'))) throw new Error('Usage: node puttombuild/mapping/discover-lm-ortho.mjs [output.json]');
const output = path.resolve(args[0] || path.join(root, 'puttombuild/mapping/lm-ortho-discovery.json'));
const features = await stacSearch(STAC_ENDPOINTS.imagery, { bbox: baseline.aoi.bboxWgs84 });
const selection = selectLatestCampaign(features, baseline.aoi.bboxEpsg3006);
if (!selection.primaryCoverage.complete || selection.fallbackCollections.length) throw new Error('Latest campaign does not cover Puttom in one epoch');
const items = selection.features.map(i => summarizeFeature(i, ['data', 'metadata']));
if (items.some(i => i.projCode !== 'EPSG:3006' || i.spectralType !== 'rgbi' || i.resolutionMetres !== items[0].resolutionMetres)) throw new Error('Expected a consistent EPSG:3006 RGBI campaign');
const dates = items.flatMap(i => [i.captureStart || i.capturedAt, i.captureEnd || i.capturedAt]).filter(Boolean).sort();
const report = {
  schemaVersion: 1, groundId: 'puttom', kind: 'orthophoto-catalogue-verification', observedAt: new Date().toISOString(),
  endpoint: STAC_ENDPOINTS.imagery,
  baseline: { path: path.relative(root, baselinePath).replaceAll('\\', '/'), sha256: createHash('sha256').update(baselineBytes).digest('hex') },
  aoi: baseline.aoi,
  orthophoto: {
    collection: selection.collection, coverage: selection.coverage, horizontalCrs: 'EPSG:3006',
    resolutionMetres: items[0].resolutionMetres, spectralType: 'rgbi',
    captureRange: { first: dates[0], last: dates.at(-1) }, items, alternativeCampaigns: selection.campaigns,
  },
  rawImageryRedistributed: false, geometryChanged: false,
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, collection: selection.collection, captureRange: report.orthophoto.captureRange, items: items.length, complete: selection.coverage.complete }));
