/* Check the composited green, gesture redraws and power saving on a real WebGL
   surface. Run on an idle renderer against a root-path production build. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from './browser-args.mjs';

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:8620/');
const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
const wait = (page, predicate, arg) => page.waitForFunction(predicate, arg, { timeout: 180000, polling: 100 });
const settled = page => wait(page, () => {
  const map = globalThis.V3DMap;
  return map && map.stats().frames > 0 && !map.stats().busy && !map.state.opening && !map.state.flight
    && map.state.guidance?.status !== 'loading';
});
const counters = page => page.evaluate(() => {
  const { frames, pulseFrames } = V3DMap.stats();
  return { pulses: pulseFrames, scene: frames - pulseFrames, time: performance.now() };
});
async function assertRedrawn(page, name, action) {
  const before = await counters(page);
  await action();
  await wait(page, scene => V3DMap.stats().frames - V3DMap.stats().pulseFrames > scene, before.scene);
  await settled(page);
  assert.ok(await page.evaluate(() => V3DMap.state.greenView), name + ' preserves the green view');
}

/* Compare pixels in the middle of the projected green. The rest of the map,
   the camera, the status messages, and the button labels are outside this check. */
async function pulsePicture(page) {
  const clip = await page.evaluate(() => {
    const { course, state, camera, heightAt } = V3DMap;
    const [x, z] = course.holes[state.hole - 1].green.c;
    const centre = camera.project(x, heightAt(x, z) * state.exaggeration, z);
    const size = 56;
    return { x: Math.round(centre.x - size / 2), y: Math.round(centre.y - size / 2), width: size, height: size };
  });
  return page.screenshot({ clip, scale: 'css' });
}

async function movingPixels(page) {
  const start = await pulsePicture(page);
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(170);
    if (!start.equals(await pulsePicture(page))) return true;
  }
  return false;
}

async function openGreen(page) {
  await page.goto(new URL('?bana=veckefjarden&karta=1&hal=3', base).href, { waitUntil: 'domcontentloaded' });
  await settled(page);
  await page.locator('[data-green]').tap();
  await wait(page, () => V3DMap.state.greenGrid?.pulses.length > 0 && !V3DMap.state.flight);
  await settled(page);
  assert.ok(await page.locator('[data-legend]').isVisible());
  assert.match(await page.locator('[data-hole-facts]').innerText(), /Snitt/);
}

const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  page.on('console', message => {
    if (message.type() === 'warning' && /INVALID_|CONTEXT_LOST|WebGL error/.test(message.text())) console.warn(message.text());
  });
  await openGreen(page);
  const details = await page.evaluate(() => {
    const gl = document.querySelector('.map-ground').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      quality: V3DMap.state.quality, buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      pulseCount: V3DMap.state.greenGrid.pulses.length / 13 };
  });
  assert.ok(details.pulseCount > 20);
  // The first pulse after a dirty frame also builds the retained scene.
  // Allow one-time shader compilation to finish before measuring cadence.
  await page.waitForFunction(() => V3DMap.stats().pulseFrames >= 2, null, { timeout: 30000, polling: 100 })
    .catch(async error => {
      const state = await page.evaluate(() => ({ frames: V3DMap.stats().frames, pulses: V3DMap.stats().pulseFrames,
        deadline: Math.round(V3DMap.state.gridAwake - performance.now()), hidden: document.hidden,
        reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, busy: V3DMap.stats().busy }));
      throw new Error('Green never began its pulse loop: ' + JSON.stringify(state), { cause: error });
    });
  const before = await counters(page);
  await page.waitForTimeout(3000);
  const after = await counters(page);
  const rate = 1000 * (after.pulses - before.pulses) / (after.time - before.time);
  const full = after.scene - before.scene;
  console.log(JSON.stringify({ ...details, pulseFps: Number(rate.toFixed(1)), fullSceneDraws: full }));
  assert.ok(await movingPixels(page), 'the projected green visibly changes between pulse frames');

  await assertRedrawn(page, 'Light change', () => page.evaluate(() => V3DMap.setLight('bla')));
  await assertRedrawn(page, 'Resize', () => page.setViewportSize({ width: 390, height: 844 }));
  await assertRedrawn(page, 'New GPS fix', () => page.evaluate(() => {
    const { course, state } = V3DMap;
    const [east, south] = course.frame.toPack(...course.holes[state.hole - 1].line[0]);
    V3DMap.fix(course.geo.origin.lat - south / 111320, course.geo.origin.lon + east / course.geo.mPerLon, 4);
  }));
  const cameraX = await page.evaluate(() => V3DMap.camera.state.x);
  await assertRedrawn(page, 'Camera pan', async () => {
    await page.mouse.move(174, 386);
    await page.mouse.down();
    await page.mouse.move(201, 404, { steps: 4 });
    await page.mouse.up();
  });
  assert.notEqual(await page.evaluate(() => V3DMap.camera.state.x), cameraX);

  const priorRestore = await counters(page);
  await page.evaluate(async () => {
    const surface = document.querySelector('.map-ground');
    const ext = surface.getContext('webgl2').getExtension('WEBGL_lose_context');
    if (!ext) throw new Error('Browser lacks WebGL context loss simulation');
    const event = type => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(type + ' timed out')), 10000);
      surface.addEventListener(type, () => { clearTimeout(timeout); resolve(); }, { once: true });
    });
    const lost = event('webglcontextlost');
    ext.loseContext();
    await lost;
    // Chromium allows restoration after the cancelled loss event has finished.
    await new Promise(resolve => setTimeout(resolve, 250));
    const restored = event('webglcontextrestored');
    ext.restoreContext();
    await restored;
  });
  await settled(page);
  await wait(page, count => V3DMap.stats().pulseFrames >= count + 2, priorRestore.pulses);
  assert.ok(await movingPixels(page), 'green pulses become visible again after context restoration');

  // Advance only the grid's idle deadline. It normally takes a minute.
  await page.evaluate(() => { V3DMap.state.gridAwake = performance.now() - 1; });
  await page.waitForTimeout(300);
  const sleeping = await counters(page);
  await page.waitForTimeout(700);
  assert.equal((await counters(page)).pulses, sleeping.pulses, 'pulses sleep after inactivity');
  await page.mouse.click(174, 386);
  await wait(page, count => V3DMap.stats().pulseFrames > count, sleeping.pulses);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await settled(page);
  await page.waitForTimeout(250);
  const reduced = await counters(page);
  await page.waitForTimeout(900);
  assert.equal((await counters(page)).pulses, reduced.pulses, 'reduced motion leaves the slope grid still');
  assert.ok(!await movingPixels(page), 'the reduced-motion green stays visibly still');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await wait(page, count => V3DMap.stats().pulseFrames > count, reduced.pulses);
  await page.locator('[data-green]').tap();
  await settled(page);
  assert.equal(await page.evaluate(() => V3DMap.state.greenGrid), null);
  assert.deepEqual(errors, []);
  assert.ok(full <= 2, 'a stationary green avoids redrawing terrain for each pulse');
  assert.ok(rate > 8, 'green pulses update more than eight times a second');
  console.log('Camera, GPS, light, resize, context restoration, idle and reduced-motion green checks passed.');
} finally {
  await browser.close();
}
