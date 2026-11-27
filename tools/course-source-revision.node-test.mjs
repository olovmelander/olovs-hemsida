/* A course's source revision: what it holds, what it leaves out, and what moves it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { courseRevisionCoverage, courseRevisionParts, courseSourceRevision, courseSourceRevisions, unheldModules } from './course-source-revision.mjs';
import { tidy } from '../packages/course-workflow/test-fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = 'apps/golf/src/engine';

/** A player small enough to read: two grounds, a module they share, a worker, the four tables, and code no player loads. */
function miniature(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'course-revision-'));
  t.after(() => tidy(root));
  const put = (file, text) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  put('apps/golf/package.json', JSON.stringify({ dependencies: { three: '0.187.0' } }));
  put('apps/golf/public/courses/index.json', JSON.stringify({ courses: [{ slug: 'alpha' }, { slug: 'beta-nine' }] }));
  put('apps/golf/src/main.js', ["import { x } from './engine/shared.mjs';", "import './ui/hud.mjs';", "import { pick } from './engine/v2-terrain-select.mjs';",
    "import { PROJECTED_GPS_FRAMES } from './engine/gps-projected-frames.mjs';", "const scenery = () => import('./engine/scenery/index.js');", ''].join('\n'));
  put('apps/golf/src/ui/hud.mjs', 'export const hud = 1;\n');
  put(`${ENGINE}/shared.mjs`, "import './decode.mjs';\nexport const x = 1;\n");
  put(`${ENGINE}/decode.mjs`, "export const worker = () => new Worker(new URL('../../../../packages/course-v2/runtime/entry.mjs', import.meta.url), { type: 'module' });\n");
  put('packages/course-v2/runtime/entry.mjs', "import './codec.mjs';\n");
  put('packages/course-v2/runtime/codec.mjs', 'export const decode = 1;\n');
  put('packages/course-v2/vegetation/compile.mjs', 'export const compile = 1;\n');
  put(`${ENGINE}/shared.test.mjs`, 'export const t = 1;\n');
  put(`${ENGINE}/scenery/index.js`, ['/* one module a ground */', 'const REGISTRY = {', "  alpha: () => import('./alpha.js'),", '  /* the nine on its own ground */', "  'beta-nine': () => import('./beta.js'),", '};',
    'export const load = slug => REGISTRY[slug]?.();', ''].join('\n'));
  put(`${ENGINE}/scenery/alpha.js`, "import roofs from './alpha-roofs.json' with { type: 'json' };\nimport './campus.mjs';\nexport const sand = 0xaa9d94;\n");
  put(`${ENGINE}/scenery/alpha-roofs.json`, '[1]\n');
  put(`${ENGINE}/scenery/beta.js`, "import './campus.mjs';\nexport const sand = 0xdedbd2;\n");
  put(`${ENGINE}/scenery/campus.mjs`, 'export const campus = 1;\n');
  put(`${ENGINE}/v2-terrain-select.mjs`, ["import { V2_GRAPH_FRONTIER_CONFIGS } from './v2-frontier-configs.mjs';", "export const V2_PUBLISHED_GRAPH_SLUGS = Object.freeze(['alpha', 'beta-nine']);",
    'export const pick = slug => V2_GRAPH_FRONTIER_CONFIGS[slug];', ''].join('\n'));
  put(`${ENGINE}/v2-frontier-configs.mjs`, ["import { ALPHA_V2_CONFIGS } from './v2-alpha-config.mjs';", "import { BETA_V2_CONFIGS } from './v2-beta-config.mjs';", '',
    'export const V2_GRAPH_FRONTIER_CONFIGS = Object.freeze({', '  ...ALPHA_V2_CONFIGS,', '  ...BETA_V2_CONFIGS,', '});', ''].join('\n'));
  put(`${ENGINE}/v2-alpha-config.mjs`, "export const ALPHA_V2_CONFIGS = Object.freeze({ alpha: Object.freeze({ slug: 'alpha', tiles: 64 }) });\n");
  put(`${ENGINE}/v2-beta-config.mjs`, "export const BETA_V2_CONFIGS = Object.freeze({ 'beta-nine': Object.freeze({ slug: 'beta-nine', tiles: 64 }) });\n");
  put(`${ENGINE}/gps-projected-frames.mjs`, ['export const PROJECTED_GPS_FRAMES = Object.freeze([', '  {', '    slug: "alpha",', '    packMetresPerLongitude: 56323.13,', '  },', ']);', ''].join('\n'));
  const revisions = () => courseSourceRevisions(root);
  /** The courses whose revision an edit moves. */
  const moved = change => { const before = revisions(); change(); const after = revisions(); return Object.keys(after).filter(slug => before[slug] !== after[slug]).sort(); };
  const append = (file, text) => put(file, read(file) + text);
  return { root, put, read, revisions, moved, append };
}

