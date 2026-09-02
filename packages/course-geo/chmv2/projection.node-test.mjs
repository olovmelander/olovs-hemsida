import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  latLonToSweref99Tm,
  latLonToWebMercator,
  sweref99TmToLatLon,
  webMercatorGroundScale,
  webMercatorToLatLon,
} from './projection.mjs';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

test('the series reproduces PROJ: the legacy origin the migration projected', () => {
  /* residual-report.json: cs2cs on the legacy origin (63.2992 N, 18.9413 E) */
  const report = JSON.parse(readFileSync(resolve(ROOT, 'geo_data/course-v2/puttom/migration/residual-report.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'geo_data/course-v2/puttom/source-manifest.json'), 'utf8'));
  const { latitude, longitude } = manifest.legacyFrame.originWgs84;
  const [easting, northing] = latLonToSweref99Tm(latitude, longitude);
  assert.ok(Math.abs(easting - report.candidateOrigin.easting) < 0.01, `easting ${easting} vs PROJ ${report.candidateOrigin.easting}`);
  assert.ok(Math.abs(northing - report.candidateOrigin.northing) < 0.01, `northing ${northing} vs PROJ ${report.candidateOrigin.northing}`);
  const [lat, lon] = sweref99TmToLatLon(easting, northing);
  assert.ok(Math.abs(lat - latitude) < 1e-8);
  assert.ok(Math.abs(lon - longitude) < 1e-8);
});

test('the series reproduces PROJ: the AOI envelope the discovery projected', () => {
  /* d2-discovery.json: the EPSG:3006 envelope of the WGS 84 AOI's densified
     edges; east of the central meridian the extremes sit at the corners */
  const discovery = JSON.parse(readFileSync(resolve(ROOT, 'geo_data/course-v2/puttom/acquisition/d2-discovery.json'), 'utf8'));
  const [west, south, east, north] = discovery.aoi.bboxWgs84;
  const [minE, minN, maxE, maxN] = discovery.aoi.bboxEpsg3006;
  const northWest = latLonToSweref99Tm(north, west);
  const southEast = latLonToSweref99Tm(south, east);
  const southWest = latLonToSweref99Tm(south, west);
  const northEast = latLonToSweref99Tm(north, east);
  assert.ok(Math.abs(northWest[0] - minE) < 0.01, `min easting ${northWest[0]} vs ${minE}`);
  assert.ok(Math.abs(southEast[0] - maxE) < 0.01, `max easting ${southEast[0]} vs ${maxE}`);
  assert.ok(Math.abs(southWest[1] - minN) < 0.01, `min northing ${southWest[1]} vs ${minN}`);
  assert.ok(Math.abs(northEast[1] - maxN) < 0.01, `max northing ${northEast[1]} vs ${maxN}`);
});

test('Web Mercator round-trips and scales as the CHMv2 tile expects', () => {
  const [x, y] = latLonToWebMercator(63.2992, 18.9413);
  const [lat, lon] = webMercatorToLatLon(x, y);
  assert.ok(Math.abs(lat - 63.2992) < 1e-9);
  assert.ok(Math.abs(lon - 18.9413) < 1e-9);
  /* the z10 tile's top edge from its tiepoint: 9196903.24 m is about 63.4 N */
  assert.ok(Math.abs(webMercatorToLatLon(0, 9196903.243272407)[0] - 63.4) < 0.01);
  assert.ok(Math.abs(webMercatorGroundScale(63.3) * 1.1943285669558676 - 0.5365) < 0.001, 'about 0.54 m on the ground per pixel');
});
