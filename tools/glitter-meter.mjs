/* The glitter meter: what twinkles, and what it is made of.

   A twinkle on a screen is a pixel whose value flips while its neighbours do
   not -- an edge sliding moves whole rows together; a sub-pixel gap in a tree
   crown opening and closing against the sky moves one pixel. So the number
   here is ISOLATED FLIPS between two consecutive frames: luminance moved by
   more than 40/255 while the eight neighbours moved by under 10 on average.
   Beside it: every pixel that moved by more than 24, the same restricted to
   the lower half (the ground), and the bright isolated points in ONE frame
   (a pixel brighter than the ring two pixels out by more than 60/255), which
   is what the eye reads as "particles" before anything moves.

   Two ways to drive the frame, one boot each:
     default   ?det=1 (clocks pinned, no breathing): the camera CREEPS --step
               metres and --yaw degrees a frame, so the count is what motion
               alone does. --step 0 --yaw 0.009 is the camera breathing's own
               peak rate (0.45 deg over a 5.5 s period, 0.16 px a frame at
               900 px and 48 deg) with no travel at all.
     --live    the clock runs and the camera stands still: what twinkles with
               nothing but time moving (wind sway, sky noise, shadow ticks).
               NOTE the breathing gaze is disabled while a readback is in
               flight (captureRenderLocked resets it), so --live never sees
               it; measure the breath as the drift above.

   Each condition switches one candidate off in the same boot, measures, and
   switches it back; "as is again" at the end proves every teardown restored
   its thing (its numbers must equal "as is"). --hide adds conditions that hide
   every scene object whose name matches a regex, e.g. the tree tiers:
     --hide "t0 hero=-t0$;t1 full=-t1$;impostors=impostor"

   What it found on 2026-09-10 (Puttom, 12th tee, golden, 1600x900, RTX 3070,
   the numbers in the two comments this commit added to main.js): the flips
   are the TREES -- 394 a frame under a creep, 139 without them, and the same
   394-430 whichever tier every tree is forced to (?lod=2|3|4), so it is the
   silhouette against the sky at sub-pixel scale and no template escapes it;
   4x MSAA is on and working (1598 without it). Nothing else moved the number:
   bloom, the environment map, the sun's specular, the shadow map, the ground's
   roughness or normals, the water, the sky, the far ring. At rest the breath
   supplied the drift (465 a frame at its peak rate) and the wind sway the
   rest (86 -> 45 with the sway faded past 140 m); three's TRAA, tried as an
   MRT velocity pass, came out WORSE here (1197 / 1694) because its history
   clamp rejects exactly these one-pixel features.

     node tools/serve.mjs apps/golf/dist 8627
     BANVY_GPU=1 node tools/glitter-meter.mjs [http://127.0.0.1:8627] [--course puttom]
        [--view 12:tee:golden] [--frames 8] [--step 0.12] [--yaw 0.04] [--live]
        [--query k=v&k=v] [--conds "as is,trees hidden"] [--hide "label=regex;..."]
        [--perframe] [--reduced-motion] [--out dir]     (writes <label>.png with every flip ringed) */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { browserArgs, GPU } from './browser-args.mjs';

if (!GPU) { console.error('BANVY_GPU=1 required: a flip is measured on the real adapter'); process.exit(2); }
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const BASE = args.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:8627';
const SLUG = flag('course', 'puttom');
const [H, CAM, PRESET] = String(flag('view', '12:tee:golden')).split(':');
const FRAMES = +flag('frames', 8), STEP = +flag('step', 0.12), YAW = +flag('yaw', 0.04);
const QUERY = flag('query', '');
const OUT = flag('out', null);
const CONDS = String(flag('conds', 'all'));
const LIVE = args.includes('--live');
const PERFRAME = args.includes('--perframe');

