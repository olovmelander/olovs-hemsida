#!/usr/bin/env node
/* A look at a ground where it is served: after a deploy, or against a local build.

   BANVY_GPU=1 node tools/check-live-course.mjs --base https://banvy.olovmelander.workers.dev --ground <id>
       [--control <slug>] [--quality hi|lo] [--shots <dir>]

   For each routing of the ground, and for one course of another ground (a deploy must not break what was there):
   - the detailed course starts, settles with every terrain tile loaded, plants trees, and reports its authored
     campus as loaded where the ground has one;
   - the phone map starts at phone width;
   - neither writes an error to the console.
   It fails on the first thing a visitor would notice, and with --shots keeps a picture of each to look at.

   This opens a browser, on the real GPU with BANVY_GPU=1: it is the owner's to start. It reads the site and
   changes nothing. A static server has no sign-in service, so that one probe's 404 is not counted. */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from './browser-args.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const BASE = (flag('base') ?? '').replace(/\/$/, ''), GROUND = flag('ground'), QUALITY = flag('quality', 'hi'), SHOTS = flag('shots');
if (!BASE || !GROUND) throw new Error('usage: check-live-course.mjs --base <url> --ground <id> [--control <slug>] [--quality hi|lo] [--shots <dir>]');

const get = async file => { const response = await fetch(`${BASE}/${file}`, { cache: 'no-store' }); if (!response.ok) throw new Error(`${file}: ${response.status}`); return response.json(); };
const v2 = (await get('courses/v2-index.json')).courses, catalogue = (await get('courses/index.json')).courses;
const own = v2.filter(course => course.groundId === GROUND).map(course => course.slug);
if (!own.length) throw new Error(`${BASE} serves no routing of ${GROUND}`);
const control = flag('control') ?? catalogue.find(course => !own.includes(course.slug))?.slug;
const campus = (await fetch(`${BASE}/models/${GROUND}/facilities-v1.json`, { cache: 'no-store' })).ok;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const failures = [];
const report = (ok, line) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${line}`); if (!ok) failures.push(line); };
const listen = page => {
  const errors = [];
  page.on('pageerror', error => errors.push(`page error: ${String(error).split('\n')[0].slice(0, 200)}`));
  page.on('console', message => { if (message.type() === 'error' && !(message.location()?.url ?? '').endsWith('/api/health')) errors.push(message.text().split('\n')[0].slice(0, 200)); });
  return errors;
};

const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
try {
  for (const slug of [...own, ...(control ? [control] : [])]) {
    const mine = own.includes(slug);
    {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, serviceWorkers: 'block' }), errors = listen(page), started = Date.now();
      let state = null, problem = null;
      try {
        await page.goto(`${BASE}/?bana=${slug}&hal=1&vy=fritt&ljus=dag&q=${QUALITY}&qualitylock=1&ren=1&skylt=0`);
        await page.waitForSelector('#boot.done', { timeout: 180000 });
        await page.waitForFunction(() => window.V3D.settled() && (window.V3D.v2Terrain().adapter?.stream?.loadingTiles ?? 0) === 0, null, { timeout: 120000, polling: 200 });
        state = await page.evaluate(() => ({ backend: window.V3D.stats.backend, trees: window.V3D.stats.trees, facilities: window.V3D.stats.facilities?.status ?? null }));
        if (SHOTS) { await page.waitForTimeout(1500); await page.locator('body > canvas').screenshot({ path: path.join(SHOTS, `${slug}-3d.png`) }); }
      } catch (error) { problem = String(error).split('\n')[0].slice(0, 160); }
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      report(!problem, `${slug} detailed course starts${problem ? `: ${problem}` : ` (${state.backend}, ${seconds} s)`}`);
      if (state) {
        report(state.trees > 0, `${slug} has trees (${state.trees})`);
        if (mine && campus) report(state.facilities === 'loaded', `${slug} campus is ${state.facilities}`);
      }
      report(errors.length === 0, `${slug} detailed course console${errors.length ? `: ${errors[0]}` : ' is clean'}`);
      await page.close();
    }
    {
      const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
      const page = await context.newPage(), errors = listen(page);
      let problem = null;
      try {
        await page.goto(`${BASE}/?bana=${slug}&hal=1&karta=1`);
        await page.waitForFunction(() => !!window.V3DMap?.course, null, { timeout: 60000 });
        await page.waitForTimeout(6000);
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${slug}-map.png`) });
      } catch (error) { problem = String(error).split('\n')[0].slice(0, 160); }
      report(!problem, `${slug} phone map starts${problem ? `: ${problem}` : ''}`);
      report(errors.length === 0, `${slug} phone map console${errors.length ? `: ${errors[0]}` : ' is clean'}`);
      await context.close();
    }
  }
} finally { await browser.close(); }
console.log(failures.length ? `${failures.length} check(s) failed on ${BASE}` : `${GROUND} and ${control ?? 'no control course'} are as they should be on ${BASE}`);
process.exitCode = failures.length ? 1 : 0;
