/* The tree LOD pop meter: how many pixels a tier switch changes, frame by
   frame, measured in the page (docs/tree-lod-plan.md, phase 4; the design is
   docs/specs/tree-lod-phase-4-crossfade.md section 5).

   usage: node tools/serve.mjs apps/golf/dist 8620 &
          BANVY_GPU=1 node tools/tree-pop-meter.mjs [http://127.0.0.1:8620] [--course puttom]
              [--fade 0.3] [--modes A,B,C] [--cell] [--frames 300] [--step 0.25] [--out file.json]

   The page's fade clock is DRIVEN by this tool (V3D.driveTreeFadeClock), so a
   fade is walked level by level whatever the frame rate, and every number is
   V3D.pixelDelta(): the count of pixels whose largest channel moved by more
   than 24/255 since the previous call, computed in the page over a readback.

   Mode A (annulus): the event a camera move produces -- the hero boundary is
     pushed out by a quarter so the trees between 110 and 137 px switch hero
     to full at once. Fade 0 gives the pop S; with the fade the same switch
     is walked over its 16 levels, and the gates are: the switch frame
     changes nothing, the drain frame changes nothing, no level changes more
     than S/8, and the levels add up to S (every pixel flips exactly once).
   Mode B (mass): every visible tree forced to the decimated tier and back,
     ~13k fades at once, the same walk and gates, plus the slot audit.
   Mode C (dolly): the camera advances --step metres per simulated frame
     along the tee shot; each frame is measured twice -- once with the tiers
     FROZEN (camera motion alone, discarded) and once after the update with
     the clock stepped 1/60 s -- so the second number is what tiering alone
     changed. Reported as median / p95 / max of the per-frame fraction and
     the ratios between them: a spike is a pop.

   Mode S (swim): shadow swimming. The tiers are frozen so nothing but the
     camera moves; the camera advances 0.1 m a frame along the tee shot and
     every frame's change is measured on the far ground under the horizon
     (rows 42-55%, where a 0.1 m step is sub-pixel parallax but a shadow's swim
     is not), at a 6/255 threshold, first with the shadow map snapped to its
     texels and then unsnapped in the same boot (V3D.setShadowSnap).

   --cell decides tiers the way phases 1-3 did (per 128 m cell from a nominal
   tree), which is the "before" this meter was built to see; --fade 0 --cell
   must show the spike in Mode C or the instrument is not measuring the thing
   the owner sees. The default measures the per-tree build with its fade.  */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { browserArgs, GPU } from './browser-args.mjs';

if (!GPU) { console.error('BANVY_GPU=1 required: a pop is measured on the real adapter'); process.exit(2); }
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const BASE = args.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:8620';
const SLUG = flag('course', 'puttom');
const FADE = +flag('fade', 0.3);
const MODES = String(flag('modes', 'A,B,C')).split(',');   /* A, B, C and S (shadow swim) */
const CELL = args.includes('--cell');
const N = +flag('frames', 300), STEP = +flag('step', 0.25);
const QUERY = flag('query', '');   /* extra URL parameters, e.g. lodpin=4,4 */
/* the meter measures SWITCHING, which the default tier-by-zone mode never does: it boots in screen mode unless the query says otherwise */
const LOD_QUERY = /lodmode=/.test(QUERY) ? '' : 'lodmode=screen';
const OUT = flag('out', null);
const LEVELS = 16;

