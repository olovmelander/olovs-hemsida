/* Phase 0 of the vegetation plan: freeze and measure the legacy tree
   population before anything about it changes.

   usage: node tools/vegetation-baseline.mjs [baseUrl] [--course puttom]
            [--shots] [--out geo_data/course-v2/<course>/vegetation/phase0-baseline.json]
   e.g.   node tools/serve.mjs apps/golf/dist 8620 &
          BANVY_GPU=1 node tools/vegetation-baseline.mjs http://127.0.0.1:8620 --course puttom --shots

   Boots the built app twice -- the plain GPK1 path and ?v2=require -- and
   records what V3D reports: the tree population by species, by the source
   that planted each tree, by hole and by provisional zone; draw calls and
   the other instance counts; boot marks; and the v2 selection's object-layer
   state, which today must be "no renderer, zero tiles". With --shots it also
   captures every tee view and an overhead, and records their SHA-256s so the
   pictures (gitignored, like the goldens) are pinned by content.

   The identities of the inputs -- pack, tree-cover raster, published v2
   manifests -- are read from the committed manifests, not recomputed, so the
   baseline names exactly the artifacts the cutover will be measured against. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { ROOT } from '../geobuild/lib.mjs';
import { browserArgs, GPU } from './browser-args.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const BASE = args.find(a => !a.startsWith('--') && /^https?:/.test(a)) || 'http://127.0.0.1:8620';
const SLUG = flag('course', 'puttom');
const SHOTS = args.includes('--shots');
/* `--label phase0` froze the legacy population; `--label v2` (default once
   the vegetation runtime exists) gates the published generation: registry
   and stand trees planted, the lattice cut out of their coverage, bases on
   the visible ground. */
const LABEL = flag('label', 'v2');
const EXPECT_V2 = LABEL !== 'phase0';
const OUT = path.resolve(ROOT, flag('out', `geo_data/course-v2/${SLUG}/vegetation/${LABEL === 'phase0' ? 'phase0-baseline' : 'phase4-vegetation'}.json`));
const SHOT_DIR = path.resolve(ROOT, flag('shot-dir', `tools/goldens/${SLUG}-vegetation-${LABEL === 'phase0' ? 'baseline' : 'v2'}`));
const BOOT_TIMEOUT = +(process.env.BANVY_BOOT_TIMEOUT || 600) * 1000;
const LINUX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const CHROME = fs.existsSync(LINUX_CHROME) ? LINUX_CHROME : undefined;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sha256Lf = file => sha256(fs.readFileSync(file).toString('latin1').replace(/\r\n/g, '\n'));

/* input identities */
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/golf/public/courses/index.json'), 'utf8'));
const course = index.courses.find(c => c.slug === SLUG);
if (!course) throw new Error(`${SLUG} is not in the course manifest`);
const sourceManifestPath = path.join(ROOT, `geo_data/course-v2/${SLUG}/source-manifest.json`);
const sourceManifest = fs.existsSync(sourceManifestPath) ? JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8')) : null;
const artifact = id => sourceManifest?.artifacts.find(a => a.id === id) || null;
const publicDir = name => {
  const dir = path.join(ROOT, 'apps/golf/public', name);
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
};
const inputs = {
  pack: { url: course.packUrl, bytes: course.bytes, sha256: course.sha256 },
  treeCover: artifact('legacy-tree-cover'),
  courseModel: artifact('legacy-course-model'),
  courseV2Manifest: publicDir(`courses/${SLUG}`).find(n => /^course-v2-[a-f0-9]{64}\.json$/.test(n)) || null,
  groundV2Manifest: publicDir(`grounds/${SLUG}`).find(n => /^ground-v2-[a-f0-9]{64}\.json$/.test(n)) || null,
  groundPreviewDescriptorSha256: fs.existsSync(path.join(ROOT, `apps/golf/public/grounds/${SLUG}/preview.json`))
    ? sha256Lf(path.join(ROOT, `apps/golf/public/grounds/${SLUG}/preview.json`)) : null,
};

const browser = await chromium.launch({
  ...(CHROME ? { executablePath: CHROME } : { channel: 'chrome' }),
  args: browserArgs(),
});
const runs = [];
let failed = 0;
const gate = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };

for (const mode of [{ label: 'gpk1', search: '&det=1&v2=0' }, { label: 'v2-require', search: '&det=1&v2=require' }]) {
  const url = `${BASE}/?bana=${SLUG}${mode.search}`;
  console.log(`\n${SLUG} ${mode.label} <- ${url}`);
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(300000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).split('\n')[0].slice(0, 200)));
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  let booted = true;
  try { await page.waitForSelector('#boot.done', { timeout: BOOT_TIMEOUT }); }
  catch { booted = false; }
  const bootSeconds = (Date.now() - t0) / 1000;
  gate(booted, `boot completed (${bootSeconds.toFixed(1)} s)`);
  if (!booted) { runs.push({ mode: mode.label, url, booted: false, errors }); await page.close(); continue; }
  gate(errors.length === 0, `no page errors${errors.length ? ' -- ' + errors[0] : ''}`);

  const report = await page.evaluate(() => {
    const V = window.V3D;
    const v2 = V.v2Terrain();
    return {
      stats: { ...V.stats },
      trees: V.legacyTrees(),
      objects: V.v2Objects(),
      perf: V.perf(),
      v2: {
        requested: v2.requested, ready: v2.ready, status: v2.status, reason: v2.reason,
        selection: { mode: v2.selection.mode, requestMode: v2.selection.requestMode, graph: v2.selection.graph, graphError: v2.selection.graphError },
        bounds: v2.bounds, backend: v2.backend,
      },
      course: V.course(),
    };
  });
  gate(report.trees.total === report.stats.trees, `tree export (${report.trees.total}) matches stats.trees (${report.stats.trees})`);
  const objects = report.objects;
  if (mode.label === 'gpk1' || !EXPECT_V2) {
    gate(objects.loaded === null && !(report.trees.reasons.v2Individual > 0) && !(report.trees.reasons.v2Stand > 0),
      `no v2 vegetation on the ${mode.label} path (${objects.graphObjectTiles ?? 'no graph'} object tiles referenced)`);
  } else {
    gate(objects.loaded !== null && objects.error === null, `v2 vegetation loaded${objects.error ? ' -- ' + objects.error : ''}`);
    const loaded = objects.loaded || {};
    gate(loaded.loadedTiles > 0 && loaded.loadedTiles >= Math.max(loaded.referencedObjectTiles || 0, loaded.referencedStandTiles || 0),
      `all referenced tiles loaded (${loaded.loadedTiles} tiles, ${loaded.records} records, ${loaded.bytes} bytes)`);
    const planned = objects.planned || {};
    gate(planned.individuals > 0 && planned.standTrees > 0, `registry individuals ${planned.individuals} and stand trees ${planned.standTrees} planted`);
    gate(report.trees.legacyInsideCoverage === 0, `legacy lattice cut out of v2 coverage (${report.trees.legacyInsideCoverage} inside ${objects.coverageTiles} tiles)`);
    gate(planned.baseMismatch?.p95Metres !== null && planned.baseMismatch?.p95Metres <= 0.5,
      `registry bases agree with the visible ground (p95 ${planned.baseMismatch?.p95Metres} m, max ${planned.baseMismatch?.maxMetres} m over ${planned.baseMismatch?.samples})`);
  }
  console.log(`  trees ${report.trees.total}: ${JSON.stringify(report.trees.species)} reasons ${JSON.stringify(report.trees.reasons)} zones ${JSON.stringify(report.trees.zones)}`);
  console.log(`  draws ${report.stats.draws}, vista ${report.stats.vista}, bushes ${report.stats.bushes}, tufts ${report.stats.tufts}, backend ${report.stats.backend}, v2 ${report.v2.selection.mode}/${report.v2.status}`);

  const shots = [];
  if (SHOTS) {
    const dir = path.join(SHOT_DIR, mode.label);
    fs.mkdirSync(dir, { recursive: true });
    const holes = report.course.holes || report.trees.holes.length || 18;
    const views = [{ id: 'h01_top', hole: 1, cam: 'top', preset: 'noon' }];
    for (let n = 1; n <= holes; n++) views.push({ id: `h${String(n).padStart(2, '0')}_tee`, hole: n, cam: 'tee', preset: 'golden' });
    for (const view of views) {
      await page.evaluate(([h, c, p]) => {
        window.V3D.setPreset?.(p);
        window.V3D.goHole?.(h, true, true);
        window.V3D.setCam?.(c, true);
      }, [view.hole, view.cam, view.preset]);
      await page.waitForFunction(() => window.V3D?.settled?.() !== false, null, { timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(1400);
      const file = path.join(dir, `${view.id}.png`);
      await page.screenshot({ path: file, timeout: 300000, animations: 'disabled' });
      const cam = await page.evaluate(() => window.V3D.camInfo());
      shots.push({ ...view, file: path.relative(ROOT, file), sha256: sha256(fs.readFileSync(file)), cam });
      console.log(`  shot ${view.id}`);
    }
  }
  runs.push({ mode: mode.label, url, booted: true, bootSeconds: +bootSeconds.toFixed(1), errors, ...report, shots });
  await page.close();
}
await browser.close();

const baseline = {
  schemaVersion: 1,
  phase: EXPECT_V2 ? 'vegetation-plan-phase-4-published-generation' : 'vegetation-plan-phase-0-baseline',
  courseSlug: SLUG,
  observedOn: new Date().toISOString().slice(0, 10),
  baseUrl: BASE,
  renderer: GPU ? 'gpu-angle-d3d11' : 'swiftshader',
  note: 'SwiftShader captures are rendering evidence, not hardware performance evidence; boot seconds are indicative only. Zoning in the tree export is provisional until the plan approves zone-A geometry.',
  inputs,
  runs,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(baseline, null, 2) + '\n');
console.log(`\nwrote ${path.relative(ROOT, OUT)} (${failed ? failed + ' gate(s) FAILED' : 'all gates passed'})`);
process.exit(failed ? 1 : 0);
