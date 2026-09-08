import fs from 'node:fs';
import { discoverPilot, summarizeDiscoveryReport } from '../../../../packages/course-geo/acquisition/discovery.mjs';

const aoi = JSON.parse(fs.readFileSync(new URL('./aoi.json', import.meta.url), 'utf8'));
aoi.groundName = 'Lidingö Golfklubb';
const report = await discoverPilot(aoi, { observedOn: '2026-09-07', fetchMetadata: true });
report.projection = aoi.projection;
const acquired = JSON.parse(fs.readFileSync(new URL('../acquisition/terrain-window.json', import.meta.url), 'utf8'));
report.terrain.cogWindow = {
  state: 'acquired-see-terrain-window-json',
  transferredBytes: acquired.transfer.rangeBytes,
  outputCompressedBytes: null,
  outputSha256: acquired.raster.sha256,
  elapsedMilliseconds: acquired.transfer.elapsedMilliseconds,
};
report.gate.blockers = [
  'Bounded COPC canopy windows and interpreted water break geometry remain pending; terrain and laser credentials work, and break geometry is downloaded separately.',
  'National 2025 orthophoto asset access returned HTTP 403 with the configured account; product-specific delivery terms remain pending. Municipal 2019 reference imagery is acquired separately.',
  'Independent course control points, current played-surface review, and tree evidence are required before an authoritative ground release.',
];
fs.writeFileSync(new URL('../acquisition/d2-discovery.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(summarizeDiscoveryReport(report), null, 2));
