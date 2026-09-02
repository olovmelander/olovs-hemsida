#!/usr/bin/env node
/* Audit the v2 per-class surface rendering on a REAL browser: boot the built
   app at ?bana=puttom&v2=require, prove the representation that is drawing,
   photograph the plan's visual matrix, walk probe transects across every
   green, tee and bunker edge, and -- in the weights debug view -- read the
   GPU's own pixels back at projected world points and compare them with the
   CPU probe. Writes PNGs and a report.json; exits non-zero on a failed gate.

   Runs SwiftShader by default like every harness here. BANVY_GPU=1 asks for
   the machine's real adapter (tools/browser-args.mjs), which is the only way
   the performance numbers in the report mean anything.

   usage: node tools/v2-surface-audit.mjs [--out dir] [--backend webgpu|webgl2]
            [--holes 6,7,10,16,17,18] [--views tee,green,fritt,ovan]
            [--ljus dag,kvall] [--no-matrix] [--no-transects] [--no-pixels]
            [--timeout 240]                                                  */
import fs from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { browserArgs, GPU } from './browser-args.mjs';
import { decodePNG } from '../geobuild/png.mjs';
import { surfaceDebugColour } from '../apps/golf/src/engine/material.js';
import { SURFACE } from '../apps/golf/src/engine/surface.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'apps/golf/dist');
const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i < 0 ? fallback : argv[i + 1]; };
const has = name => argv.includes(`--${name}`);
const OUT = path.resolve(flag('out', path.join(ROOT, 'geobuild/shots/v2-surface')));
const BACKEND = flag('backend', 'webgpu');
const HOLES = flag('holes', '6,7,10,16,17,18').split(',').map(Number);
const VIEWS = flag('views', 'tee,green,fritt,ovan').split(',');
const LJUS = flag('ljus', 'dag,kvall').split(',');
const TIMEOUT = +flag('timeout', 240) * 1000;
const NAME = Object.fromEntries(Object.entries(SURFACE).map(([k, v]) => [v, k.toLowerCase()]));

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.bvch', 'application/vnd.banvy.chunk-v2'], ['.png', 'image/png'], ['.bin', 'application/octet-stream'],
  ['.svg', 'image/svg+xml'], ['.webp', 'image/webp'], ['.woff2', 'font/woff2'],
]);

async function serve(root) {
  const server = createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url || '/', 'http://local').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const target = path.resolve(root, relative);
      if (!target.startsWith(`${root}${path.sep}`) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
        response.writeHead(404).end('not found'); return;
      }
      const bytes = fs.readFileSync(target);
      response.writeHead(200, {
        'content-type': MIME.get(path.extname(target)) || 'application/octet-stream',
        'content-length': String(bytes.byteLength), 'cache-control': 'no-store',
      });
      response.end(bytes);
    } catch { response.writeHead(500).end('error'); }
  });
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)) };
}

function launchArgs(backend) {
  const args = [...browserArgs()];
  if (backend === 'webgpu') {
    args.push('--enable-unsafe-webgpu');
    if (!GPU) args.push('--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader');
  }
  return args;
}

async function boot(browser, origin, { backend, debug, hole, view, ljus }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const problems = [];
  page.on('pageerror', error => problems.push(`page: ${String(error.message || error)}`.slice(0, 240)));
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) problems.push(`${message.type()}: ${message.text()}`.slice(0, 240));
  });
  const query = new URLSearchParams({
    bana: 'puttom', v2: 'require', det: '1', q: 'hi', hal: String(hole), vy: view, ljus, skylt: '0',
  });
  if (backend === 'webgl2') query.set('gl', '1');
  if (debug) query.set('surfaceDebug', 'weights');
  const t0 = Date.now();
  await page.goto(`${origin}/?${query}`, { waitUntil: 'load', timeout: TIMEOUT });
  await page.waitForFunction(() => {
    const status = window.V3D?.v2Terrain?.().status;
    return status === 'ready' || status === 'failed' || status === 'fallback';
  }, null, { timeout: TIMEOUT });
  await page.waitForFunction(() => window.V3D?.settled?.() === true, null, { timeout: TIMEOUT });
  const bootSeconds = (Date.now() - t0) / 1000;
  const state = await page.evaluate(() => ({
    v2: window.V3D.v2Terrain(), stats: window.V3D.stats, fps: window.V3D.fps(),
  }));
  if (state.v2.status !== 'ready') throw new Error(`v2 did not reach ready: ${JSON.stringify(state.v2).slice(0, 300)}`);
  return { page, problems, state, bootSeconds };
}

