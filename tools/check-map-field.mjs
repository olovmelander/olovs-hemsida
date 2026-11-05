#!/usr/bin/env node
/* The map mode as it is used on a course: walking with GPS, measuring a shot,
 * standing idle, losing the graphics context and playing with no signal.
 *
 * pnpm --filter @banvy/golf build && node tools/serve.mjs apps/golf/dist 8620
 * BANVY_GPU=1 node tools/check-map-field.mjs [--url http://localhost:8620/] [--slug veckefjarden]
 *
 * Fails on any broken expectation or console error. Screenshots go to
 * tools/goldens/map/field/ (ignored). */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from './browser-args.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const BASE = flag('url', 'http://localhost:8620/'), SLUG = flag('slug', 'veckefjarden');
const OUT = path.resolve('tools/goldens/map/field');
fs.mkdirSync(OUT, { recursive: true });

const failures = [];
const expect = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what); };
const settled = page => page.waitForFunction(() => {
  const s = V3DMap.stats();
  return s.frames > 0 && s.busy === 0 && !V3DMap.state.flight && !V3DMap.state.opening;
}, null, { timeout: 60000, polling: 100 });
const note = async (page, label) => {
  if (args.includes('--trace')) console.log('  ' + label, JSON.stringify(await page.evaluate(() => {
    const c = V3DMap.camera.state, p = V3DMap.state.player;
    return { x: c.x, z: c.z, d: c.distance, patches: V3DMap.stats().patches, flight: Boolean(V3DMap.state.flight), mode: V3DMap.state.mode, player: p?.point, on: p?.onCourse };
  })));
};
const shot = async (page, name) => { await page.waitForTimeout(900); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); };

const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
const context = await browser.newContext({
  viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
  serviceWorkers: 'allow',
});
const page = await context.newPage();
const problems = [];
page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
page.on('pageerror', error => problems.push(error.message));
const refused = [];
page.on('requestfailed', request => refused.push(request.url()));

await page.goto(`${BASE}?bana=${SLUG}&karta=1&hal=3`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.V3DMap);
await settled(page);
await page.waitForTimeout(800);

/* ---- the engine stays out of it ---- */
const loaded = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => ({ name: entry.name, bytes: entry.encodedBodySize })));
const scripts = loaded.filter(entry => /\.js(\?|$)/.test(entry.name));
expect(!scripts.some(entry => /three[.-]|ghibli|v2-terrain/.test(entry.name)), `no 3D engine loaded (${scripts.length} scripts)`);

/* ---- idle: nothing draws ---- */
const framesBefore = (await page.evaluate(() => V3DMap.stats())).frames;
await page.waitForTimeout(2500);
const framesAfter = (await page.evaluate(() => V3DMap.stats())).frames;
expect(framesAfter === framesBefore, `an idle map draws no frames (${framesAfter - framesBefore} in 2.5 s)`);

/* ---- walking: a fix down the hole, from the tee toward the green ---- */
const walk = await page.evaluate(() => {
  const { course, state } = V3DMap;
  const hole = course.holes[state.hole - 1];
  return { tee: hole.line[0], green: hole.green.c, geo: course.geo };
});
const toLatLon = async (share, side = 0) => page.evaluate(([from, to, t, offset]) => {
  /* Back through the same frame the map reads a fix with, by search: there is no
     inverse in the app, and a fix only has to land on the spot. */
  const { course } = V3DMap;
  const x = from[0] + (to[0] - from[0]) * t + offset, z = from[1] + (to[1] - from[1]) * t;
  const { origin, mPerLon } = course.geo;
  let lat = origin.lat, lon = origin.lon;
  for (let i = 0; i < 40; i++) {
    const at = V3DMap.worldOf(lat, lon);
    lon += (x - at[0]) / mPerLon;
    lat -= (z - at[1]) / 111320;
  }
  return [lat, lon];
}, [walk.tee, walk.green, share, side]);

const expected = async share => page.evaluate(([from, to, t]) => {
  const x = from[0] + (to[0] - from[0]) * t, z = from[1] + (to[1] - from[1]) * t;
  return Math.hypot(to[0] - x, to[1] - z);
}, [walk.tee, walk.green, share]);

const fixAt = async share => {
  const [lat, lon] = await toLatLon(share);
  await page.evaluate(([a, b]) => V3DMap.fix(a, b, 5), [lat, lon]);
  await settled(page);
};
const midNumber = () => page.evaluate(() => Number(document.querySelector('[data-mid-number]').textContent));

