#!/usr/bin/env node
/* The mouse and the keyboard in the detailed course, measured in the real app
 * (apps/golf/src/ui/camera-navigation.mjs).
 *
 * node tools/serve.mjs apps/golf/dist 8620
 * BANVY_GPU=1 node tools/check-camera-navigation.mjs [--course slug[,slug]] [--base url] [--out dir] [--query a=b]
 *
 * Trusted browser input (Playwright's mouse, wheel and keyboard) on the booted
 * course, at 1600 x 900 under the 60 Hz cap. Every gesture is made twice on
 * the same page and from the same view: with the navigation on, and with
 * BANVY_NAV.setEnabled(false), which is the stock orbit controls. So the
 * stock numbers in the table are measured here, not remembered.
 *
 * What is measured:
 *   drag       a 200 px left drag in one step: how long until the view has
 *              half and nine tenths of its turn, and how far the ground the
 *              hand took hold of ends from where it was taken
 *   pan        a right drag: how far the ground taken hold of ends from the cursor
 *   zoom       five wheel notches: how far the ground under the cursor ends
 *              from it, and the largest share of the whole travel in one frame
 *   look       a left drag on the far ground from a tee: how far the eye moved
 *   walk       W held from a tee: the distance, the eye's height above the
 *              ground, its largest frame-to-frame change of vertical step, and
 *              the lift the ground clamp is left owed
 *   above      from straight above: W goes up the picture, and the wheel
 *              still holds the ground under the cursor
 *   takeover   a drag, the wheel and a key each stop a view's tween, and a
 *              drag a flight
 *
 * The navigation's own numbers are gated; the stock ones are the comparison.
 * A SwiftShader run (no BANVY_GPU) checks the behaviour but its timings are
 * not a frame rate: the latency gate is skipped there.                       */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from './browser-args.mjs';

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const BASE = flag('base', 'http://127.0.0.1:8620').replace(/\/$/, '');
const OUT = path.resolve(flag('out', 'tools/goldens/navigation'));
const QUERY = flag('query', '');
const courses = flag('course', 'puttom').split(',');
const VIEW = { width: 1600, height: 900 };
if (!GPU) console.warn('WARN: BANVY_GPU is not 1; this is a SwiftShader run, and its timings are not gated');
fs.mkdirSync(OUT, { recursive: true });

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const hyp = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

/* The page's own measuring: three's projection, the drawn ground, one sample a rendered frame. */
function instrument() {
  const { camera, controls } = window.V3D.harness();
  const Vec = camera.position.constructor, canvas = document.querySelector('body > canvas');
  const above = (o, d, t) => o.y + d.y * t - window.V3D.groundAt(o.x + d.x * t, o.z + d.z * t);
  const groundUnder = (x, y) => {
    camera.updateMatrixWorld(true);
    const r = canvas.getBoundingClientRect(), o = camera.position.clone();
    const d = new Vec((x - r.left) / r.width * 2 - 1, 1 - (y - r.top) / r.height * 2, 0.5).unproject(camera).sub(o).normalize();
    let near = 0;
    for (let t = 0.5; t < 6000; t += Math.max(0.5, t * 0.01)) {
      if (above(o, d, t) <= 0) {
        let far = t;
        for (let i = 0; i < 24; i++) { const m = (near + far) / 2; if (above(o, d, m) <= 0) far = m; else near = m; }
        return [o.x + d.x * far, o.y + d.y * far, o.z + d.z * far, far];
      }
      near = t;
    }
    return null;
  };
  const screen = p => {
    camera.updateMatrixWorld(true);
    const v = new Vec(p[0], p[1], p[2]).project(camera), r = canvas.getBoundingClientRect();
    return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height];
  };
  let log = null, moved = null;
  const tick = () => {
    if (log && log.at(-1)?.f !== window.V3D.frame()) log.push({ t: performance.now(), f: window.V3D.frame(),
      p: camera.position.toArray(), l: controls.target.toArray(), g: window.V3D.groundAt(camera.position.x, camera.position.z) });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  for (const type of ['pointermove', 'wheel', 'keydown']) addEventListener(type, e => { if (log && moved === null && (type !== 'pointermove' || e.buttons)) moved = e.timeStamp; }, true);
  window.__nav = { groundUnder, screen,
    record() { log = []; moved = null; }, stop() { const out = { log, moved }; log = null; return out; },
    onCanvas: (x, y) => document.elementFromPoint(x, y) === canvas,
    pose: () => ({ p: camera.position.toArray(), l: controls.target.toArray() }) };
}