const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(600000);
const errors = [];
page.on('pageerror', e => errors.push(String(e).split('\n')[0].slice(0, 200)));
const t0 = Date.now();
await page.goto(`${BASE}/?bana=${SLUG}&det=1&v2=require&ren=1${QUERY ? `&${QUERY}` : ''}${LOD_QUERY ? `&${LOD_QUERY}` : ''}`, { waitUntil: 'load' });
await page.waitForSelector('#boot.done');
const ev = (fn, arg) => page.evaluate(fn, arg);
const frame = () => ev(() => window.V3D.frame());
const oneFrame = async () => { const f = await frame(); await page.waitForFunction(f0 => window.V3D.frame() > f0, f, { polling: 5 }); };
/* settled tiers AND an idle terrain stream, then two more frames: a tile landing between two readbacks would be counted as a pop */
const settle = async () => {
  const f = await frame();
  await page.waitForFunction(f0 => { const V = window.V3D; return V.frame() >= f0 + 2 && V.settled() && (V.v2Terrain().adapter?.stream?.loadingTiles ?? 0) === 0; }, f, { polling: 30 });
  const f1 = await frame();
  await page.waitForFunction(f0 => window.V3D.frame() >= f0 + 2 && window.V3D.settled(), f1, { polling: 10 });
};
const streamIdle = () => page.waitForFunction(() => (window.V3D.v2Terrain().adapter?.stream?.loadingTiles ?? 0) === 0, null, { polling: 10, timeout: 20000 }).catch(() => {});
let clock = 100;
const setClock = async t => { clock = t; await ev(t => window.V3D.setTreeFadeClock(t), t); };
const stepClock = async dt => { await setClock(clock + dt); await oneFrame(); };
const delta = () => ev(() => window.V3D.pixelDelta());
const tiers = () => ev(() => { const t = window.V3D.treeTiers(); return { t0: t.tier0, t1: t.tier1, t2: t.tier2, t3: t.tier3, fading: t.fading, switches: t.switches, updateMs: +t.updateMs.toFixed(3) }; });
const setFade = s => ev(s => window.V3D.setTreeFade(s), s);
const freeze = on => ev(on => window.V3D.freezeTreeTiers(on), on);
const setView = async ([h, cam, preset]) => {
  await ev(([h, cam, preset]) => { window.V3D.setPreset(preset); window.V3D.goHole(h, true, true); window.V3D.setCam(cam, true); }, [h, cam, preset]);
  await settle();
};
const stats = await ev(() => ({ backend: window.V3D.stats.backend, trees: window.V3D.stats.trees, px: window.V3D.treeLodPx() }));
if (stats.backend !== 'webgpu') { console.error(`backend ${stats.backend}: the meter needs the WebGPU readback`); process.exit(2); }
await ev(() => window.V3D.driveTreeFadeClock(true));
await setClock(clock);
if (CELL) await ev(() => window.V3D.setTreeLodCellMode(true));
await settle();
const hero0 = stats.px.hero;
const pct = (n, total) => +(100 * n / total).toFixed(4);
const report = { tool: 'tree-pop-meter', date: new Date().toISOString(), base: BASE, course: SLUG, fade: FADE, cellMode: CELL,
                 frames: N, step: STEP, boot: { seconds: +((Date.now() - t0) / 1000).toFixed(1), ...stats }, modes: {} };
console.log(`${SLUG} ${stats.backend} trees ${stats.trees} thresholds ${hero0}/${stats.px.full}/${stats.px.impostor} fade ${FADE} ${CELL ? 'PER-CELL (before)' : 'per-tree'} boot ${report.boot.seconds} s`);

/* one crossfade event walked level by level: prime, trigger, then the levels and the drain.
   Both runs start from a hysteresis-free state (restore is a reset), or the
   instant pop would also count every tree parked in a hysteresis band. */
async function walk(trigger, restore, label) {
  await setFade(0); await restore(); await oneFrame(); await settle();
  await freeze(true); await delta();
  await trigger(); await freeze(false); await oneFrame();
  const instant = await delta();
  const S = instant.changed;
  await restore(); await oneFrame(); await settle();
  const row = { label, S, Spct: pct(S, instant.total), total: instant.total };
  if (FADE > 0) {
    await setFade(FADE); await freeze(true); await delta(); await ev(() => window.V3D.pixelDeltaMark());
    await trigger(); await freeze(false); await oneFrame();
    const d0 = await delta(), levels = [];
    for (let L = 1; L <= LEVELS; L++) { await stepClock(FADE / LEVELS); levels.push((await delta()).changed); }
    await stepClock(FADE / LEVELS);
    const dDrain = await delta();
    /* the whole event against the frame before it: the same pixels the instant pop changed, however the fade spread them */
    const whole = (await ev(() => window.V3D.pixelDelta(24, true))).changed;
    const after = await tiers();
    const sum = levels.reduce((a, b) => a + b, 0);
    Object.assign(row, { d0: d0.changed, levels, levelSum: sum, maxLevel: Math.max(...levels), dDrain: dDrain.changed, whole, fadingAfterDrain: after.fading,
      gates: { switchFrame: d0.changed <= 1e-4 * d0.total, drainFrame: dDrain.changed <= 1e-4 * d0.total,
               maxLevel: Math.max(...levels) <= S / 8, wholeEqualsPop: S === 0 || Math.abs(whole - S) <= 0.1 * S } });
    await restore(); await oneFrame(); await stepClock(FADE * 18 / 16); await settle(); await setFade(0);
    row.ok = Object.values(row.gates).every(Boolean);
    console.log(`  ${label}: pop ${S} px (${row.Spct}%) | fade: switch ${d0.changed}, levels max ${row.maxLevel} (S/8 = ${(S / 8).toFixed(0)}), level sum ${sum}, whole event ${whole}, drain ${dDrain.changed} -> ${row.ok ? 'ok' : 'FAIL ' + Object.entries(row.gates).filter(([, v]) => !v).map(([k]) => k).join(',')}`);
  } else console.log(`  ${label}: pop ${S} px (${row.Spct}%)`);
  return row;
}