await note(page, 'before fix');
await fixAt(0.25);
await note(page, 'fix 1');
const strip = () => page.evaluate(() => {
  const you = document.querySelector('[data-profile-you]');
  return { shown: !you.hidden, x: Number(you.style.getPropertyValue('--x')), share: Number(you.dataset.share), text: document.querySelector('[data-profile-text]').textContent };
});
const stripEarly = await strip();
const quarter = await midNumber(), wantQuarter = await expected(0.25);
expect(Math.abs(quarter - wantQuarter) <= 1, `distance to the green follows the fix (${quarter} m, expected ${wantQuarter.toFixed(1)} m)`);
await fixAt(0.75);
await note(page, 'fix 2');
const stripLate = await strip();
expect(stripEarly.shown && stripLate.shown, 'the player stands on the height strip');
expect(stripLate.share > stripEarly.share + 0.2 && stripEarly.share > 0.05, `and moves along the hole (${stripEarly.share} to ${stripLate.share} of it)`);
expect(stripEarly.x <= 0.2201 && stripLate.x <= 0.2201, `holding its place while the ground ahead spreads out (at ${stripLate.x})`);
const late = await midNumber(), wantLate = await expected(0.75);
expect(Math.abs(late - wantLate) <= 1, `and keeps following it (${late} m, expected ${wantLate.toFixed(1)} m)`);
expect(late < quarter, 'the number falls as the player walks to the green');
expect((await page.textContent('[data-from]')).includes('dig'), 'distances are from the player');
await shot(page, 'gps');

/* ---- measuring: tap the ground ---- */
const box = page.locator('.map-marks');
await box.tap({ position: { x: 160, y: 430 } });
await page.waitForTimeout(500);
const reading = await page.textContent('[data-reading]');
expect(/\d+ m/.test(reading) && /kvar/.test(reading), `a tap reads the shot: ${reading}`);
await note(page, 'measured');
expect(await page.evaluate(() => !document.querySelector('[data-profile-aim]').hidden), 'the measured point stands on the strip too');
await shot(page, 'measure');

/* ---- what lies ahead, the air, the card ---- */
const hazards = await page.evaluate(() => V3DMap.state.hazards);
expect(hazards.every(hazard => hazard.front > 0), `hazards ahead carry their distances (${hazards.length} on this hole)`);
await page.evaluate(() => V3DMap.setWeather({ windFromDeg: 0, windMs: 6, gustMs: 9, tempC: 12, code: 2, fetchedAt: Date.now(), source: 'test' }));
await page.waitForTimeout(250);
expect(await page.isVisible('[data-wind]'), 'the wind shows, with its arrow');
const windy = await page.textContent('[data-reading]');
expect(/spelas/.test(windy), `and the shot reads it: ${windy}`);

