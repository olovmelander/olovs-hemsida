/* Capture the actual WebGL2 app and verify reviewed source controls on the
 * published 1 m terrain. Runs locally or in the focused GitHub workflow.
 * node tools/check-johannesberg-ground-surfaces.mjs http://127.0.0.1:8647
 * Browser images are application renders, never redistributed orthophotos. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';
import { SURFACE } from '../apps/golf/src/engine/surface.js';
import { JOHANNESBERG_GROUND_REVIEW as review } from '../apps/golf/src/engine/scenery/johannesberg-ground-surfaces.mjs';

process.env.BUILD = 'johannesbergbuild';
const { loadTerrain } = await import('../geobuild/dtm-lib.mjs');
const terrain = loadTerrain('johannesberg');
const base = process.argv.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:8647';
const out = 'johannesbergbuild/cache/ground-surface-browser';
fs.mkdirSync(out, { recursive: true });
const report = { reviewId: review.id, capturedAt: new Date().toISOString(), backend: 'webgl2-swiftshader', courses: [], passed: false };
const saveReport = () => fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
try {
  for (const slug of review.courseSlugs) {
    const page = await browser.newPage({ viewport: { width: 709, height: 1200 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    console.log(`${slug}: loading`);
    await page.goto(`${base}/?bana=${slug}&v2=require&ghibli=1&gl=1&q=performance&qualitylock=1&det=1`, { timeout: 120000 });
    await page.waitForSelector('#boot.done', { timeout: 600000 });
    console.log(`${slug}: boot complete`);
    const actual = await page.evaluate(controls => {
      const v = window.V3D;
      return { review: v.M.groundSurfaceReview, terrain: v.v2Terrain(),
        controls: controls.map(c => ({ id: c.id, surface: v.groundSample(...c.point)?.surface,
          rawHeight: v.demH(...c.point), renderedHeight: v.terrainH(...c.point) })) };
    }, review.controls);
    assert.equal(actual.review.id, review.id);
    assert.equal(actual.terrain.ready, true);
    for (const c of review.controls) {
      const got = actual.controls.find(p => p.id === c.id);
      if (c.expectedMaterial === 'natural') {
        assert.ok(![SURFACE.GRAVEL, SURFACE.ROCK, SURFACE.ASPHALT, SURFACE.SAND].includes(got.surface), c.id);
      } else assert.equal(got.surface, c.expectedMaterial === 'rock' ? SURFACE.ROCK : SURFACE.GRAVEL, c.id);
      got.sourceHeightRh2000 = terrain.hAt(...c.point);
      got.heightResidualMetres = got.rawHeight - terrain.datum - got.sourceHeightRh2000;
      assert.ok(Math.abs(got.heightResidualMetres) < .12, `${c.id}: terrain registration ${got.heightResidualMetres}`);
    }
    const captures = [];
    report.courses.push({ slug, ...actual, errors, captures });
    saveReport();
    console.log(`${slug}: all source controls and terrain heights passed`);
    const cdp = await page.context().newCDPSession(page);
    const capture = async file => {
      console.log(`${slug}: capturing ${file}`);
      // Stop submitting new frames while the software GPU drains this one.
      // Restore the real application loop afterwards; do not change the scene,
      // materials, shadows or terrain resolution for capture.
      const loop = await page.evaluateHandle(async () => {
        const renderer = window.V3D.harness().renderer;
        const callback = renderer.getAnimationLoop();
        await renderer.setAnimationLoop(null);
        await window.V3D.prepareCapture();
        return callback;
      });
      // Read the browser view directly. The software compositor can stall
      // Playwright's surface-copy screenshot path after a large WebGL frame.
      let timer, data;
      try {
        ({ data } = await Promise.race([
          cdp.send('Page.captureScreenshot', {
            format: 'png', fromSurface: false, captureBeyondViewport: false,
          }),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${file}: capture timed out`)), 120000);
          }),
        ]));
      } finally {
        clearTimeout(timer);
        await page.evaluate(callback => window.V3D.harness().renderer.setAnimationLoop(callback), loop);
        await loop.dispose();
      }
      const bytes = Buffer.from(data, 'base64');
      assert.ok(bytes.length > 10000, `${file}: empty browser capture`);
      fs.writeFileSync(`${out}/${file}`, bytes);
      captures.push(file);
      saveReport();
      console.log(`${slug}: saved ${file} (${bytes.length} bytes)`);
    };
    for (const view of [
      { id: 'hole18', x: -182, z: -454, rise: 110, offset: 65 },
      { id: 'hole17', x: -98, z: -235, rise: 85, offset: 125 },
      { id: 'works-yard', x: 108, z: -743, rise: 240, offset: 60 },
    ]) {
      await page.evaluate(view => {
        const v = window.V3D, y = v.terrainH(view.x, view.z);
        v.setPreset('golden');
        v.placeCamera([view.x, y + view.rise, view.z + view.offset], [view.x, y, view.z]);
      }, view);
      await page.waitForFunction(() => window.V3D.settled(), null, { timeout: 120000 });
      const file = `${slug}-${view.id}-mobile.png`;
      await capture(file);
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.evaluate(() => window.V3D.setPreset('noon'));
    await page.waitForFunction(() => window.V3D.settled(), null, { timeout: 120000 });
    const file = `${slug}-works-yard-wide.png`;
    await capture(file);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ slug, controls: actual.controls, captures }));
    await page.close();
  }
  report.passed = true;
} catch (error) {
  report.error = String(error.stack || error);
  throw error;
} finally {
  saveReport();
  await browser.close();
}
