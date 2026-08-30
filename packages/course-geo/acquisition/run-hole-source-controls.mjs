#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EXPECTED_GROUNDS } from '../manifest.mjs';
import {
  lantmaterietCredentials,
  skogsstyrelsenCredentials,
} from './credentials.mjs';
import { runAuthenticatedGroundHoleSourceControls } from './hole-source-runner.mjs';

function parseArguments(argv) {
  const options = {
    groundId: null,
    providers: ['laser', 'tree-height'],
    batchIndex: 0,
    batchCount: 1,
    output: null,
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const value = () => {
      const result = argv[++index];
      if (!result) throw new Error(`${argument} requires a value`);
      return result;
    };
    if (argument === '--ground') options.groundId = value();
    else if (argument === '--providers') {
      const selected = value();
      if (selected === 'both') options.providers = ['laser', 'tree-height'];
      else if (selected === 'laser') options.providers = ['laser'];
      else if (selected === 'tree-height') options.providers = ['tree-height'];
      else throw new Error('--providers must be both, laser or tree-height');
    } else if (argument === '--batch-index') options.batchIndex = Number(value());
    else if (argument === '--batch-count') options.batchCount = Number(value());
    else if (argument === '--output') options.output = path.resolve(value());
    else throw new Error(`unknown argument ${argument}`);
  }
  if (!EXPECTED_GROUNDS[options.groundId]) {
    throw new Error(`--ground must be one of ${Object.keys(EXPECTED_GROUNDS).join(', ')}`);
  }
  if (!options.output || path.extname(options.output).toLowerCase() !== '.json') {
    throw new Error('--output must name an explicit JSON evidence file');
  }
  return options;
}

function stableJson(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'banvy-hole-controls-'));
  try {
    const evidence = await runAuthenticatedGroundHoleSourceControls(options.groundId, {
      providers: options.providers,
      batchIndex: options.batchIndex,
      batchCount: options.batchCount,
      lantmaterietCredentials: options.providers.includes('laser')
        ? lantmaterietCredentials()
        : null,
      skogsstyrelsenCredentials: options.providers.includes('tree-height')
        ? skogsstyrelsenCredentials()
        : null,
      workRoot: temporaryRoot,
      onProgress: ({ completed, total, result }) => {
        console.log(
          `${options.groundId}: ${completed}/${total} controls; ` +
          `${result.disposition.eligibleForAutomaticObjectCandidates ? 'eligible' : 'fallback/review'}`,
        );
      },
    });
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    const temporaryOutput = `${options.output}.tmp-${process.pid}`;
    fs.writeFileSync(temporaryOutput, stableJson(evidence), { mode: 0o600 });
    fs.renameSync(temporaryOutput, options.output);
    console.log(
      `wrote safe aggregate evidence: ${evidence.summary.checkedWindowCount} windows, ` +
      `${evidence.summary.automaticEligibleCount} automatically eligible, ` +
      `${evidence.summary.technicalErrorCount} technical errors`,
    );
    if (evidence.summary.technicalErrorCount > 0) process.exitCode = 2;
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`per-hole source controls failed: ${error.message}`);
  process.exitCode = 1;
});
