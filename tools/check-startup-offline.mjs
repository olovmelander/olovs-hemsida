#!/usr/bin/env node
// A persistent-profile test with the HTTP server actually stopped. Browser
// offline emulation alone does not stop a service worker's network requests.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const dist = path.resolve(flag('dist', 'tools/reference/startup-release-build'));
const course = flag('course', 'veckefjarden');
const port = +flag('port', '8630');
const base = `http://127.0.0.1:${port}`;
const out = path.resolve(flag('out', 'tools/reference/startup-offline'));
await fs.mkdir(out, { recursive: true });
const profile = await fs.mkdtemp(path.join(out, 'profile-'));
await fs.access(path.join(dist, 'sw.js'));
const report = { course, physicalPhone: false, profile, visits: [], errors: [] };
const server = spawn(process.execPath, ['tools/serve.mjs', dist, String(port)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const stopped = once(server, 'exit');
let context;
const launch = () => chromium.launchPersistentContext(profile, { channel: 'chrome', args: browserArgs(),
  viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 });
const query = new URLSearchParams({ bana: course, v2: 'require', det: '1', qualitylock: '1', startup: '1',
  q: flag('q', 'lo'), ghibli: flag('look', '1'), vy: 'tee', hal: '1' });

async function record(page, visit) {
  await page.waitForSelector('#boot.done', { timeout: 180000 });
  const data = await page.evaluate(async () => {
    const V = window.V3D, tint = V.groundTint();
    const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
    return { slug: V.course().slug, holes: V.HOLES.length, perf: V.perf(), world: {
      instances: await hash(new TextEncoder().encode(JSON.stringify(V.legacyTrees({ instances: true }).instances))),
      exactTables: V.startupWorldFingerprint ? await V.startupWorldFingerprint() : null,
      landmarks: V.landmarkModels?.()?.status ?? null,
      facilities: V.facilityGeometry?.()?.assetSha256 ?? null,
      near: await hash(tint.near), far: await hash(tint.far), trees: V.stats.trees, vista: V.stats.vista },
      caches: await caches.keys() };
  });
  assert.equal(data.slug, course);
  assert.equal(data.perf.courseData.complete, true);
  assert.deepEqual(data.perf.courseData.fallbackReasons, []);
  assert.equal(data.perf.preparedTint, true);
  report.visits.push({ visit, ...data });
  console.log(`${visit}: ${Math.round(data.perf.courseReadyAtNavigationMs)} ms, complete ${data.perf.courseData.verified} chunks`);
}

try {
  await Promise.race([
    once(server.stdout, 'data'),
    stopped.then(([code]) => { throw new Error(`test server exited ${code}`); }),
  ]);
  assert.equal((await fetch(base)).status, 200);
  context = await launch();
  let page = context.pages()[0];
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(`${base}/?${query}`, { waitUntil: 'domcontentloaded' });
  await record(page, 'first-online');
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Registration on a first-ever visit may follow the first data requests.
  // The controlled second visit is the explicit persistence boundary tested.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await record(page, 'controlled-online');
  await page.waitForTimeout(1500);
  await context.close(); context = null;
  server.kill(); await stopped;
  await assert.rejects(fetch(base), 'HTTP server must be unavailable');
  report.serverStopped = true;
  context = await launch(); page = context.pages()[0];
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(`${base}/?${query}`, { waitUntil: 'domcontentloaded' });
  await record(page, 'reopened-offline');
  const offline = report.visits.at(-1);
  assert.deepEqual(offline.world, report.visits[1].world, 'offline world changed');
  assert.equal(offline.perf.courseData.networkRequests, 0);
  assert.ok(offline.perf.courseData.cacheHits > 0);
  assert.deepEqual(report.errors, []);
} catch (error) { report.errors.push(error.stack); process.exitCode = 1; }
finally {
  await context?.close();
  if (server.exitCode === null) { server.kill(); await stopped; }
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ visits: report.visits.length, errors: report.errors }, null, 2));