test('a course\'s revision holds the shared engine, its ground\'s own modules and its rows, and nothing no player loads', t => {
  const { root, revisions, moved, append, put, read } = miniature(t);
  const first = revisions();
  assert.deepEqual(Object.keys(first), ['alpha', 'beta-nine']);
  assert.ok(Object.values(first).every(value => /^[a-f0-9]{64}$/.test(value)) && first.alpha !== first['beta-nine']);
  assert.deepEqual(revisions(), first, 'the same source, the same revisions');

  const parts = courseRevisionParts(root, ['alpha', 'beta-nine']);
  assert.deepEqual(parts.shared, [`${ENGINE}/decode.mjs`, `${ENGINE}/gps-projected-frames.mjs`, `${ENGINE}/scenery/index.js`, `${ENGINE}/shared.mjs`,
    `${ENGINE}/v2-frontier-configs.mjs`, `${ENGINE}/v2-terrain-select.mjs`, 'apps/golf/src/main.js', 'packages/course-v2/runtime/codec.mjs', 'packages/course-v2/runtime/entry.mjs'],
    'what main.js reaches in the hashed folders, a worker\'s modules among them; not the shell, and not a test');
  assert.deepEqual(parts.own.alpha, [`${ENGINE}/scenery/alpha-roofs.json`, `${ENGINE}/scenery/alpha.js`, `${ENGINE}/scenery/campus.mjs`, `${ENGINE}/v2-alpha-config.mjs`]);
  assert.deepEqual(parts.own['beta-nine'], [`${ENGINE}/scenery/beta.js`, `${ENGINE}/scenery/campus.mjs`, `${ENGINE}/v2-beta-config.mjs`]);
  assert.deepEqual(parts.rows.alpha.PROJECTED_GPS_FRAMES, { slug: 'alpha', packMetresPerLongitude: 56323.13 });
  assert.deepEqual([parts.rows['beta-nine'].PROJECTED_GPS_FRAMES, parts.rows['beta-nine'].V2_PUBLISHED_GRAPH_SLUGS], [null, true]);

  // a ground's own
  assert.deepEqual(moved(() => append(`${ENGINE}/scenery/alpha.js`, 'export const species = 1;\n')), ['alpha'], 'its scenery module');
  assert.deepEqual(moved(() => put(`${ENGINE}/scenery/alpha-roofs.json`, '[2]\n')), ['alpha'], 'a data file its module imports');
  assert.deepEqual(moved(() => put(`${ENGINE}/v2-alpha-config.mjs`, read(`${ENGINE}/v2-alpha-config.mjs`).replace('tiles: 64', 'tiles: 256'))), ['alpha'], 'its terrain contract');
  assert.deepEqual(moved(() => put(`${ENGINE}/gps-projected-frames.mjs`, read(`${ENGINE}/gps-projected-frames.mjs`).replace('56323.13', '56500.89'))), ['alpha'], 'its row in a table');
  assert.deepEqual(moved(() => append(`${ENGINE}/scenery/campus.mjs`, 'export const flag = 1;\n')), ['alpha', 'beta-nine'], 'a module two grounds\' own modules import is both grounds\'');
  // what every course runs
  assert.deepEqual(moved(() => append(`${ENGINE}/shared.mjs`, 'export const y = 2;\n')), ['alpha', 'beta-nine']);
  assert.deepEqual(moved(() => append('packages/course-v2/runtime/codec.mjs', 'export const z = 3;\n')), ['alpha', 'beta-nine'], 'a module only the worker loads');
  assert.deepEqual(moved(() => put(`${ENGINE}/v2-terrain-select.mjs`, read(`${ENGINE}/v2-terrain-select.mjs`).replace('V2_GRAPH_FRONTIER_CONFIGS[slug];', 'V2_GRAPH_FRONTIER_CONFIGS[slug] ?? null;'))),
    ['alpha', 'beta-nine'], 'the code round a table counts for every course');
  assert.deepEqual(moved(() => put('apps/golf/package.json', JSON.stringify({ dependencies: { three: '0.188.0' } }))), ['alpha', 'beta-nine'], 'three.js');
  // what no prepared record answers for
  assert.deepEqual(moved(() => append('apps/golf/src/ui/hud.mjs', 'export const more = 1;\n')), [], 'the shell is outside, as it always was');
  assert.deepEqual(moved(() => append('packages/course-v2/vegetation/compile.mjs', 'export const faster = 1;\n')), [], 'code no player loads');
  assert.deepEqual(moved(() => append(`${ENGINE}/shared.test.mjs`, 'export const u = 1;\n')), [], 'a test');
  assert.deepEqual(moved(() => put(`${ENGINE}/scenery/index.js`, read(`${ENGINE}/scenery/index.js`).replace('/* the nine on its own ground */', '/* the nine, on the same shore */'))), [],
    'a comment among a table\'s rows');
});

