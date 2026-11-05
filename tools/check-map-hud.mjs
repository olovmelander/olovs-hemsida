#!/usr/bin/env node
/* Does the map's HUD fit every phone? Drives each state of a hole, on phones with and
 * without a notch and on their side, in each display setting, and measures: panels on
 * panels, panels off the screen, words cut off, small targets, and what on the course
 * lies behind a panel. A phone's height says little: a notch and a home bar take over
 * 90 px, and that is where this went wrong before it was measured.
 *
 * pnpm --filter @banvy/golf build && node tools/serve.mjs apps/golf/dist 8620
 * node tools/check-map-hud.mjs [--url http://localhost:8620/] [--phone se3] [--label hud]
 *
 * Build at the root path: check-basepath leaves a build the map cannot boot from here.
 * Fails on a real clash. A question over the wheel, or a passing note over a mark on the
 * map, is by design. The full report and any failing screens go to
 * tools/goldens/map/<label>/ (ignored). */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from './browser-args.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const LABEL = flag('label', 'hud');
const OUT = path.resolve('tools/goldens/map', LABEL);
fs.mkdirSync(OUT, { recursive: true });
const BASE = flag('url', 'http://localhost:8620/');
/* Four at a time, or a full run takes half an hour. */

const PHONES = [
  ['se3', 375, 667, 0, 0], ['side-notch', 844, 390, 0, 21], ['iphone-notch', 390, 844, 59, 34], ['android-small', 360, 640, 0, 0],
  ['side-small', 667, 375, 0, 0], ['se1', 320, 568, 0, 0], ['android', 360, 800, 24, 0], ['pixel', 412, 915, 0, 0],
  ['pro-max', 430, 932, 59, 34], ['tablet', 768, 1024, 0, 0],
];
const SETTINGS = [['plain', {}], ['sun', { sun: true }], ['left-large', { left: true, large: true }], ['sun-left-large', { sun: true, left: true, large: true }]];

/* What may lie on what by design: a sheet covers the game until it is closed. */
const collect = () => {
  const HUD = { hole: '.map-hole', green: '.map-green', wind: '.map-wind', wheel: '.map-wheel', hint: '.map-wheel-hint', recentre: '.map-recentre', note: '[data-locked]', same: '[data-same]', prompt: '[data-prompt]', reading: '[data-reading]', profile: '[data-profile]', legend: '[data-legend]', views: '[data-views]', tools: '.map-tools', status: '[data-status]' };
  const shown = element => { if (!element || element.hidden) return false; const style = getComputedStyle(element); if (style.display === 'none' || style.visibility === 'hidden') return false; return element.getClientRects().length > 0; };
  const rects = {};
  for (const [name, selector] of Object.entries(HUD)) {
    const element = document.querySelector(selector);
    if (!shown(element)) continue;
    const box = element.getBoundingClientRect();
    rects[name] = { l: box.left, t: box.top, r: box.right, b: box.bottom };
  }
  const issues = [];
  const names = Object.keys(rects);
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = rects[names[i]], b = rects[names[j]];
    const w = Math.min(a.r, b.r) - Math.max(a.l, b.l), h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
    if (w > 1 && h > 1) issues.push(`overlap ${names[i]}/${names[j]} ${Math.round(w)}x${Math.round(h)}`);
  }
  for (const name of names) {
    const r = rects[name];
    if (r.l < -1 || r.t < -1 || r.r > innerWidth + 1 || r.b > innerHeight + 1) issues.push(`offscreen ${name} ${Math.round(r.l)},${Math.round(r.t)},${Math.round(r.r)},${Math.round(r.b)}`);
  }
  /* Words cut off. */
  const root = document.querySelector('#courseMap');
  for (const element of root.querySelectorAll('b, span, small, button, p, output')) {
    if (!shown(element) || element.closest('.map-sheet[hidden]') || element.closest('.map-sr') || element.closest('.map-wheel-list')) continue;
    if (element.children.length && element.tagName !== 'BUTTON') continue;
    if (element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0) issues.push(`clipped "${(element.textContent ?? '').trim().slice(0, 24)}" ${element.clientWidth}<${element.scrollWidth}`);
  }
  /* Targets. */
  for (const button of root.querySelectorAll('button, a, input')) {
    if (!shown(button) || button.closest('.map-sr') || button.closest('[hidden]')) continue;
    const box = button.getBoundingClientRect();
    if (box.height < 40 || box.width < 40) issues.push(`small "${(button.getAttribute('aria-label') ?? button.textContent ?? '').trim().slice(0, 18)}" ${Math.round(box.width)}x${Math.round(box.height)}`);
  }
  /* What on the course lies behind a panel. */
  const { camera, state, course, heightAt } = V3DMap;
  const hole = course.holes[state.hole - 1];
  const screen = point => camera.project(point[0], heightAt(point[0], point[1]) * state.exaggeration, point[1]);
  const under = at => Object.entries(rects).find(([, r]) => at.x > r.l && at.x < r.r && at.y > r.t && at.y < r.b)?.[0];
  if (state.mode === 'hole' && !state.atEye) {
    const marks = { pin: hole.pin, greenCentre: hole.green.c, you: state.player?.point };
    for (const [name, point] of Object.entries(marks)) {
      if (!point) continue;
      const at = screen(point);
      if (!Number.isFinite(at.x)) continue;
      const behind = under(at);
      if (behind) issues.push(`hidden ${name} behind ${behind}`);
      else if (at.x < 0 || at.y < 0 || at.x > innerWidth || at.y > innerHeight) issues.push(`outside ${name}`);
    }
    if (state.showHazards && !state.greenView) {
      const hazards = state.hazards.map(each => under(screen(each.at))).filter(Boolean);
      if (hazards.length) issues.push(`hazard labels behind ${[...new Set(hazards)].join('+')}: ${hazards.length}/${state.hazards.length}`);
    }
  }
  return { issues, rects };
};