async function settle(page, ms = 900) {
  await page.waitForFunction(() => window.V3D?.settled?.() !== false, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

async function shoot(page, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, timeout: 300000, animations: 'disabled' });
  return file;
}

/* Walk a line through the CPU probe across an edge of a ring and find where
   the leading class stops being the ring's class. The ring itself is the
   reference: the vectors the raster was compiled from, so this measures the
   whole chain -- 25 cm mask, exact EDT, byte, stitch, bilinear, weights. */
const TRANSECT_SCRIPT = ({ holes, samplesPerRing, halfMetres, step }) => {
  const result = [];
  const centroid = ring => {
    let x = 0, z = 0;
    for (const p of ring) { x += p[0]; z += p[1]; }
    return [x / ring.length, z / ring.length];
  };
  /* The expected edge is not always the ring: a bunker's sand is padded 0.5 m
     beyond its ring (surface-features.mjs), a green's and a tee's are not.
     Greens and tees sit inside their fringe, so rough must NEVER appear at
     their edge; a bunker may sit in rough, so it is not gated on that. */
  const walk = (ring, classId, label, hole, expectedOffset, roughGated) => {
    if (!ring || ring.length < 3) return;
    const c = centroid(ring);
    for (let s = 0; s < samplesPerRing; s++) {
      const i = Math.floor(s * ring.length / samplesPerRing);
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      /* the segment's own normal, pointed away from the centroid: a ray from
         the centroid crosses a crescent bunker or a long tee pad obliquely
         and reads a perpendicular offset as a larger one */
      let nx = -(b[1] - a[1]), nz = b[0] - a[0];
      const len = Math.hypot(nx, nz) || 1;
      nx /= len; nz /= len;
      if (nx * (mid[0] - c[0]) + nz * (mid[1] - c[1]) < 0) { nx = -nx; nz = -nz; }
      let flip = null, previousInside = null, maxWeightError = 0, maxRough = 0, inBounds = true;
      let insideAtStart = null;
      for (let t = -halfMetres; t <= halfMetres + 1e-9; t += step) {
        const probe = window.V3D.v2SurfaceProbe(mid[0] + nx * t, mid[1] + nz * t);
        if (!probe || !probe.inBounds) { inBounds = false; break; }
        const inside = probe.surface === classId;
        if (insideAtStart === null) insideAtStart = inside;
        maxWeightError = Math.max(maxWeightError, probe.weightError || 0);
        const rough = probe.weights.find(w => w.surface === 0);
        if (roughGated && Math.abs(t - expectedOffset) < 0.4 && rough) maxRough = Math.max(maxRough, rough.weight);
        if (previousInside === true && !inside && flip === null) flip = t - step / 2;
        previousInside = inside;
      }
      result.push({
        hole, label, kind: label.replace(/[0-9]+$/, ''), edge: i,
        x: +mid[0].toFixed(2), z: +mid[1].toFixed(2), inBounds, insideAtStart,
        flipMetres: flip === null ? null : +flip.toFixed(3),
        errorMetres: flip === null ? null : +(flip - expectedOffset).toFixed(3),
        maxWeightError: +maxWeightError.toFixed(4), maxRoughAtEdge: +maxRough.toFixed(4),
      });
    }
  };
  for (const n of holes) {
    const h = window.V3D.HOLES.find(item => item.n === n);
    if (!h) continue;
    walk(h.green?.ring, 4, 'green', n, 0, true);
    for (const [k, tee] of (h.tees?.pads || []).entries()) {
      /* synthesised pads are inferred at boot and are not in the compiled
         raster; they are reported separately, never measured as an edge */
      if (tee?.prov === 'synth') { result.push({ hole: n, label: `tee${k}`, kind: 'synth-pad', inBounds: true, insideAtStart: null, flipMetres: null, errorMetres: null, maxWeightError: 0, maxRoughAtEdge: 0 }); continue; }
      walk(tee?.ring, 5, `tee${k}`, n, 0, true);
    }
    for (const [k, bunker] of (h.bunkers || []).entries()) walk(bunker?.ring, 6, `bunker${k}`, n, 0.5, false);
  }
  return result;
};

