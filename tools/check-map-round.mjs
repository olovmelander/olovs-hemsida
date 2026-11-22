/* Course chooser → mobile GPS play → score → home Continue. Run against a
   production build with: node tools/check-map-round.mjs http://127.0.0.1:8620/ */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from './browser-args.mjs';

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:8620/');
const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
const slug = 'upsala';
const errors = [];
const wait = (page, predicate, argument) => page.waitForFunction(predicate, argument, { timeout: 60000, polling: 100 });
const tap = (page, selector) => page.locator(selector).tap();
const sheet = '#courseSheet';
const round = page => page.evaluate(() => structuredClone(V3DMap.round()));
const storedRound = page => page.evaluate(course => JSON.parse(localStorage.getItem('banvy-map-round-v1:' + course)), slug);
const choices = page => page.evaluate(course => ({
  tee: localStorage.getItem('banvy-map-tee-v1:' + course), handicap: localStorage.getItem('banvy-map-handicap-v1'),
}), slug);
const visited = [];

async function phone() {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce',
    permissions: ['geolocation'], geolocation: { latitude: 0, longitude: 0, accuracy: 4 },
  });
  await context.addInitScript(() => {
    localStorage.setItem('banvy-map-quality-v1', '3');
    localStorage.setItem('banvy-map-hint-v1', '1');
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      const params = new URL(request.url()).searchParams;
      if (params.has('runda')) visited.push({ intent: params.get('runda'), hole: params.get('hal') });
    }
  });
  return { page, context };
}

async function courseCard(page) {
  await page.goto(new URL('#karta', base).href, { waitUntil: 'domcontentloaded' });
  await tap(page, `#chooser .card[data-slug="${slug}"]`);
  await page.locator(sheet + '[open]').waitFor();
}

async function launch(page, button, intent, hole) {
  const before = visited.length;
  await tap(page, button);
  await wait(page, () => globalThis.V3DMap?.state.guidance);
  assert.deepEqual(visited.slice(before), [{ intent, hole }]);
}

async function start(page, hole) {
  await courseCard(page);
  await tap(page, `#courseSheet label:has(input[name="cs-hole"][value="${hole}"])`);
  await tap(page, '#courseSheet label:has(input[name="cs-tee"][value="1"])');
  await page.locator('#courseSheet [data-hcp]').fill('17');
  await launch(page, '#courseSheet [data-go]', '1', String(hole));
  await wait(page, n => V3DMap.round().begunAt && V3DMap.round().playingHole === n && V3DMap.state.hole === n, hole);
  assert.deepEqual(await choices(page), { tee: '1', handicap: '17' });
}

async function gpsAtTee(page, context, hole) {
  const fix = await page.evaluate(number => {
    const { course, state } = V3DMap;
    const tees = course.holes[number - 1].tees;
    const [east, south] = course.frame.toPack(...(tees[state.tee] ?? tees[0]).point);
    return { latitude: course.geo.origin.lat - south / 111320, longitude: course.geo.origin.lon + east / course.geo.mPerLon, accuracy: 4 };
  }, hole);
  await context.setGeolocation(fix);
  await wait(page, ({ latitude, longitude }) => {
    const { state } = V3DMap;
    const [x, z] = V3DMap.worldOf(latitude, longitude);
    return state.player?.onCourse && state.guidance?.source === 'gps'
      && Math.hypot(state.player.point[0] - x, state.player.point[1] - z) < 1;
  }, fix);
  return fix;
}

