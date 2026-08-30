#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from '../manifest.mjs';
import { summarizeDiscoveryReport, TREE_HEIGHT_CONTRACT } from './discovery.mjs';
import {
  COURSE_DATA_DIR,
  PILOT_GROUND_IDS,
  REPO_ROOT,
  loadPilotManifest,
} from './pilots.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = path.join(HERE, 'd2-discovery.schema.json');
const SHA256 = /^[a-f0-9]{64}$/;

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateD2DiscoveryReport(report, manifest) {
  const errors = [];
  const fail = message => errors.push(message);
  if (report?.schemaVersion !== 1) fail('schemaVersion must be 1');
  if (report?.phase !== 'D2-authoritative-acquisition-spike') fail('phase is invalid');
  if (report?.state !== 'discovery-evidence-only') fail('state must remain discovery-evidence-only');
  if (report?.groundId !== manifest.groundId) fail('groundId does not match the source manifest');
  if (!equal(report?.courseSlugs, manifest.courseSlugs)) fail('courseSlugs do not match the source manifest');
  if (!equal(report?.aoi?.bboxWgs84, manifest.targetBboxWgs84)) fail('WGS84 AOI does not match the source manifest');
  if (!Array.isArray(report?.aoi?.bboxEpsg3006) || report.aoi.bboxEpsg3006.length !== 4) {
    fail('EPSG:3006 AOI is missing');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(report?.observedOn || '')) fail('observedOn must be YYYY-MM-DD');

  if (report?.terrain?.collection !== 'dtm-cog') fail('terrain must use dtm-cog');
  if (report?.terrain?.verticalCrs !== 'EPSG:5613 (RH 2000)') fail('terrain vertical CRS must be RH 2000');
  if (report?.terrain?.compoundCrs !== 'EPSG:5845') fail('terrain compound CRS must be EPSG:5845');
  if (report?.terrain?.resolutionMetres !== 1) fail('terrain resolution must be 1 metre');
  if (!report?.terrain?.coverage?.complete) fail('terrain does not cover the complete pilot AOI');
  if (!report?.terrain?.crsValidated) fail('terrain CRS was not validated');
  if (report?.waterBreakGeometry?.itemCount !== report?.terrain?.itemCount ||
      !report?.waterBreakGeometry?.allTerrainItemsAdvertiseAsset) {
    fail('every terrain item must advertise water break geometry');
  }

  if (!report?.orthophoto?.coverage?.complete) fail('orthophoto campaign does not cover the complete pilot AOI');
  if (!report?.orthophoto?.completeCampaignAvailable) fail('no complete orthophoto campaign was selected');
  if (!Number.isFinite(report?.orthophoto?.resolutionMetres) || report.orthophoto.resolutionMetres > 0.16) {
    fail('orthophoto campaign must be 16 cm or finer');
  }
  if (report?.orthophoto?.spectralType !== 'rgbi') fail('orthophoto campaign must expose RGBI bands');
  if (!report?.orthophoto?.crsValidated) fail('orthophoto CRS was not validated');

  if ((report?.laser?.coverage?.ratio || 0) < 0.95) fail('newest LiDAR coverage is below 95%');
  if (!report?.laser?.crsValidated) fail('LiDAR CRS was not validated');
  if (report?.treeHeight?.service !== TREE_HEIGHT_CONTRACT.service) fail('tree-height service contract drifted');
  if (report?.treeHeight?.unit !== 'decimetre') fail('tree-height unit must remain decimetres');
  if (report?.treeHeight?.resolutionMetres !== 1) fail('tree-height resolution must remain 1 metre');

  for (const source of [report.terrain, report.laser, report.orthophoto]) {
    for (const asset of (source?.items || []).map(item => item.assets?.data).filter(Boolean)) {
      if (!asset.href?.startsWith('https://dl1.lantmateriet.se/')) fail(`invalid data asset URL ${asset.href}`);
      if (!Number.isFinite(asset.bytes) || asset.bytes <= 0) fail(`missing byte size for ${asset.href}`);
      if (source !== report.orthophoto && !SHA256.test(asset.sha256 || '')) {
        fail(`missing SHA-256 multihash projection for ${asset.href}`);
      }
    }
  }
  for (const item of report?.terrain?.items || []) {
    for (const name of ['breakgeometry', 'info', 'metadata']) {
      if (!SHA256.test(item.assets?.[name]?.sha256 || '')) fail(`${item.id} lacks ${name} SHA-256`);
    }
  }

  const evidence = report?.metadataEvidence || [];
  if (evidence.length === 0) fail('metadata evidence is empty');
  for (const item of evidence) {
    if (item.status !== 'verified' || !item.sizeVerified || !item.checksumVerified) {
      fail(`metadata evidence is not verified: ${item.href}`);
    }
    if (!SHA256.test(item.sha256 || '')) fail(`metadata evidence lacks SHA-256: ${item.href}`);
  }
  if (!report?.measurements?.metadata?.complete) fail('metadata measurement is incomplete');
  if (!report?.gate?.discoveryReady) fail('discovery gate is not ready');
  if (!Array.isArray(report?.gate?.blockers) || report.gate.blockers.length < 3) {
    fail('acquisition blockers were not recorded');
  }
  return errors;
}

function reportPath(groundId) {
  return path.join(COURSE_DATA_DIR, groundId, 'acquisition', 'd2-discovery.json');
}

function main() {
  const failures = [];
  const reports = [];
  for (const groundId of PILOT_GROUND_IDS) {
    const file = reportPath(groundId);
    if (!fs.existsSync(file)) {
      failures.push(`${groundId}: missing ${path.relative(REPO_ROOT, file)}`);
      continue;
    }
    const report = readJson(file);
    reports.push(report);
    const resolvedSchema = path.resolve(path.dirname(file), report.$schema || '');
    if (resolvedSchema !== SCHEMA || !fs.existsSync(resolvedSchema)) {
      failures.push(`${groundId}: $schema must resolve to ${path.relative(REPO_ROOT, SCHEMA)}`);
    }
    for (const error of validateD2DiscoveryReport(report, loadPilotManifest(groundId))) {
      failures.push(`${groundId}: ${error}`);
    }
    console.log(
      `  ${failures.some(item => item.startsWith(`${groundId}:`)) ? 'FAIL' : 'ok  '} ` +
      `${groundId.padEnd(18)} DTM ${(report.terrain.coverage.ratio * 100).toFixed(2)}%, ` +
      `LiDAR ${(report.laser.coverage.ratio * 100).toFixed(2)}%, ${report.orthophoto.collection}`,
    );
  }

  const aggregateFile = path.join(COURSE_DATA_DIR, 'd2-acquisition-spike-report.json');
  if (!fs.existsSync(aggregateFile)) {
    failures.push(`missing ${path.relative(REPO_ROOT, aggregateFile)}`);
  } else if (reports.length === PILOT_GROUND_IDS.length) {
    const aggregate = readJson(aggregateFile);
    const expected = reports.map(summarizeDiscoveryReport);
    if (!equal(aggregate.reports, expected)) failures.push('aggregate D2 report does not match pilot reports');
    if (aggregate.observedOn !== reports[0].observedOn ||
        reports.some(report => report.observedOn !== aggregate.observedOn)) {
      failures.push('D2 reports do not share one observation date');
    }
  }

  if (failures.length) {
    console.error(`\nD2 discovery gate FAILED\n${failures.map(item => `  ${item}`).join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('\nD2 discovery gate passed; remaining pilot/tree-height acquisition remains explicitly blocked');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