const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
const report = {};
const add = (phone, setting, state, found) => {
  for (const issue of found) {
    const key = issue.replace(/\s[\d,x<]+$/, '').replace(/\d+\/\d+$/, '');
    (report[key] ??= { count: 0, where: new Set(), example: issue }).count++;
    report[key].where.add(`${phone}/${setting}/${state}`);
  }
};
const CONCURRENT = 4;
let pending = [];
const only = flag('phone', null);
const jobs = PHONES.filter(phone => !only || phone[0] === only).flatMap(phone => SETTINGS.filter(([name]) => name !== 'sun-left-large' || ['se1', 'side-small'].includes(phone[0])).map(setting => [phone, setting]));
const write = () => {
  const rows = Object.entries(report).sort((a, b) => b[1].count - a[1].count).map(([key, value]) => ({ key, count: value.count, example: value.example, where: [...value.where] }));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(rows, null, 1));
  return rows;
};
let finished = 0;
pending = jobs.slice();
const runOne = async ([[phone, width, height, top, bottom], [setting, display]]) => {
      const before = Object.values(report).reduce((sum, value) => sum + value.count, 0);
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, permissions: ['geolocation'], geolocation: { latitude: 59.6, longitude: 17.8 } });
      await context.addInitScript(values => { try { localStorage.setItem('banvy-map-display-v1', JSON.stringify(values)); localStorage.setItem('banvy-map-hint-v1', '1'); } catch {} }, display);
      const page = await context.newPage();
      const problems = [];
      page.on('pageerror', e => problems.push(e.message));
      const cdp = await context.newCDPSession(page);
      if (top || bottom) await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top, left: 0, bottom, right: 0 } }).catch(() => {});
      const settled = () => page.waitForFunction(() => { const s = globalThis.V3DMap?.stats(); return s && s.frames > 0 && s.busy === 0 && !V3DMap.state.flight && !V3DMap.state.opening; }, null, { timeout: 25000, polling: 150 });
      let lastStep = 'boot';
      const record = async state => {
        lastStep = state;
        await page.waitForTimeout(260);
        const { issues } = await page.evaluate(collect);
        add(phone, setting, state, issues);
        if (issues.some(each => each.startsWith('overlap') || each.startsWith('offscreen') || each.startsWith('clipped')) && setting !== 'sun') await page.screenshot({ path: path.join(OUT, `${phone}-${setting}-${state}.png`) }).catch(() => {});
      };
      const stand = async share => {
        const point = await page.evaluate(t => { const h = V3DMap.course.holes[V3DMap.state.hole - 1]; const [a, b] = [h.line[0], h.green.c]; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }, share);
        await page.evaluate(([x, z]) => {
          const { origin, mPerLon } = V3DMap.course.geo;
          let latitude = origin.lat, longitude = origin.lon;
          for (let i = 0; i < 40; i++) { const at = V3DMap.worldOf(latitude, longitude); longitude += (x - at[0]) / mPerLon; latitude -= (z - at[1]) / 111320; }
          V3DMap.fix(latitude, longitude, 5);
        }, point);
        await page.waitForTimeout(200);
      };
      const hold = async () => {
        await page.evaluate(() => V3DMap.refix());
        const box = await page.locator('[data-wheel]').boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(1020);
        await page.mouse.up();
        await page.waitForTimeout(220);
      };
      try {
        await page.goto(`${BASE}?bana=veckefjarden&karta=1&hal=5`, { waitUntil: 'domcontentloaded' });
        await settled();
        await record('idle');
        await stand(0.12);
        await settled();
        await record('gps');
        await hold();
        await record('locked-note');
        await hold();
        await record('same-spot');
        await page.click('[data-same-shot]').catch(() => {});
        await page.waitForTimeout(200);
        await stand(0.5);
        await settled();
        await page.evaluate(() => { document.querySelector('[data-locked]').hidden = true; });
        await record('walking');
        await page.locator('.map-marks').tap({ position: { x: Math.round(width * 0.35), y: Math.round(height * 0.42) } });
        await page.waitForTimeout(300);
        await record('reading');
        await hold();
        await record('reading+note');
        await page.locator('[data-reading-close]').click().catch(() => {});
        await page.evaluate(() => { document.querySelector('[data-locked]').hidden = true; });
        const box = { x: Math.round(width * 0.35), y: Math.round(height * 0.4) };
        await page.mouse.move(box.x, box.y);
        await page.mouse.down();
        await page.mouse.move(box.x + 40, box.y + 30, { steps: 4 });
        await page.mouse.up();
        await page.waitForTimeout(300);
        await record('moved-view');
        await page.click('[data-view="hole"]');
        await settled();
        const green = await page.evaluate(() => V3DMap.course.holes[V3DMap.state.hole - 1].green.c);
        await page.evaluate(([x, z]) => {
          const { origin, mPerLon } = V3DMap.course.geo;
          let latitude = origin.lat, longitude = origin.lon;
          for (let i = 0; i < 40; i++) { const at = V3DMap.worldOf(latitude, longitude); longitude += (x - at[0]) / mPerLon; latitude -= (z - at[1]) / 111320; }
          V3DMap.fix(latitude, longitude, 5);
        }, green);
        await page.waitForTimeout(900);
        await settled();
        await record('on-green');
        await hold();
        await record('putts-prompt');
        await page.click('[data-putts-key="2"]').catch(() => {});
        await record('hole-note');
        await page.evaluate(() => { document.querySelector('[data-locked]').hidden = true; });
        await page.click('[data-view="green"]').catch(() => {});
        await settled();
        await page.waitForTimeout(400);
        await record('green-view');
        await page.click('[data-view="eye"]').catch(() => {});
        await settled();
        await record('min-vy');
        await page.click('[data-view="hole"]').catch(() => {});
        await page.click('[data-next]');
        await settled();
        await page.click('[data-next]');
        await settled();
        await record('score-prompt');
        await page.locator('[data-prompt-close]').click().catch(() => {});
        await page.click('[data-overview]');
        await settled();
        await record('overview');
        await page.evaluate(() => V3DMap.fix(62.5, 18, 5));
        await page.waitForTimeout(120);
        await record('far-status');
      } catch (error) {
        const seen = await page.evaluate(() => { const s = globalThis.V3DMap?.stats(); return s ? { frames: s.frames, busy: s.busy, flight: Boolean(V3DMap.state.flight), opening: V3DMap.state.opening } : null; }).catch(() => null);
        add(phone, setting, 'script', [`script after ${lastStep}: ${String(error.message).slice(0, 60).replace(/\s+/g, ' ')} ${JSON.stringify(seen)}`]);
      }
      if (problems.length) add(phone, setting, 'page', [`pageerror ${problems[0].slice(0, 90)}`]);
      await context.close();
      write();
      console.log('done', ++finished, 'of', jobs.length, phone, setting, 'new issues', Object.values(report).reduce((sum, value) => sum + value.count, 0) - before);
};
try {
  await Promise.all(Array.from({ length: CONCURRENT }, async () => { while (jobs.length > finished + 0 && pending.length) await runOne(pending.shift()); }));
} finally { await browser.close(); }
const rows = write();
for (const row of rows) console.log(String(row.count).padStart(4), row.example.slice(0, 80), '|', row.where.slice(0, 3).join(' '));
/* The clashes that fail it. The rest is reported for reading. */
const BY_DESIGN = /overlap (wheel|hint|recentre|wind|green)\/(prompt|same)|overlap (prompt|same)\//;
const clashes = rows.filter(row => /^(overlap|offscreen|clipped|script|pageerror|small|hidden (pin|greenCentre) behind (hole|views|tools))/.test(row.example) && !BY_DESIGN.test(row.example));
console.log(clashes.length ? `${clashes.length} kinds of clash` : 'the HUD fits every phone measured');
process.exitCode = clashes.length ? 1 : 0;
