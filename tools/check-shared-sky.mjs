#!/usr/bin/env node
/* Render both visual styles at identical sun/camera/cloud state. The atmosphere
 * must match in pixels, including with post processing and reversed depth.
 * BANVY_GPU=1 node tools/check-shared-sky.mjs --base http://127.0.0.1:8623
 * --backend webgpu|webgl2, --rdepth 0|1, --quality hi|lo, --mobile,
 * --course veckefjarden, --presets golden,noon,..., --out directory, --elevated
 * --before URL optionally measures the previous realistic sky's brightness.
 * --audit checks the eight moods, visible native clouds, ground fill and reuse.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { decodePNG } from '../geobuild/png.mjs';
import { browserArgs, GPU } from './browser-args.mjs';

const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(`--${key}`) ? args[args.indexOf(`--${key}`) + 1] : fallback;
const base = option('base', 'http://127.0.0.1:8623');
const before = option('before', null);
const beforeLook = option('before-look', 'real');
const backend = option('backend', 'webgpu');
const rdepth = option('rdepth', '1');
const quality = option('quality', 'hi');
const mobile = args.includes('--mobile');
const course = option('course', 'veckefjarden');
const hole = option('hole', '1');
const elevated = args.includes('--elevated');
const audit = args.includes('--audit');
const poseFile = option('pose', null);
let overviewPose = poseFile ? JSON.parse(fs.readFileSync(poseFile, 'utf8')) : null;
const farBounds = option('far-roi', null)?.split(',').map(Number);
const allPresets = ['golden', 'noon', 'mist', 'dawn', 'host', 'midnight', 'bluehour', 'storm'];
const presets = option('presets', allPresets.join(',')).split(',');
if (!['webgpu', 'webgl2'].includes(backend) || !['0', '1'].includes(rdepth) || !['hi', 'lo'].includes(quality) || presets.some(p => !allPresets.includes(p))) throw new Error('Invalid rendering options');
const out = path.resolve(option('out', `tools/goldens/shared-sky-${backend}-${rdepth}-${quality}`));
fs.mkdirSync(out, { recursive: true });
const timeout = +(process.env.BANVY_BOOT_TIMEOUT || 600) * 1000;
const browser = await chromium.launch({ ...(process.env.BANVY_CHROME ? { executablePath: process.env.BANVY_CHROME } : { channel: 'chrome' }), args: browserArgs() });
const checks = [], runs = [], pictures = new Map();
function gate(ok, label) { checks.push({ ok, label }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); }
function measure(png, other, bounds = [0.1, 0.1, 0.9, 0.9]) {
  const a = decodePNG(png), b = other && decodePNG(other);
  if (b && (a.width !== b.width || a.height !== b.height)) throw new Error('Sky dimensions differ');
  let sum = 0, min = 255, max = 0, clipped = 0, pale = 0, count = 0, delta = 0, changed = 0;
  const channels = [0, 0, 0];
  for (let y = a.height * bounds[1] | 0; y < a.height * bounds[3]; y++) for (let x = a.width * bounds[0] | 0; x < a.width * bounds[2]; x++) {
    const p = y * a.width + x;
    const rgb = [0, 1, 2].map(c => a.data[p * a.channels + c]);
    const value = (rgb[0] + rgb[1] + rgb[2]) / 3;
    sum += value; min = Math.min(min, value); max = Math.max(max, value); count++;
    rgb.forEach((v, c) => channels[c] += v);
    if (value >= 248) clipped++;
    if (value >= 200) pale++;
    if (b) {
      const d = Math.max(...rgb.map((v, c) => Math.abs(v - b.data[p * b.channels + c])));
      delta += d; if (d > 2) changed++;
    }
  }
  return { mean: sum / count, meanRGB: channels.map(v => v / count), range: max - min, percentNearWhite: 100 * clipped / count, percentOver200: 100 * pale / count,
    ...(b ? { meanDifference: delta / count, percentOver2: 100 * changed / count } : {}) };
}
async function settle(page) {
  const frame = await page.evaluate(() => V3D.frameTimes().frame);
  await page.waitForFunction(f => V3D.frameTimes().frame >= f + 3 && V3D.settled(), frame, { timeout });
}
async function capture(page, name) {
  await page.evaluate(() => V3D.prepareCapture());
  return page.locator('body > canvas').screenshot({ path: path.join(out, name), timeout });
}
async function run(origin, look, label) {
  const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 720 },
    deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const query = new URLSearchParams({ bana: course, hal: hole, vy: 'tee', ljus: 'kvall', ghibli: look === 'painted' ? '1' : '0',
    det: '1', q: quality, qualitylock: '1', ren: '1', gl: backend === 'webgl2' ? '1' : '0', rdepth });
  const report = { label, look, url: `${origin.replace(/\/$/, '')}/?${query}`, errors, presets: [] };
  runs.push(report);
  console.log(`booting ${label}: ${report.url}`);
  try {
    await page.goto(report.url, { waitUntil: 'load', timeout });
    await page.waitForSelector('#boot.done', { timeout });
    await page.addStyleTag({ content: 'body > :not(canvas) { visibility: hidden !important; }' });
    await settle(page);
    report.state = await page.evaluate(() => ({ backend: V3D.stats.backend, painted: document.querySelector('#lookBtn')?.getAttribute('aria-pressed') === 'true', camera: V3D.cameraInfo(), quality: V3D.quality(), atmosphere: V3D.atmosphere?.(), audit: V3D.treeTierAudit() }));
    gate(report.state.backend === backend && report.state.camera.reversedDepth === (backend === 'webgpu' && rdepth === '1'), `${label}: renderer and depth active`);
    gate(report.state.painted === (look === 'painted'), `${label}: requested visual style active`);
    if (label !== 'before') gate(report.state.atmosphere?.kind === 'SkyMesh', `${label}: shared atmospheric sky active`);
    for (const preset of presets) {
      await page.evaluate(p => { V3D.setCam('tee', true); V3D.setPreset(p); }, preset);
      if (elevated) {
        if (!overviewPose) {
          const cam = await page.evaluate(() => V3D.cameraInfo());
          if (!cam.target) throw new Error('Elevated review requires cameraInfo().target');
          overviewPose = { eye: cam.position.map((v, i) => i === 1 ? v + 85 : v - (cam.target[i] - v) * 0.15),
            target: cam.target.map((v, i) => i === 1 ? v + 45 : v) };
        }
        await page.evaluate(({ eye, target }) => V3D.placeCamera(eye, target), overviewPose);
      }
      await settle(page);
      const world = await capture(page, `${label}-${preset}-tee.png`);
      const treeState = await page.evaluate(() => ({ audit: V3D.treeTierAudit(), renderer: V3D.rendererInfo() }));
      gate(treeState.audit.ok && treeState.renderer.triangles > 0 && measure(world).range > 20, `${label}/${preset}: course renders`);
      // Fixed camera above all course geometry; no world grade or bloom from
      // differently coloured trees should alter this view of the atmosphere.
      await page.evaluate(() => V3D.placeCamera([0, 4000, 0], [0, 4400, 600]));
      await settle(page);
      const sky = await capture(page, `${label}-${preset}-sky.png`);
      const metrics = measure(sky);
      const row = { preset, sky: metrics, treeAudit: treeState.audit.ok, world: measure(world),
        ground: measure(world, null, [0.2, 0.62, 0.8, 0.92]),
        ...(farBounds ? { distantLandscape: measure(world, null, farBounds) } : {}),
        atmosphere: await page.evaluate(() => V3D.atmosphere?.()) };
      report.presets.push(row);
      pictures.set(`${label}/${preset}`, sky);
      gate(metrics.range > 1 && metrics.mean > 2, `${label}/${preset}: sky shaded (${metrics.mean.toFixed(1)}/255, ${metrics.percentNearWhite.toFixed(1)}% near white)`);
      if (['golden', 'noon'].includes(preset)) gate(metrics.mean > 120 && metrics.range > 10, `${label}/${preset}: daylight atmosphere retains colour and brightness`);
      if (audit && label === 'real') {
        await page.evaluate(p => V3D.setPreset(p, { cloud: 0 }), preset);
        await settle(page);
        const clear = await capture(page, `${label}-${preset}-cloudless.png`);
        row.cloudContribution = { ...measure(sky, clear), view: 'fixed' };
        // The preserved midnight sky is almost clear facing away from its
        // very low sun. Also sample its lit hemisphere before calling clouds
        // missing; coverage is spatial, not a promise of a cloud in every view.
        if (row.cloudContribution.meanDifference <= 0.05) {
          const sun = row.atmosphere.sun, n = Math.hypot(sun[0], sun[2]);
          await page.evaluate(({ preset, target }) => {
            V3D.setPreset(preset); V3D.placeCamera([0, 4000, 0], target);
          }, { preset, target: [sun[0] / n * 600, 4180, sun[2] / n * 600] });
          await settle(page);
          const litSky = await capture(page, `${label}-${preset}-sunward.png`);
          await page.evaluate(p => V3D.setPreset(p, { cloud: 0 }), preset);
          await settle(page);
          const litClear = await capture(page, `${label}-${preset}-sunward-cloudless.png`);
          row.cloudContribution = { ...measure(litSky, litClear), view: 'sunward' };
        }
        gate(row.cloudContribution.meanDifference > 0.05, `${preset}: native clouds visibly contribute (${row.cloudContribution.meanDifference.toFixed(2)}/255)`);
        await page.evaluate(p => V3D.setPreset(p), preset);
      }
    }
    report.environment = await page.evaluate(() => V3D.lightingEnvironment?.());
    if (audit && label !== 'before') gate(report.environment?.allocations <= 2, `${label}: preset switching reuses at most two reflection maps`);
    gate(errors.length === 0, `${label}: no browser/renderer errors`);
  } catch (e) { report.failure = String(e); gate(false, `${label}: ${e}`); }
  finally { await page.close(); }
}
try {
  await run(base, 'painted', 'painted');
  await run(base, 'real', 'real');
  if (before) await run(before, beforeLook, 'before');
  for (const preset of presets) {
    const painted = pictures.get(`painted/${preset}`), real = pictures.get(`real/${preset}`);
    if (painted && real) {
      const comparison = measure(painted, real);
      runs[0].presets.find(p => p.preset === preset).comparison = comparison;
      gate(comparison.meanDifference < 0.25 && comparison.percentOver2 < 0.1, `${preset}: skies match across styles (${comparison.meanDifference.toFixed(4)}/255, ${comparison.percentOver2.toFixed(3)}% over 2)`);
    }
    const old = pictures.get(`before/${preset}`);
    if (!audit && real && old && ['golden', 'noon'].includes(preset)) {
      const now = measure(real), previous = measure(old);
      gate(now.mean < previous.mean - 5 && now.percentNearWhite < previous.percentNearWhite, `${preset}: sky highlights reduced (${previous.mean.toFixed(1)} → ${now.mean.toFixed(1)}/255; ${previous.percentNearWhite.toFixed(1)} → ${now.percentNearWhite.toFixed(1)}% near white)`);
    }
  }
  if (audit) {
    if (farBounds && before) {
      const previous = runs.find(r => r.label === 'before');
      const current = runs.find(r => r.label === beforeLook);
      for (const name of ['dawn', 'mist']) {
        const old = previous?.presets.find(p => p.preset === name)?.distantLandscape;
        const now = current?.presets.find(p => p.preset === name)?.distantLandscape;
        if (old && now) gate(now.mean < old.mean - 10 && now.percentOver200 < old.percentOver200,
          `${beforeLook}/${name}: distant landscape loses its pale wash (${old.mean.toFixed(1)} → ${now.mean.toFixed(1)}/255)`);
      }
    }
    for (const run of runs.filter(r => r.label !== 'before')) {
      const rows = Object.fromEntries(run.presets.map(p => [p.preset, p]));
      if (rows.storm && rows.noon) gate(rows.storm.sky.mean < rows.noon.sky.mean * 0.75, `${run.label}: storm sky is substantially darker than daylight`);
      if (rows.mist && rows.storm) gate(rows.mist.sky.mean > rows.storm.sky.mean + 20, `${run.label}: luminous mist differs from storm`);
      if (rows.bluehour) {
        const p = rows.bluehour;
        gate(p.sky.meanRGB[2] > p.sky.meanRGB[0] + 10 && p.ground.mean > 25, `${run.label}: blue twilight retains readable terrain`);
      }
    }
    const currentMidnight = runs.find(r => r.label === 'real')?.presets.find(p => p.preset === 'midnight');
    const beforeMidnight = runs.find(r => r.label === 'before')?.presets.find(p => p.preset === 'midnight');
    if (currentMidnight && beforeMidnight) gate(currentMidnight.ground.mean > beforeMidnight.ground.mean * 1.15,
      `midnight: ground illumination improved (${beforeMidnight.ground.mean.toFixed(1)} → ${currentMidnight.ground.mean.toFixed(1)}/255)`);
    for (let i = 0; i < presets.length; i++) for (let j = i + 1; j < presets.length; j++) {
      const a = pictures.get(`real/${presets[i]}`), b = pictures.get(`real/${presets[j]}`);
      if (a && b) gate(measure(a, b).meanDifference > 2.5, `${presets[i]}/${presets[j]}: visibly distinct skies`);
    }
  }
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ browser: browser.version(), hardwareRequested: GPU, backend, rdepth, quality, mobile, course, hole, elevated, audit, overviewPose, farBounds, checks, runs }, null, 2) + '\n');
  await browser.close();
}
if (checks.some(c => !c.ok)) process.exitCode = 1;
