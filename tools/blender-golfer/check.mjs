import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';
const out = 'docs/graphics/golfer-2026-09-16';
const character = process.argv[2] === 'male' ? 'male' : 'female';
const prefix = character === 'male' ? 'golfer-male' : 'golfer';
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(`http://127.0.0.1:5180/golfer-study.html?character=${character}`);
  await page.waitForFunction(() => window.GOLFER_STUDY, undefined, { timeout: 60000 });
  const animations = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.webgpu.js');
    const { golfer } = window.GOLFER_STUDY;
    const results = [];
    golfer.paused = false;
    for (const clip of golfer.manifest.clips) {
      golfer.play(clip.name, { fade: 0 });
      let hits = 0; golfer.onImpact = () => hits++;
      for (let t = 0; t <= clip.duration + .3; t += .025) golfer.update(.025);
      const box = new THREE.Box3();
      for (const time of [0, .2, .43, .59, .82, .99]) {
        golfer.seek(time * clip.duration); golfer.root.updateMatrixWorld(true);
        golfer.root.traverse(o => {
          if (!o.isSkinnedMesh) return;
          o.skeleton.update();
          for (let i = 0; i < o.geometry.attributes.position.count; i += 17) {
            box.expandByPoint(o.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(o.matrixWorld));
          }
        });
      }
      results.push({ name: clip.name, hits, expectedHits: clip.impact == null ? 0 : 1, contact: clip.contact, bounds: { min: box.min.toArray(), max: box.max.toArray() } });
    }
    return results;
  });
  assert.equal(animations.length, 20);
  for (const a of animations) {
    assert.equal(a.hits, a.expectedHits, `${a.name}: exactly one impact per stroke`);
    assert(a.bounds.min.every(Number.isFinite) && a.bounds.max.every(Number.isFinite));
    assert(a.bounds.min[1] > -.4 && a.bounds.max[1] < 3.4, `${a.name}: skin must stay in human proportions`);
    assert(a.bounds.max[0] - a.bounds.min[0] < 3.5, `${a.name}: no exploded limb weights`);
    if (a.contact) assert(a.contact[1] >= 0 && a.contact[1] <= .07, `${a.name}: club head must reach the ball`);
  }
  checks.push('All 20 clips, sampled skin bounds, and exactly one impact for each of five strokes');
  for (const club of ['Driver', 'Wood', 'Iron', 'Wedge', 'Putter']) {
    const state = await page.evaluate(id => {
      const g = window.GOLFER_STUDY.golfer;
      g.paused = false; g.selectClub(id); g.update(2); g.swing();
      return { club: g.club, visible: [...g.clubMeshes].filter(([, o]) => o.visible).map(([name]) => name), clip: g.current };
    }, club);
    assert.equal(state.club, club); assert.deepEqual(state.visible, [club]);
  }
  checks.push('Club changes finish correctly and expose exactly one club');
  await page.evaluate(() => { const g = window.GOLFER_STUDY.golfer; g.play('Idle', { fade: 0 }); g.paused = false; });
  const before = await page.evaluate(() => window.GOLFER_STUDY.golfer.root.position.toArray());
  await page.locator('#stage canvas').click({ position: { x: 15, y: 220 } });
  await page.keyboard.down('w'); await page.waitForTimeout(500); await page.keyboard.up('w');
  const after = await page.evaluate(() => window.GOLFER_STUDY.golfer.root.position.toArray());
  assert(Math.hypot(...after.map((n, i) => n - before[i])) > .1);
  checks.push('Desktop keyboard walking changes world position');
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('#reset').click();
  await page.screenshot({ path: `${out}/${prefix}-mobile.png` });
  checks.push('390px mobile layout has no horizontal overflow');
  if (!process.argv.includes('--studio-only')) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://127.0.0.1:5180/?bana=puttom&golfer=1&character=${character}&ghibli=1&ljus=dag&q=lo&skylt=0`,{waitUntil:'domcontentloaded',timeout:180000});
  await page.waitForFunction(() => window.BANVY_GOLFER && document.querySelector('#boot')?.classList.contains('done'), undefined, { timeout: 180000 });
  const courseBefore = await page.evaluate(() => window.BANVY_GOLFER.golfer.root.position.toArray());
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.down('w');
  try {
    await page.waitForFunction(before => {
      const p = BANVY_GOLFER.golfer.root.position;
      return Math.hypot(p.x - before[0], p.z - before[2]) > .10;
    }, courseBefore, { timeout: 20000 });
  } finally { await page.keyboard.up('w'); }
  const courseAfter = await page.evaluate(() => { const g = window.BANVY_GOLFER.golfer; return { p:g.root.position.toArray(), ground:V3D.probeH(g.root.position.x,g.root.position.z) }; });
  assert(Math.hypot(courseAfter.p[0] - courseBefore[0], courseAfter.p[2] - courseBefore[2]) > .08);
  assert(Math.abs(courseAfter.p[1] - courseAfter.ground) < .03);
  await page.screenshot({ path: `${out}/${prefix}-on-course.png` });
  await page.locator('[data-address]').click(); await page.locator('[data-swing]').click();
  await page.waitForTimeout(1900);
  assert.equal(await page.evaluate(() => BANVY_GOLFER.golfer.current), 'SwingIron');
  checks.push('Puttom walking follows rendered terrain and a club-specific swing plays');
  await page.locator('[data-close]').click();
  assert(await page.evaluate(() => BANVY_GOLFER.closed));
  assert.equal(await page.locator('.golfer-course').count(), 0);
  checks.push('Closing the preview releases the actor and controls');
  }
  assert.deepEqual(errors, []);
  const report = { character, checks, animations, errors, verifiedAt: new Date().toISOString() };
  await writeFile(`${out}/verification-${process.argv.includes('--studio-only')?'studio-':''}${character}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally { await browser.close(); }
