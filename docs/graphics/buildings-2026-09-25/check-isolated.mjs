// The buildings batch in isolated scenes (isolated.html), on WebGL2 and on WebGPU
// with reversed depth, read back linear:
//  - the batch's houses: the wall's foot darkens exactly as building-paint.mjs
//    says, only on walls and only below its band, and every other pixel is the
//    same value as without it; the ridge lights each slope from its eaves up as
//    it says, and nothing else. "Exactly": a paint scales a surface's colour,
//    and only the share of a pixel's light that follows its colour follows the
//    paint -- not the specular sheen or the haze. Each pixel's share is read
//    from the same view with every colour scaled by ALBEDO, and the pixel's
//    change must be its share of its paint;
//  - the courses' own Blender models, from their files: the foot darkens only
//    walls' lowest half metre, and every other pixel of the model -- every
//    colour it was made with -- is the same value as without it;
//  - a map's alpha: should a model bring a map, only its colour takes the foot;
//  - the models' metal and glass under each low sun: what of each material
//    reaches that light's glow threshold (glow.mjs);
// and pictures through the app's own pipeline. Software rendering by default,
// BANVY_GPU=1 for the real adapter. Run from the repository root:
//   node docs/graphics/buildings-2026-09-25/check-isolated.mjs
// (BANVY_BACKENDS=webgpu picks the backends and BANVY_MODELS=angso,tortuna the
// models; BANVY_QUICK=1 leaves out the metals and the pictures, for iterating:
// the report is from a full run.)
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from '../../../tools/browser-args.mjs';
import { BUILDING_PAINT, wallFootAt } from '../../../apps/golf/src/engine/building-paint.mjs';
import { GLOW } from '../../../apps/golf/src/engine/glow.mjs';

const dir = 'docs/graphics/buildings-2026-09-25';
const out = process.argv[2] || `${dir}/isolated-check.json`;
const port = 8701;
const BACKENDS = (process.env.BANVY_BACKENDS || 'webgl2,webgpu').split(',');
const QUICK = process.env.BANVY_QUICK === '1';
const MODELS = process.env.BANVY_MODELS?.split(',');
const LOW_SUN = ['golden', 'dawn', 'midnight', 'host'];
/* a change this small is rounding, not paint: the half-float target keeps 11 significant bits, and cutting
   a gable end where its slopes are cut moves a flat-shaded pixel's last bit or two */
const ROUNDING = 0.004;
/* each pixel's share of its light that follows its colour, s: with every colour x ALBEDO it is lit
   1 + s (ALBEDO - 1) times as brightly, and a paint of k takes it to 1 + s (k - 1) */
const ALBEDO = 0.8;
const sharesOf = (before, scaled) => { const s = new Float32Array(before.length / 4);
  for (let i = 0; i < s.length; i++) { const a = lumOf(before, i * 4); s[i] = a > 1e-4 ? (lumOf(scaled, i * 4) / a - 1) / (ALBEDO - 1) : 0; }
  return s; };
/* what the paint should do to a pixel: measured against expected, the error's median and 90th percentile */
const errorsOf = (list, kOf, shares) => {
  const rows = list.map(p => { const k = kOf(p), s = shares[p.i], expected = 1 + s * (k - 1); return { k, s, expected, error: Math.abs(p.ratio - expected) }; });
  return { k: rows.map(r => r.k), s: rows.map(r => r.s), expected: rows.map(r => r.expected), error: rows.map(r => r.error) };
};
const WITHIN = { median: 0.005, p90: 0.015 };
const decode = (s, T) => { const b = Buffer.from(s, 'base64'); return new T(new Uint8Array(b).buffer); };
const lumOf = (c, k) => 0.2126 * c[k] + 0.7152 * c[k + 1] + 0.0722 * c[k + 2];
const r3 = v => Math.round(v * 1000) / 1000;
const slopeGround = (x, z) => 0.12 * x + 0.03 * z;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const server = spawn(process.execPath, ['tools/serve.mjs', '.', String(port)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));
const argsFor = b => b === 'webgpu' ? [...browserArgs(), '--enable-unsafe-webgpu',
  ...(GPU ? [] : ['--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface'])] : browserArgs();
