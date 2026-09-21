#!/usr/bin/env node
// Compare the full water state before any renderer work, on every course.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const base = args.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:8641';
const catalog = await (await fetch(`${base}/courses/index.json`)).json();
const only = flag('only', '').split(',').filter(Boolean), rounds = Number(flag('rounds', '1')), cpu = Number(flag('cpu', '1'));
assert.ok(Number.isSafeInteger(rounds) && rounds > 0 && Number.isFinite(cpu) && cpu >= 1, 'invalid rounds/CPU rate');
assert.ok(only.every(slug => catalog.courses.some(c => c.slug === slug)), 'unknown course');
const report = { physicalPhone: false, cpu, rounds, results: [] };
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
try {
  for (const course of catalog.courses.filter(c => !only.length || only.includes(c.slug))) {
    const result = { course: course.slug, runs: [] };
    let expected = null;
    for (let round = 0; round < rounds; round++) for (const startup of round % 2 ? ['1', 'live-water'] : ['live-water', '1']) {
      const page = await browser.newPage({ serviceWorkers: 'block' });
      try {
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
        if (args.includes('--missing-water')) await page.route('**/prepared/water-*.bin', route => route.abort());
        const query = new URLSearchParams({ bana: course.slug, v2: 'require', det: '1', startup, waterAudit: '1',
          ghibli: '1', ljus: round % 2 ? 'dis' : 'gryning', q: round % 2 ? 'hi' : 'lo' });
        await page.goto(`${base}/?${query}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.waitForFunction(() => !!window.__WATER_BAKE__, null, { timeout: 180000 });
        assert.deepEqual(errors, []);
        const state = await page.evaluate(async () => {
          const data = window.__WATER_BAKE__;
          if (data.supported === false) return { supported: false, revision: data.revision };
          return { supported: true, revision: data.revision, prepared: data.prepared, load: data.load,
            spans: data.spans, fingerprint: await data.fingerprint(), levels: data.levels };
        });
        if (state.supported) {
          assert.equal(state.prepared, startup === '1' && !args.includes('--missing-water'), `${course.slug} prepared path`);
          const exact = { fingerprint: state.fingerprint, levels: state.levels };
          if (expected) assert.deepEqual(exact, expected, `${course.slug} exact water fields/carved terrain`);
          else expected = exact;
          result.runs.push({ round, startup, prepared: state.prepared, load: state.load, spans: state.spans, revision: state.revision });
        } else result.runs.push({ round, startup, supported: false });
        console.log(`${course.slug} ${round + 1} ${startup}: ${state.supported ? 'exact water + carved rings' : 'existing measured/frontier path'}`);
      } finally { await page.close(); }
    }
    result.exact = expected;
    report.results.push(result);
  }
  const out = path.resolve(flag('out', 'tools/reference/prepared-water-review.json'));
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(report, null, 2) + '\n');
  console.log(`PASS ${report.results.length} courses; saved ${out}`);
} finally { await browser.close(); }
