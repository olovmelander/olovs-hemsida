#!/usr/bin/env node
/* Report the remaining Puttom surface-publication gates without treating the
   retained migration preview as survey truth. Pass --source only after a
   reviewer has prepared an authoritative-surface-source-v1 JSON document. */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateAuthoritativeSurfacePreflight } from './authoritative-surface-preflight.mjs';
import { assertTerrainPreview } from './terrain-preview.mjs';
import { PUTTOM_PREVIEW_CONFIG } from '../../apps/golf/src/engine/v2-puttom-preview.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function defaultOptions() {
  return {
    manifest: resolve(ROOT, 'geo_data/course-v2/puttom/source-manifest.json'),
    catalog: resolve(ROOT, 'geo_data/course-v2/source-catalog.json'),
    /* Where the pilot descriptor lives is the reviewed config's to say; this
       default pointed at apps/golf/public/v2/puttom/preview.json, which the
       widening deleted, so the preflight had been reading a missing file. */
    terrainPreview: resolve(ROOT, 'apps/golf/public', PUTTOM_PREVIEW_CONFIG.descriptorPath),
    source: null,
    requireReady: false,
  };
}

function argumentsFrom(argv) {
  const options = defaultOptions();
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--manifest') options.manifest = resolve(argv[++index] || '');
    else if (argument === '--catalog') options.catalog = resolve(argv[++index] || '');
    else if (argument === '--terrain-preview') options.terrainPreview = resolve(argv[++index] || '');
    else if (argument === '--source') options.source = resolve(argv[++index] || '');
    else if (argument === '--require-ready') options.requireReady = true;
    else if (argument === '--help') {
      console.log('Usage: node packages/course-v2/puttom-authoritative-surface-preflight.mjs [--source reviewed-source.json] [--require-ready]');
      process.exit(0);
    } else throw new Error(`unknown argument ${argument}`);
  }
  return options;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`${path}: ${error.message}`);
  }
}

export async function reportPuttomAuthoritativeSurfacePreflight(options = {}) {
  const paths = { ...defaultOptions(), ...options };
  const manifest = await readJson(paths.manifest);
  const catalog = await readJson(paths.catalog);
  const terrain = assertTerrainPreview(await readJson(paths.terrainPreview));
  const source = paths.source === null || paths.source === undefined ? null : await readJson(paths.source);
  return evaluateAuthoritativeSurfacePreflight({
    manifest,
    catalog,
    frame: terrain.frame,
    terrainBounds: terrain.bounds,
    terrainProvisional: terrain.provisional,
    source,
  });
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  const report = await reportPuttomAuthoritativeSurfacePreflight(options);
  console.log(JSON.stringify(report, null, 2));
  if (options.requireReady && !report.ready) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Puttom authoritative surface preflight failed: ${error.message}`);
    process.exitCode = 1;
  });
}
