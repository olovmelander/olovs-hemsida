#!/usr/bin/env node
// Summarize raw paired samples without substituting boot/FPS estimates.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import os from 'node:os';
import assert from 'node:assert/strict';
import { courseSourceRevision } from './course-source-revision.mjs';
const root = path.resolve('output/performance-audit/reconstruction-2026-09-22');
const read = async p => JSON.parse(await fs.readFile(path.join(root, p)));
const quantile = (a, q) => { const s = [...a].sort((x,y) => x-y), i = (s.length-1)*q, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)]-s[lo])*(i-lo); };
const stats = a => ({ n: a.length, median: quantile(a,.5), p75: quantile(a,.75), min: Math.min(...a), max: Math.max(...a) });
const replay = await read('component-replay.json'), calibration = await read('component-calibration.json');
const summarize = c => {
  const variants = Object.fromEntries(['baseline', 'candidate'].map(v => [v, stats(c.samples.filter(s=>s.variant===v).map(s=>s.combined))]));
  const paired = Array.from({length:6}, (_,round) => {
    const sample = v => { const matches=c.samples.filter(s=>s.round===round&&s.variant===v); if(matches.length!==1||!Number.isFinite(matches[0].combined))throw Error('invalid paired samples');return matches[0].combined; };
    return sample('baseline')-sample('candidate');
  });
  return { course:c.course, ...variants, medianReductionPercent:100*(1-variants.candidate.median/variants.baseline.median), pairedSavings:stats(paired), fasterPairs:paired.filter(n=>n>0).length, raw:c.samples };
};
const inputs = ['component-replay.json','component-calibration.json','startup-publication.json','startup-parity.txt','prepared-gate.json','water-publication.json','unsupported-water-publication.json','tint-publication.json','baseline-tint-publication.json','water-parity.json','openings.json','baseline-openings.json','baseline-dist/DIAGNOSTIC-ONLY.json','vitest.txt','node-tests.txt'];
const files = {}; for(const file of inputs) { const bytes=await fs.readFile(path.join(root,file));files[file]={sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length}; }
assert.equal(courseSourceRevision(process.cwd()), replay.revision, 'measured source changed');
assert.equal(calibration.revision, replay.revision);
const tint = await read('tint-publication.json'), baselineTint = await read('baseline-tint-publication.json');
assert.equal(tint.revision, replay.revision);
assert.equal(baselineTint.revision, replay.revision);
assert.equal(tint.results.length, 26);
assert.deepEqual(tint.results, baselineTint.results, 'fresh original/reconstructed colors differ');
const control = await read('baseline-dist/DIAGNOSTIC-ONLY.json');
assert.equal(control.baseline, replay.baseline);
const sources = {};
for (const [file, baseline] of Object.entries(control.sources)) {
  sources[file] = { baseline, candidate: createHash('sha256').update(await fs.readFile(file)).digest('hex') };
  if (replay.sources[file]) assert.deepEqual(sources[file], replay.sources[file]);
}
const startupText = await fs.readFile(path.join(root, 'startup-parity.txt'), 'utf8');
const startupParity = JSON.parse(startupText.slice(startupText.indexOf('{')));
assert.equal(startupParity.courses, replay.courses.length);
const vitestLog = await fs.readFile(path.join(root, 'vitest.txt'), 'utf8');
const nodeLog = await fs.readFile(path.join(root, 'node-tests.txt'), 'utf8');
const count = (text, pattern) => { const m=text.match(pattern); assert.ok(m, 'test summary missing'); return Number(m[1]); };
const tests = {
  vitest: { filesPassed:count(vitestLog,/Test Files\s+(\d+) passed/),passed:count(vitestLog,/Tests\s+(\d+) passed/),total:count(vitestLog,/Tests\s+\d+ passed \((\d+)\)/) },
  node: { total:count(nodeLog,/ℹ tests (\d+)/),passed:count(nodeLog,/ℹ pass (\d+)/),failed:count(nodeLog,/ℹ fail (\d+)/),skipped:count(nodeLog,/ℹ skipped (\d+)/),cancelled:count(nodeLog,/ℹ cancelled (\d+)/) }
};
assert.equal(tests.vitest.passed, tests.vitest.total);
assert.equal(tests.node.failed, 0); assert.equal(tests.node.cancelled, 0);
assert.equal(tests.node.passed + tests.node.skipped, tests.node.total);
const openings = await read('openings.json'), baselineOpenings = await read('baseline-openings.json');
assert.equal(openings.results.length, 3);
assert.equal(baselineOpenings.results.length, 3);
const world = [];
for(const run of openings.results) {
  const b=baselineOpenings.results.find(x=>x.course===run.course); if(!b)throw Error('baseline opening missing');
  for (const r of [b, run]) {
    assert.equal(r.perf.courseData.complete, true);
    assert.deepEqual(r.perf.courseData.fallbackReasons, []);
    assert.equal(r.perf.preparedTint, true);
    assert.equal(r.quality.qualityLocked, true);
    assert.equal(r.terrain.backend, 'webgl2');
    assert.ok(r.world && Object.keys(r.world).length);
  }
  if(JSON.stringify(run.world)!==JSON.stringify(b.world)||JSON.stringify(run.water)!==JSON.stringify(b.water))throw Error(`${run.course}: opening fingerprint differs`);
  const summarize = r => ({ perf:r.perf,quality:r.quality,backend:r.terrain.backend,adapter:r.adapter,world:r.world,waterSha256:createHash('sha256').update(JSON.stringify(r.water)).digest('hex') });
  world.push({course:run.course,exactWorld:true,baseline:summarize(b),candidate:summarize(run)});
}
const evidence = { baseline:replay.baseline, revision:replay.revision,
  environment:{node:process.version,platform:process.platform,cpu:os.cpus()[0]?.model,availableParallelism:os.availableParallelism(),browser:replay.browser},
  limitations:['Software GPU only; no hardware FPS or physical phone measurements','Component timings are diagnostic Vite/Chromium replay, not full startup savings','Original lost local commits were not recovered; this is a new reconstruction','Opening A/B compares original modules against reconstructed modules with the same prepared assets','No new full-course screenshot parity claim'],
  sources,componentResults:replay.courses.map(summarize),calibration:calibration.courses.map(summarize),
  atlas:replay.courses.map(c=>({course:c.course,packSha256:c.packSha256,exactAtlas:c.exactAtlas,fingerprint:c.fingerprint,adapter:c.adapter,preparedWater:c.preparedWater})),
  marker:calibration.marker,startup:await read('startup-publication.json'),prepared:await read('prepared-gate.json'),
  waterParity:(await read('water-parity.json')).results.map(r=>({course:r.course,runs:r.runs,exactSha256:createHash('sha256').update(JSON.stringify(r.exact)).digest('hex')})),
  tintPublication:tint,freshOriginalTintExact:true,startupParity,tests,openings:world,rawFiles:files };
await fs.writeFile('docs/performance-reconstruction-2026-09-22-evidence.json',JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({courses:evidence.atlas.length,openings:world.length,revision:evidence.revision,marker:calibration.marker.exactSnapshots}));
