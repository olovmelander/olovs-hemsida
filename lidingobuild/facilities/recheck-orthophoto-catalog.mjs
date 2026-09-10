// Read-only current STAC discovery; preserve older acquisition baselines.
import fs from 'node:fs';
import { STAC_ENDPOINTS, stacSearch, selectLatestCampaign, summarizeFeature } from '../../packages/course-geo/acquisition/stac.mjs';

const discovery = JSON.parse(fs.readFileSync('geo_data/course-v2/lidingo/acquisition/d2-discovery.json'));
const previous = JSON.parse(fs.readFileSync('geo_data/course-v2/lidingo/reference/lm-ortho-plan-2026-09-09.json'));
const features = await stacSearch(STAC_ENDPOINTS.imagery, { bbox: discovery.aoi.bboxWgs84 });
const selection = selectLatestCampaign(features, discovery.aoi.bboxEpsg3006);
const items = selection.features.map(feature => summarizeFeature(feature));
const unchanged = selection.collection === previous.collection && previous.sources.every(source => {
  const item = items.find(candidate => candidate.id === source.id);
  return item?.assets?.data?.href === source.href && item?.assets?.data?.bytes === source.bytes;
});
const report = {
  schemaVersion: 1, groundId: 'lidingo', checkedAt: new Date().toISOString(),
  endpoint: STAC_ENDPOINTS.imagery, bboxWgs84: discovery.aoi.bboxWgs84,
  collection: selection.collection, coverage: selection.coverage,
  campaigns: selection.campaigns, assetsMatchRetained2025Sources: unchanged, items,
  limitation: 'Latest catalog campaign does not establish a 2026 as-built survey or local positional accuracy.',
};
fs.writeFileSync('lidingobuild/facilities/orthophoto-catalog-check.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ collection: selection.collection, complete: selection.coverage.complete, assetsMatchRetained2025Sources: unchanged }));
if (!unchanged) process.exitCode = 2;
