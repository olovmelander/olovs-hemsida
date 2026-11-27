/* WHAT A COURSE'S PREPARED DATA WAS BAKED AGAINST.

   Prepared water, tints, vista and scatter are the engine's own results, kept from one visit to the next. They
   hold while the code that made them holds, and each record names that code by a hash, its revision.

   Until 27 November 2026 there was one revision for every course: a hash of every module under the engine, the
   loader and packages/course-v2, and main.js. So a new ground, a colour changed in one ground's scenery module or
   an edit to a tree compiler the player never loads turned off the prepared data of all sixteen layouts until
   every one was baked again, half an hour on the GPU; and with several sittings open, each merge of one made the
   others bake once more. Of those 364 files the player loads 230 for every course, 62 only through one ground's
   own scenery module, and 97 never.

   A course's revision is now the hash of what the player can load FOR THAT COURSE:
   - the shared graph: every module main.js reaches (imports, import() by name, a worker's own address) inside
     the folders that were always hashed. The player's shell, map and game stay outside it, as they were;
   - the ground's own: what its scenery module imports and nobody else does, its data files with it, and the
     module that holds its terrain contract (v2-<ground>-config.mjs);
   - its rows in the four tables that list the grounds. A table's rows are read by value, each course its own;
     the code round a table counts for every course.
   So a new ground changes no other course's revision, a ground's own edit bakes that ground, and code no player
   loads bakes nothing. An edit to shared engine code still bakes every course: that is what it changes.

   The build checks the reading against the bundler's own graph (apps/golf/vite.config.js): a module the bundle
   takes from those folders that no course's revision holds stops the build. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { importClosure } from '../packages/course-workflow/io.mjs';
import { literalOf, literalSpan } from '../packages/course-workflow/ground-card.mjs';

const MAIN = 'apps/golf/src/main.js', ENGINE = 'apps/golf/src/engine';
const HASHED_FOLDERS = [ENGINE, 'apps/golf/src/loader', 'packages/course-v2'];
const SCENERY = `${ENGINE}/scenery/index.js`, FRONTIER = `${ENGINE}/v2-frontier-configs.mjs`;
/* The tables that list the grounds, each a literal a course has a row of. */
const TABLES = [[SCENERY, 'REGISTRY'], [`${ENGINE}/v2-terrain-select.mjs`, 'V2_PUBLISHED_GRAPH_SLUGS'], [`${ENGINE}/gps-projected-frames.mjs`, 'PROJECTED_GPS_FRAMES']];
/* The frontier registry holds no rows of its own: it imports each ground's contract and spreads it into one table. */
const CONTRACT_IMPORT = /^import \{[^}]+\} from '\.\/(v2-[a-z0-9-]+-config\.mjs)';\n/gm, CONTRACT_SPREAD = /^ {2}\.\.\.[A-Z0-9_]+,\n/gm;

const hashed = file => file === MAIN || HASHED_FOLDERS.some(folder => file.startsWith(`${folder}/`));
const code = file => /\.(?:mjs|js)$/.test(file) && !/\.(?:node-)?test\.mjs$/.test(file);
const stable = value => (Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : value !== null && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
    : typeof value === 'function' ? JSON.stringify(String(value)) : JSON.stringify(value ?? null));

