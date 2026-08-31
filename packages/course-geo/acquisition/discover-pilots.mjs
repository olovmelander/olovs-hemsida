#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverPilot, summarizeDiscoveryReport } from './discovery.mjs';
import {
  COURSE_DATA_DIR,
  PILOT_GROUND_IDS,
  pilotAoi,
} from './pilots.mjs';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(PACKAGE_DIR, '../..');

function argumentsFrom(argv) {
  const options = {
    write: false,
    fetchMetadata: true,
    observedOn: new Date().toISOString().slice(0, 10),
    grounds: [...PILOT_GROUND_IDS],
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--write') options.write = true;
    else if (argument === '--no-metadata') options.fetchMetadata = false;
    else if (argument === '--observed-on') options.observedOn = argv[++index];
    else if (argument === '--ground') options.grounds = [argv[++index]];
    else throw new Error(`unknown argument ${argument}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.observedOn || '')) {
    throw new Error('--observed-on must be YYYY-MM-DD');
  }
  for (const ground of options.grounds) {
    if (!PILOT_GROUND_IDS.includes(ground)) throw new Error(`unknown D2 pilot ${ground}`);
  }
  return options;
}

function stableJson(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

function reportPath(groundId) {
  return path.join(COURSE_DATA_DIR, groundId, 'acquisition', 'd2-discovery.json');
}

function writeReport(file, report) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, stableJson(report));
  console.log(`  wrote ${path.relative(ROOT, file)}`);
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  const reports = [];
  for (const groundId of options.grounds) {
    console.log(`discovering ${groundId}`);
    const report = await discoverPilot(pilotAoi(groundId), {
      observedOn: options.observedOn,
      fetchMetadata: options.fetchMetadata,
    });
    reports.push(report);
    const summary = summarizeDiscoveryReport(report);
    console.log(
      `  DTM ${(summary.terrain.coverage * 100).toFixed(2)}%, ` +
      `LiDAR ${(summary.laser.coverage * 100).toFixed(2)}%, ` +
      `${summary.orthophoto.campaign} ${(summary.orthophoto.coverage * 100).toFixed(2)}%`,
    );
    if (options.write) writeReport(reportPath(groundId), report);
  }

  const aggregate = {
    schemaVersion: 1,
    phase: 'D2-authoritative-acquisition-spike',
    observedOn: options.observedOn,
    state: 'discovery-evidence-only',
    source: 'official Lantmäteriet STAC and public metadata endpoints',
    reports: reports.map(summarizeDiscoveryReport),
    gate: {
      discoveryReady: reports.every(report => report.gate.discoveryReady),
      acquisitionComplete: reports.every(report => report.gate.acquisitionComplete),
      note: 'A false acquisition gate is expected until authenticated COG, break geometry and tree-height windows have been measured.',
    },
  };
  if (options.write && options.grounds.length === PILOT_GROUND_IDS.length) {
    writeReport(path.join(COURSE_DATA_DIR, 'd2-acquisition-spike-report.json'), aggregate);
  } else {
    process.stdout.write(stableJson(aggregate));
  }
}

main().catch(error => {
  console.error(`D2 discovery failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