const report = { adapter: GPU ? 'gpu' : 'swiftshader', constants: BUILDING_PAINT, backends: {} };
let failed = false;
const check = (backend, label, ok, detail) => {
  report.backends[backend].checks.push({ label, ok, ...detail });
  if (!ok) failed = true;
  console.log(`${backend} ${ok ? 'ok  ' : 'FAIL'} ${label} ${JSON.stringify(detail).slice(0, 700)}`);
};

/* where two read-backs differ, and how: every pixel's height over the ground stamped under it, its |normal.y|,
   whether it has a stamped ground (a house or a model) and, if it changed, by what ratio; `behind` labels
   what shows through a model's glass, and `layers` the least share the foot leaves any glass layer in front */
function compare(before, after, above, offset, behind = null, layers = null) {
  const changed = [], stillAbove = [];
  let same = 0, pixels = 0;
  for (let i = 0; i < before.length / 4; i++) {
    const k = i * 4;
    if (above[k + 3] === 0) continue;   /* nothing drawn: the sky */
    pixels++;
    const stamped = above[k + 2] > 0.5, height = above[k] - offset, normalY = above[k + 1];
    const identical = before[k] === after[k] && before[k + 1] === after[k + 1] && before[k + 2] === after[k + 2];
    if (identical) { same++; continue; }
    const a = lumOf(before, k), b = lumOf(after, k);
    const p = { i, stamped, height, normalY, ratio: a > 1e-4 ? b / a : 1 };
    changed.push(p);
  }
  return { pixels, same, changed, above, behind, layers };
}
/* a changed pixel is explained when it, what shows through its glass or a glass layer between is `is`, or it
   touches such a pixel (an edge: the label names one surface where the pixel's own sample may have fallen on
   the other), or when it changed by no more than rounding */
function unexplained(c, offset, is, W = 480) {
  const label = (a, i) => { const k = i * 4; return { stamped: a[k + 2] > 0.5, height: a[k] - offset, normalY: a[k + 1] }; };
  const isAt = i => is(label(c.above, i)) || (c.behind !== null && is(label(c.behind, i))) || (c.layers !== null && c.layers[i * 4] < 1 - 1e-3);
  return c.changed.filter(p => {
    if (Math.abs(p.ratio - 1) <= ROUNDING || isAt(p.i)) return false;
    const x = p.i % W, y = Math.floor(p.i / W);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const j = (y + dy) * W + (x + dx);
      if (x + dx >= 0 && x + dx < W && j >= 0 && j < c.above.length / 4 && isAt(j)) return false;
    }
    return true;
  });
}
const rounding = c => c.changed.filter(p => Math.abs(p.ratio - 1) <= ROUNDING).length;
const detail = (list, ids = null, materials = null) => list.slice(0, 6).map(p => ({ x: p.i % 480, y: Math.floor(p.i / 480), stamped: p.stamped,
  height: r3(p.height), normalY: r3(p.normalY), ratio: r3(p.ratio), ...(ids ? { material: materials[Math.round(ids[p.i * 4]) - 1]?.name ?? 'the ground' } : {}) }));