function summariseTransects(rows) {
  const stats = subset => {
    const valid = subset.filter(row => row.inBounds && row.insideAtStart && row.errorMetres !== null);
    const errors = valid.map(row => Math.abs(row.errorMetres));
    const sorted = [...errors].sort((a, b) => a - b);
    const quantile = q => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null;
    return {
      transects: subset.length,
      measured: valid.length,
      noFlip: subset.filter(row => row.inBounds && row.insideAtStart && row.flipMetres === null).length,
      startedOutside: subset.filter(row => row.inBounds && row.insideAtStart === false).length,
      meanErrorMetres: errors.length ? +(errors.reduce((a, b) => a + b, 0) / errors.length).toFixed(3) : null,
      p90ErrorMetres: quantile(0.9) === null ? null : +quantile(0.9).toFixed(3),
      maxErrorMetres: sorted.length ? +sorted.at(-1).toFixed(3) : null,
      maxWeightError: +Math.max(0, ...subset.map(row => row.maxWeightError)).toFixed(4),
      maxRoughAtEdge: +Math.max(0, ...subset.map(row => row.maxRoughAtEdge)).toFixed(4),
      worst: valid.sort((a, b) => Math.abs(b.errorMetres) - Math.abs(a.errorMetres)).slice(0, 4),
    };
  };
  const measured = rows.filter(row => row.kind !== 'synth-pad');
  return {
    ...stats(measured),
    synthesisedPads: rows.length - measured.length,
    byKind: Object.fromEntries(['green', 'tee', 'bunker'].map(kind => [kind, stats(rows.filter(row => row.kind === kind))])),
  };
}

/* In the weights view every pixel is an emissive categorical colour (neither
   tone mapped nor fogged), so the pixel under a projected probe can be read
   back and compared with the class the CPU probe predicts. A pixel farther
   than this, in linear RGB, from every measured class colour is not ground:
   a tree crown, a flag, a ball or a marker standing over the probe. */
const OCCLUDER_DISTANCE = 0.18;