test('a new ground changes no other course\'s revision', t => {
  const { root, put, read, moved, revisions } = miniature(t);
  const before = revisions();
  const added = moved(() => {
    put('apps/golf/public/courses/index.json', JSON.stringify({ courses: [{ slug: 'alpha' }, { slug: 'beta-nine' }, { slug: 'gamma' }] }));
    put(`${ENGINE}/scenery/gamma.js`, 'export const sand = 0xcccccc;\n');
    put(`${ENGINE}/v2-gamma-config.mjs`, "export const GAMMA_V2_CONFIGS = Object.freeze({ gamma: Object.freeze({ slug: 'gamma', tiles: 64 }) });\n");
    put(`${ENGINE}/scenery/index.js`, read(`${ENGINE}/scenery/index.js`).replace('};', "  /* a third ground */\n  gamma: () => import('./gamma.js'),\n};"));
    put(`${ENGINE}/v2-terrain-select.mjs`, read(`${ENGINE}/v2-terrain-select.mjs`).replace("['alpha', 'beta-nine']", "['alpha', 'beta-nine', 'gamma']"));
    put(`${ENGINE}/gps-projected-frames.mjs`, read(`${ENGINE}/gps-projected-frames.mjs`).replace(']);', '  {\n    slug: "gamma",\n    packMetresPerLongitude: 56000,\n  },\n]);'));
    put(`${ENGINE}/v2-frontier-configs.mjs`, read(`${ENGINE}/v2-frontier-configs.mjs`).replace("import { BETA_V2_CONFIGS } from './v2-beta-config.mjs';\n", "import { BETA_V2_CONFIGS } from './v2-beta-config.mjs';\nimport { GAMMA_V2_CONFIGS } from './v2-gamma-config.mjs';\n")
      .replace('  ...BETA_V2_CONFIGS,\n', '  ...BETA_V2_CONFIGS,\n  ...GAMMA_V2_CONFIGS,\n'));
  });
  assert.deepEqual(added, ['gamma'], 'its modules, its rows in all four tables, and the catalogue: the others stand');
  const after = revisions();
  assert.deepEqual([after.alpha, after['beta-nine']], [before.alpha, before['beta-nine']]);
  assert.deepEqual(courseRevisionParts(root, ['gamma']).own.gamma, [`${ENGINE}/scenery/gamma.js`, `${ENGINE}/v2-gamma-config.mjs`]);
  // a course no table knows yet still has a revision: the shared engine, and rows that say it is in none
  assert.match(courseSourceRevisions(root, ['delta']).delta, /^[a-f0-9]{64}$/);
  assert.deepEqual(courseRevisionParts(root, ['delta']).rows.delta, { REGISTRY: null, V2_PUBLISHED_GRAPH_SLUGS: false, PROJECTED_GPS_FRAMES: null });
});

test('what the bundler took is held by some course\'s revision, or the build is told', t => {
  const { root, put, append } = miniature(t);
  const slugs = ['alpha', 'beta-nine'], at = file => path.join(root, file);
  assert.deepEqual(unheldModules(root, slugs, ['apps/golf/src/main.js', `${ENGINE}/shared.mjs`, `${ENGINE}/scenery/beta.js`, 'apps/golf/src/ui/hud.mjs', 'node_modules/three/build/three.module.js'].map(at)), []);
  // the bundler found a way into a module that the reading of the source did not
  put(`${ENGINE}/late.mjs`, 'export const late = 1;\n');
  assert.deepEqual(unheldModules(root, slugs, [at(`${ENGINE}/late.mjs`), at('packages/course-v2/vegetation/compile.mjs'), path.join(root, '..', 'elsewhere.mjs')]),
    [`${ENGINE}/late.mjs`, 'packages/course-v2/vegetation/compile.mjs']);
  const coverage = courseRevisionCoverage(root, slugs);
  assert.deepEqual(coverage.unloaded, [`${ENGINE}/late.mjs`, 'packages/course-v2/vegetation/compile.mjs']);
  // an import the reading cannot follow is refused, not guessed at
  append(`${ENGINE}/shared.mjs`, 'export const load = name => import(name);\n');
  assert.throws(() => courseSourceRevisions(root), /a computed import\(\) cannot be watched/);
});