const heading = s => Math.atan2(s.l[0] - s.p[0], -(s.l[2] - s.p[2]));
const turnBetween = (a, b) => { let d = heading(b) - heading(a); while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d * 180 / Math.PI; };
/* seconds after the hand moved until `share` of the whole change was drawn */
function reached(run, value, share) {
  const total = value(run.log.at(-1));
  if (Math.abs(total) < 1e-9) return null;
  const hit = run.log.find(s => Math.abs(value(s)) >= Math.abs(total) * share);
  return +((hit.t - run.moved) / 1000).toFixed(3);
}

async function measure(page, slug) {
  const rows = {};
  const frames = async (n = 3) => { const f = await page.evaluate(() => window.V3D.frame()); await page.waitForFunction(({ f, n }) => window.V3D.frame() >= f + n, { f, n }, { polling: 30 }); };
  const view = async (cam, hole = 1) => {
    await page.mouse.move(40, 40);
    await page.evaluate(({ cam, hole }) => { window.V3D.goHole(hole, false); window.V3D.setCam(cam, true); }, { cam, hole });
    await frames(4);
  };
  const on = async x => { if (!await page.evaluate(([x, y]) => window.__nav.onCanvas(x, y), x)) throw new Error(`(${x}) is not on the canvas`); };
  const ground = at => page.evaluate(([x, y]) => window.__nav.groundUnder(x, y), at);
  const screen = p => page.evaluate(p => window.__nav.screen(p), p);
  const record = () => page.evaluate(() => window.__nav.record());
  const stop = () => page.evaluate(() => window.__nav.stop());

  for (const mode of ['new', 'stock']) {
    await page.evaluate(on => window.BANVY_NAV.setEnabled(on), mode === 'new');
    const row = rows[mode] = {};

    /* ---- drag: the opening view, the hand takes the ground a little under the middle */
    {
      await view('orbit');
      const from = [800, 540], to = [1000, 540];
      await on(from);
      const held = await ground(from);
      await page.mouse.move(...from);
      await record();
      await page.mouse.down();
      await page.mouse.move(...to);
      await wait(1500);
      await page.mouse.up();
      await wait(900);
      const run = await stop();
      const first = run.log[0], turn = s => turnBetween(first, s);
      row.drag = { degrees: +turn(run.log.at(-1)).toFixed(2), half: reached(run, turn, 0.5), ninth: reached(run, turn, 0.9),
        heldMetres: held ? +held[3].toFixed(1) : null, heldOffPixels: held ? +hyp(await screen(held), from).toFixed(1) : null };
    }

    /* ---- pan */
    {
      await view('orbit');
      const from = [800, 580], to = [1040, 500];
      await on(from);
      const held = await ground(from), before = await page.evaluate(() => window.__nav.pose());
      await page.mouse.move(...from);
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(...to, { steps: 12 });
      await wait(1500);
      await page.mouse.up({ button: 'right' });
      await wait(900);
      const after = await page.evaluate(() => window.__nav.pose());
      row.pan = { heldOffPixels: held ? +hyp(await screen(held), to).toFixed(1) : null,
        travelled: +hyp(after.p, before.p).toFixed(2), rose: +(after.p[1] - before.p[1]).toFixed(3) };
    }

    /* ---- zoom */
    {
      await view('orbit');
      const at = [1100, 600];
      await on(at);
      await page.mouse.move(...at);
      await frames(2);
      const held = await ground(at);
      await record();
      for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -100); await wait(60); }
      await wait(1500);
      const run = await stop();
      const steps = run.log.slice(1).map((s, i) => hyp(s.p, run.log[i].p)), total = hyp(run.log.at(-1).p, run.log[0].p);
      row.zoom = { heldOffPixels: held ? +hyp(await screen(held), at).toFixed(1) : null, travelled: +total.toFixed(2),
        closed: held ? +(1 - hyp(run.log.at(-1).p, held) / hyp(run.log[0].p, held)).toFixed(3) : null,
        largestFrameShare: +(Math.max(...steps) / total).toFixed(3), movingFrames: steps.filter(s => s > total * 1e-4).length };
    }

    /* ---- look: from the tee, the hand on the far ground */
    {
      await view('tee');
      const from = [800, 470], to = [1100, 470];
      await on(from);
      const held = await ground(from), before = await page.evaluate(() => window.__nav.pose());
      await page.mouse.move(...from);
      await page.mouse.down();
      await page.mouse.move(...to, { steps: 15 });
      await wait(1500);
      await page.mouse.up();
      await wait(900);
      const after = await page.evaluate(() => window.__nav.pose());
      row.look = { heldMetres: held ? +held[3].toFixed(1) : null, eyeMoved: +hyp(after.p, before.p).toFixed(3),
        degrees: +turnBetween(before, after).toFixed(2) };
    }

    /* ---- walk */
    {
      await view('tee');
      await record();
      await page.keyboard.down('w');
      await wait(4000);
      await page.keyboard.up('w');
      await wait(1500);
      const run = await stop(), log = run.log;
      const clear = log.map(s => s.p[1] - s.g);
      let kick = 0;
      for (let i = 2; i < log.length; i++) kick = Math.max(kick, Math.abs((log[i].p[1] - log[i - 1].p[1]) - (log[i - 1].p[1] - log[i - 2].p[1])));
      row.walk = { metres: +Math.hypot(log.at(-1).p[0] - log[0].p[0], log.at(-1).p[2] - log[0].p[2]).toFixed(2),
        groundFell: +(log[0].g - log.at(-1).g).toFixed(2), eyeLowest: +Math.min(...clear).toFixed(3), eyeHighest: +Math.max(...clear).toFixed(3),
        eyeAtEnd: +clear.at(-1).toFixed(3), kick: +kick.toFixed(4),
        firstFrameShare: log.length > 3 ? +(Math.hypot(log[1].p[0] - log[0].p[0], log[1].p[2] - log[0].p[2]) * 60 / 5).toFixed(3) : null,
        liftOwed: await page.evaluate(() => window.V3D.groundClamp().lift), frames: log.length };
    }

    /* ---- above: looking straight down, where a heading has to come from the picture itself */
    {
      await view('top');
      const at = [800, 450];
      await on(at);
      await page.mouse.move(...at);
      await frames(2);
      const held = await ground(at);
      await page.keyboard.down('w');
      await wait(700);
      await page.keyboard.up('w');
      await wait(700);
      const walked = held ? await screen(held) : null;
      const under = await ground(at);
      for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -100); await wait(60); }
      await wait(1200);
      const pose = await page.evaluate(() => window.__nav.pose());
      row.above = { wentDownThePicture: walked ? +(walked[1] - at[1]).toFixed(1) : null, wentAcross: walked ? +(walked[0] - at[0]).toFixed(1) : null,
        heldOffPixels: under ? +hyp(await screen(under), at).toFixed(1) : null, finite: pose.p.concat(pose.l).every(Number.isFinite) };
    }

    /* ---- takeover: each of the hand's ways in stops a view's tween where it is */
    {
      row.takeover = {};
      for (const how of ['drag', 'wheel', 'key']) {
        await view('orbit');
        const destination = await page.evaluate(() => { window.V3D.setCam('green', true); const d = window.__nav.pose(); window.V3D.setCam('orbit', true); return d; });
        await frames(3);
        await page.mouse.move(800, 540);
        await page.evaluate(() => window.V3D.setCam('green'));
        await wait(300);
        if (how === 'drag') { await page.mouse.down(); await page.mouse.move(830, 545); await page.mouse.up(); }
        else if (how === 'wheel') await page.mouse.wheel(0, -100);
        else { await page.keyboard.down('d'); await wait(80); await page.keyboard.up('d'); }
        await wait(1800);
        const after = await page.evaluate(() => ({ pose: window.__nav.pose(), settled: window.V3D.settled() }));
        row.takeover[how] = { metresFromDestination: +hyp(after.pose.p, destination.p).toFixed(1), settled: after.settled };
      }
      /* and a hole's flight, which keeps its pose and its lens for the hand */
      await view('orbit');
      await page.mouse.move(800, 540);
      await page.evaluate(() => window.V3D.fly());
      await wait(1200);
      const flying = await page.evaluate(() => window.V3D.flightState().flying);
      await page.mouse.down(); await page.mouse.move(820, 540); await page.mouse.up();
      await wait(600);
      row.takeover.flight = { wasFlying: flying > 0, flying: await page.evaluate(() => window.V3D.flightState().flying) };
      await view('orbit');
    }
  }
  await page.evaluate(() => window.BANVY_NAV.setEnabled(true));
  rows.said = await page.evaluate(() => ({ hint: document.getElementById('hint')?.textContent,
    rows: [...document.querySelectorAll('#navRows .sc-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim()) }));
  await page.screenshot({ path: path.join(OUT, `${slug}-end.png`) });
  return rows;
}

function judge(rows) {
  const n = rows.new, s = rows.stock, problems = [];
  const gate = (ok, text) => { if (!ok) problems.push(text); };
  gate(Math.abs(n.drag.degrees) > 20, `the drag turned the view ${n.drag.degrees} degrees`);
  if (GPU) gate(n.drag.ninth !== null && n.drag.ninth <= 0.3, `nine tenths of a drag took ${n.drag.ninth} s (stock ${s.drag.ninth} s)`);
  gate(n.drag.heldOffPixels !== null && n.drag.heldOffPixels <= 3, `the ground a drag took hold of ended ${n.drag.heldOffPixels} px away`);
  gate(n.pan.heldOffPixels !== null && n.pan.heldOffPixels <= 3 && Math.abs(n.pan.rose) < 0.5, `the ground a pan took hold of ended ${n.pan.heldOffPixels} px from the cursor, the eye ${n.pan.rose} m higher`);
  gate(n.zoom.heldOffPixels !== null && n.zoom.heldOffPixels <= 3, `the ground under the wheel ended ${n.zoom.heldOffPixels} px from the cursor`);
  gate(n.zoom.closed > 0.4 && n.zoom.closed < 0.5, `five notches closed ${n.zoom.closed} of the way`);
  gate(n.zoom.largestFrameShare <= 0.15, `one frame drew ${n.zoom.largestFrameShare} of the zoom`);
  gate(n.look.eyeMoved < 0.01 && Math.abs(n.look.degrees) > 10, `looking round from the tee moved the eye ${n.look.eyeMoved} m and turned it ${n.look.degrees} degrees`);
  gate(n.walk.metres > 14 && n.walk.metres < 22, `W walked ${n.walk.metres} m in four seconds`);
  gate(n.walk.eyeLowest > 1.15 && n.walk.eyeHighest < 3 && Math.abs(n.walk.eyeAtEnd - 1.7) < 0.35, `walking, the eye was ${n.walk.eyeLowest} to ${n.walk.eyeHighest} m above the ground, ${n.walk.eyeAtEnd} m at the end`);
  gate(n.walk.kick < 0.02, `the eye's height stepped ${n.walk.kick} m between frames`);
  gate(n.walk.liftOwed < 0.3, `the ground clamp is left owed ${n.walk.liftOwed} m`);
  gate(s.walk.metres < 0.1, `with the navigation off W still walked ${s.walk.metres} m`);
  gate(n.above.finite && n.above.wentDownThePicture > 40 && Math.abs(n.above.wentAcross) < 5 && n.above.heldOffPixels <= 3,
    `from above, W took the ground ${n.above.wentDownThePicture} px down the picture and ${n.above.wentAcross} px across, and the wheel left its ground ${n.above.heldOffPixels} px off`);
  gate(n.takeover.flight.wasFlying && n.takeover.flight.flying === 0, `a drag did not take the camera from a flight (${JSON.stringify(n.takeover.flight)})`);
  for (const how of ['drag', 'wheel', 'key']) gate(n.takeover[how].metresFromDestination > 5 && n.takeover[how].settled, `a ${how} did not take the camera from a tween (${JSON.stringify(n.takeover[how])})`);
  gate(/W A S D/.test(rows.said.hint || '') && rows.said.rows.length >= 6, `the hint and the menu do not say it (${JSON.stringify(rows.said)})`);
  return problems;
}

const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
const report = { when: new Date().toISOString(), gpu: GPU, base: BASE, viewport: VIEW, courses: {} };
let failed = 0;
for (const slug of courses) {
  const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + String(e).split('\n')[0].slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !(m.location()?.url ?? '').endsWith('/api/health')) errors.push(m.text().split('\n')[0].slice(0, 300)); });
  const url = `${BASE}/?bana=${slug}&hal=1&vy=fritt&ljus=dag&q=hi&qualitylock=1${QUERY ? '&' + QUERY : ''}`;
  let problems;
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 300000 });
    await page.waitForSelector('#boot.done', { timeout: 300000 });
    await page.waitForFunction(() => window.BANVY_NAV, null, { timeout: 60000 });
    await page.evaluate(instrument);
    const rows = await measure(page, slug);
    problems = judge(rows);
    if (errors.length) problems.push(`${errors.length} console error(s): ${errors[0]}`);
    report.courses[slug] = { url, rows, problems };
    const cell = (v, unit = '') => (v === null || v === undefined ? '-' : `${v}${unit}`).padStart(9);
    console.log(`\n${slug}${' '.repeat(Math.max(1, 44 - slug.length))}${'new'.padStart(9)}${'stock'.padStart(9)}`);
    const line = (label, pick, unit) => console.log(`  ${label.padEnd(42)}${cell(pick(rows.new), unit)}${cell(pick(rows.stock), unit)}`);
    line('drag: half of the turn after', r => r.drag.half, ' s');
    line('drag: nine tenths of it after', r => r.drag.ninth, ' s');
    line('drag: the ground held ends off by', r => r.drag.heldOffPixels, ' px');
    line('pan: the ground held ends off the cursor', r => r.pan.heldOffPixels, ' px');
    line('pan: the eye rose', r => r.pan.rose, ' m');
    line('zoom: the ground under the cursor off by', r => r.zoom.heldOffPixels, ' px');
    line('zoom: five notches close', r => r.zoom.closed);
    line('zoom: largest share in one frame', r => r.zoom.largestFrameShare);
    line('zoom: frames it is drawn over', r => r.zoom.movingFrames);
    line('look from the tee: the eye moved', r => r.look.eyeMoved, ' m');
    line('look from the tee: turned', r => r.look.degrees, '°');
    line('walk: W for four seconds', r => r.walk.metres, ' m');
    line('walk: the eye above the ground, lowest', r => r.walk.eyeLowest, ' m');
    line('walk: the eye above the ground, highest', r => r.walk.eyeHighest, ' m');
    line('walk: largest change of step in the eye', r => r.walk.kick, ' m');
    line('walk: the clamp left owed', r => +r.walk.liftOwed.toFixed(3), ' m');
    line('above: W takes the ground down the picture', r => r.above.wentDownThePicture, ' px');
    line('above: the ground under the wheel off by', r => r.above.heldOffPixels, ' px');
    for (const how of ['drag', 'wheel', 'key']) line(`a ${how} takes a tween: off its end by`, r => r.takeover[how].metresFromDestination, ' m');
    line('a drag takes a flight: still flying', r => r.takeover.flight.flying);
  } catch (error) {
    problems = [String(error).split('\n')[0]];
    report.courses[slug] = { url, problems, errors };
  }
  if (problems.length) { failed++; console.log('  FAIL\n   ' + problems.join('\n   ')); } else console.log('  ok');
  await page.close();
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(failed ? `\n${failed} of ${courses.length} courses failed` : `\nall ${courses.length} courses pass`);
process.exit(failed ? 1 : 0);
