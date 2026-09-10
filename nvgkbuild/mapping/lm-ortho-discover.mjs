#!/usr/bin/env node
// Recheck current public STAC imagery without replacing terrain/laser discovery.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { STAC_ENDPOINTS, stacSearch, selectLatestCampaign, summarizeFeature } from '../../packages/course-geo/acquisition/stac.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const discovery = JSON.parse(fs.readFileSync(path.join(root, 'geo_data/course-v2/norrfallsviken/acquisition/d2-discovery.json')));
const features = await stacSearch(STAC_ENDPOINTS.imagery, { bbox: discovery.aoi.bboxWgs84 });
const selection = selectLatestCampaign(features, discovery.aoi.bboxEpsg3006);
const selected = selection.features.map(f => summarizeFeature(f));
const baseline = discovery.orthophoto;
const changed = selection.collection !== baseline.collection || selected.some(item => {
  const old = baseline.items.find(i => i.id === item.id);
  return !old || old.assets.data.href !== item.assets.data.href || old.assets.data.bytes !== item.assets.data.bytes;
});
const report = {
  schemaVersion: 1, groundId: 'norrfallsviken', kind: 'orthophoto-live-catalog-recheck', observedAt: new Date().toISOString(),
  endpoint: STAC_ENDPOINTS.imagery, bboxWgs84: discovery.aoi.bboxWgs84, bboxEpsg3006: discovery.aoi.bboxEpsg3006,
  sourceDiscoverySha256: createHash('sha256').update(fs.readFileSync(path.join(root, 'geo_data/course-v2/norrfallsviken/acquisition/d2-discovery.json'))).digest('hex'),
  collection: selection.collection, coverage: selection.coverage, fallbackCollections: selection.fallbackCollections,
  campaigns: selection.campaigns, selectedAssetsChanged: changed, items: selected,
  limitations: ['Catalog discovery does not establish pixel access; authenticated acquisition has its own byte and grid checks.',
    'Capture datetime on a tile is representative; contributing source images can have a wider capture range.'],
};
const output = path.join(root, 'geo_data/course-v2/norrfallsviken/reference/lm-ortho-catalog-2026-09-09.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output: path.relative(root, output), collection: report.collection,
  campaigns: report.campaigns.map(c => c.collection), complete: report.coverage.complete, selectedAssetsChanged: changed }));
if (changed) process.exitCode = 2;
