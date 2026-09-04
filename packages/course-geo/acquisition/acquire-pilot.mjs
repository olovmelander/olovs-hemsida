#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, sha256File } from '../manifest.mjs';
import { validateD2DiscoveryReport } from './check-discovery.mjs';
import {
  credentialState,
  lantmaterietCredentials,
  skogsstyrelsenCredentials,
} from './credentials.mjs';
import { acquireTerrainWindow } from './terrain-window.mjs';
import { acquireLaserWindow } from './laser-window.mjs';
import { acquireTreeHeight } from './tree-height.mjs';
import {
  ACQUISITION_GROUND_IDS,
  COURSE_DATA_DIR,
  REPO_ROOT,
  loadPilotManifest,
} from './pilots.mjs';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_ROOT = path.join(PACKAGE_DIR, 'toolchain', '.cache', 'acquisition');

function parseArguments(argv) {
  const options = {
    groundId: null, terrain: true, laser: true, treeHeight: true, writeEvidence: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--ground') options.groundId = argv[++index];
    else if (argument === '--terrain-only') {
      options.terrain = true; options.laser = false; options.treeHeight = false;
    }
    else if (argument === '--laser-only') {
      options.terrain = false; options.laser = true; options.treeHeight = false;
    }
    else if (argument === '--tree-height-only') {
      options.terrain = false; options.laser = false; options.treeHeight = true;
    }
    else if (argument === '--write-evidence') options.writeEvidence = true;
    else throw new Error(`unknown argument ${argument}`);
  }
  if (!ACQUISITION_GROUND_IDS.includes(options.groundId)) {
    throw new Error(`--ground must be one of ${ACQUISITION_GROUND_IDS.join(', ')}`);
  }
  return options;
}

function discoveryPath(groundId) {
  return path.join(COURSE_DATA_DIR, groundId, 'acquisition', 'd2-discovery.json');
}

function relativeCachePaths(value) {
  if (Array.isArray(value)) return value.map(relativeCachePaths);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (key === 'cachePath' && typeof item === 'string') {
      return [key, path.relative(REPO_ROOT, item).replaceAll(path.sep, '/')];
    }
    return [key, relativeCachePaths(item)];
  }));
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const file = discoveryPath(options.groundId);
  const discovery = readJson(file);
  const errors = validateD2DiscoveryReport(discovery, loadPilotManifest(options.groundId));
  if (errors.length) throw new Error(`discovery snapshot is invalid:\n${errors.join('\n')}`);

  const lmCredentials = lantmaterietCredentials();
  const sksCredentials = skogsstyrelsenCredentials();
  const missing = [];
  if ((options.terrain || options.laser) && !lmCredentials) {
    missing.push('set LANTMATERIET_BEARER_TOKEN or both LANTMATERIET_USERNAME/LANTMATERIET_PASSWORD');
  }
  if (options.treeHeight && !sksCredentials) {
    missing.push('set SKOGSSTYRELSEN_USERNAME and SKOGSSTYRELSEN_PASSWORD');
  }
  if (missing.length) {
    throw new Error(`authenticated acquisition was not started:\n${missing.map(item => `- ${item}`).join('\n')}`);
  }

  console.log(`acquiring ${options.groundId}`);
  const terrain = options.terrain
    ? await acquireTerrainWindow(discovery, {
      credentials: lmCredentials,
      cacheRoot: CACHE_ROOT,
    })
    : null;
  if (terrain) {
    console.log(
      `  terrain ${terrain.terrainWindow.width}x${terrain.terrainWindow.height}, ` +
      `${terrain.terrainWindow.compressedBytes} bytes, ${terrain.measurements.totalMilliseconds} ms`,
    );
  }
  const laser = options.laser
    ? acquireLaserWindow(discovery, { credentials: lmCredentials })
    : null;
  if (laser) {
    console.log(
      `  laser ${laser.spanMetres}x${laser.spanMetres} m, ` +
      `${laser.pointCount} classified points, ${laser.elapsedMilliseconds} ms`,
    );
  }
  const treeHeight = options.treeHeight
    ? await acquireTreeHeight(discovery, {
      credentials: sksCredentials,
      cacheRoot: CACHE_ROOT,
    })
    : null;
  if (treeHeight) {
    console.log(
      `  tree height ${treeHeight.output.width}x${treeHeight.output.height}, ` +
      `${treeHeight.output.compressedBytes} bytes, ${treeHeight.measurements.totalMilliseconds} ms`,
    );
  }

  const evidence = relativeCachePaths({
    schemaVersion: 1,
    phase: 'D2-authenticated-acquisition-spike',
    groundId: options.groundId,
    acquiredOn: new Date().toISOString().slice(0, 10),
    discovery: {
      path: path.relative(REPO_ROOT, file).replaceAll(path.sep, '/'),
      sha256: sha256File(file),
      observedOn: discovery.observedOn,
    },
    credentialState: {
      lantmateriet: credentialState(lmCredentials),
      skogsstyrelsen: credentialState(sksCredentials),
      note: 'Only credential type/presence is recorded; credentials and authorization headers are never serialized.',
    },
    terrain,
    laser,
    treeHeight,
    gate: {
      acquisitionComplete: Boolean(terrain && laser && treeHeight),
      independentControlComplete: false,
      runtimeReady: false,
      note: 'These compiler inputs remain candidates until residual and independent-control gates pass.',
    },
  });

  if (options.writeEvidence) {
    const output = path.join(COURSE_DATA_DIR, options.groundId, 'acquisition', 'd2-authenticated-acquisition.json');
    fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
    console.log(`  wrote ${path.relative(REPO_ROOT, output)}`);
  } else {
    process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
  }
}

main().catch(error => {
  console.error(`D2 acquisition failed: ${error.message}`);
  process.exitCode = 1;
});
