import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, serviceWorkers: 'block' });
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:5180/golfer-study.html?character=female');
  await page.waitForFunction(() => window.GOLFER_STUDY, undefined, { timeout: 60000 });
  const state = await page.evaluate(async () => {
    const study = window.GOLFER_STUDY, old = study.golfer;
    old.root.position.set(.4, 0, -.3); old.root.rotation.y = .25;
    old.play('SwingWood', { fade: 0 }); old.seek(.9); old.paused = true; old.rate = .35;
    const disposed = { geometries: 0, materials: 0, textures: 0 };
    const gs = new Set(), ms = new Set(), ts = new Set();
    old.root.traverse(o => { if (o.isMesh) { gs.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) ms.add(m); } });
    for (const m of ms) for (const value of Object.values(m)) if (value?.isTexture) ts.add(value);
    for (const [items, key] of [[gs, 'geometries'], [ms, 'materials'], [ts, 'textures']]) {
      for (const item of items) item.addEventListener('dispose', () => disposed[key]++);
    }
    await study.selectCharacter('male');
    const next = study.golfer;
    return { character: next.character, clip: next.current, club: next.club, time: next.time, paused: next.paused, rate: next.rate, position: next.root.position.toArray(), yaw: next.root.rotation.y, oldRemoved: !old.root.parent, disposed, counts: { geometries: gs.size, materials: ms.size, textures: ts.size } };
  });
  assert.equal(state.character, 'male'); assert.equal(state.clip, 'SwingWood'); assert.equal(state.club, 'Wood');
  assert(Math.abs(state.time - .9) < 1e-5); assert.equal(state.paused, true); assert.equal(state.rate, .35);
  assert.deepEqual(state.position, [.4, 0, -.3]); assert(Math.abs(state.yaw - .25) < 1e-5);
  assert(state.oldRemoved); assert.deepEqual(state.disposed, state.counts); assert(state.counts.textures > 0);
  assert.equal(await page.locator('[data-character=male]').getAttribute('aria-pressed'), 'true');
  assert.match(page.url(), /character=male/);
  checks.push('Switch preserves pose, playback, club, position and heading; disposes prior geometry, materials and textures');

  await page.route('**/golfer.json', route => route.fulfill({ status: 503, body: 'Simulated unavailable model' }));
  await page.locator('[data-character=female]').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Could not switch'));
  assert.equal(await page.evaluate(() => GOLFER_STUDY.golfer.character), 'male');
  await page.unroute('**/golfer.json');
  checks.push('A failed load retains the current golfer and presents a retryable message');

  await page.route('**/golfer.json', async route => { await new Promise(resolve => setTimeout(resolve, 200)); await route.continue(); });
  const final = await page.evaluate(async () => {
    const study = GOLFER_STUDY;
    await Promise.all([study.selectCharacter('female'), study.selectCharacter('male'), study.selectCharacter('female')]);
    return { id: study.golfer.character, actors: study.scene.children.filter(o => o.name === 'Banvy golfer').length };
  });
  assert.deepEqual(final, { id: 'female', actors: 1 });
  await page.unroute('**/golfer.json');
  checks.push('Rapid selection keeps only the most recently requested character');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-character=male]').click();
  await page.waitForFunction(() => GOLFER_STUDY.golfer.character === 'male');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  checks.push('Both character buttons work at a 390px viewport');

  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto('http://127.0.0.1:5180/?bana=puttom&golfer=1&character=male&ghibli=1&ljus=dag&q=lo&skylt=0',{waitUntil:'domcontentloaded',timeout:180000});
  await page.waitForFunction(() => window.BANVY_GOLFER && document.querySelector('#boot')?.classList.contains('done'), undefined, { timeout: 180000 });
  await page.evaluate(() => BANVY_GOLFER.golfer.selectClub('Putter', false));
  await page.locator('[data-address]').click();
  const before = await page.evaluate(() => { const g = BANVY_GOLFER.golfer; g.paused = true; return g.root.position.toArray(); });
  await page.locator('.golfer-course [data-character]').selectOption('female');
  await page.waitForFunction(() => BANVY_GOLFER.golfer.character === 'female');
  const course = await page.evaluate(() => { const g = BANVY_GOLFER.golfer; return { position: g.root.position.toArray(), club: g.club, clip: g.current }; });
  assert.deepEqual(course.position, before); assert.equal(course.club, 'Putter'); assert.equal(course.clip, 'AddressPutter');
  checks.push('Course selector swaps both designs without moving the actor or losing the selected club');
  await page.route('**/golfer-male.json', async route => { await new Promise(resolve => setTimeout(resolve, 350)); await route.continue(); });
  await page.locator('.golfer-course [data-character]').selectOption('male');
  await page.locator('.golfer-course [data-close]').click();
  await page.waitForTimeout(1000);
  assert(await page.evaluate(() => BANVY_GOLFER.closed && !BANVY_GOLFER.golfer.root.parent));
  checks.push('Closing during a pending switch does not resurrect the actor');
  assert.deepEqual(errors, []);
  await writeFile('docs/graphics/golfer-2026-09-16/verification-pair.json', JSON.stringify({ checks, errors, verifiedAt: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally { await browser.close(); }