if (MODES.includes('A')) {
  report.modes.A = [];
  for (const v of [[5, 'tee', 'noon'], [1, 'tee', 'golden'], [14, 'green', 'golden'], [13, 'tee', 'golden']]) {
    await setView(v);
    const label = `A hole ${v[0]} ${v[1]} ${v[2]}`;
    report.modes.A.push({ view: v, ...(await walk(
      () => ev(h => window.V3D.setTreeLodPx({ hero: h, reset: true }), hero0 * 1.25),
      () => ev(h => window.V3D.setTreeLodPx({ hero: h, reset: true }), hero0), label)) });
  }
}
if (MODES.includes('B')) {
  await setView([5, 'tee', 'noon']);
  /* the forced tier is settled (and its own fade drained) before the walk back is measured */
  const toDecimated = async () => { await ev(() => window.V3D.setTreeLod(3)); await oneFrame(); await stepClock(FADE * 18 / 16 + 1 / 60); await settle(); };
  await toDecimated();
  const row = await walk(() => ev(() => window.V3D.setTreeLod(0)), async () => { await toDecimated(); }, 'B mass, hole 5 tee noon');
  await ev(() => window.V3D.setTreeLod(0)); await stepClock(FADE * 18 / 16 + 1 / 60); await settle();
  row.audit = await ev(() => window.V3D.treeTierAudit());
  row.ok = row.ok !== false && row.audit.ok;
  console.log(`  slot audit ${row.audit.ok ? 'ok' : 'FAIL'}: ${JSON.stringify(row.audit.species)}`);
  report.modes.B = row;
}
if (MODES.includes('C')) {
  report.modes.C = [];
  await setFade(FADE);
  for (const v of [[5, 'tee', 'noon'], [1, 'tee', 'golden'], [13, 'tee', 'golden']]) {
    await setView(v);
    const cam = await ev(() => window.V3D.camInfo());
    const dx = cam.look[0] - cam.pos[0], dz = cam.look[2] - cam.pos[2], L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
    const series = [], sw = [], blockMaxes = [], blocksChanged = [];
    let prevSw = (await tiers()).switches, total = 0;
    await delta();
    for (let i = 0; i < N; i++) {
      const x = cam.pos[0] + ux * STEP * i, z = cam.pos[2] + uz * STEP * i;
      await freeze(true);
      await ev(([x, z, ux, uz]) => { const y = window.V3D.probeH(x, z) + 1.7; window.V3D.placeCamera([x, y, z], [x + ux * 40, y, z + uz * 40]); }, [x, z, ux, uz]);
      await streamIdle(); await oneFrame(); await delta();
      await freeze(false); await stepClock(1 / 60);
      const d = await delta(), t = await tiers();
      series.push(d.changed); blockMaxes.push(d.blockMax); blocksChanged.push(d.blocksChanged); sw.push(t.switches - prevSw); prevSw = t.switches; total = d.total;
    }
    const sorted = [...series].sort((a, b) => a - b);
    const q = p => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
    const median = q(0.5), p95 = q(0.95), max = sorted[sorted.length - 1];
    const row = { view: v, frames: N, stepM: STEP, total, medianPct: pct(median, total), p95Pct: pct(p95, total), maxPct: pct(max, total),
                  maxPx: max, p95Px: p95, medianPx: median, framesWithChange: series.filter(v => v > 0).length,
                  maxOverMedian: median ? +(max / median).toFixed(2) : null, p95OverMedian: median ? +(p95 / median).toFixed(2) : null,
                  blockMax: Math.max(...blockMaxes), blockP95: [...blockMaxes].sort((a, b) => a - b)[Math.floor(0.95 * (blockMaxes.length - 1))],
                  blocksChangedMax: Math.max(...blocksChanged), blocksChangedSum: blocksChanged.reduce((a, b) => a + b, 0),
                  framesWithSwitches: sw.filter(s => s > 0).length, switchesTotal: sw.reduce((a, b) => a + b, 0), series, switches: sw, blockMaxes, blocksChanged };
    console.log(`  C hole ${v[0]}: tiering-only change per frame median ${row.medianPct}% p95 ${row.p95Pct}% max ${row.maxPct}% | max ${max} px, ${row.framesWithChange} of ${N} frames changed anything | block mean max ${row.blockMax}/255 p95 ${row.blockP95}, blocks over 6/255: max ${row.blocksChangedMax} per frame, ${row.blocksChangedSum} in all | ${row.framesWithSwitches} of ${N} frames switched ${row.switchesTotal} trees`);
    report.modes.C.push(row);
  }
  await setFade(0);
}
if (MODES.includes('S')) {
  report.modes.S = [];
  await setFade(0);
  for (const v of [[5, 'tee', 'noon'], [1, 'tee', 'golden'], [13, 'tee', 'golden']]) {
    await setView(v);
    const cam = await ev(() => window.V3D.camInfo());
    const dx = cam.look[0] - cam.pos[0], dz = cam.look[2] - cam.pos[2], L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
    const row = { view: v, frames: 120, stepM: 0.1, fit: await ev(() => window.V3D.shadowFit()) };
    await freeze(true);
    for (const snap of [true, false]) {
      await ev(on => window.V3D.setShadowSnap(on), snap);
      const series = [], blockMaxes = [], tilesChanged = [];
      let prevTiles = null, total = 0;
      for (let i = 0; i < 120; i++) {
        const x = cam.pos[0] + ux * 0.1 * i, z = cam.pos[2] + uz * 0.1 * i;
        await ev(([x, z, ux, uz]) => { const y = window.V3D.probeH(x, z) + 1.7; window.V3D.placeCamera([x, y, z], [x + ux * 40, y, z + uz * 40]); }, [x, z, ux, uz]);
        await streamIdle(); await oneFrame();
        /* the far ground only (rows 42-55% of the frame, under the horizon), and a 6/255 threshold: camera parallax there is sub-pixel, a shadow's swim is not */
        const d = await ev(() => window.V3D.pixelDelta(6, false, [0.42, 0.55])), tiles = await ev(() => window.V3D.v2Terrain().adapter?.stream?.renderedTiles ?? null);
        if (i > 0) { series.push(d.changed); blockMaxes.push(d.blockMax); tilesChanged.push(prevTiles !== null && tiles !== prevTiles ? 1 : 0); }
        prevTiles = tiles; total = d.total;
      }
      const q = (arr, p) => { const s2 = [...arr].sort((a, b) => a - b); return s2[Math.min(s2.length - 1, Math.floor(p * (s2.length - 1)))]; };
      row[snap ? 'snapped' : 'unsnapped'] = { medianPct: pct(q(series, 0.5), total), p95Pct: pct(q(series, 0.95), total), maxPct: pct(Math.max(...series), total),
        blockMedian: q(blockMaxes, 0.5), blockP95: q(blockMaxes, 0.95), blockMax: Math.max(...blockMaxes), tileSwaps: tilesChanged.reduce((a, b) => a + b, 0) };
    }
    await freeze(false); await ev(() => window.V3D.setShadowSnap(true));
    const s1 = row.snapped, s0 = row.unsnapped;
    console.log(`  S hole ${v[0]} ${v[2]} (fit ${row.fit.R} m, texel ${row.fit.texel} m): per-frame change snapped median ${s1.medianPct}% p95 ${s1.p95Pct}% | unsnapped median ${s0.medianPct}% p95 ${s0.p95Pct}% | worst block mean snapped ${s1.blockMax} vs unsnapped ${s0.blockMax} /255 | tile swaps ${s1.tileSwaps}/${s0.tileSwaps}`);
    report.modes.S.push(row);
  }
}
report.errors = errors;
if (errors.length) console.log('page errors:', errors.join(' | '));
if (OUT) { fs.mkdirSync(OUT.replace(/[\\/][^\\/]*$/, '') || '.', { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n'); console.log(`wrote ${OUT}`); }
await browser.close();
