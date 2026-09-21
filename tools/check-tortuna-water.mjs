/* Actual Tortuna course: zoom captures and a fixed-camera depth comparison.
   node tools/check-tortuna-water.mjs [--mobile] [--out=tools/goldens/tortuna-water]
   Software rendering is correctness evidence, not a device FPS benchmark. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from '../apps/golf/node_modules/vite/dist/node/index.js';
import { browserArgs } from './browser-args.mjs';

const out = path.resolve(process.argv.find(a => a.startsWith('--out='))?.slice(6) || 'tools/goldens/tortuna-water');
const mobile = process.argv.includes('--mobile');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.BANVY_CHROME || undefined, args: browserArgs() });
const report = { mobile, errors: [], views: [] };
const server = await createServer({ root: path.resolve('apps/golf'), server: { host: '127.0.0.1', port: 0 } });
try {
  await server.listen();
  const page = await browser.newPage({ viewport: mobile ? { width: 393, height: 740 } : { width: 1000, height: 760 },
    isMobile: mobile, hasTouch: mobile });
  page.on('pageerror', e => { report.errors.push(e.message); console.log('pageerror: ' + e.message); });
  page.on('console', m => { if (m.type() === 'error') console.log('console: ' + m.text()); });
  await page.goto('http://127.0.0.1:' + server.httpServer.address().port + '/?bana=tortuna&v2=require&gl=1&q=low&qualitylock=1&det=1&ljus=dag');
  await page.waitForFunction(() => window.V3D?.harness && document.querySelector('#boot.done'), null, { timeout: 300000 });
  report.initial = await page.evaluate(() => {
    const v = V3D, h = v.harness();
    return { backend: v.stats.backend, terrain: v.v2Terrain(), placement: v.M.infra.terrainPlacement,
      water: v.waterSheets(), flat: v.flatWater(), near: h.camera.near,
      materials: [...new Set(h.scene.children.filter(m=>m.userData.tag==='water').map(m=>m.material))]
        .map(m=>({depthFunc:m.depthFunc,polygonOffset:m.polygonOffset,transparent:m.transparent,depthWrite:m.depthWrite})) };
  });
  console.log(JSON.stringify({ boot: true, backend: report.initial.backend, sheets: report.initial.water.length }));
  for (const view of [
    ...(!mobile ? [{ name: 'close', position: [200, 220, -380], target: [145, 19, -700] }] : []),
    { name: 'medium', position: [200, 620, 150], target: [145, 19, -700] },
    { name: 'distant', position: [200, 1500, 1550], target: [145, 19, -700] },
  ]) {
    const movedFrame = await page.evaluate(v => { V3D.placeCamera(v.position, v.target); return V3D.frame(); }, view);
    await page.waitForFunction(frame => V3D.frame() >= frame + 3 && V3D.settled() &&
      V3D.v2Terrain().adapter.stream.loadingTiles === 0, movedFrame, { timeout: 180000 });
    console.log(JSON.stringify({ view: view.name, state: 'camera and terrain ready' }));
    const capture = await page.evaluate(async () => {
      const v = V3D, { renderer, camera, scene } = v.harness(), gl = renderer.backend.gl;
      const loop = renderer.getAnimationLoop(); await renderer.setAnimationLoop(null);
      const originalNear = camera.near, originals = [];
      let target;
      const read = () => {
        const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
        const pixels = new Uint8Array(width * height * 4);
        const previousRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
        try {
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        } finally { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousRead); }
        return { width, height, pixels };
      };
      try {
        v.harness().controls.update(); camera.lookAt(v.harness().controls.target); camera.updateMatrixWorld(true);
        await v.prepareCapture();
        const frame = read(), canvas = document.createElement('canvas');
        canvas.width = frame.width; canvas.height = frame.height;
        const ctx = canvas.getContext('2d'), image = ctx.createImageData(frame.width, frame.height), stride = frame.width * 4;
        for (let y = 0; y < frame.height; y++) image.data.set(frame.pixels.subarray(y * stride, (y + 1) * stride), (frame.height - 1 - y) * stride);
        ctx.putImageData(image, 0, 0);
        scene.traverse(m => {
          if (m.userData.tag !== 'water') return;
          const diagnostic = m.material.clone();
          diagnostic.colorNode = null; diagnostic.opacityNode = null;
          diagnostic.color.setHex(0xff00ff); diagnostic.opacity = 1; diagnostic.fog = false;
          diagnostic.toneMapped = false;
          diagnostic.needsUpdate = true;
          originals.push([m, m.material]); m.material = diagnostic;
        });
        const moduleUrl = performance.getEntriesByType('resource').find(e => /\/three_webgpu\.js\?/.test(e.name))?.name;
        if (!moduleUrl) throw new Error('Cannot find the app Three module for render-target readback');
        const { RenderTarget } = await import(moduleUrl);
        target = new RenderTarget(frame.width, frame.height, { samples: 4 });
        renderer.setRenderTarget(target);
        const diagnostic = async near => {
          camera.near = near; camera.updateProjectionMatrix(); renderer.render(scene, camera);
          return { width: frame.width, height: frame.height,
            pixels: await renderer.readRenderTargetPixelsAsync(target, 0, 0, frame.width, frame.height) };
        };
        const before = await diagnostic(1), actual = await diagnostic(originalNear);
        // An independent, more aggressive reference plane still lies wholly
        // above the measured world's 69.52 m ceiling + 64 m scenery allowance.
        // Geometry, camera pose and LOD stay identical; only depth changes.
        camera.near = Math.min(128, (camera.position.y - 69.52 - 64) / 4,
          camera.position.distanceTo(v.harness().controls.target) / 8);
        const reference = await diagnostic(camera.near);
        let missing = 0, leaking = 0, oldMissing = 0, oldLeaking = 0, waterPixels = 0;
        const water = (p, i) => p[i] > 180 && p[i + 1] < 40 && p[i + 2] > 180;
        for (let i = 0; i < actual.pixels.length; i += 4) {
          const a = water(actual.pixels, i), b = water(reference.pixels, i), old = water(before.pixels, i);
          if (b) waterPixels++;
          if (a && !b) leaking++;
          if (!a && b) missing++;
          if (old && !b) oldLeaking++;
          if (!old && b) oldMissing++;
        }
        return { image: canvas.toDataURL('image/png').split(',')[1], comparison: { actualNear: originalNear,
          referenceNear: camera.near, missing, leaking, oldMissing, oldLeaking, waterPixels, width: actual.width, height: actual.height } };
      } finally {
        renderer.setRenderTarget(null); target?.dispose();
        for (const [mesh, material] of originals) { mesh.material.dispose(); mesh.material = material; }
        camera.near = originalNear; camera.updateProjectionMatrix(); await renderer.setAnimationLoop(loop);
      }
    });
    await fs.writeFile(path.join(out, view.name + '.png'), Buffer.from(capture.image, 'base64'));
    const state = await page.evaluate(() => ({ camera: V3D.camExact(), near: V3D.harness().camera.near, terrain: V3D.v2Terrain() }));
    report.views.push({ ...view, ...state, comparison: capture.comparison });
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ view: view.name, near: state.near, comparison: capture.comparison }));
  }
  assert.equal(report.initial.backend, 'webgl2');
  assert.deepEqual(report.errors, []);
  assert.ok(report.views.every(v => v.near > 1), 'Measured ponds must receive the zoom precision guard');
  assert.ok(report.views.every(v => v.comparison.waterPixels > 10), 'Diagnostic water must actually be visible');
  const total = key => report.views.reduce((sum, v) => sum + v.comparison[key], 0);
  assert.ok(total('oldMissing') + total('oldLeaking') > 0, 'Old near plane must reproduce depth errors');
  assert.ok(total('missing') + total('leaking') <= .05 * (total('oldMissing') + total('oldLeaking')),
    'Corrected depth must remove at least 95% of mismatched water pixels');
  for (const { comparison: c } of report.views) assert.ok(c.missing + c.leaking <= Math.max(4, c.waterPixels * .02),
    'Residual mismatch must stay below 2% of reference water pixels (or four pixels)');
  report.passed = true;
} finally {
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