const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(600000);
if (args.includes('--reduced-motion')) await page.emulateMedia({ reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', e => errors.push(String(e).split('\n')[0].slice(0, 200)));
const url = `${BASE}/?bana=${SLUG}${LIVE ? '' : '&det=1'}&v2=require&ren=1${QUERY ? `&${QUERY}` : ''}`;
console.log('boot', url);
await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('#boot.done');
const ev = (fn, arg) => page.evaluate(fn, arg);
await ev(([h, cam, preset]) => { const V = window.V3D; V.setPreset(preset); V.goHole(+h, true, true); V.setCam(cam, true); }, [H, CAM, PRESET]);
await page.waitForFunction(() => (window.V3D.v2Terrain().adapter?.stream?.loadingTiles ?? 0) === 0 && window.V3D.settled(), null, { polling: 50 });
await page.waitForTimeout(2500);
console.log('quality:', JSON.stringify(await ev(() => window.V3D.quality?.())));
console.log('tree meshes:', await ev(() => { const { scene } = window.V3D.harness(); const out = []; scene.traverse(o => { if (o.userData?.tag === 'trees') out.push(o.name + ':' + (o.count ?? o.geometry?.instanceCount ?? '')); }); return out.join(' '); }));

await ev(() => {
  const V = window.V3D;
  window.__gm = {
    prev: null, pose: null, mask: null, diff: null,
    savePose() { const { camera, controls } = V.harness(); this.pose = { p: camera.position.toArray(), t: controls.target.toArray() }; },
    restorePose() { V.placeCamera(this.pose.p, this.pose.t); },
    creep(step, yawDeg) {
      const { camera, controls } = V.harness();
      const p = camera.position.clone(), t = controls.target.clone();
      const f = t.clone().sub(p); f.y = 0; f.normalize().multiplyScalar(step);
      p.add(f); t.add(f);
      const yaw = yawDeg * Math.PI / 180; const d = t.clone().sub(p);
      const c = Math.cos(yaw), s = Math.sin(yaw); const dx = d.x * c - d.z * s, dz = d.x * s + d.z * c; d.x = dx; d.z = dz;
      t.copy(p).add(d);
      V.placeCamera(p.toArray(), t.toArray());
    },
    async measure(T = 40, iso = 10) {
      const { pixels, width, height } = await V.captureRaw();
      const N = width * height, L = new Float32Array(N);
      for (let i = 0; i < N; i++) L[i] = 0.299 * pixels[i * 4] + 0.587 * pixels[i * 4 + 1] + 0.114 * pixels[i * 4 + 2];
      const out = { width, height, frame: V.frame(), primed: !!this.prev, changed24: 0, lowerChanged: 0, specks: 0, specksUpper: 0, specksLower: 0, meanAbs: 0, bright: 0 };
      if (this.prev) {
        const P = this.prev, D = new Float32Array(N); let sum = 0;
        for (let i = 0; i < N; i++) { const d = Math.abs(L[i] - P[i]); D[i] = d; sum += d; if (d > 24) { out.changed24++; if (i >= N * 0.5) out.lowerChanged++; } }
        out.meanAbs = +(sum / N).toFixed(3);
        const mask = new Uint8Array(N);
        for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
          const i = y * width + x; if (D[i] <= T) continue;
          const nb = (D[i - 1] + D[i + 1] + D[i - width] + D[i + width] + D[i - width - 1] + D[i - width + 1] + D[i + width - 1] + D[i + width + 1]) / 8;
          if (nb < iso) { out.specks++; mask[i] = 1; if (y < height * 0.5) out.specksUpper++; else out.specksLower++; }
        }
        this.mask = mask; this.diff = D;
      }
      for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) {
        const i = y * width + x; const v = L[i]; if (v < 120) continue;
        const r = (L[i - 2] + L[i + 2] + L[i - 2 * width] + L[i + 2 * width] + L[i - 2 * width - 2] + L[i - 2 * width + 2] + L[i + 2 * width - 2] + L[i + 2 * width + 2]) / 8;
        if (v - r > 60) out.bright++;
      }
      this.prev = L;
      return out;
    },
    /* the frame with every flip ringed in magenta (rings) or every moved pixel painted (paint) */
    async annotated(paint = false) {
      const { pixels, width, height } = await V.captureRaw();
      const c = document.createElement('canvas'); c.width = width; c.height = height; const g = c.getContext('2d');
      const im = g.createImageData(width, height); im.data.set(pixels);
      if (paint && this.diff) for (let i = 0; i < width * height; i++) if (this.diff[i] > 24) { im.data[i * 4] = 255; im.data[i * 4 + 1] = 0; im.data[i * 4 + 2] = 255; }
      g.putImageData(im, 0, 0);
      if (!paint && this.mask) { g.strokeStyle = '#ff00ff'; g.lineWidth = 1; for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (this.mask[y * width + x]) { g.beginPath(); g.arc(x + 0.5, y + 0.5, 4, 0, Math.PI * 2); g.stroke(); } }
      return c.toDataURL('image/png');
    },
  };
  window.__gm.savePose();
});
const frame = () => ev(() => window.V3D.frame());
const oneFrame = async () => { const f = await frame(); await page.waitForFunction(f0 => window.V3D.frame() > f0, f, { polling: 5 }); };
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[(s.length - 1) >> 1] : 0; };
const mx = a => a.length ? Math.max(...a) : 0;
const savePng = (name, dataUrl) => fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));

