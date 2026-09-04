/* Live-motion regression gate for Spellinje. Unlike visual captures this does
   not use ?det=1: it exercises the exact animation path a player gets while
   orbiting, toggling the guide and stepping through holes. */
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';
import { decodePNG } from '../geobuild/png.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8620';
const FORCE_GL = process.argv.includes('--webgl');
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs({ uncappedFrameRate: true }) });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(420_000);
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const gate = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) process.exitCode = 1;
};
const stats = values => {
  const ordered = [...values].sort((a, b) => a - b);
  const at = ratio => ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * ratio))];
  return { median: at(0.5), p95: at(0.95), max: ordered.at(-1), over50: values.filter(value => value > 50).length };
};

/* Pin tree LOD to its cheapest tier so this gate measures Spellinje rather than
   thousands of unrelated tree crossfades triggered by the scripted camera. */
await page.goto(`${BASE}/?bana=angso&ren=1&q=lo&lodpin=4,4&v2=0${FORCE_GL ? '&gl=1' : ''}`, { waitUntil: 'load', timeout: 120_000 });
await page.waitForSelector('#boot.done');
const backend = await page.evaluate(() => window.V3D.stats.backend);
console.log(`info live course booted on ${backend}`);

/* By the time boot is visible, the short entrance must have become entirely
   idle. Run transitions in one task so the result measures input handlers,
   not the much heavier course/tree render occurring between animation frames. */
await page.waitForTimeout(1200);
const transitions = await page.evaluate(() => {
  const holes = [], toggles = [];
  const button = document.getElementById('strategyBtn');
  const settledBeforeStress = window.V3D.caddie().visual?.settled === true;
  for (let index = 0; index < 12; index++) {
    const started = performance.now();
    button.click();
    toggles.push({ syncMs: performance.now() - started, on: window.V3D.caddie().strategyOn });
  }
  for (let number = 2; number <= 18; number++) {
    const started = performance.now();
    window.V3D.goHole(number, true);
    const syncMs = performance.now() - started;
    holes.push({ number, syncMs, shown: document.getElementById('cno')?.textContent });
  }
  return { holes, toggles, strategyOn: window.V3D.caddie().strategyOn, settledBeforeStress };
});

const holeSync = stats(transitions.holes.map(item => item.syncMs));
const toggleSync = stats(transitions.toggles.map(item => item.syncMs));
const allHolesChanged = transitions.holes.every(item => Number(item.shown) === item.number);

const mainCanvas = page.locator('body > canvas').last();
const frameAt = async (hole, camera) => {
  await page.evaluate(([number, view]) => {
    window.V3D.goHole(number, true, true);
    window.V3D.setCam(view, true);
  }, [hole, camera]);
  await page.waitForTimeout(450);
  return decodePNG(await mainCanvas.screenshot({ timeout: 30_000 }));
};
const changedRatio = (a, b) => {
  const pixels = Math.min(a.width * a.height, b.width * b.height);
  let changed = 0;
  for (let index = 0; index < pixels; index++) {
    const ao = index * a.channels, bo = index * b.channels;
    const delta = Math.abs(a.data[ao] - b.data[bo])
      + Math.abs(a.data[ao + 1] - b.data[bo + 1])
      + Math.abs(a.data[ao + 2] - b.data[bo + 2]);
    if (delta > 30) changed++;
  }
  return changed / pixels;
};
const teeFrame = await frameAt(1, 'tee');
const movedFrame = await frameAt(1, 'top');
const nextHoleFrame = await frameAt(2, 'tee');
const cameraChange = changedRatio(teeFrame, movedFrame);
const holeChange = changedRatio(movedFrame, nextHoleFrame);

console.log(`info hole sync p95/max ${holeSync.p95.toFixed(2)}/${holeSync.max.toFixed(2)} ms`);
console.log(`info toggle sync p95/max ${toggleSync.p95.toFixed(2)}/${toggleSync.max.toFixed(2)} ms`);
console.log(`info main-canvas change camera ${(cameraChange * 100).toFixed(1)}%, next hole ${(holeChange * 100).toFixed(1)}%`);
gate(transitions.settledBeforeStress, 'Spellinje becomes idle after its short entrance');
gate(backend === (FORCE_GL ? 'webgl2' : 'webgpu'), `stress gate exercises the ${FORCE_GL ? 'WebGL2' : 'WebGPU'} backend`);
gate(allHolesChanged, 'consecutive next-hole changes complete with Spellinje on');
gate(holeSync.p95 < 100, 'strategy construction does not block a hole change');
gate(toggleSync.p95 < 100, 'repeated Spellinje toggles do not block input');
gate(transitions.strategyOn, 'toggle stress ends with an honest enabled state');
gate(cameraChange > 0.08, 'main 3D canvas updates after a camera move with Spellinje active');
gate(holeChange > 0.08, 'main 3D canvas updates after advancing to the next hole');
gate(errors.length === 0, `no page errors${errors.length ? ` — ${errors[0]}` : ''}`);

await browser.close();