/* ---- a measuring point takes a drag, and an × ---- */
const aim = () => page.evaluate(() => { const p = V3DMap.state.target; const s = V3DMap.camera.project(p[0], V3DMap.heightAt(p[0], p[1]) * V3DMap.state.exaggeration, p[1]); return { x: s.x, y: s.y, target: [...p] }; });
const before = await aim();
await page.mouse.move(before.x, before.y);
await page.mouse.down();
await page.mouse.move(before.x + 30, before.y - 20, { steps: 4 });
await page.mouse.move(before.x + 60, before.y - 40, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(300);
const after = await aim();
expect(Math.hypot(after.target[0] - before.target[0], after.target[1] - before.target[1]) > 2, 'the measuring point follows a finger');
expect(await page.evaluate(() => !V3DMap.state.viewMoved), 'and the map stays where it was');
await page.click('[data-reading-close]');
expect(await page.evaluate(() => V3DMap.state.target === null && document.querySelector('[data-reading]').hidden), 'the × clears it');

/* ---- what lies ahead, in words ---- */
await page.click('[data-hole]');
expect(await page.isVisible('[data-hole-sheet]'), 'Hålet opens the hole');
expect(await page.locator('[data-hazard-list] li').count() === hazards.length, 'with the hazards ahead listed');
expect(await page.locator('[data-holes] button').count() === await page.evaluate(() => V3DMap.course.holes.length), 'and every hole a tap away');
const sheetBox = await page.locator('[data-hole-sheet] .map-sheet-head b').boundingBox();
await page.mouse.move(sheetBox.x + 40, sheetBox.y + 6);
await page.mouse.down();
await page.mouse.move(sheetBox.x + 40, sheetBox.y + 110, { steps: 6 });
await page.mouse.up();
expect(!(await page.isVisible('[data-hole-sheet]')), 'a sheet goes when it is pulled down');
await page.click('[data-hole-text]');
expect(await page.isVisible('[data-hole-sheet]'), 'the header opens it too');
await page.click('[data-hole]');

/* ---- off the shot, and back ---- */
expect(!(await page.isVisible('[data-recentre]')), 'nothing asks to go back while the view is on the shot');
await page.mouse.move(200, 420);
await page.mouse.down();
await page.mouse.move(120, 300, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(250);
expect(await page.isVisible('[data-recentre]'), 'moving the map offers the way back');
await page.click('[data-recentre]');
await settled(page);
expect(await page.evaluate(() => V3DMap.state.follow && !V3DMap.state.viewMoved), 'and it follows the player again');

/* ---- the quick views ---- */
const framing = () => page.evaluate(() => {
  const { tilt, bearing } = V3DMap.camera.state;
  const { state, course } = V3DMap;
  const green = course.holes[state.hole - 1].green.c, from = state.player.point;
  const wanted = Math.atan2(green[0] - from[0], -(green[1] - from[1]));
  return { tilt, off: Math.abs(Math.atan2(Math.sin(bearing - wanted), Math.cos(bearing - wanted))), pressed: document.querySelector('[data-views] [aria-pressed="true"]').dataset.view };
});
await page.click('[data-view="behind"]');
await settled(page);
const behind = await framing();
expect(behind.tilt > 1.1 && behind.off < 0.01 && behind.pressed === 'behind', `Bakom stands low behind the player, facing the green (tilt ${behind.tilt.toFixed(2)})`);
await shot(page, 'behind');
await fixAt(0.5);
const walked = await framing();
expect(walked.tilt > 1.1 && walked.off < 0.01, 'and stays lined up as the player walks');
await page.click('[data-view="above"]');
await settled(page);
const above = await framing();
expect(above.tilt < 0.1 && above.off < 0.01 && above.pressed === 'above', 'Ovan looks straight down, with play up the screen');
await shot(page, 'above');
await page.mouse.move(200, 420);
await page.mouse.down();
await page.mouse.move(120, 300, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(250);
await page.click('[data-view="hole"]');
await settled(page);
const framed = await framing();
expect(framed.tilt > 0.8 && framed.tilt < 1 && framed.off < 0.01, 'Hål brings a moved view back, and fingers still move it');
expect(await page.evaluate(() => localStorage.getItem('banvy-map-view-v1')) === 'hole', 'the view chosen is remembered');
const reliefBefore = await page.evaluate(() => V3DMap.state.exaggeration);
await page.click('[data-view="eye"]');
await settled(page);
await page.waitForTimeout(600);
const eyeView = () => page.evaluate(() => {
  const { state, camera, heightAt } = V3DMap, { eye } = camera.derived;
  return { relief: state.exaggeration, fov: camera.state.fov, above: eye[1] - heightAt(eye[0], eye[2]) * state.exaggeration, bearing: camera.state.bearing, along: Math.hypot(eye[0] - state.player.point[0], eye[2] - state.player.point[1]) };
});
const standing = await eyeView();
expect(standing.relief === 1 && standing.above > 1 && standing.above < 3 && standing.along < 1, `Min vy stands at the player on the true ground, ${standing.above.toFixed(1)} m up`);
await page.mouse.move(120, 420);
await page.mouse.down();
await page.mouse.move(60, 420, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(300);
const turned = await eyeView();
expect(Math.abs(turned.bearing - standing.bearing) > 0.02 && turned.along < 1, 'a finger turns the head and the feet stay put');
await page.locator('.map-marks').tap({ position: { x: 120, y: 420 } });
await page.waitForTimeout(500);
expect(await page.evaluate(() => Boolean(V3DMap.state.target)), 'a tap still measures, from eye level');
await page.click('[data-reading-close]');
await page.click('[data-view="hole"]');
await settled(page);
const backOnMap = await page.evaluate(() => ({ relief: V3DMap.state.exaggeration, fov: V3DMap.camera.state.fov, tilt: V3DMap.camera.state.tilt }));
expect(backOnMap.relief === reliefBefore && backOnMap.fov === 30 && backOnMap.tilt < 1, 'and Hela hålet goes back to the map as it was');
await page.click('[data-view="green"]');
await settled(page);
expect(await page.evaluate(() => V3DMap.state.greenView), 'Green opens the green');
await page.click('[data-view="hole"]');
await settled(page);
await fixAt(0.75);

/* ---- the green, close to ---- */
await page.click('[data-green]');
await settled(page);
await page.waitForTimeout(300);
const green = await page.evaluate(() => ({ view: V3DMap.state.greenView, distance: V3DMap.camera.state.distance, pulses: (V3DMap.state.greenGrid?.pulses.length ?? 0) / 13, lines: V3DMap.state.greenGrid?.indices.length ?? 0, marked: document.querySelector('[data-view="green"]').getAttribute('aria-pressed') }));
expect(green.view && green.distance < 250 && green.marked === 'true', `the numbers open the green (from ${Math.round(green.distance)} m)`);
expect(green.lines > 100 && green.pulses > 20, `and lay the greengrid over it, ${Math.round(green.pulses)} pulses`);
expect(/^Snitt \d/.test(await page.textContent('[data-hole-facts]')) && await page.isVisible('[data-legend]'), `with its slopes in words: ${await page.textContent('[data-hole-facts]')}`);
const gridFrames = (await page.evaluate(() => V3DMap.stats().frames));
await page.waitForTimeout(1000);
const gridRate = (await page.evaluate(() => V3DMap.stats().frames)) - gridFrames;
expect(gridRate > 8, `its pulses run on their own (${gridRate} frames in a second)`);
await shot(page, 'green');
await page.click('[data-green]');
await settled(page);
expect(await page.evaluate(() => !V3DMap.state.greenView && V3DMap.state.greenGrid === null), 'and take it away again');
const afterGrid = (await page.evaluate(() => V3DMap.stats().frames));
await page.waitForTimeout(800);
expect((await page.evaluate(() => V3DMap.stats().frames)) === afterGrid, 'and the map goes back to drawing nothing');

/* ---- the card ---- */
await page.click('[data-score]');
const parHere = await page.evaluate(() => V3DMap.course.holes[V3DMap.state.hole - 1].par);
await page.click(`[data-stroke-key="${parHere + 1}"]`);
await page.click('[data-putt-key="2"]');
if (parHere >= 4) await page.click('[data-fairway-key="hit"]');
await page.click('[data-handicap-more]');
const card = await page.evaluate(() => ({ round: V3DMap.round(), hole: V3DMap.state.hole, par: V3DMap.course.holes[V3DMap.state.hole - 1].par }));
expect(card.round.scores[card.hole].strokes === card.par + 1, 'the card takes a score in one tap');
expect(card.round.scores[card.hole].putts === 2, 'and the putts in another');
const scoreStored = await page.evaluate(slug => localStorage.getItem(`banvy-map-round-v1:${slug}`), SLUG);
expect(scoreStored?.includes('"strokes"'), 'and keeps them on the phone');
expect(/poäng/.test(await page.textContent('[data-score-sum]')), 'and adds up Stableford with a handicap');
expect((await page.textContent('[data-score-label]')).includes('+1'), 'the Score button shows how the round stands');
await page.click('[data-score]');

/* ---- the next tee ---- */
const onPoint = async point => {
  const [lat, lon] = await page.evaluate(([x, z]) => {
    const { origin, mPerLon } = V3DMap.course.geo;
    let latitude = origin.lat, longitude = origin.lon;
    for (let i = 0; i < 40; i++) {
      const at = V3DMap.worldOf(latitude, longitude);
      longitude += (x - at[0]) / mPerLon;
      latitude -= (z - at[1]) / 111320;
    }
    return [latitude, longitude];
  }, point);
  await page.evaluate(([a, b]) => V3DMap.fix(a, b, 5), [lat, lon]);
};
const played = await page.evaluate(() => V3DMap.state.hole);
const nextTee = await page.evaluate(n => V3DMap.course.holes[n].tees[0].point, played);
await onPoint(nextTee);
expect(await page.evaluate(() => V3DMap.state.hole) === played, 'walking onto the next tee changes nothing yet');
await page.evaluate(() => V3DMap.skipTime(21000));
await onPoint(nextTee);
await settled(page);
expect(await page.evaluate(() => V3DMap.state.hole) === played + 1, 'standing on it turns to that hole');
await page.click('[data-prev]');
await settled(page);
await page.evaluate(() => V3DMap.skipTime(21000));
await onPoint(nextTee);
await page.evaluate(() => V3DMap.skipTime(21000));
await onPoint(nextTee);
await settled(page);
expect(await page.evaluate(() => V3DMap.state.hole) === played, 'and a hole chosen by hand stays chosen');
/* The next green: holes can lie so close that mid-hole is on both. */
const midNext = await page.evaluate(n => V3DMap.course.holes[n].green.c, played);
await page.evaluate(() => V3DMap.skipTime(70000));
await onPoint(midNext);
await settled(page);
expect(await page.evaluate(() => V3DMap.state.hole) === played, 'a hole chosen by hand survives a phone put away');
await fixAt(0.75);
/* Tees side by side can settle it without the button. */
if (await page.isVisible('[data-recentre]')) await page.click('[data-recentre]');
await settled(page);
expect(await page.evaluate(() => V3DMap.state.playing) === played, 'the round button settles which hole is being played');
await page.evaluate(() => V3DMap.skipTime(70000));
await onPoint(midNext);
await settled(page);
expect(await page.evaluate(() => V3DMap.state.hole) === played + 1, 'a phone put away over a tee finds the hole again when it wakes');
await page.click('[data-prev]');
await settled(page);
await fixAt(0.75);
/* Tees side by side can settle it without the button. */
if (await page.isVisible('[data-recentre]')) await page.click('[data-recentre]');
await settled(page);
const [stillLat, stillLon] = await toLatLon(0.75);
expect(await page.evaluate(([a, b]) => { V3DMap.fix(a, b, 5); return !V3DMap.state.flight; }, [stillLat, stillLon]), 'a player standing still does not move the map');

/* ---- the club wheel ---- */
const wheelState = () => page.evaluate(() => ({ chosen: V3DMap.wheel(), suggested: document.querySelector('.map-wheel-row.is-suggested')?.dataset.club, count: V3DMap.shots().length, open: V3DMap.shots().at(-1) }));
const holdWheel = async () => {
  await page.evaluate(() => V3DMap.refix());
  const band = await page.locator('.map-wheel-band').boundingBox();
  await page.mouse.move(band.x + band.width / 2, band.y + band.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1050);
  await page.mouse.up();
  await page.waitForTimeout(250);
};
expect(await page.isVisible('[data-wheel]'), 'the club wheel is always on screen');
await page.evaluate(() => V3DMap.invalidate());
await page.waitForTimeout(900);
const rested = await wheelState();
expect(rested.chosen === rested.suggested && Boolean(rested.chosen), `it rests on the suggested club (${rested.chosen})`);
const logged = rested.count;
await holdWheel();
const first = await wheelState();
expect(first.count === logged + 1 && first.open.club === rested.chosen, 'a hold locks the club and the spot');
expect(await page.isVisible('[data-locked]'), 'and says so');
await page.click('[data-locked-undo]');
expect((await wheelState()).count === logged, 'Ångra takes it back');
await holdWheel();
await holdWheel();
expect(await page.isVisible('[data-same]') && (await wheelState()).count === logged + 1, 'a second hold on the same spot asks what happened');
await page.click('[data-same-out]');
const retaken = await page.evaluate(() => V3DMap.shots().slice(-2).map(shot => shot.outcome));
expect(retaken[0] === 'out' && retaken[1] === 'open', 'out of bounds goes again from the same spot, a stroke on');
await fixAt(0.9);
await page.waitForTimeout(400);
expect(/\d+ m/.test(await page.textContent('[data-wheel-hint]')), `the shot's length counts up on the walk: ${await page.textContent('[data-wheel-hint]')}`);
await holdWheel();
const landed = await page.evaluate(() => { const shot = V3DMap.shots().at(-2); return { outcome: shot.outcome, metres: Math.hypot(shot.to[0] - shot.from[0], shot.to[1] - shot.from[1]) }; });
expect(landed.outcome === 'played' && landed.metres > 20, `the next lock ends the shot, at ${Math.round(landed.metres)} m`);
expect(/\d+ m/.test(await page.textContent('[data-locked-text]')), `and the player sees what it did: ${await page.textContent('[data-locked-text]')}`);
/* The wrong club, found out later. */
const logRow = await page.evaluate(() => { const shot = V3DMap.shots().at(-2); return { club: shot.club, length: Math.hypot(shot.to[0] - shot.from[0], shot.to[1] - shot.from[1]) }; });
await page.click('[data-hole]');
await page.waitForSelector('[data-shots] button.map-shot');
expect(await page.isVisible('[data-shots-hint]'), 'the hole says how to put a club right');
const shotRows = page.locator('[data-shots] button.map-shot');
const thumbSized = await shotRows.nth(1).boundingBox();
expect(thumbSized.height >= 44, `a shot is a thumb's size to press (${Math.round(thumbSized.height)} px)`);
await shotRows.nth(1).click();
const wrongFirst = await page.locator('[data-shots] .map-chip[aria-pressed="true"]').count();
const rightClub = page.locator('[data-shots] .map-chip[aria-pressed="false"]').first();
const rightName = await rightClub.textContent();
expect(wrongFirst === 1, 'the bag opens under the shot, with its club marked');
const chipBox = await rightClub.boundingBox();
await page.mouse.move(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2);
await page.mouse.down();
await page.evaluate(() => V3DMap.refix());
await page.waitForTimeout(120);
await page.mouse.up();
await page.waitForTimeout(150);
const putRight = await page.evaluate(() => {
  const shot = V3DMap.shots().at(-2), stored = JSON.parse(localStorage.getItem('banvy-map-shots-v1')).shots.at(-2);
  return { club: shot.club, stored: stored.club, length: Math.hypot(shot.to[0] - shot.from[0], shot.to[1] - shot.from[1]), row: document.querySelectorAll('[data-shots] button.map-shot')[1].textContent, open: document.querySelectorAll('[data-shots] .map-chip').length };
});
expect(putRight.club !== logRow.club && putRight.stored === putRight.club, `a tap puts it right, even with a fix under the finger (${rightName})`);
expect(putRight.length === logRow.length && putRight.row.includes(rightName) && putRight.open === 0, 'the length stands, the row says the new club and the bag closes');
await page.click('[data-hole]');
const greenCentre = await page.evaluate(() => V3DMap.course.holes[V3DMap.state.hole - 1].green.c);
await onPoint(greenCentre);
await page.waitForTimeout(900);
const onGreen = await wheelState();
expect(onGreen.suggested === 'putter' && onGreen.chosen === 'putter', 'on the green the wheel turns to the putter by itself');
await holdWheel();
expect(await page.isVisible('[data-prompt]'), 'the putter asks for the putts');
await page.click('[data-putts-key="2"]');
const written = await page.evaluate(() => ({ score: V3DMap.round().scores[V3DMap.state.hole], tally: V3DMap.shots().filter(shot => shot.hole === V3DMap.state.hole && shot.round === V3DMap.round().id).length }));
expect(written.score.putts === 2 && written.score.strokes === card.par + 1, `and the score entered by hand stays: ${written.score.strokes}, with the log at ${written.tally}`);
await page.evaluate(() => { delete V3DMap.round().scores[V3DMap.state.hole]; });
await holdWheel();
await page.click('[data-putts-key="2"]');
const logged2 = await page.evaluate(() => ({ score: V3DMap.round().scores[V3DMap.state.hole], tally: V3DMap.shots().filter(shot => shot.hole === V3DMap.state.hole && shot.round === V3DMap.round().id).length }));
expect(logged2.score.logged && logged2.score.strokes >= logged2.tally, `with none, the score writes itself: ${logged2.score.strokes}`);
await fixAt(0.75);

/* ---- the next hole, the whole course ---- */
const hole = await page.evaluate(() => V3DMap.state.hole);
await page.click('[data-next]');
await settled(page);
expect(await page.evaluate(() => V3DMap.state.hole) === hole + 1, 'the next hole opens');
expect(!(await page.isVisible('[data-prompt]')), 'a hole with a score does not ask for one');
await page.click('[data-next]');
await settled(page);
expect(await page.isVisible('[data-prompt]'), 'a hole left without a score asks for it');
const skipped = await page.evaluate(() => Number(document.querySelector('[data-prompt]').dataset.asked));
await page.click('[data-prompt-keys] .is-par');
expect(await page.evaluate(hole => Number.isFinite(V3DMap.round().scores[hole]?.strokes), skipped), 'and takes it in one tap');
expect(!(await page.isVisible('[data-prompt]')), 'and goes');
const barBox = await page.locator('[data-hole-title]').boundingBox();
const swipeHole = await page.evaluate(() => V3DMap.state.hole);
await page.mouse.move(barBox.x + 60, barBox.y + 10);
await page.mouse.down();
await page.mouse.move(barBox.x - 40, barBox.y + 10, { steps: 6 });
await page.mouse.up();
await settled(page);
expect(await page.evaluate(() => V3DMap.state.hole) === swipeHole + 1, 'a swipe along the header turns to the next hole');
expect(!(await page.isVisible('[data-hole-sheet]')), 'and opens nothing');
await page.click('[data-prev]');
await settled(page);
expect(await page.evaluate(() => Number.isFinite(V3DMap.camera.state.x) && V3DMap.stats().patches < 120), 'the camera frames it from close in on the last green');
await note(page, 'next hole');
await page.click('[data-overview]');
await settled(page);
expect(await page.evaluate(() => V3DMap.state.mode) === 'course', 'the overview opens');
await note(page, 'overview');
await shot(page, 'overview');
await note(page, 'overview shot');

/* ---- the light ---- */
const lightState = () => page.evaluate(() => ({ key: V3DMap.state.lightKey, light: V3DMap.state.light.key, sun: V3DMap.state.light.sun, autumn: V3DMap.state.light.autumn, pressed: document.querySelector('[data-now]').getAttribute('aria-pressed') }));
await page.click('[data-menu]');
await page.locator('[data-light]').scrollIntoViewIfNeeded();
await page.click('[data-light]');
expect(await page.isVisible('[data-light-sheet]'), 'Ljus lives in the menu and opens its picker');
expect(await page.locator('[data-lights] button').count() === 11, 'with Nu, the simulator\'s nine lights and a winter');
await page.click('[data-lights] [data-key="host"]');
await page.waitForTimeout(250);
const autumn = await lightState();
expect(autumn.key === 'host' && autumn.autumn === 1, 'Höst turns the leaves');
await page.click('[data-now]');
await page.waitForTimeout(250);
const sunNow = await lightState();
expect(sunNow.key === 'nu' && sunNow.pressed === 'true', `Nu takes the sun of this moment ${JSON.stringify(sunNow.sun.map(n => +n.toFixed(2)))}`);
await page.click('[data-now]');
await page.waitForTimeout(250);
expect((await lightState()).pressed === 'false', 'and lets it go again');
await page.click('[data-light-back]');
await page.click('[data-clubs-open]');
expect(await page.isVisible('[data-clubs-sheet]') && await page.locator('[data-clubs] li').count() > 5, 'Mina klubbor lists the bag');
await page.click('[data-clubs-back]');
expect(await page.isVisible('[data-menu-sheet]'), 'the picker goes back to Meny');
await page.click('[data-menu]');
expect(!(await page.isVisible('[data-menu-sheet]')), 'and Meny closes');
const stillDrawing = await page.evaluate(() => V3DMap.stats().frames);
await page.waitForTimeout(1500);
expect((await page.evaluate(() => V3DMap.stats().frames)) === stillDrawing, 'a light costs nothing while nothing moves');

/* ---- on its side, the widest view of a hole: the map has to come to rest ---- */
await page.setViewportSize({ width: 800, height: 360 });
await page.evaluate(() => { V3DMap.goHole(3); });
await settled(page);
await page.waitForTimeout(600);
const sideways = (await page.evaluate(() => V3DMap.stats().frames));
await page.waitForTimeout(1500);
const sidewaysFrames = (await page.evaluate(() => V3DMap.stats().frames)) - sideways;
expect(sidewaysFrames === 0, `on its side the map comes to rest, with every tile it wants (${sidewaysFrames} frames in 1.5 s)`);
await page.setViewportSize({ width: 412, height: 915 });
await settled(page);

/* ---- a lost graphics context comes back ---- */
await page.evaluate(() => {
  const gl = document.querySelector('.map-ground').getContext('webgl2');
  const loser = gl.getExtension('WEBGL_lose_context');
  globalThis.mapLoser = loser;
  loser.loseContext();
});
await page.waitForTimeout(300);
await note(page, 'lost');
await page.evaluate(() => globalThis.mapLoser.restoreContext());
await page.waitForTimeout(500);
await settled(page);
await page.evaluate(() => V3DMap.invalidate());
await page.waitForTimeout(600);
await note(page, 'restored');
const restored = await page.evaluate(() => V3DMap.stats());
expect(restored.patches > 0 && restored.patches < 120, `the map redraws after a lost context (${restored.patches} patches)`);
const view = restored.camera;
expect(['x', 'y', 'z', 'distance', 'bearing', 'tilt'].every(key => Number.isFinite(view[key])), `the camera survives it ${JSON.stringify(view)}`);

/* ---- no signal ---- */
await page.click('[data-overview]');
await settled(page);
await page.click('[data-menu]');
const saved = page.waitForFunction(() => document.querySelector('[data-download]').textContent === 'Sparad', null, { timeout: 120000 });
await page.click('[data-download]');
await saved;
const held = await page.evaluate(async () => (await (await caches.open('banvy-map-offline-v1')).keys()).length);
expect(held > 20, `the course is saved (${held} files)`);
const worker = await page.evaluate(async () => {
  const registration = await navigator.serviceWorker?.ready;
  return Boolean(registration?.active);
});
if (worker) {
  await page.waitForTimeout(1500);
  await context.setOffline(true);
  await page.goto(`${BASE}?bana=${SLUG}&karta=1&hal=9`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.V3DMap, null, { timeout: 30000 });
  await settled(page);
  const offline = await page.evaluate(() => V3DMap.stats());
  expect(offline.failures === 0 && offline.metreTiles > 0, `a saved course opens with no signal, on 1 m tiles (${offline.metreTiles} tiles, ${offline.failures} failures)`);
  await shot(page, 'offline');
  await context.setOffline(false);
} else console.log('skip offline check: no service worker on this server');

/* ---- a tab lost in the pocket ---- */
await context.grantPermissions(['geolocation']);
await page.evaluate(() => V3DMap.goHole(7, { fly: false }));
await page.goto(`${BASE}?bana=${SLUG}&karta=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => globalThis.V3DMap, null, { timeout: 30000 });
await settled(page);
expect(await page.evaluate(() => V3DMap.state.hole) === 7, 'a reopened map comes back to the hole it was on');
await page.waitForTimeout(400);
expect(await page.getAttribute('[data-gps]', 'aria-pressed') === 'true', 'and with the GPS on, the permission being given');

/* ---- what a course link opens ---- */
const isMap = target => target.evaluate(() => document.body.classList.contains('course-map'));
const phone = await context.newPage();
await phone.goto(`${BASE}?bana=${SLUG}`, { waitUntil: 'domcontentloaded' });
await phone.waitForFunction(() => document.body.classList.contains('course-map') || Boolean(globalThis.V3D), null, { timeout: 60000 });
expect(await isMap(phone), 'a plain course link opens the map on a phone');
await phone.waitForSelector('[data-full][href]', { state: 'attached', timeout: 60000 });
const detailed = new URL(await phone.getAttribute('[data-full]', 'href'), BASE).href;
expect(detailed.includes(`bana=${SLUG}`) && detailed.includes('karta=0'), `the 3D button says so: ${detailed}`);
await phone.goto(detailed, { waitUntil: 'domcontentloaded' });
await phone.waitForFunction(() => document.body.classList.contains('course-map') || globalThis.V3D, null, { timeout: 120000 });
expect(!(await isMap(phone)) && await phone.evaluate(() => Boolean(globalThis.V3D)), 'the 3D button opens the detailed course on a phone, and stays there');
await phone.goto(`${BASE}?bana=${SLUG}&det=1&gl=1`, { waitUntil: 'domcontentloaded' });
await phone.waitForFunction(() => document.body.classList.contains('course-map') || globalThis.V3D, null, { timeout: 120000 });
expect(!(await isMap(phone)), 'a link that asks for the player still gets it on a phone');
await phone.goto(BASE, { waitUntil: 'domcontentloaded' });
await phone.waitForSelector('.card-map', { timeout: 60000, state: 'attached' });
expect((await phone.textContent('.card-map')) === '3D', 'the chooser offers a phone the detailed course');
await phone.close();
const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const desktop = await desktopContext.newPage();
await desktop.goto(`${BASE}?bana=${SLUG}`, { waitUntil: 'domcontentloaded' });
await desktop.waitForFunction(() => document.body.classList.contains('course-map') || globalThis.V3D, null, { timeout: 120000 });
expect(!(await isMap(desktop)), 'a computer still opens the detailed course');
await desktop.goto(BASE, { waitUntil: 'domcontentloaded' });
await desktop.waitForSelector('.card-map', { timeout: 60000, state: 'attached' });
expect((await desktop.textContent('.card-map')) === 'Karta', 'and its chooser offers the map');
await desktopContext.close();

console.log(refused.length ? `requests refused: ${[...new Set(refused)].slice(0, 8).join(' ')}` : 'no requests refused');
/* The service worker's own loader is not in its precache; by then the worker is
   running, so this one refusal offline changes nothing. Any other still fails. */
const harmless = refused.length > 0 && refused.every(url => url.endsWith('/registerSW.js') || url.includes('api.open-meteo.com'));
if (harmless) problems.splice(0, problems.length, ...problems.filter(text => !text.includes('ERR_INTERNET_DISCONNECTED')));
expect(!problems.length, `no console errors${problems.length ? `: ${problems.slice(0, 4).join(' | ')}` : ''}`);
await browser.close();
process.exit(failures.length ? 1 : 0);