async function pixelProbe(page, hole, file) {
  /* a straight-down camera 70 m over the green, then a 2 m grid of probes */
  const placed = await page.evaluate(n => {
    const h = window.V3D.HOLES.find(item => item.n === n);
    const [cx, cz] = h.green.c;
    const y = window.V3D.probeH(cx, cz);
    window.V3D.setView(cx + 0.01, y + 70, cz, cx, y, cz);
    return { cx, cz, y };
  }, hole);
  await settle(page, 1200);
  await shoot(page, file);
  const image = decodePNG(fs.readFileSync(file));
  const probes = await page.evaluate(({ cx, cz }) => {
    const rows = [];
    for (let dz = -18; dz <= 18; dz += 2) for (let dx = -18; dx <= 18; dx += 2) {
      const x = cx + dx, z = cz + dz;
      const probe = window.V3D.v2SurfaceProbe(x, z);
      if (!probe?.inBounds) continue;
      const y = window.V3D.probeH(x, z);
      const s = window.V3D.project(x, y, z);
      if (!s.visible) continue;
      const leading = probe.weights.reduce((a, b) => (b.weight > a.weight ? b : a));
      rows.push({ x, z, px: Math.round(s.x), py: Math.round(s.y), surface: probe.surface, confidence: leading.weight });
    }
    return rows;
  }, placed);
  /* Self-calibrating: the rendered value of each palette colour is measured
     from the frame itself -- the per-channel median of every confident pixel
     the probe assigns to that class -- and pixels are then classified by the
     nearest measured colour. A theoretical palette does not survive the
     output stage (a faint additive haze remains even without tone mapping and
     fog), and a normalised hue cannot tell sand from rough. This measures
     what matters: that pixels are separable BY CLASS exactly where the probe
     says the classes are. A tree crown, flag or ball over a probe is near no
     measured colour and is reported as occluded, never counted. */
  const confident = probes.filter(probe => probe.confidence >= 0.99 &&
    probe.px >= 0 && probe.py >= 0 && probe.px < image.width && probe.py < image.height);
  const pixelOf = probe => {
    const o = (probe.py * image.width + probe.px) * image.channels;
    return [image.data[o], image.data[o + 1], image.data[o + 2]].map(linearChannel);
  };
  /* Calibrate only on pixels that at least resemble their class's authored
     colour: forest probes lie mostly under tree crowns, and a median taken
     over crowns would "measure" forest as tree-green and then claim every
     rough probe standing under a tree. The resemblance test is loose (the
     output stage shifts colours) but a dark-green crown is nowhere near
     forest's red. */
  const byClass = new Map();
  for (const probe of confident) {
    const pixel = pixelOf(probe);
    const authored = surfaceDebugColour(probe.surface);
    if (Math.hypot(pixel[0] - authored[0], pixel[1] - authored[1], pixel[2] - authored[2]) > 0.45) continue;
    if (!byClass.has(probe.surface)) byClass.set(probe.surface, []);
    byClass.get(probe.surface).push(pixel);
  }
  const median = values => { const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const measured = [...byClass].filter(([, pixels]) => pixels.length >= 5)
    .map(([id, pixels]) => [id, [0, 1, 2].map(c => median(pixels.map(p => p[c])))]);
  let agreed = 0, counted = 0, occluded = 0, uncalibrated = 0;
  const disagreements = [];
  for (const probe of confident) {
    if (!measured.some(([id]) => id === probe.surface)) { uncalibrated++; continue; }
    const rgb = pixelOf(probe);
    let best = null, bestD = Infinity;
    for (const [id, colour] of measured) {
      const d = Math.hypot(rgb[0] - colour[0], rgb[1] - colour[1], rgb[2] - colour[2]);
      if (d < bestD) { bestD = d; best = id; }
    }
    if (bestD > OCCLUDER_DISTANCE) { occluded++; continue; }
    counted++;
    if (best === probe.surface) agreed++;
    else disagreements.push({ ...probe, seen: best, distance: +bestD.toFixed(3), linear: rgb.map(v => +v.toFixed(3)) });
  }
  return {
    hole, probes: probes.length, counted, agreed, occluded, uncalibrated,
    palette: Object.fromEntries(measured.map(([id, colour]) => [id, colour.map(v => +v.toFixed(3))])),
    agreement: counted ? +(agreed / counted).toFixed(4) : null,
    disagreements: disagreements.slice(0, 8),
  };
}

function linearChannel(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('build the app first: cd apps/golf && npx vite build');
  const server = await serve(DIST);
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: launchArgs(BACKEND) });
  const outDir = path.join(OUT, BACKEND);
  fs.mkdirSync(outDir, { recursive: true });
  const report = { backend: BACKEND, gpu: GPU, startedAt: new Date().toISOString(), gates: {}, matrix: [], fps: [] };
  const failures = [];
  try {
    /* ---- 1. what is drawing */
    const first = await boot(browser, server.origin, { backend: BACKEND, debug: false, hole: HOLES[0], view: 'tee', ljus: LJUS[0] });
    const { v2, stats } = first.state;
    report.boot = { seconds: +first.bootSeconds.toFixed(1), backend: stats.backend, draws: stats.draws, fps: first.state.fps };
    report.representation = v2.surfaceRepresentation;
    report.surface = v2.surface;
    report.gates.representation = v2.surfaceRepresentation === 'class-sdf-v1';
    report.gates.noOverlays = v2.courseSurfaceOverlayMeshes === 0 && stats.surfaceOverlays === 0;
    report.gates.oneTerrainDraw = v2.renderer?.drawCalls === 1;
    report.gates.backend = stats.backend === BACKEND;
    for (const [gate, ok] of Object.entries(report.gates)) if (!ok) failures.push(`gate ${gate} failed`);
    console.log(`booted ${stats.backend} in ${first.bootSeconds.toFixed(1)} s: representation ${v2.surfaceRepresentation}, overlays ${v2.courseSurfaceOverlayMeshes}, draws ${stats.draws}, fps ${first.state.fps}`);

    /* ---- 2. transects through the CPU probe */
    if (!has('no-transects')) {
      const rows = await first.page.evaluate(TRANSECT_SCRIPT, { holes: HOLES, samplesPerRing: 8, halfMetres: 1.5, step: 0.05 });
      report.transects = summariseTransects(rows);
      report.transectRows = rows;
      const t = report.transects;
      console.log(`transects: ${t.measured}/${t.transects} measured, mean ${t.meanErrorMetres} m, p90 ${t.p90ErrorMetres} m, max ${t.maxErrorMetres} m, rough at a cut edge max ${t.maxRoughAtEdge}, raw-sum error max ${t.maxWeightError}`);
      report.gates.contourMax = t.maxErrorMetres !== null && t.maxErrorMetres <= 0.25;
      report.gates.contourMean = t.meanErrorMetres !== null && t.meanErrorMetres <= 0.15;
      report.gates.noRoughSeam = t.maxRoughAtEdge < 0.05;
      if (!report.gates.contourMax) failures.push(`contour max ${t.maxErrorMetres} m > 0.25`);
      if (!report.gates.noRoughSeam) failures.push(`rough weight ${t.maxRoughAtEdge} inside a cut edge`);
    }

    /* ---- 3. the visual matrix, one boot */
    if (!has('no-matrix')) {
      const { page } = first;
      for (const ljus of LJUS) {
        for (const hole of HOLES) {
          for (const view of VIEWS) {
            await page.evaluate(([h, c, l]) => {
              const P = { kvall: 'golden', dag: 'noon', dis: 'mist', gryning: 'dawn', host: 'host' };
              window.V3D.setPreset(P[l] || l);
              window.V3D.goHole(h, true, true);
              const cam = { fritt: 'orbit', ovan: 'top' }[c] || c;
              window.V3D.setCam(cam, true);
            }, [hole, view, ljus]);
            await settle(page, 1000);
            const file = await shoot(page, path.join(outDir, `h${hole}-${view}-${ljus}.png`));
            const fps = await page.evaluate(() => window.V3D.fps());
            report.matrix.push({ hole, view, ljus, file: path.relative(ROOT, file), fps });
            report.fps.push(fps);
            console.log(`  ${path.basename(file)}  fps ${fps}`);
          }
          /* grazing: eye height at the green edge looking along it */
          await page.evaluate(h => {
            const hole = window.V3D.HOLES.find(item => item.n === h);
            const ring = hole.green.ring;
            const a = ring[0], b = ring[Math.floor(ring.length / 2)];
            const [cx, cz] = hole.green.c;
            const y = window.V3D.probeH(a[0], a[1]);
            const dx = a[0] - cx, dz = a[1] - cz, len = Math.hypot(dx, dz) || 1;
            window.V3D.setView(a[0] + dx / len * 5, y + 1.6, a[1] + dz / len * 5, b[0], window.V3D.probeH(b[0], b[1]), b[1]);
          }, hole);
          await settle(page, 1000);
          const file = await shoot(page, path.join(outDir, `h${hole}-grazing-${ljus}.png`));
          report.matrix.push({ hole, view: 'grazing', ljus, file: path.relative(ROOT, file) });
          console.log(`  ${path.basename(file)}`);
        }
      }
      const sorted = [...report.fps].sort((a, b) => a - b);
      report.medianFps = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
    }
    await first.page.close();

    /* ---- 4. the GPU's own pixels against the probe, in the weights view */
    if (!has('no-pixels')) {
      const debug = await boot(browser, server.origin, { backend: BACKEND, debug: true, hole: HOLES[0], view: 'ovan', ljus: 'dag' });
      report.pixels = [];
      for (const hole of HOLES) {
        const result = await pixelProbe(debug.page, hole, path.join(outDir, `h${hole}-weights.png`));
        report.pixels.push(result);
        console.log(`  weights h${hole}: ${result.agreed}/${result.counted} confident probes agree (${result.agreement})`);
      }
      const total = report.pixels.reduce((s, r) => s + r.counted, 0);
      const agreed = report.pixels.reduce((s, r) => s + r.agreed, 0);
      report.pixelAgreement = total ? +(agreed / total).toFixed(4) : null;
      report.gates.pixelAgreement = report.pixelAgreement !== null && report.pixelAgreement >= 0.995;
      if (!report.gates.pixelAgreement) failures.push(`pixel agreement ${report.pixelAgreement} < 0.995`);
      report.problems = [...new Set([...first.problems, ...debug.problems])].slice(0, 20);
      await debug.page.close();
    } else {
      report.problems = [...new Set(first.problems)].slice(0, 20);
    }
  } finally {
    await browser.close();
    await server.close();
  }
  report.failures = failures;
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`report: ${path.relative(ROOT, path.join(outDir, 'report.json'))}`);
  if (report.problems?.length) console.log('problems:\n  ' + report.problems.join('\n  '));
  if (failures.length) {
    console.error('FAILED:\n  ' + failures.join('\n  '));
    process.exitCode = 1;
  } else {
    console.log('all gates passed');
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
