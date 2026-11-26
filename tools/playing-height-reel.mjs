/** Record Banvy's live player-height views and measure the same camera paths.
 * BANVY_GPU=1 node tools/playing-height-reel.mjs --base http://127.0.0.1:8654 --out tools/goldens/gfx/playing-height
 * --measure measures without an encoder; --gl --low use the compatibility renderer.
 * --course, --light and --art allow matched, interleaved comparisons on one build.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from './browser-args.mjs';
import { createRound, holeCard, writePlayCheckpoint } from '../apps/golf/src/play/play-rules.mjs';

const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const base = option('--base', 'http://127.0.0.1:8654');
const out = path.resolve(option('--out', 'tools/goldens/gfx/playing-height'));
const measure = args.includes('--measure'), low = args.includes('--low');
const repeats = Number(option('--repeat','1'));
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('--repeat must be between 1 and 10');
const courses = [{ slug: 'norrfallsviken', hole: 1, light: 'kvall' }, { slug: 'bro-hof-stadium', hole: 18, light: 'dag' }];
const selected = courses.filter(c => !option('--course') || c.slug === option('--course'));
if (!selected.length) throw new Error('No matching pilot course');
if (measure && !GPU) throw new Error('Use BANVY_GPU=1 for hardware timing');
await fs.mkdir(out, { recursive: true });

// Anchors come from the active course graph, in metres. The bank scan picks a
// real polygon vertex and looks along its shoreline from the landward side.
function findShots(hole) {
  const v = window.V3D, h = v.HOLES.find(h => h.n === hole);
  const pin = v.cups().positions.find(c => c.hole === hole);
  const green = [pin.x, pin.z], tee = h.tees.marks[0].c;
  const direction = (a, b) => {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
  };
  const shift = (p, dir, metres) => [p[0] + dir[0] * metres, p[1] + dir[1] * metres];
  const teeDir = direction(tee, h.line[1]), approach = direction(h.line.at(-2), green);
  const right = d => [d[1], -d[0]];
  const shot = (id, a, b, lookA, lookB, height, aimHeight) => ({ id, a, b, lookA, lookB, height, aimHeight });
  const shots = hole === 1
    ? [shot('tee', shift(tee, teeDir, -2), shift(tee, teeDir, 1), shift(tee, teeDir, 23), shift(shift(tee, teeDir, 23), right(teeDir), 7), 1.5, 0.6)]
    : [];
  if (hole === 18) {
    const sand = h.bunkers.map(b => b.ring).filter(r => r.length > 2)
      .sort((a,b) => Math.min(...a.map(p => Math.hypot(p[0]-pin.x,p[1]-pin.z))) - Math.min(...b.map(p => Math.hypot(p[0]-pin.x,p[1]-pin.z))))[0];
    const centre = sand.reduce((sum, p) => [sum[0] + p[0] / sand.length, sum[1] + p[1] / sand.length], [0, 0]);
    shots.push(shot('bunker', shift(centre, approach, -2), centre, green, shift(green, right(approach), 2), 1.2, 0.6));
    const banks = v.M.water.filter(w => !w.stream && w.ring?.length > 2).flatMap(w => w.ring);
    const distance = p => Math.hypot(p[0] - pin.x, p[1] - pin.z);
    const bank = banks.reduce((a,b) => distance(a) <= distance(b) ? a : b);
    const inland = direction(bank, green), along = right(inland);
    const eye = shift(bank, inland, 4), across = shift(bank, inland, -18);
    shots.push(shot('shore', shift(eye, along, -1), shift(eye, along, 1), shift(across, along, -10), shift(across, along, 18), 1.6, 1));
  }
  shots.push(shot('approach', shift(green, approach, -29), shift(green, approach, -22), green, green, 1.6, 0.55));
  shots.push(shot('green', shift(green, approach, -7), shift(shift(green, approach, -5), right(approach), 0.6), green, green, 1.05, 0.2));
  const ball = shift(green, approach, -3.2);
  return { shots, ball, holes: v.HOLES.map(({ n, par }) => ({ n, par })) };
}

// Runs inside the player. Compare exactly the same endpoints and duration on
// every device. Sample GPU timestamps while moving, without stalling the camera.
async function runShot({ shot, recording, duration, putt }) {
  const v = window.V3D, canvas = document.querySelector('body > canvas');
  const tick = () => new Promise(resolve => requestAnimationFrame(resolve));
  const lerp = (a,b,t) => a + (b-a)*t;
  // Pre-sample the short surveyed paths so the timing loop measures the player,
  // without re-querying the streamed height field twice for every camera tick.
  const pathPoints = (a,b,offset) => Array.from({ length: 17 }, (_,i) => {
    const x = lerp(a[0],b[0],i/16), z = lerp(a[1],b[1],i/16);
    return [x, v.probeH(x,z) + offset, z];
  });
  const cameraPath = shot && pathPoints(shot.a,shot.b,shot.height);
  const aimPath = shot && pathPoints(shot.lookA,shot.lookB,shot.aimHeight);
  const pose = progress => {
    if (!shot) return;
    const s = progress * progress * (3 - 2 * progress);
    const index = Math.min(15, Math.floor(s * 16));
    const point = pts => pts[index].map((a,j) => lerp(a,pts[index+1][j],s * 16 - index));
    v.placeCamera(point(cameraPath), point(aimPath));
  };
  pose(0);
  for (let i = 0; i < 35; i++) await tick();
  const pendingChunks = [];
  let stream, recorder, stopped;
  if (recording) {
    stream = canvas.captureStream(60);
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8'].find(t => MediaRecorder.isTypeSupported(t));
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12000000 });
    stopped = new Promise((resolve, reject) => { recorder.onstop = resolve; recorder.onerror = e => reject(e.error); });
    recorder.ondataavailable = e => { if (e.data.size) pendingChunks.push(e.data); };
    recorder.start(500);
  }
  let previous = await tick(), start = previous, pending, frame = v.frame(), swung = false, movingBall = false, nextBallCheck = start;
  const intervals = [], gpu = [];
  for (;;) {
    const t = await tick(), u = Math.min(1,(t - start) / duration);
    // Browser rAF can run more often than the canvas actually renders.
    const drawn = v.frame();
    if (drawn !== frame) {
      intervals.push(t - previous); previous = t; frame = drawn;
      if (!recording && !pending && v.gpuTime) {
        pending = v.gpuTime().then(r => { if (r.ms > 0) gpu.push(r.ms); }).finally(() => { pending = null; });
      }
    }
    pose(u);
    if (putt && u > 0.12 && !swung) { window.BANVY_PLAY.swing({ power: 0.35, face: 0, path: 0 }); swung = true; }
    if (swung && !movingBall && t >= nextBallCheck) {
      movingBall = window.BANVY_PLAY.state().state === 'flight';
      nextBallCheck = t + 85;
    }
    if (u >= 1) break;
  }
  if (pending) await pending;
  let video;
  if (recorder) {
    recorder.stop(); await stopped; stream.getTracks().forEach(track => track.stop());
    const blob = new Blob(pendingChunks, { type: recorder.mimeType });
    video = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.readAsDataURL(blob); });
  }
  const stats = values => {
    if (!values.length) return null;
    values.sort((a,b) => a-b);
    const p = q => Number(values[Math.min(values.length-1, Math.ceil(q*values.length)-1)].toFixed(2));
    return { samples: values.length, median: p(0.5), p95: p(0.95), p99: p(0.99) };
  };
  return { video, frameMs: stats(intervals), gpuMs: stats(gpu), movingBall };
}

const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs({ uncappedFrameRate: measure }) });
const rows = [];
try {
  for (const course of selected) {
    const context = await browser.newContext({
      viewport: low ? { width: 393, height: 852 } : { width: 1920, height: 1080 },
      deviceScaleFactor: 1, isMobile: low, hasTouch: low, serviceWorkers: 'block',
    });
    try {
      await context.addInitScript(() => localStorage.setItem('banvy-strategy-visible-v1','off'));
      const page = await context.newPage(), errors = [];
      page.setDefaultTimeout(180000);
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error' && !m.location().url.endsWith('/api/health')) errors.push(m.text().slice(0,280)); });
      const url = new URL(base);
      const light = option('--light', course.light);
      url.search = new URLSearchParams({ bana: course.slug, hal: String(course.hole), vy: 'tee', ljus: light === 'overcast' ? 'dis' : light,
        q: low ? 'lo' : 'hi', qualitylock: '1', gl: args.includes('--gl') ? '1' : '0', fps: measure ? '0' : '60',
        ren: '1', skylt: '0', gputime: measure ? '1' : '0', playerArt: option('--art','1') });
      const open = async () => {
        await page.goto(url.href);
        // The boot element fades out. Its class is the readiness signal even
        // when a fast reload has hidden it before Playwright checks visibility.
        await page.waitForSelector('#boot.done', { state: 'attached' });
        if (!url.searchParams.has('spela'))
          await page.waitForFunction(() => window.V3D?.settled() && !window.V3D.v2Terrain().adapter?.stream?.loadingTiles);
        if (light === 'overcast') await page.evaluate(() => {
          const v = window.V3D;
          v.setNuClock('2025-06-14T11:00:00Z');
          v.setNuWeather({ code: 3, cloudPct: 99, visibilityM: 20000 });
          v.chooseLight('nu');
        });
        await page.addStyleTag({ content: 'body > :not(canvas):not(style) { visibility: hidden !important }' });
      };
      await open();
      const anchors = await page.evaluate(findShots,course.hole);
      const device = await page.evaluate(() => {
        const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl2');
        const debug = gl?.getExtension('WEBGL_debug_renderer_info');
        const adapter = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null;
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
        const v = window.V3D;
        return { adapter, backend: v.stats.backend, resolution: v.rendererInfo().drawingBuffer, lowQuality: v.quality().lowq };
      });
      if (device.lowQuality !== low || (args.includes('--gl') && device.backend !== 'webgl2')) throw new Error('Unexpected renderer configuration');
      const render = async (id, shot, putt = false) => {
        const data = await page.evaluate(runShot, { shot, putt, recording: !measure, duration: putt ? 5500 : 3800 });
        const { video, ...stats } = data, name = course.slug + '-' + id;
        if (video) {
          await fs.writeFile(path.join(out,name+'.webm'), Buffer.from(video,'base64'));
          await page.locator('body > canvas').screenshot({ path: path.join(out,name+'.jpg'), type: 'jpeg', quality: 92 });
        }
        const row = { name, light, url:url.href, ...device, shot, ...stats, errors: [...new Set(errors)] };
        rows.push(row);
        await fs.writeFile(path.join(out,'report.json'),JSON.stringify(rows,null,2));
        console.log(name, row.backend, JSON.stringify(row.frameMs), JSON.stringify(row.gpuMs));
        if (row.errors.length || (putt && !row.movingBall)) throw new Error(name + ': ' + (row.errors.join(' / ') || 'no live putt'));
      };
      const requestedShot = option('--shot');
      for (const shot of anchors.shots.filter(s => !requestedShot || requestedShot === s.id)) {
        for (let i = 1; i <= repeats; i++) await render(repeats === 1 ? shot.id : shot.id+'-'+i,shot);
      }
      if (course.hole === 18 && (!requestedShot || requestedShot === 'putt')) {
        // Resume a real putting lie in this isolated test browser. Use Banvy's
        // checkpoint writer and public swing entry point to drive normal physics.
        const round = createRound({ slug: course.slug, courseName: course.slug, holes: anchors.holes, startHole: course.hole });
        holeCard(round, course.hole);
        const entries = new Map();
        const storage = { getItem: k => entries.get(k) ?? null, setItem: (k,v) => entries.set(k,v) };
        const saved = writePlayCheckpoint(storage, round, { phase:'address', ball: anchors.ball });
        if (!saved.revision) throw new Error('Unable to prepare putting lie');
        await page.evaluate(items => items.forEach(([k,v]) => localStorage.setItem(k,v)),[...entries]);
        url.searchParams.set('spela','1'); url.searchParams.set('sim','fortsatt');
        await open();
        await page.waitForFunction(() => !!window.BANVY_PLAY);
        const lie = await page.evaluate(() => { const s = window.BANVY_PLAY.state(); return [s.state,s.lie,s.hole]; });
        if (lie[0] !== 'address' || lie[1] !== 'green' || lie[2] !== course.hole)
          throw new Error('Unexpected resumed putting lie ' + JSON.stringify(lie));
        await render('putt',null,true);
      }
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
