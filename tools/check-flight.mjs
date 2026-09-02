/* The bansafari, measured instead of watched.

   Boots a course in the built app on a local server, asks the page to
   SIMULATE every hole's broadcast flight offline (`V3D.flightSim`, the same
   station table and the same springs the frame loop walks, stepped at 60 Hz)
   and gates what a viewer would see as a fault:

   - clearance: the camera never comes within CLEAR_MIN of the terrain
   - pan rate: the yaw never turns faster than PAN_MAX degrees per second
   - acceleration: no jolt above ACC_MAX m/s^2 after the first half second
     (a level flight that pops over a crown it did not know about reads as a
     bump; this is the number that caught it)
   - pitch: the frame centre stays between PITCH_MIN and PITCH_MAX degrees
     below the horizon -- never looking up, never looking straight down
   - duration: a hole's shot takes between DUR_MIN and DUR_MAX seconds

   Holes 2-18 are simulated WITH the travel shot from the previous hole's
   reverse angle in front of them, the way the tour flies them, so the turn
   away from the green and the arrival behind the next tee are measured too.

   Optionally flies one hole LIVE and photographs it at intervals, and runs the
   whole-course tour through its first transition to check that there is no
   cut -- the camera moves continuously from hole 1 into hole 2, the card is
   off during the travel and back for the tee -- and that the lens returns on
   exit.

   usage: node tools/serve.mjs apps/golf/dist 8631 &
          BANVY_GPU=1 node tools/check-flight.mjs [--base http://127.0.0.1:8631]
              [--course puttom,angso] [--live 12] [--tour] [--out dir]

   The default is SwiftShader, which boots in minutes; BANVY_GPU=1 uses the
   real adapter (see tools/browser-args.mjs). Exits non-zero on any gate.  */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : (args[i + 1] ?? true); };
const BASE = flag('base', 'http://127.0.0.1:8631');
const COURSES = String(flag('course', 'puttom')).split(',').filter(Boolean);
const LIVE = flag('live', null);
const TOUR = args.includes('--tour');
const OUT = flag('out', path.join('geobuild', 'shots', 'flight'));
fs.mkdirSync(OUT, { recursive: true });

const CLEAR_MIN = 12, PAN_MAX = 20, ACC_MAX = 40, PITCH_MIN = 4, PITCH_MAX = 42, DUR_MIN = 24, DUR_MAX = 80, JUMP_MAX = 35;
let failures = 0;
const fail = msg => { failures++; console.log('  FAIL ' + msg); };