try {
  const first = await phone();
  await courseCard(first.page);
  const initial = await choices(first.page);
  await first.page.getByRole('button', { name: 'Spara för offline' }).waitFor();
  assert.match(await first.page.locator('#courseSheet [data-offline-status]').innerText(), /inte sparad/);
  await tap(first.page, '#courseSheet label:has(input[name="cs-hole"][value="10"])');
  await tap(first.page, '#courseSheet label:has(input[name="cs-tee"][value="1"])');
  await first.page.locator('#courseSheet [data-hcp]').fill('17');
  await launch(first.page, '#courseSheet [data-look]', 'visa', '10');
  assert.equal(await first.page.evaluate(() => V3DMap.state.hole), 10);
  assert.equal(await first.page.evaluate(() => V3DMap.state.tee), 1);
  assert.ok(!(await round(first.page)).begunAt);
  assert.equal(await first.page.locator('[data-gps]').getAttribute('aria-pressed'), 'false');
  assert.deepEqual(await choices(first.page), initial);
  console.log('Course preview opens on 10 without starting GPS or saving the edited setup.');
  await first.page.reload({ waitUntil: 'domcontentloaded' });
  await wait(first.page, () => globalThis.V3DMap?.state.hole === 10);
  assert.ok(!(await round(first.page)).begunAt);
  assert.equal(await first.page.locator('[data-gps]').getAttribute('aria-pressed'), 'false');
  await start(first.page, 1);
  console.log('A preview survives refresh without starting GPS or saving setup. Starting on 1 then plays hole 1.');
  const green = await first.page.evaluate(() => {
    const { course } = V3DMap;
    const [east, south] = course.frame.toPack(...course.holes[0].green.c);
    return { latitude: course.geo.origin.lat - south / 111320, longitude: course.geo.origin.lon + east / course.geo.mPerLon, accuracy: 4 };
  });
  await first.context.setGeolocation(green);
  await wait(first.page, () => V3DMap.wheel() === 'putter' && V3DMap.state.guidance.source === 'gps');
  await tap(first.page, '[data-wheel-lock]');
  await first.context.setGeolocation(green);
  await tap(first.page, '[data-putts-key="2"]');
  const partial = (await storedRound(first.page)).scores[1];
  assert.equal(partial.putts, 2);
  assert.equal(partial.strokes, null);
  assert.equal(await first.page.locator('[data-score-label]').innerText(), 'Score');
  assert.match(await first.page.locator('[data-prompt-title]').innerText(), /2 puttar.*slag totalt/);
  await first.page.reload({ waitUntil: 'domcontentloaded' });
  await first.page.locator('[data-prompt-key="5"]').waitFor();
  await tap(first.page, '[data-prompt-key="5"]');
  assert.equal((await storedRound(first.page)).scores[1].strokes, 5);
  assert.equal((await storedRound(first.page)).scores[1].putts, 2);
  console.log('A putter-only hole keeps two putts, asks for total strokes, and resumes that choice after reload.');
  await first.context.close();

  const preview = await phone();
  const previewURL = new URL(base);
  previewURL.search = new URLSearchParams({ bana: slug, karta: '1', hal: '18', runda: 'visa', utm_source: 'hole-guide' });
  await preview.page.goto(previewURL.href, { waitUntil: 'domcontentloaded' });
  await wait(preview.page, () => globalThis.V3DMap?.state.hole === 18 && V3DMap.state.guidance);
  const railAction = preview.page.locator('[data-wheel-lock]');
  const startSheet = preview.page.locator('[data-start-sheet]');
  assert.match(await railAction.innerText(), /^Starta runda\b/);
  const untouched = await storedRound(preview.page);
  const originalChoices = await choices(preview.page);
  const scoreTool = preview.page.locator('[data-score]');
  await scoreTool.tap();
  await startSheet.waitFor();
  assert.equal(await startSheet.locator('[data-start-hole="18"]').getAttribute('aria-pressed'), 'true');
  assert.ok(await preview.page.locator('[data-score-sheet]').isHidden());
  await preview.page.goBack();
  await startSheet.waitFor({ state: 'hidden' });
  assert.ok(await scoreTool.evaluate(button => button === document.activeElement));
  assert.deepEqual(await storedRound(preview.page), untouched);
  assert.equal(await preview.page.locator('[data-gps]').getAttribute('aria-pressed'), 'false');
  await railAction.tap();
  await startSheet.waitFor();
  assert.equal(await startSheet.locator('[data-start-hole="18"]').getAttribute('aria-pressed'), 'true');
  await startSheet.locator('[data-start-tees] button[aria-pressed="false"]').first().tap();
  await startSheet.locator('[data-start-more]').tap();
  const draftTee = await startSheet.locator('[data-start-tees] button[aria-pressed="true"]').innerText();
  const draftHandicap = await startSheet.locator('[data-start-handicap]').innerText();
  await preview.page.goBack();
  await startSheet.waitFor({ state: 'hidden' });
  assert.equal(await preview.page.locator('[data-gps]').getAttribute('aria-pressed'), 'false');
  assert.deepEqual(await storedRound(preview.page), untouched);
  assert.deepEqual(await choices(preview.page), originalChoices, 'cancelling discards the draft tee and handicap');
  assert.equal(await preview.page.evaluate(() => V3DMap.shots().length), 0);
  await preview.page.goForward();
  await startSheet.waitFor();
  assert.equal(await startSheet.locator('[data-start-tees] button[aria-pressed="true"]').innerText(), draftTee);
  assert.equal(await startSheet.locator('[data-start-handicap]').innerText(), draftHandicap);
  await startSheet.locator('.map-sheet-head [data-close]').tap();
  await startSheet.waitFor({ state: 'hidden' });
  assert.deepEqual(await choices(preview.page), originalChoices, 'closing the restored setup leaves the saved preferences alone');
  await railAction.tap();
  await startSheet.locator('[data-start-go]').tap();
  await wait(preview.page, () => V3DMap.round().begunAt && V3DMap.round().playingHole === 18 && V3DMap.state.hole === 18);
  assert.match(await railAction.innerText(), /^Logga\b/);
  assert.match(await railAction.getAttribute('aria-label'), /^Logga slag\b/);
  assert.equal(await preview.page.evaluate(() => V3DMap.shots().length), 0);
  // A guide link previews hole 7 while the player's existing card is on 18.
  const started = await round(preview.page);
  previewURL.searchParams.set('hal', '7');
  await preview.page.goto(previewURL.href, { waitUntil: 'domcontentloaded' });
  await wait(preview.page, () => globalThis.V3DMap?.state.hole === 7 && V3DMap.state.previewOnly);
  await scoreTool.tap();
  assert.match(await preview.page.locator('[data-score-title]').innerText(), /^Hål 18\b/);
  await tap(preview.page, '[data-stroke-key="4"]');
  const scored = await storedRound(preview.page);
  assert.equal(scored.id, started.id);
  assert.equal(scored.playingHole, 18);
  assert.equal(scored.scores[18].strokes, 4);
  assert.equal(scored.scores[7], undefined);
  await preview.context.close();
  console.log('A tagged preview on hole 18 starts only after confirmation; Back cancels without GPS or a saved shot.');

  const { page, context } = await phone();
  await start(page, 10);
  console.log('Course setup starts a new round on 10 with the chosen tee and handicap.');
  const original = await round(page);
  const coordinate = await gpsAtTee(page, context, 10);
  await tap(page, '[data-hole]');
  await tap(page, '[data-measure-hazard="0"]');
  await wait(page, () => V3DMap.state.guidance.mode === 'manual' && V3DMap.state.guidance.recommendedClub);
  const pin = await page.evaluate(() => [...V3DMap.state.guidance.target]);
  await page.locator('[data-wheel-list]').press('ArrowDown');
  await wait(page, () => Boolean(V3DMap.state.manualClub));
  await tap(page, '[data-club-auto]');
  await wait(page, () => !V3DMap.state.manualClub && V3DMap.wheel() === V3DMap.state.guidance.recommendedClub.id);
  assert.deepEqual(await page.evaluate(() => V3DMap.state.guidance.target), pin);

  const mapAddress = page.url();
  const clubsSheet = page.locator('[data-clubs-sheet]');
  const menuSheet = page.locator('[data-menu-sheet]');
  await tap(page, '[data-menu]');
  await tap(page, '[data-menu-tab="visning"]');
  assert.ok(await page.locator('[data-lights] button').first().isVisible());
  await tap(page, '[data-menu-tab="runda"]');
  await tap(page, '[data-clubs-open]');
  await clubsSheet.waitFor();
  await page.goBack();
  await menuSheet.waitFor();
  assert.equal(await page.locator('[data-menu-tab="runda"]').getAttribute('aria-selected'), 'true');
  assert.ok(await page.locator('[data-clubs-open]').evaluate(button => button === document.activeElement));
  await page.goForward();
  await clubsSheet.waitFor();
  await page.keyboard.press('Escape');
  await menuSheet.waitFor();
  await page.goBack();
  await menuSheet.waitFor({ state: 'hidden' });
  assert.ok(await page.locator('[data-menu]').evaluate(button => button === document.activeElement));
  await tap(page, '[data-view-toggle]');
  await page.goBack();
  await page.locator('[data-view-menu]').waitFor({ state: 'hidden' });
  await page.goForward();
  await page.locator('[data-view-menu]').waitFor();
  await tap(page, '[data-view="above"]');
  await page.locator('[data-view-menu]').waitFor({ state: 'hidden' });
  assert.equal(page.url(), mapAddress);
  assert.deepEqual(await page.evaluate(() => ({
    id: V3DMap.round().id, hole: V3DMap.state.playing, target: V3DMap.state.guidance?.target, shots: V3DMap.shots().length,
  })), { id: original.id, hole: 10, target: pin, shots: 0 }, 'nested navigation preserves the active round and pinned shot');
  console.log('Native Back and Forward traverse the menu, light sheet and camera options without leaving the measured shot.');
  await context.setGeolocation(coordinate);
  await tap(page, '[data-wheel-lock]');
  await wait(page, () => Boolean(V3DMap.shots()[0]?.aim));
  const loggedAim = await page.evaluate(() => V3DMap.shots()[0].aim);
  assert.equal(loggedAim.mode, 'manual');
  assert.deepEqual(loggedAim.target, pin);
  assert.equal(loggedAim.selectedClub, loggedAim.recommendedClub);
  await tap(page, '[data-locked-undo]');
  await tap(page, '[data-reading-close]');
  await wait(page, () => V3DMap.state.guidance.mode === 'auto');
  assert.equal((await page.evaluate(() => V3DMap.shots())).length, 0);
  console.log('Changing back to the suggested club keeps the measured target. Automatic aim resumes without logging a shot.');

  await tap(page, '[data-next]');
  await wait(page, () => V3DMap.state.hole === 11 && V3DMap.state.playing === 10);
  await tap(page, '[data-score]');
  assert.match(await page.locator('[data-score-title]').innerText(), /^Hål 10\b/);
  const par = await page.evaluate(() => V3DMap.course.holes[9].par);
  await tap(page, `[data-stroke-key="${par + 1}"]`);
  await tap(page, '[data-putt-key="2"]');
  await page.goBack();
  await page.locator('[data-score-sheet]').waitFor({ state: 'hidden' });
  await page.goForward();
  await page.locator('[data-score-sheet]').waitFor();
  assert.match(await page.locator('[data-score-title]').innerText(), /^Hål 10\b/);
  await tap(page, '[data-score-sheet] [data-close]');
  let record = await storedRound(page);
  assert.equal(record.scores[10].strokes, par + 1);
  assert.equal(record.scores[11], undefined);

  await context.setGeolocation(coordinate);
  await wait(page, () => V3DMap.state.player?.onCourse);
  const log = page.getByRole('button', { name: /^Logga slag/ });
  await log.tap();
  await wait(page, () => V3DMap.shots().length === 1);
  assert.equal(await page.evaluate(() => V3DMap.shots()[0].hole), 10);
  assert.equal(await page.evaluate(() => V3DMap.shots()[0].aim), undefined);
  await tap(page, '[data-score]');
  await tap(page, `[data-stroke-key="${par + 2}"]`);
  await tap(page, '[data-score-sheet] [data-close]');
  await tap(page, '[data-locked-undo]');
  assert.equal(await page.evaluate(() => V3DMap.shots().length), 0);
  record = await storedRound(page);
  assert.equal(record.scores[10].strokes, par + 2);
  assert.equal(record.scores[10].putts, 2);
  assert.equal(record.scores[11], undefined);
  console.log('While previewing 11, score and shot belong to 10. Undo removes the shot and preserves later hand-entered score.');

  await context.setGeolocation(coordinate);
  await log.tap();
  await wait(page, () => V3DMap.shots().length === 1);
  await log.tap();
  await page.locator('[data-same]').waitFor();
  const before = await page.evaluate(() => ({ shots: V3DMap.shots(), scores: V3DMap.round().scores }));
  await page.evaluate(() => V3DMap.skipTime(22000));
  if (await page.locator('[data-same-shot]').isVisible()) await tap(page, '[data-same-shot]');
  assert.deepEqual(await page.evaluate(() => ({ shots: V3DMap.shots(), scores: V3DMap.round().scores })), before);
  console.log('A stale same-location confirmation leaves both shots and score intact.');

  await tap(page, '[data-menu]');
  await tap(page, '[data-menu-sheet] [data-home]');
  await page.locator('#home:visible').waitFor();
  const resume = page.locator('#home [data-resume]');
  await resume.waitFor();
  assert.match(await resume.getAttribute('aria-label'), /Hål 10\b/);
  await launch(page, '#home [data-resume]', 'fortsatt', null);
  await wait(page, () => V3DMap.state.hole === 10 && V3DMap.state.playing === 10);
  assert.equal((await round(page)).id, original.id);
  assert.equal(await page.evaluate(() => V3DMap.shots().filter(shot => shot.hole === 10).length), 1);
  assert.deepEqual(await choices(page), { tee: '1', handicap: '17' });

  await courseCard(page);
  assert.match(await page.locator('#courseSheet [data-go]').innerText(), /Fortsätt rundan/);
  assert.ok(!(await page.locator('#courseSheet [data-hcp]').isVisible()));
  await launch(page, '#courseSheet [data-go]', 'fortsatt', null);
  await tap(page, '[data-next]');
  await tap(page, '[data-score]');
  assert.match(await page.locator('[data-score-title]').innerText(), /^Hål 10\b/);
  await tap(page, '[data-score-done]');
  await wait(page, () => V3DMap.round().playingHole === 11 && V3DMap.state.hole === 11);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await wait(page, () => globalThis.V3DMap?.state.hole === 11 && V3DMap.round().playingHole === 11);
  record = await storedRound(page);
  assert.equal(record.id, original.id);
  assert.equal(record.scores[10].strokes, par + 2);
  assert.equal(record.scores[11], undefined);
  assert.equal(await page.evaluate(() => V3DMap.shots()[0].hole), 10);
  console.log('Home and course Continue return to 10. Finishing its score while viewing 11 advances once and survives refresh.');

  await tap(page, '[data-next]');
  await tap(page, '[data-hole]');
  await tap(page, '[data-play-hole]');
  await wait(page, () => V3DMap.round().playingHole === 12);
  assert.equal((await storedRound(page)).playingHole, 12);
  assert.equal((await round(page)).scores[10].strokes, par + 2);
  assert.equal(await page.evaluate(() => V3DMap.shots().length), 1);
  console.log('Explicitly playing previewed hole 12 preserves the previous score and shot.');
  if (await page.locator('[data-gps]').getAttribute('aria-pressed') === 'false') await tap(page, '[data-gps]');
  const playing = (await round(page)).playingHole;
  const next = await page.evaluate(n => n % V3DMap.course.holes.length + 1, playing);
  await gpsAtTee(page, context, playing);
  const lastOrigin = await page.evaluate(() => V3DMap.state.guidance.origin);
  const session = await context.newCDPSession(page);
  const { targetInfo } = await session.send('Target.getTargetInfo');
  const permission = setting => session.send('Browser.setPermission', {
    permission: { name: 'geolocation' }, setting, origin: base.origin, browserContextId: targetInfo.browserContextId,
  });
  await permission('denied');
  await wait(page, () => V3DMap.state.guidance.source === 'last-gps' && document.querySelector('[data-gps-label]').textContent === 'Tillåt GPS');
  assert.deepEqual(await page.evaluate(() => V3DMap.state.guidance.origin), lastOrigin);
  await tap(page, '[data-next]');
  await tap(page, '[data-hole]');
  await tap(page, '[data-play-hole]');
  await wait(page, n => V3DMap.state.playing === n && V3DMap.state.guidance.source === 'tee', next);
  await permission('granted');
  await tap(page, '[data-gps]');
  await gpsAtTee(page, context, next);
  await wait(page, () => document.querySelector('[data-gps-label]').textContent === '±4 m');
  assert.equal(await page.evaluate(() => V3DMap.shots().length), 1);
  console.log('Revoking permission retains the last position on its own hole. The next hole previews from its tee, and GPS resumes after regrant.');

  const imported = { course: 'visby', round: 123, hole: 7, at: 120, club: 'wedge', from: [0, 0], to: [0, 85], outcome: 'played' };
  await page.evaluate(shot => {
    const key = 'banvy-map-shots-v1';
    const log = JSON.parse(localStorage.getItem(key));
    log.shots.unshift(shot);
    localStorage.setItem(key, JSON.stringify(log));
    const clubs = [{ id: 'wedge', name: 'Min wedge', carry: 93 }, { id: 'putter', name: 'Putter', carry: 0 }];
    localStorage.setItem('banvy-caddie-bag-v1', JSON.stringify({ version: 3, clubs }));
    window.dispatchEvent(new CustomEvent('banvy-sync-changed', { detail: { changed: true } }));
  }, imported);
  await wait(page, () => document.querySelector('[data-wheel]').textContent.includes('Min wedge'));
  const fresh = await gpsAtTee(page, context, next);
  await tap(page, '[data-wheel-lock]');
  await context.setGeolocation(fresh);
  await wait(page, () => V3DMap.shots().some(shot => shot.hole === V3DMap.state.playing && shot.course === 'upsala'));
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('banvy-map-shots-v1')).shots);
  assert.deepEqual(persisted.find(shot => shot.course === imported.course), imported);
  console.log('A bag and a shot imported during play survive the next GPS shot on the played course.');

  assert.deepEqual(errors, []);
  await context.close();
} finally {
  await browser.close();
}
