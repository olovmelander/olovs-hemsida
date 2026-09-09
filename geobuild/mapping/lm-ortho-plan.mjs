#!/usr/bin/env node
/** Discover and pin Veckefjarden's newest complete orthophoto campaign. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stacSearch, STAC_ENDPOINTS, selectLatestCampaign, summarizeFeature } from '../../packages/course-geo/acquisition/stac.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'geo_data/course-v2/veckefjarden/acquisition');
const intersects = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

export function buildPlan(discovery, requestedBounds = [682885, 7021978, 684934, 7024027]) {
  if (discovery.groundId !== 'veckefjarden' || !discovery.primaryCoverage.complete || discovery.fallbackCollections.length) {
    throw new Error('Expected a complete single Veckefjarden campaign');
  }
  const resolution = discovery.items[0].resolutionMetres;
  if (resolution !== .16 || discovery.items.some(i => i.projCode !== 'EPSG:3006' || i.resolutionMetres !== resolution)) {
    throw new Error('Expected consistent native 0.16 m EPSG:3006 images');
  }
  const anchor = discovery.items[0].projBbox;
  const snap = (v, a, high) => +(a + (high ? Math.ceil : Math.floor)((v - a) / resolution + (high ? -1e-7 : 1e-7)) * resolution).toFixed(6);
  const bounds = [snap(requestedBounds[0], anchor[0], false), snap(requestedBounds[1], anchor[1], false),
    snap(requestedBounds[2], anchor[0], true), snap(requestedBounds[3], anchor[1], true)];
  const aoi = discovery.aoi.bboxEpsg3006;
  if (bounds[0] < aoi[0] || bounds[1] < aoi[1] || bounds[2] > aoi[2] || bounds[3] > aoi[3]) throw new Error('Window leaves the discovered AOI');
  const width = Math.round((bounds[2] - bounds[0]) / resolution), height = Math.round((bounds[3] - bounds[1]) / resolution);
  const sources = discovery.items.filter(i => intersects(i.projBbox, bounds)).map(i => ({ id: i.id,
    href: i.assets.data.href, boundsEpsg3006: i.projBbox, width: i.assets.data.projShape[1],
    height: i.assets.data.projShape[0], capturedAt: i.capturedAt, bytes: i.assets.data.bytes }));
  const windows = [];
  for (let row = 0, top = 0; top < height; row++, top += 4000) {
    for (let col = 0, left = 0; left < width; col++, left += 4000) {
      const w = Math.min(4000, width - left), h = Math.min(4000, height - top);
      const box = [bounds[0] + left * resolution, bounds[3] - (top + h) * resolution,
        bounds[0] + (left + w) * resolution, bounds[3] - top * resolution].map(v => +v.toFixed(6));
      windows.push({ id: `context-${row}-${col}`, row, col, boundsEpsg3006: box, width: w, height: h,
        sourceIds: sources.filter(s => intersects(s.boundsEpsg3006, box)).map(s => s.id) });
    }
  }
  return { schemaVersion: 1, groundId: 'veckefjarden', kind: 'authenticated-orthophoto-review-plan',
    collection: discovery.collection, discoveryObservedAt: discovery.observedAt,
    horizontalCrs: 'EPSG:3006', resolutionMetres: resolution, requestedBoundsEpsg3006: requestedBounds,
    boundsEpsg3006: bounds, width, height, nativeGridAnchor: [anchor[0], anchor[3]],
    pixelConvention: 'Bounds are pixel edges. Centre E=minE+(column+0.5)*resolution; N=maxN-(row+0.5)*resolution.',
    resampling: 'none: output pixels match the source image lattice', sources, windows,
    summary: { windows: windows.length, megapixels: +(width * height / 1e6).toFixed(3) },
    limitations: ['This is the newest available June 2024 flight, not a 2026 capture.',
      'Pixel resolution does not establish absolute horizontal accuracy.',
      'Source rasters and review overlays remain in the ignored local cache.'] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const previous = JSON.parse(fs.readFileSync(path.join(DIR, 'd2-discovery.json')));
  const items = await stacSearch(STAC_ENDPOINTS.imagery, { bbox: previous.aoi.bboxWgs84 });
  const selected = selectLatestCampaign(items, previous.aoi.bboxEpsg3006);
  const discovery = { schemaVersion: 1, groundId: 'veckefjarden', kind: 'orthophoto-catalogue-discovery',
    observedAt: new Date().toISOString(), endpoint: STAC_ENDPOINTS.imagery, aoi: previous.aoi,
    collection: selected.collection, coverage: selected.coverage, primaryCoverage: selected.primaryCoverage,
    fallbackCollections: selected.fallbackCollections, campaigns: selected.campaigns,
    items: selected.features.map(i => summarizeFeature(i, ['data', 'metadata'])) };
  const plan = buildPlan(discovery);
  fs.writeFileSync(path.join(DIR, 'ortho-discovery.json'), JSON.stringify(discovery, null, 2) + '\n');
  fs.writeFileSync(path.join(DIR, 'ortho-plan.json'), JSON.stringify(plan, null, 2) + '\n');
  console.log(JSON.stringify({ collection: plan.collection, bounds: plan.boundsEpsg3006, ...plan.summary }));
}
