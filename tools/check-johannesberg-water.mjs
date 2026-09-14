import { spawn } from 'node:child_process';
/* Verify nine source-reviewed ponds in both actual course packs.
 * Build apps/golf, then node tools/check-johannesberg-water.mjs [--gpu]
 * The harness starts its own preview so it also works in isolated runners.
 * Captures are app frames, not redistributed orthophotos or FPS evidence. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';
import { JOHANNESBERG_WATER_REVIEW as waterReview } from '../apps/golf/src/engine/scenery/johannesberg-water.mjs';
import { SURFACE } from '../apps/golf/src/engine/surface.js';
import { JOHANNESBERG_GROUND_REVIEW as review } from '../apps/golf/src/engine/scenery/johannesberg-ground-surfaces.mjs';

process.env.BUILD = 'johannesbergbuild';
const { loadTerrain } = await import('../geobuild/dtm-lib.mjs');
const terrain = loadTerrain('johannesberg');
const gpu = process.argv.includes('--gpu');
const port = gpu ? '8650' : '8649';
const base = process.argv.find(a => /^https?:/.test(a)) || `http://127.0.0.1:${port}`;
const out = process.env.WATER_REVIEW_OUT || `johannesbergbuild/cache/water-browser${gpu ? '-gpu' : ''}`;
fs.mkdirSync(out, { recursive: true });
const report = { reviewId: waterReview.id, capturedAt: new Date().toISOString(), backend: gpu ? 'webgpu-swiftshader' : 'webgl2-swiftshader',
  captureMethod: gpu ? 'app-render-target-readback' : 'active-pipeline-webgl-pixels', performanceEvidence: false, courses: [], passed: false };
const saveReport = () => fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', port, '--strictPort'], { cwd: 'apps/golf', stdio: 'ignore' });
server.unref();
for (let i = 0; i < 50; i++) { try { await fetch(base); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
const browser = await chromium.launch({ args: [...browserArgs(), ...(gpu ? ['--enable-unsafe-webgpu'] : [])] });
try {
  for (const slug of waterReview.courseSlugs) {
    const page = await browser.newPage({ viewport: { width: 393, height: 740 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 16; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36' });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    console.log(`${slug}: loading`);
    await page.goto(`${base}/?bana=${slug}&v2=require&ghibli=1&${gpu ? '' : 'gl=1&'}qualitylock=1&det=1`, { timeout: 120000 });
    await page.waitForSelector('#boot.done', { timeout: 600000 });
    console.log(`${slug}: boot complete`);
    const actual = await page.evaluate(controls => {
      const v = window.V3D;
      return { review: v.M.groundSurfaceReview, terrain: v.v2Terrain(),
        water: v.M.water.slice(0,12).map(w=>({id:w.id,level:w.level,evidence:w.levelEvidence,exactShore:w.exactShore,vegetatedBank:w.vegetatedBank})), bed: v.harness().terrainV2.waterBedSummary, controls: controls.map(c => ({ id: c.id, surface: v.groundSample(...c.point)?.surface,
          rawHeight: v.demH(...c.point), renderedHeight: v.terrainH(...c.point) })) };
    }, review.controls);
    assert.equal(actual.review.id, review.id);
    assert.equal(actual.terrain.ready, true);
    assert.equal(actual.terrain.backend, gpu ? 'webgpu' : 'webgl2', 'requested backend must actually render');
    assert.equal(actual.bed.refinedBodies, 9);
    for (const source of waterReview.bodies) {
      const w=actual.water.find(w=>w.id===source.id);
      assert.ok(w, source.id);
      assert.equal(w.exactShore,true);
      assert.equal(w.vegetatedBank,true);
      assert.equal(w.evidence.method,'reviewed-interior-terrain-controls');
      assert.ok(Math.abs(w.evidence.sourceLevelRH2000Metres-source.levelRH2000Metres)<.03, source.id);
      assert.ok(Math.abs(w.level-terrain.datum-source.levelRH2000Metres-.06)<.03, source.id);
    }
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
    const capture = async file => {
      console.log(`${slug}: capturing ${file}`);
      // Capture the actual app's final default framebuffer in the same task as
      // rendering it. Chrome's screenshot compositor stalls on this CI adapter.
      // Preserve all scene/material/quality settings and restore its frame loop.
      const result = await page.evaluate(async gpu => {
        const v = window.V3D, renderer = v.harness().renderer;
        const callback = renderer.getAnimationLoop();
        await renderer.setAnimationLoop(null);
        try {
          const { camera, controls } = v.harness();
          controls.update(); camera.lookAt(controls.target); camera.updateMatrixWorld(true);
          if (gpu) {
            if (!v.captureReadback) throw new Error('WebGPU capture unavailable; backend fell back');
            const shot = await v.captureReadback();
            return { data: shot.base64, width: shot.width, height: shot.height,
              quality: v.quality(), camera: v.camExact(), sourceBytes: shot.sourceBytes };
          }
          await v.prepareCapture();
          const gl = renderer.backend.gl;
          if (!gl || gl.isContextLost()) throw new Error('WebGL2 context unavailable');
          const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
          const pixels = new Uint8Array(width * height * 4);
          const previousRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
          try {
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          } finally { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousRead); }
          if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL pixel readback failed');
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const context = canvas.getContext('2d'), image = context.createImageData(width, height);
          const stride = width * 4, colours = new Set();
          let opaque = 0;
          for (let y = 0; y < height; y++) {
            image.data.set(pixels.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride);
          }
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i + 3] > 250) opaque++;
            if (i % 64 === 0) colours.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
          }
          if (opaque < width * height * .95 || colours.size < 128) throw new Error('Empty or uniform app frame');
          context.putImageData(image, 0, 0);
          return { data: canvas.toDataURL('image/png').split(',')[1], width, height,
            opaquePixels: opaque, sampledColours: colours.size, quality: v.quality(), camera: v.camExact() };
        } finally { await renderer.setAnimationLoop(callback); }
      }, gpu);
      const bytes = Buffer.from(result.data, 'base64');
      assert.ok(bytes.length > 10000, `${file}: empty browser capture`);
      fs.writeFileSync(`${out}/${file}`, bytes);
      const { data, ...evidence } = result;
      captures.push({ file, ...evidence });
      saveReport();
      console.log(`${slug}: saved ${file} (${bytes.length} bytes)`);
    };
    for (const view of [
      { id: 'east-ponds', x: 100, z: -220, rise: 230, offset: 110 },
      { id: 'west-ponds', x: -320, z: -630, rise: 190, offset: 90 },
    ]) {
      await page.evaluate(view => {
        const v = window.V3D, y = 16; // identical absolute source camera for before/after
        v.setPreset('golden');
        v.placeCamera([view.x, y + view.rise, view.z + view.offset], [view.x, y, view.z]);
        const { camera, controls } = v.harness(); controls.update(); camera.lookAt(controls.target); camera.updateMatrixWorld(true);
      }, view);
      await page.waitForFunction(() => window.V3D.settled(), null, { timeout: 120000 });
      const file = `${slug}-${view.id}-mobile.png`;
      await capture(file);
    }
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.evaluate(() => window.V3D.setPreset('noon'));
    await page.waitForFunction(() => window.V3D.settled(), null, { timeout: 120000 });
    const file = `${slug}-west-ponds-wide.png`;
    await capture(file);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ slug, ponds: actual.water.filter(w=>w.exactShore).length, captures: captures.map(c=>c.file) }));
    await page.close();
  }
  report.passed = true;
} catch (error) {
  report.error = String(error.stack || error);
  throw error;
} finally {
  saveReport();
  await browser.close(); server.kill();
}