async function run(label, setup, teardown) {
  await ev(() => window.__gm.restorePose());
  if (setup) await ev(setup);
  await oneFrame(); await oneFrame();
  await ev(() => { window.__gm.prev = null; });
  await ev(() => window.__gm.measure());   /* prime */
  const rows = [];
  for (let k = 0; k < FRAMES; k++) {
    if (!LIVE) await ev(([s, y]) => window.__gm.creep(s, y), [STEP, YAW]);
    await oneFrame();
    const r = await ev(() => window.__gm.measure()); rows.push(r);
    if (PERFRAME) {
      const sr = await ev(() => { const x = window.V3D.shadowRest?.(); const t = window.V3D.v2Terrain?.(); return x ? `shadow renders ${x.renders} why ${x.why} since ${x.sinceRender} | tiles loading ${t?.adapter?.stream?.loadingTiles ?? '?'}` : ''; });
      console.log(`      f${r.frame} specks ${r.specks} changed ${r.changed24} lower ${r.lowerChanged} bright ${r.bright} | ${sr}`);
      if (OUT && r.lowerChanged > 5000) savePng(`jump_${label.replace(/[^a-z0-9]+/gi, '_')}_f${r.frame}`, await ev(() => window.__gm.annotated(true)));
    }
  }
  if (OUT) savePng(label.replace(/[^a-z0-9]+/gi, '_'), await ev(() => window.__gm.annotated()));
  if (teardown) await ev(teardown);
  const sp = rows.map(r => r.specks), up = rows.map(r => r.specksUpper), lo = rows.map(r => r.specksLower), ch = rows.map(r => r.changed24), br = rows.map(r => r.bright), lc = rows.map(r => r.lowerChanged);
  console.log(`${label.padEnd(28)} flips med ${String(med(sp)).padStart(5)} max ${String(mx(sp)).padStart(5)} | upper ${String(med(up)).padStart(5)} lower ${String(med(lo)).padStart(5)} | moved>24 med ${String(med(ch)).padStart(7)} (ground ${String(med(lc)).padStart(6)} max ${String(mx(lc)).padStart(6)}) | bright pts ${String(med(br)).padStart(5)} | meanAbs ${med(rows.map(r => r.meanAbs))}`);
  return { label, rows };
}