const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
for (const slug of COURSES) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(300000);
  const problems = [];
  page.on('pageerror', e => problems.push('pageerror: ' + String(e).split('\n')[0].slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) problems.push('console: ' + m.text().slice(0, 300)); });
  await page.goto(`${BASE}/?bana=${slug}&det=1&ljus=kvall`, { waitUntil: 'load' });
  await page.waitForSelector('#boot.done', { timeout: 420000 });
  await page.waitForTimeout(1500);

  const sims = await page.evaluate(() => {
    const out = [];
    for (let h = 1; h <= 18; h++) {
      const s = window.V3D.flightSim(h, 1 / 60, h > 1);
      if (!s) { out.push({ hole: h, missing: true }); continue; }
      const T = s.track;
      let minClear = Infinity, maxV = 0, maxA = 0, tA = 0, maxPan = 0, tPan = 0, pitchMin = 90, pitchMax = -90;
      let prevV = null, prevYaw = null;
      for (let i = 1; i < T.length; i++) {
        const a = T[i - 1], b = T[i], dt = b.t - a.t;
        if (dt <= 0) continue;
        minClear = Math.min(minClear, b.clear);
        const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt, vz = (b.z - a.z) / dt;
        maxV = Math.max(maxV, Math.hypot(vx, vy, vz));
        if (prevV && b.t > 0.5) { const A = Math.hypot(vx - prevV[0], vy - prevV[1], vz - prevV[2]) / dt; if (A > maxA) { maxA = A; tA = b.t; } }
        prevV = [vx, vy, vz];
        const dx = b.lx - b.x, dy = b.ly - b.y, dz = b.lz - b.z;
        const yaw = Math.atan2(dx, dz) * 180 / Math.PI, pitch = Math.atan2(-dy, Math.hypot(dx, dz)) * 180 / Math.PI;
        pitchMin = Math.min(pitchMin, pitch); pitchMax = Math.max(pitchMax, pitch);
        if (prevYaw !== null) { let d = yaw - prevYaw; if (d > 180) d -= 360; if (d < -180) d += 360; const r = Math.abs(d) / dt; if (r > maxPan) { maxPan = r; tPan = b.t; } }
        prevYaw = yaw;
      }
      out.push({ hole: h, duration: s.duration, orbitT: s.orbitT, transitT: s.transitT, R: s.R, minClear, maxV, maxA, tA, maxPan, tPan, pitchMin, pitchMax });
    }
    return out;
  });
  console.log(`\n${slug}: hole  dur  travel  sweep@  R  clear  vmax  amax@t  pan/s  pitch`);
  for (const s of sims) {
    if (s.missing) { fail(`${slug} hole ${s.hole}: no flight`); continue; }
    console.log('  ' + [s.hole, s.duration.toFixed(1), s.transitT.toFixed(1), s.orbitT.toFixed(1), s.R.toFixed(0), s.minClear.toFixed(1), s.maxV.toFixed(1),
      `${s.maxA.toFixed(1)}@${s.tA.toFixed(1)}`, `${s.maxPan.toFixed(1)}@${s.tPan.toFixed(1)}`, `${s.pitchMin.toFixed(0)}..${s.pitchMax.toFixed(0)}`].join('\t'));
    if (s.minClear < CLEAR_MIN) fail(`${slug} hole ${s.hole}: clearance ${s.minClear.toFixed(1)} m < ${CLEAR_MIN}`);
    if (s.maxPan > PAN_MAX) fail(`${slug} hole ${s.hole}: pan ${s.maxPan.toFixed(1)} deg/s at ${s.tPan.toFixed(1)} s > ${PAN_MAX}`);
    if (s.maxA > ACC_MAX) fail(`${slug} hole ${s.hole}: jolt ${s.maxA.toFixed(1)} m/s^2 at ${s.tA.toFixed(1)} s > ${ACC_MAX}`);
    if (s.pitchMin < PITCH_MIN || s.pitchMax > PITCH_MAX) fail(`${slug} hole ${s.hole}: pitch ${s.pitchMin.toFixed(0)}..${s.pitchMax.toFixed(0)} outside ${PITCH_MIN}..${PITCH_MAX}`);
    if (s.duration < DUR_MIN || s.duration > DUR_MAX) fail(`${slug} hole ${s.hole}: ${s.duration.toFixed(1)} s outside ${DUR_MIN}..${DUR_MAX}`);
  }
  fs.writeFileSync(path.join(OUT, `sim-${slug}.json`), JSON.stringify(sims, null, 1));

  if (LIVE) {
    await page.evaluate(n => { window.V3D.goHole(+n, false, true); window.V3D.fly(); }, LIVE);
    const t0 = Date.now();
    for (const at of [0.3, 3, 7, 12, 17, 22, 27, 32, 38, 44]) {
      const wait = t0 + at * 1000 - Date.now();
      if (wait > 0) await page.waitForTimeout(wait);
      const st = await page.evaluate(() => window.V3D.flightState());
      if (st.flying === 0 && at > 1) break;
      await page.screenshot({ path: path.join(OUT, `live-${slug}-h${LIVE}-${String(at).padStart(2, '0')}s.png`), timeout: 300000 });
    }
    console.log(`  live hole ${LIVE} photographed into ${OUT}`);
  }

  if (TOUR) {
    const fovBefore = await page.evaluate(() => window.V3D.cameraInfo().fov);
    await page.evaluate(() => document.getElementById('tourBtn').click());
    await page.waitForTimeout(800);
    const s0 = await page.evaluate(() => ({ ...window.V3D.flightState(), clean: document.body.classList.contains('clean') }));
    if (!(s0.tour === 1 && s0.hole === 1 && s0.clean)) fail(`${slug} tour did not start clean on hole 1`);
    await page.waitForTimeout(Math.max(0, (s0.duration - 1.0) * 1000 - 800));
    /* sample the camera through the transition: it must reach hole 2 with no
       jump larger than a frame's travel, the card off during the travel shot
       and back on by the tee, and no fade element anywhere */
    let sawNext = false, cardOff = false, cardBack = false, maxJump = 0, prev = null, prevAt = 0, samples = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      const s = await page.evaluate(() => ({ ...window.V3D.flightState(), pos: window.V3D.cameraInfo().position,
        card: document.getElementById('tourCard').classList.contains('show'), fade: !!document.getElementById('tourFade') }));
      const at = Date.now();
      /* a jump is judged as a SPEED over the wall-clock gap, since a screenshot
         in this loop stalls the sampling for half a second at a time */
      if (prev) maxJump = Math.max(maxJump, Math.hypot(s.pos[0] - prev[0], s.pos[1] - prev[1], s.pos[2] - prev[2]) / Math.max(0.05, (at - prevAt) / 1000));
      prev = s.pos; prevAt = at;
      if (s.fade) { fail(`${slug} tour: a fade element exists`); break; }
      if (s.hole === 2 && s.flying > 0) { sawNext = true; if (!s.card) cardOff = true; }
      if (s.hole === 2 && cardOff && s.card) { cardBack = true; break; }
      if (++samples % 12 === 0) await page.screenshot({ path: path.join(OUT, `tour-${slug}-transit-${String(samples / 12).padStart(2, '0')}.png`), timeout: 300000 });
      await page.waitForTimeout(100);
    }
    if (!sawNext) fail(`${slug} tour: hole 2 did not follow hole 1`);
    if (!cardOff) fail(`${slug} tour: the card never left during the travel shot`);
    if (!cardBack) fail(`${slug} tour: the card did not come back for the 2nd tee`);
    if (maxJump > JUMP_MAX) fail(`${slug} tour: camera moved at ${maxJump.toFixed(1)} m/s between samples (> ${JUMP_MAX})`);
    await page.screenshot({ path: path.join(OUT, `tour-${slug}-h2-arrival.png`), timeout: 300000 });
    await page.waitForTimeout(600);
    await page.evaluate(() => document.getElementById('cleanExit').click());
    await page.waitForTimeout(300);
    const s3 = await page.evaluate(() => ({ ...window.V3D.flightState(), fov: window.V3D.cameraInfo().fov, clean: document.body.classList.contains('clean'),
      card: document.getElementById('tourCard').classList.contains('show') }));
    if (s3.flying !== 0 || s3.tour !== 0 || s3.clean || s3.card) fail(`${slug} tour: exit left state ${JSON.stringify(s3)}`);
    if (Math.abs(s3.fov - fovBefore) > 1e-6) fail(`${slug} tour: lens ${s3.fov} after exit, was ${fovBefore}`);
    console.log(`  tour: start ok, hole 2 ${sawNext ? 'followed continuously' : 'MISSING'} (peak ${maxJump.toFixed(1)} m/s between samples), card off then back, exit restored fov ${s3.fov}`);
  }
  if (problems.length) fail(`${slug}: ${problems.join(' | ')}`);
  await page.close();
}
await browser.close();
console.log(failures ? `\n${failures} failure(s)` : '\nflight ok');
process.exit(failures ? 1 : 0);
