import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAC_ENDPOINTS, stacSearch, selectLatestCampaign, summarizeFeature } from '../../packages/course-geo/acquisition/stac.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const discovery = JSON.parse(fs.readFileSync(path.join(root, 'geo_data/course-v2/ribbingsfors/acquisition/d2-discovery.json')));
const features = await stacSearch(STAC_ENDPOINTS.imagery, { bbox: discovery.aoi.bboxWgs84 });
const selection = selectLatestCampaign(features, discovery.aoi.bboxEpsg3006);
const output = path.join(root, 'ribbingsforsbuild/facilities/reference/orthophoto-catalog.json');
const report = {
  schemaVersion: 1, groundId: 'ribbingsfors', kind: 'orthophoto-live-catalog-recheck',
  observedAt: new Date().toISOString(), endpoint: STAC_ENDPOINTS.imagery,
  bboxWgs84: discovery.aoi.bboxWgs84, bboxEpsg3006: discovery.aoi.bboxEpsg3006,
  collection: selection.collection, coverage: selection.coverage,
  fallbackCollections: selection.fallbackCollections, campaigns: selection.campaigns,
  items: selection.features.map(feature => summarizeFeature(feature)),
  limitations: ['Retrieval time is distinct from source capture dates.', 'Pixel spacing is not positional accuracy.'],
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output: path.relative(root, output), collection: report.collection,
  campaigns: report.campaigns, items: report.items.map(i => ({ id: i.id, resolutionMetres: i.resolutionMetres, capturedAt: i.capturedAt, bounds: i.projBbox })) }));