test('every published course has a revision of its own making, on the real source', () => {
  const slugs = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/golf/public/courses/index.json'), 'utf8')).courses.map(course => course.slug);
  const revisions = courseSourceRevisions(ROOT), { shared, own, rows, view, read } = courseRevisionParts(ROOT, slugs), coverage = courseRevisionCoverage(ROOT, slugs);
  assert.deepEqual(Object.keys(revisions), slugs);
  assert.ok(Object.values(revisions).every(value => /^[a-f0-9]{64}$/.test(value)));
  for (const needed of ['apps/golf/src/main.js', `${ENGINE}/prepared-water.mjs`, `${ENGINE}/scenery/index.js`, 'packages/course-v2/runtime/chunk-worker-entry.mjs']) assert.ok(shared.includes(needed), needed);
  assert.ok(shared.every(file => !/\/scenery\/(?!index\.js)[a-z-]+\.js$/.test(file)), 'no ground\'s scenery module is every course\'s');
  for (const slug of slugs) {
    assert.equal(typeof rows[slug].REGISTRY, 'function', `${slug}: a scenery module`);
    assert.equal(rows[slug].V2_PUBLISHED_GRAPH_SLUGS, true, `${slug}: published`);
    assert.ok(own[slug].some(file => /\/scenery\/[a-z-]+\.js$/.test(file)), `${slug}: its scenery module is its own`);
  }
  assert.ok(own.tjusta.includes(`${ENGINE}/scenery/tjusta.js`) && own.tjusta.includes(`${ENGINE}/v2-tjusta-config.mjs`) && !own.tjusta.some(file => /bro-hof|visby|angso/.test(file)));
  assert.deepEqual(own['bro-hof-stadium'], own['bro-hof-castle'], 'two routings on one ground have the same modules');
  assert.notEqual(revisions['bro-hof-stadium'], revisions['bro-hof-castle'], 'and each its own rows');
  assert.ok(own.johannesberg.includes('johannesbergbuild/mapping/water-source-review.json'), 'a review a ground\'s module reads is that ground\'s, wherever it lies');
  // code no player loads: the tree compilers above all, whose edits used to bake every course
  for (const file of ['packages/course-v2/vegetation/compile-vegetation.mjs', 'packages/course-v2/vegetation/crown-detect.mjs', 'packages/course-v2/tjusta-ground-rings.mjs']) assert.ok(coverage.unloaded.includes(file), file);
  assert.ok(coverage.unloaded.length > 60 && shared.length > 150);

  // every contract the frontier registry imports is some course's own: Tortuna's names its course as JSON does,
  // and was first read as nobody's, which the build's check against the bundle caught
  const contracts = fs.readdirSync(path.join(ROOT, ENGINE)).filter(name => /^v2-[a-z0-9-]+-config\.mjs$/.test(name)).map(name => `${ENGINE}/${name}`);
  assert.deepEqual(contracts.filter(file => !coverage.held.has(file)), [], 'a terrain contract that no course\'s revision holds');
  assert.ok(own.tortuna.includes(`${ENGINE}/v2-tortuna-config.mjs`));
  // the frontier registry is glue, and its view holds no ground: a line of another shape has to be looked at
  const glue = view(`${ENGINE}/v2-frontier-configs.mjs`);
  assert.ok(!/config\.mjs|^\s+\.\.\./m.test(glue), 'every import and spread of a ground\'s contract is taken out of the shared view');
  // a contract is data: logic in one would be code a single course's revision holds, which is right, but look first
  for (const file of fs.readdirSync(path.join(ROOT, ENGINE)).filter(name => /^v2-[a-z0-9-]+-config\.mjs$/.test(name))) {
    assert.ok(!/=>|\bfunction\b|\bimport\b/.test(read(`${ENGINE}/${file}`).replace(/\/\*[\s\S]*?\*\//g, '')), `${file}: a terrain contract holds data only`);
  }
  // the hash of everything, which the September audits name, is still what it was made of
  assert.match(courseSourceRevision(ROOT), /^[a-f0-9]{64}$/);
});