/** What each course's revision is made of: { shared: [files], own: { slug: [files] }, rows: { slug: {...} }, view(file) }. */
export function courseRevisionParts(root, slugs) {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n');
  const registry = literalOf(read(SCENERY), 'REGISTRY');
  const sceneryOf = Object.fromEntries(Object.entries(registry).map(([slug, load]) => {
    const named = /import\(\s*['"]\.\/([^'"]+)['"]\s*\)/.exec(String(load));
    if (!named) throw new Error(`${SCENERY}: the row of ${slug} does not import a module by name`);
    return [slug, `${ENGINE}/scenery/${named[1]}`];
  }));
  const sceneryModules = new Set(Object.values(sceneryOf));
  const contracts = [...read(FRONTIER).matchAll(CONTRACT_IMPORT)].map(match => `${ENGINE}/${match[1]}`);
  // a ground's scenery module and its contract are its own: the shared graph is followed past neither
  const skip = (from, target) => (from === SCENERY && sceneryModules.has(target)) || (from === FRONTIER && contracts.includes(target));
  const reached = new Set(importClosure(root, [MAIN], { skip }));
  const shared = [...reached].filter(file => hashed(file) && code(file)).sort();
  // a contract names its course as `slug: 'x'`, or as JSON does, `"slug": "x"` (Tortuna's is written that way)
  const contractsOf = slug => contracts.filter(file => !reached.has(file) && new RegExp(`(?<![\\w$])["']?slug["']?\\s*:\\s*['"]${slug}['"]`).test(read(file)));
  const own = {}, rows = {};
  const tables = TABLES.map(([file, name]) => [name, literalOf(read(file), name)]);
  for (const slug of slugs) {
    const entries = [...(sceneryOf[slug] ? [sceneryOf[slug]] : []), ...contractsOf(slug)];
    own[slug] = importClosure(root, entries).filter(file => !reached.has(file) && !/\.(?:node-)?test\.mjs$/.test(file));
    rows[slug] = Object.fromEntries(tables.map(([name, table]) => [name,
      Array.isArray(table) ? (typeof table[0] === 'string' ? table.includes(slug) : table.find(row => row?.slug === slug) ?? null) : table[slug] ?? null]));
  }
  /* A table's file as every course sees it: its rows taken out, the code round them left. */
  const view = file => {
    let text = read(file);
    for (const [tableFile, name] of TABLES) if (tableFile === file) { const span = literalSpan(text, name); text = `${text.slice(0, span.start)}<rows>${text.slice(span.end)}`; }
    return file === FRONTIER ? text.replace(CONTRACT_IMPORT, '').replace(CONTRACT_SPREAD, '') : text;
  };
  return { shared, own, rows, view, read, reached: [...reached] };
}

/** Each course's revision, by slug. */
export function courseSourceRevisions(root, slugs = JSON.parse(fs.readFileSync(path.join(root, 'apps/golf/public/courses/index.json'), 'utf8')).courses.map(course => course.slug)) {
  const { shared, own, rows, view, read } = courseRevisionParts(root, slugs);
  const base = createHash('sha256').update('banvy-course-revision/2\0');
  for (const file of shared) base.update(file).update('\0').update(view(file)).update('\0');
  base.update(JSON.parse(fs.readFileSync(path.join(root, 'apps/golf/package.json'))).dependencies.three);
  const sharedDigest = base.digest('hex');
  return Object.fromEntries(slugs.map(slug => {
    const hash = createHash('sha256').update(sharedDigest).update('\0own\0');
    for (const file of own[slug]) hash.update(file).update('\0').update(read(file)).update('\0');
    return [slug, hash.update('\0rows\0').update(stable(rows[slug])).digest('hex')];
  }));
}

/** Every file some course's revision holds, and the hashed folders' modules that none does (no player loads them). */
export function courseRevisionCoverage(root, slugs) {
  const { shared, own, reached } = courseRevisionParts(root, slugs);
  const held = new Set([...shared, ...Object.values(own).flat()]);
  const all = [];
  const walk = folder => { for (const entry of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) { const file = `${folder}/${entry.name}`; if (entry.isDirectory()) walk(file); else if (code(file)) all.push(file); } };
  HASHED_FOLDERS.filter(folder => fs.existsSync(path.join(root, folder))).forEach(walk);
  return { held, shared, own, reached, unloaded: all.filter(file => !held.has(file)).sort() };
}

/** The modules, of those a bundle was built from (absolute paths, as the bundler names them), that lie in the hashed
 * folders and that no course's revision holds. Empty when the reading of the source agrees with the bundler's. */
export function unheldModules(root, slugs, bundled) {
  const { held } = courseRevisionCoverage(root, slugs), base = path.resolve(root);
  return [...new Set(bundled.map(file => path.relative(base, path.resolve(file)).split(path.sep).join('/')))]
    .filter(file => !file.startsWith('..') && hashed(file) && code(file) && !held.has(file)).sort();
}

/* ONE HASH OF EVERY FILE, as it was before a course had its own. The audits and evidence records of September
   name the code they were taken with by it, and still do; no prepared data reads it. Normalize checkout
   newlines so Windows publication and Linux deployment agree. */
export function courseSourceRevision(root) {
  const files = [];
  const walk = relative => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(name);
      else if (code(name)) files.push(name);
    }
  };
  files.push(MAIN);
  files.push('johannesbergbuild/mapping/ground-surface-review.json');
  files.push('johannesbergbuild/mapping/water-source-review.json');
  HASHED_FOLDERS.forEach(walk);
  const hash = createHash('sha256');
  for (const file of files.sort()) hash.update(file).update('\0').update(fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n')).update('\0');
  hash.update(JSON.parse(fs.readFileSync(path.join(root, 'apps/golf/package.json'))).dependencies.three);
  return hash.digest('hex');
}