const median = values => { const v = [...values].sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
const quantile = (values, f) => { const v = [...values].sort((a, b) => a - b); return v.length ? v[Math.floor(f * (v.length - 1))] : null; };
/* the foot band by band up the wall: its paint (the curve), each pixel's share of it, and the measured change
   against that pixel's expected one */
function footBands(changed, shade, shares, bands = 6) {
  const rows = [];
  for (let j = 0; j < bands; j++) {
    const lo = shade.metres * j / bands, hi = shade.metres * (j + 1) / bands;
    const inBand = changed.filter(p => p.stamped && p.height >= lo && p.height < hi && p.normalY < 0.3);
    if (inBand.length < 12) continue;
    const e = errorsOf(inBand, p => wallFootAt(p.height, p.normalY, shade), shares);
    rows.push({ from: r3(lo), to: r3(hi), pixels: inBand.length, paint: r3(median(e.k)), share: r3(median(e.s)),
      expected: r3(median(e.expected)), measured: r3(median(inBand.map(p => p.ratio))),
      error: r3(median(e.error)), error90: r3(quantile(e.error, 0.9)) });
  }
  return rows;
}
const bandsWithin = bands => bands.every(b => b.error < WITHIN.median && b.error90 < WITHIN.p90);

try {
  for (const backend of BACKENDS) {
    report.backends[backend] = { checks: [], metals: {} };
    const reads = [];
    const browser = await chromium.launch({ ...browserExecutable(), args: argsFor(backend) });
    const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e).slice(0, 400)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 400)); });
    await page.goto(`http://127.0.0.1:${port}/${dir}/isolated.html?backend=${backend}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__result, null, { timeout: 900000, polling: 500 });
    const ready = await page.evaluate(() => window.__result);
    if (!ready.ready) throw new Error(`${backend}: ${ready.error}`);
    const call = (fn, a) => page.evaluate(([f, x]) => window[f](x), [fn, a]);

    /* THE BATCH'S HOUSES, on ground sloping 12% */
    const village = async options => {
      const r = await call('__village', options);
      reads.push({ what: `village ${options.preset} ${options.view}${options.foot ? ' foot' : ''}${options.ridge ? ' ridge' : ''}${options.albedo ? ' scaled' : ''}`, renders: r.renders, settled: r.settled });
      return { colour: decode(r.colour, Float32Array), above: decode(r.above, Float32Array), shade: decode(r.shade, Float32Array), offset: r.offset };
    };
    const foot = BUILDING_PAINT.foot.batch;
    const footRows = {};
    for (const preset of ['golden', 'noon']) {
      const before = await village({ preset, ridge: false, foot: false, view: 'front' });
      const after = await village({ preset, ridge: false, foot: true, view: 'front' });
      const scaled = await village({ preset, ridge: false, foot: false, view: 'front', albedo: ALBEDO });
      const c = compare(before.colour, after.colour, after.above, after.offset);
      const bands = footBands(c.changed, foot, sharesOf(before.colour, scaled.colour));
      /* every change is a wall's foot, or an edge pixel touching one */
      const inFoot = p => p.stamped && p.height <= foot.metres + 0.05 && p.normalY < BUILDING_PAINT.steep[1] + 0.05;
      const odd = unexplained(c, after.offset, inFoot);
      footRows[preset] = { pixels: c.pixels, unchanged: c.same, changed: c.changed.length,
        onTheFoot: c.changed.filter(inFoot).length, atItsEdges: c.changed.filter(p => !inFoot(p)).length, rounding: rounding(c),
        unexplained: odd.length, bands, unexplainedPixels: detail(odd) };
    }
    check(backend, 'the batch\'s wall foot darkens walls\' foot band by its own curve and changes nothing else',
      Object.values(footRows).every(r => r.changed > 200 && r.unexplained === 0 && r.bands.length >= 4 && bandsWithin(r.bands)),
      { foot, albedo: ALBEDO, within: WITHIN, rows: footRows });

    const ridgeRows = {};
    for (const preset of ['golden', 'noon']) {
      const before = await village({ preset, ridge: false, foot: false, view: 'roofs' });
      const after = await village({ preset, ridge: true, foot: false, view: 'roofs' });
      const scaled = await village({ preset, ridge: false, foot: false, view: 'roofs', albedo: ALBEDO });
      const c = compare(before.colour, after.colour, after.above, after.offset);
      const isRoof = p => p.stamped && p.normalY > 0.5 && p.normalY < 0.97;
      const roofs = c.changed.filter(isRoof), odd = unexplained(c, after.offset, isRoof);
      /* each roof pixel's paint from its own label, its share of it from the scaled view */
      const e = errorsOf(roofs, p => after.shade[p.i * 4], sharesOf(before.colour, scaled.colour));
      ridgeRows[preset] = { pixels: c.pixels, unchanged: c.same, roofPixelsChanged: roofs.length,
        paint: { eaves: r3(Math.min(...e.k)), ridge: r3(Math.max(...e.k)) }, share: r3(median(e.s)),
        measured: { p01: r3(quantile(roofs.map(p => p.ratio), 0.01)), p99: r3(quantile(roofs.map(p => p.ratio), 0.99)) },
        error: r3(median(e.error)), error90: r3(quantile(e.error, 0.9)),
        atRoofEdges: c.changed.filter(p => !isRoof(p)).length, rounding: rounding(c), unexplained: odd.length, unexplainedPixels: detail(odd) };
    }
    const { eave, light } = BUILDING_PAINT.ridge;
    /* the pixels nearest the eaves and the ridge lie up to a pixel's footprint inside them: 12 cm of slope in this
       view, 0.002 of the eaves' paint and 0.019 of the band's */
    check(backend, 'the ridge lights each slope from its eaves up, and changes nothing but roofs and their edges',
      Object.values(ridgeRows).every(r => r.roofPixelsChanged > 500 && Math.abs(r.paint.eaves - eave) < 0.005 && Math.abs(r.paint.ridge - light) < 0.02
        && r.error < WITHIN.median && r.error90 < WITHIN.p90 && r.unexplained === 0), { eave, light, albedo: ALBEDO, within: WITHIN, rows: ridgeRows });

    /* THE BLENDER MODELS, from their own files */
    const modelFoot = BUILDING_PAINT.foot.model;
    const modelRows = {};
    const keys = (backend === 'webgl2' ? ready.models : ['angso', 'tortuna']).filter(k => !MODELS || MODELS.includes(k));
    for (const key of keys) {
      const row = modelRows[key] = { views: {} };
      for (const [view, close] of [['sun', 'foot'], ['away', 'foot'], ['side', false]]) {
        const before = await call('__model', { key, preset: 'golden', view, close, foot: false });
        const after = await call('__model', { key, preset: 'golden', view, close, foot: true });
        const scaled = await call('__model', { key, preset: 'golden', view, close, foot: false, albedo: ALBEDO });
        for (const [r, what] of [[before, ''], [after, ' foot'], [scaled, ' scaled']]) reads.push({ what: `${key} ${view}${what}`, renders: r.renders, settled: r.settled });
        const c = compare(decode(before.colour, Float32Array), decode(after.colour, Float32Array), decode(after.above, Float32Array), after.offset,
          after.behind ? decode(after.behind, Float32Array) : null, after.layers ? decode(after.layers, Float32Array) : null);
        row.meshes = after.report.meshes; row.materials = after.report.materials;
        const inFoot = p => p.stamped && p.height <= modelFoot.metres + 0.05 && p.normalY < BUILDING_PAINT.steep[1] + 0.05;
        const odd = unexplained(c, after.offset, inFoot);
        row.views[view] = { pixels: c.pixels, unchanged: c.same, changed: c.changed.length,
          onTheFoot: c.changed.filter(inFoot).length, atItsEdges: c.changed.filter(p => !inFoot(p)).length, rounding: rounding(c),
          seenThroughGlass: c.behind !== null, throughAGlassFoot: c.layers ? c.changed.filter(p => c.layers[p.i * 4] < 1 - 1e-3).length : 0,
          unexplained: odd.length,
          bands: footBands(c.changed, modelFoot, sharesOf(decode(before.colour, Float32Array), decode(scaled.colour, Float32Array)), 4),
          unexplainedPixels: detail(odd, decode(after.ids, Float32Array), after.materials) };
      }
    }
    /* how much wall stands in the band over the ground given here: a building on a slope stands its uphill walls
       above its lowest point, so some show no foot in these views. check-boot.mjs measures the same on each
       course's own ground. */
    for (const key of keys) {
      const buildings = await call('__footArea', key);
      const sum = f => Math.round(buildings.reduce((s, b) => s + b[f], 0) * 10) / 10;
      modelRows[key].footArea = { wall: sum('wall'), foot: sum('foot'), buildings: buildings.length,
        withoutFoot: buildings.filter(b => b.wall > 5 && b.foot === 0).map(b => b.name) };
    }
    /* not vacuous: the foot is in view on at least half the models */
    const shown = Object.values(modelRows).filter(r => Object.values(r.views).some(v => v.onTheFoot > 20)).length;
    check(backend, 'each Blender model takes the foot on its walls\' lowest half metre only, by its own curve: every other pixel keeps its value',
      Object.values(modelRows).every(r => Object.values(r.views).every(v => v.unexplained === 0 && bandsWithin(v.bands)))
        && shown >= Math.ceil(Object.keys(modelRows).length / 2), { foot: modelFoot, albedo: ALBEDO, within: WITHIN, modelsWhereTheFootShows: shown, models: modelRows });

    /* A MAP'S ALPHA: the panel's grey takes the foot, its alpha does not */
    {
      const r = await call('__alpha');
      const shade = r.shade, a = r.texel, value = (height, foot) => a * (foot ? wallFootAt(height, 0, shade) : 1) * a + (1 - a);
      const rows = {};
      for (const [name, row] of Object.entries(r.rows)) {
        const err = row.at.map(p => Math.abs(p.value - value(p.height, name === 'foot')));
        const low = row.at.reduce((m, p) => p.height < m.height ? p : m, row.at[0]);
        rows[name] = { settled: row.settled, pixels: row.at.length, worst: r3(Math.max(...err)), atTheGround: { height: r3(low.height), measured: r3(low.value), expected: r3(value(low.height, name === 'foot')),
          ifTheAlphaTookTheFoot: r3(a * wallFootAt(low.height, 0, shade) * a * wallFootAt(low.height, 0, shade) + 1 - a * wallFootAt(low.height, 0, shade)) } };
      }
      check(backend, 'a map\'s alpha passes through the foot: only the colour darkens',
        Object.values(rows).every(x => x.settled && x.pixels > 100 && x.worst < 0.004), { rows });
    }

    /* THE METAL AND GLASS, under each low sun: what of each material reaches the glow */
    if (backend === 'webgl2' && !QUICK) {
      const metals = report.backends[backend].metals;
      for (const key of ready.models) for (const preset of LOW_SUN) for (const view of ['sun', 'side', 'away']) {
        const r = await call('__model', { key, preset, view, foot: true });
        const colour = decode(r.colour, Float32Array), ids = decode(r.ids, Float32Array);
        const byMaterial = new Map();
        for (let i = 0; i < ids.length / 4; i++) {
          const id = Math.round(ids[i * 4]) - 1;
          if (id < 0) continue;
          if (!byMaterial.has(id)) byMaterial.set(id, []);
          byMaterial.get(id).push(lumOf(colour, i * 4));
        }
        for (const [id, values] of byMaterial) {
          if (values.length < 30) continue;
          const m = r.materials[id];
          values.sort((a, b) => a - b);
          const p99 = values[Math.floor(0.99 * (values.length - 1))], max = values[values.length - 1];
          const over = values.filter(v => v > r.threshold).length / values.length;
          const kept = values.reduce((s, v) => s + smooth(r.threshold, r.threshold + GLOW.knee, v) * v, 0) / values.length;
          const name = `${key}: ${m.name}`;
          const row = (metals[name] ||= { metalness: r3(m.metalness), roughness: r3(m.roughness), colour: m.colour, worst: null });
          if (!row.worst || kept > row.worst.kept) row.worst = { preset, view, threshold: r.threshold, pixels: values.length, p99: r3(p99), max: r3(max), over: r3(over), kept: r3(kept) };
        }
      }
      const passing = Object.entries(metals).filter(([, v]) => v.worst.over > 0).sort((a, b) => b[1].worst.kept - a[1].worst.kept);
      report.metalsPassing = passing.map(([name, v]) => ({ name, ...v }));
      console.log(`${backend}      materials reaching a low sun's glow threshold: ${passing.length} of ${Object.keys(metals).length}`);
      for (const [name, v] of passing.slice(0, 25)) console.log(`   ${name.padEnd(64)} metal ${v.metalness} rough ${v.roughness} ${v.colour}  ${v.worst.preset} ${v.worst.view}: p99 ${v.worst.p99} max ${v.worst.max} over ${v.worst.over} kept ${v.worst.kept}`);
    }

    check(backend, 'every read-back settled: two renders in a row agree', reads.every(r => r.settled),
      { reads: reads.length, renders: reads.reduce((s, r) => s + r.renders, 0), mostRenders: Math.max(...reads.map(r => r.renders)),
        unsettled: reads.filter(r => !r.settled).map(r => r.what) });
    check(backend, 'no page errors', errors.length === 0, { errors: errors.slice(0, 3) });

    /* PICTURES, through the app's own pipeline */
    if (backend === 'webgl2' && !QUICK) {
      const shots = [];
      const shoot = async (label, options) => { await call('__picture', options); shots.push({ label, png: (await page.locator('canvas').first().screenshot()).toString('base64') }); };
      await shoot('houses, before', { kind: 'village', preset: 'golden', ridge: false, foot: false, view: 'front' });
      await shoot('houses, wall foot and ridge', { kind: 'village', preset: 'golden', ridge: true, foot: true, view: 'front' });
      await shoot('roofs, before', { kind: 'village', preset: 'golden', ridge: false, foot: false, view: 'ridge' });
      await shoot('roofs, ridge', { kind: 'village', preset: 'golden', ridge: true, foot: false, view: 'ridge' });
      for (const [key, view] of [['veckefjarden church', 'sun'], ['ribbingsfors', 'away'], ['tortuna', 'away']]) {
        await shoot(`${key}, before`, { kind: 'model', key, preset: 'golden', view, close: 'foot', foot: false });
        await shoot(`${key}, wall foot`, { kind: 'model', key, preset: 'golden', view, close: 'foot', foot: true });
      }
      /* the glow batch's lower thresholds on sunlit white walls: the midnight sun's 0.50 against the old 0.86 */
      const white = [];
      const shootWhite = async (label, options) => { await call('__picture', options); white.push({ label, png: (await page.locator('canvas').first().screenshot()).toString('base64') }); };
      for (const key of ['veckefjarden church', 'tortuna']) {
        await shootWhite(`${key}, midnight sun, glow at 0.86`, { kind: 'model', key, preset: 'midnight', view: 'away', foot: true, glowBefore: true });
        await shootWhite(`${key}, midnight sun, glow at 0.50`, { kind: 'model', key, preset: 'midnight', view: 'away', foot: true });
      }
      shots.whiteFacades = white;
      const compose = async shots => {
        const images = await Promise.all(shots.map(async s => { const im = new Image(); im.src = `data:image/png;base64,${s.png}`; await im.decode(); return im; }));
        const w = images[0].width, h = images[0].height, c = document.createElement('canvas');
        c.width = w * 2; c.height = h * Math.ceil(images.length / 2);
        const g = c.getContext('2d');
        images.forEach((im, i) => {
          const x = (i % 2) * w, y = Math.floor(i / 2) * h;
          g.drawImage(im, x, y);
          g.font = '14px sans-serif';
          const width = g.measureText(shots[i].label).width + 12;
          g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(x + 6, y + 6, width, 22);
          g.fillStyle = '#fff'; g.fillText(shots[i].label, x + 12, y + 22);
        });
        return c.toDataURL('image/jpeg', 0.88).split(',')[1];
      };
      const jpg = await page.evaluate(compose, shots);
      fs.writeFileSync(`${dir}/buildings.jpg`, Buffer.from(jpg, 'base64'));
      const whiteJpg = await page.evaluate(compose, shots.whiteFacades);
      fs.writeFileSync(`${dir}/white-facades.jpg`, Buffer.from(whiteJpg, 'base64'));
    }
    await browser.close();
  }
} finally {
  server.kill();
}
const written = QUICK ? process.env.BANVY_QUICK_OUT || '/dev/null' : out;
fs.writeFileSync(written, JSON.stringify(report, null, 1) + '\n');
console.log(failed ? 'isolated check FAILED' : `isolated check passed -> ${written}`);
process.exitCode = failed ? 1 : 0;