const batches = () => window.V3D.harness().terrainV2.runtime?.layer?.batches;
const ALL = [
  ['as is', null, null],
  ['bloom 0', () => { const { renderer } = window.V3D.harness(); window.__b = renderer.__bloomNode?.strength.value; if (renderer.__bloomNode) renderer.__bloomNode.strength.value = 0; },
             () => { const { renderer } = window.V3D.harness(); if (renderer.__bloomNode) renderer.__bloomNode.strength.value = window.__b; }],
  ['environment 0', () => { const { scene } = window.V3D.harness(); window.__e = scene.environmentIntensity; scene.environmentIntensity = 0; },
                    () => { const { scene } = window.V3D.harness(); scene.environmentIntensity = window.__e; }],
  ['sun 0', () => { const { sun } = window.V3D.harness(); window.__s = sun.intensity; sun.intensity = 0; },
            () => { const { sun } = window.V3D.harness(); sun.intensity = window.__s; }],
  ['shadow frozen', () => window.V3D.setShadowUpdate(false), () => window.V3D.setShadowUpdate(true)],
  ['shadows off', () => { const { sun } = window.V3D.harness(); sun.castShadow = false; }, () => { const { sun } = window.V3D.harness(); sun.castShadow = true; sun.shadow.needsUpdate = true; }],
  ['trees hidden', () => window.V3D.setMeshesVisible({ tag: 'trees' }, false), () => window.V3D.setMeshesVisible({ tag: 'trees' }, true)],
  ['water hidden', () => window.V3D.setWaterVisible(false), () => window.V3D.setWaterVisible(true)],
  ['vista hidden', () => window.V3D.setMeshesVisible({ tag: 'vista' }, false), () => window.V3D.setMeshesVisible({ tag: 'vista' }, true)],
  ['instanced hidden', () => window.V3D.setMeshesVisible({ minInstances: 50 }, false), () => window.V3D.setMeshesVisible({}, true)],
  ['world hidden', () => window.V3D.setMeshesVisible({ world: true }, false), () => window.V3D.setMeshesVisible({ world: true }, true)],
  ['world roughness 1', () => { const b = window.V3D.harness().terrainV2.runtime?.layer?.batches; window.__r = new Map(); for (const x of b.values()) window.__r.set(x, x.material.roughnessNode); window.V3D.v2WorldMaterial({ roughness: 1 }); },
                        () => { for (const [x, n] of window.__r) { x.material.roughnessNode = n; x.material.needsUpdate = true; } }],
  ['world flat normal', () => { const b = window.V3D.harness().terrainV2.runtime?.layer?.batches; window.__n = new Map(); for (const x of b.values()) window.__n.set(x, x.material.normalNode); window.V3D.v2WorldMaterial({ flatNormal: true }); },
                        () => { for (const [x, n] of window.__n) { x.material.normalNode = n; x.material.needsUpdate = true; } }],
  ['world unlit', () => { const b = window.V3D.harness().terrainV2.runtime?.layer?.batches; window.__u = new Map(); for (const x of b.values()) window.__u.set(x, [x.material.colorNode, x.material.emissiveNode, x.material.lights]); window.V3D.v2WorldMaterial({ unlit: true }); },
                  () => { for (const [x, [c, e, l]] of window.__u) { x.material.colorNode = c; x.material.emissiveNode = e; x.material.lights = l; x.material.needsUpdate = true; } }],
  ['sky hidden', () => { const { scene } = window.V3D.harness(); window.__sky = []; scene.traverse(o => { if (o.isSkyMesh || /sky/i.test(o.constructor?.name || '') || o.userData?.tag === 'sky') { window.__sky.push([o, o.visible]); o.visible = false; } }); return window.__sky.length; },
                 () => { for (const [o, v] of window.__sky) o.visible = v; }],
  ['hero no sway', () => { const { scene } = window.V3D.harness(); window.__sw = []; scene.traverse(o => { if (/trees-.*-t0$/.test(o.name)) { window.__sw.push([o.material, o.material.positionNode]); o.material.positionNode = null; o.material.needsUpdate = true; } }); return window.__sw.length; },
                   () => { for (const [m, n] of window.__sw) { m.positionNode = n; m.needsUpdate = true; } }],
  ['hero crowns smooth', () => { const { scene } = window.V3D.harness(); window.__fl = []; scene.traverse(o => { if (/trees-.*-crown-t0$/.test(o.name)) { window.__fl.push(o.material); o.material.flatShading = false; o.material.needsUpdate = true; } }); return window.__fl.length; },
                   () => { for (const m of window.__fl) { m.flatShading = true; m.needsUpdate = true; } }],
  ['as is again', null, null],
];
void batches;
/* --hide "label=regex;label=regex": hide every scene object whose name matches, one condition each */
for (const spec of String(flag('hide', '')).split(';').filter(Boolean)) {
  const [label, re] = spec.split('=');
  ALL.splice(ALL.length - 1, 0, [label,
    new Function(`const { scene } = window.V3D.harness(); const R = new RegExp(${JSON.stringify(re)}); window.__h = []; scene.traverse(o => { if (o.name && R.test(o.name) && o.visible) { window.__h.push(o); o.visible = false; } }); return window.__h.length;`),
    () => { for (const o of window.__h) o.visible = true; }]);
}
const pick = CONDS === 'all' ? ALL : ALL.filter(c => CONDS.split(',').includes(c[0]));
const results = [];
for (const [label, setup, teardown] of pick) results.push(await run(label, setup, teardown));
if (errors.length) console.log('page errors:', errors);
if (OUT) fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
await browser.close();
