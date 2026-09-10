// Read the live public catalog without replacing previous discovery evidence.
import fs from 'node:fs';
import { STAC_ENDPOINTS, stacSearch, selectLatestCampaign, summarizeFeature } from '../../packages/course-geo/acquisition/stac.mjs';
const baseline=JSON.parse(fs.readFileSync('geo_data/course-v2/angso/acquisition/d2-discovery.json'));
const features=await stacSearch(STAC_ENDPOINTS.imagery,{bbox:baseline.aoi.bboxWgs84});
const selection=selectLatestCampaign(features,baseline.aoi.bboxEpsg3006);
const report={schemaVersion:1,groundId:'angso',observedAt:new Date().toISOString(),endpoint:STAC_ENDPOINTS.imagery,
  bboxWgs84:baseline.aoi.bboxWgs84,collection:selection.collection,coverage:selection.coverage,
  campaigns:selection.campaigns,items:selection.features.map(f=>summarizeFeature(f)),
  note:'Latest complete catalog campaign. Native pixel access checked separately in orthophoto-acquisition.json.'};
fs.writeFileSync('angsobuild/facilities/orthophoto-catalog.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({collection:report.collection,complete:report.coverage.complete,campaigns:report.campaigns.map(c=>c.collection)}));
