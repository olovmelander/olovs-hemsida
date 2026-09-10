// Recheck the live public LM catalog without changing shared source discovery.
import fs from 'node:fs';
import { STAC_ENDPOINTS, stacSearch, selectLatestCampaign, summarizeFeature } from '../../packages/course-geo/acquisition/stac.mjs';

const aoi = JSON.parse(fs.readFileSync(new URL('../../geo_data/course-v2/lidingo/discovery/aoi.json', import.meta.url)));
const items = await stacSearch(STAC_ENDPOINTS.imagery, { bbox: aoi.bboxWgs84 });
const selected = selectLatestCampaign(items, aoi.bboxEpsg3006);
const report = {
  schemaVersion: 1, groundId: 'lidingo', kind: 'orthophoto-live-catalog-recheck',
  observedAt: new Date().toISOString(), endpoint: STAC_ENDPOINTS.imagery, aoi,
  collection: selected.collection, coverage: selected.coverage,
  campaigns: selected.campaigns, items: selected.features.map(f => summarizeFeature(f)),
};
const cache = new URL('../cache/lm-ortho/', import.meta.url);
fs.mkdirSync(cache, { recursive: true });
fs.writeFileSync(new URL('catalog.json', cache), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ collection: report.collection, coverage: report.coverage,
  campaigns: report.campaigns, items: report.items.map(i => ({ id: i.id, capturedAt: i.capturedAt })) }));
