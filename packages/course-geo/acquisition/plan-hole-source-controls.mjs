#!/usr/bin/env node
import { loadRepositoryHoleSourceControlPlan } from './hole-source-inventory.mjs';

const json = process.argv.includes('--json');
const unknown = process.argv.slice(2).filter(argument => argument !== '--json');
if (unknown.length) throw new Error(`unknown argument ${unknown[0]}`);

const plan = loadRepositoryHoleSourceControlPlan();
if (json) {
  process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
} else {
  console.log(
    `Validated ${plan.summary.groundCount} physical grounds, ${plan.summary.courseCount} courses, ` +
    `${plan.summary.holeCount} holes and ${plan.summary.uniqueGroundWindowCount} shared control windows`,
  );
  for (const ground of plan.grounds) {
    console.log(
      `  ${ground.groundId}: ${ground.summary.holeCount} holes, ` +
      `${ground.summary.uniqueWindowCount} windows, ${ground.discoveryState}`,
    );
  }
  console.log('Production remains disabled; local density/raster evidence is required per window.');
}
