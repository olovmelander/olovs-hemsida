#!/usr/bin/env node
/**
 * Rebuild accepted Upsala mapping and its local deliverables, without downloads.
 *   node tools/refresh-upsala-mapping.mjs [--python /path/to/python3]
 *   node tools/refresh-upsala-mapping.mjs --help
 *
 * The original Stora cs2cs migration and its exact source are restored from a
 * pinned Git commit on every run. Both current courses use that same verified
 * frame reference. Canonical migrations use installed PROJ through cs2cs, or
 * explicitly select real pyproj with COURSE_GEO_PYPROJ_PYTHON. All processes use
 * argument arrays and abort on failure. This command does not commit, push or deploy.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = '8498cedb8e9cc22467f42e175491072400b3938f';
const REFERENCE_DIR = `upsalabuild/cache/mapping-reference-${BASE}`;
const REFERENCE_MODEL = `${REFERENCE_DIR}/course-model.json`;
const REFERENCE_MIGRATION = `${REFERENCE_DIR}/course-model.epsg3006.json`;
const ORIGINALS = [
  { path: 'upsalabuild/course-model.json', sha256: '965c350f8068016d3ff5ecfdf110e6fcbb19cb05ce145e12e7ef3aa489650c7d' },
  { path: 'geo_data/course-v2/upsala/migration/course-model.epsg3006.json', sha256: 'd0f6f895614c2472505587dd6796d33ec860058264da4286dafec79bd1e43d56' },
  { path: 'packages/course-geo/migrate-legacy.mjs', sha256: 'c177803e0c7564a2db4794e81c85d6ac96180833541decedca7fc093dc556665' },
  { path: 'packages/course-geo/proj.mjs', sha256: '663ee8066610f135d5c4f93aecbc9517b22701cfa94946136a89b9d28e7aa881' },
];
const COURSES = [
  { slug: 'upsala', key: 'upsala', build: 'upsalabuild', model: 'upsalabuild/course-model.json',
    migration: 'geo_data/course-v2/upsala/migration/course-model.epsg3006.json' },
  { slug: 'upsala-mellanbanan', key: "'upsala-mellanbanan'", build: 'upsalamellanbuild', model: 'upsalamellanbuild/course-model.json',
    migration: 'geo_data/course-v2/upsala/migration/mellanbanan-course-model.epsg3006.json' },
];
const REGISTERED_ARTIFACTS = [
  ['legacy-course-model', COURSES[0].model],
  ['legacy-osm-features', 'upsalabuild/osm-features.json'],
  ['shipped-middle-course-model', COURSES[1].model],
  ['migration-course-model-epsg3006', COURSES[0].migration],
  ['migration-mellanbanan-course-model-epsg3006', COURSES[1].migration],
  ['migration-residual-report', 'geo_data/course-v2/upsala/migration/residual-report.json'],
];
const CONTROL_REGISTRY = 'packages/course-geo/acquisition/hole-source-controls.mjs';
const INVENTORY_REGISTRY = 'packages/course-geo/acquisition/hole-source-inventory.mjs';
const HELP = `Usage: node tools/refresh-upsala-mapping.mjs [--python /path/to/python3]

Rebuild local Stora and Mellanbanan artifacts from accepted mapping evidence:
  1. Verify the original model, cs2cs migration and generator lineage in Git ${BASE}.
  2. Reconcile Stora, build Mellanbanan, draw the design and embed upsala3d.html.
  3. Emit both packs/index; canonically migrate both current models using PROJ.
  4. Rebind both published routing/fallback references while preserving the ground graph.
  5. Re-pin six registered artifacts and only the two Upsala hashes in each registry.
  6. Export geographic GeoJSON and render overview.svg plus overview.png.

Default invocation writes local generated files. It performs no acquisition,
dependency installation, Git commit, push or deployment. It aborts at the first
failed step; earlier successful outputs remain available for inspection.

--python selects an already installed Python with numpy and matplotlib.
Default: CODEX_PRIMARY_RUNTIME_PYTHON when available, otherwise python3.
Projection uses cs2cs from PATH. Explicitly set COURSE_GEO_PYPROJ_PYTHON to use
installed pyproj instead; migration reports identify that implementation explicitly.
--help, -h show this text without reading Git or creating any output.

The pinned commit must already exist locally. Original reference files are
re-created from verified Git blobs under ${REFERENCE_DIR}.
Current models and the published v2 ground graph must be present. Run project
data, pack, lint and test gates after this generation command.
`;
const bytesSha = bytes => createHash('sha256').update(bytes).digest('hex');
const textSha = relative => bytesSha(fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n'));
const readJSON = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));

function run(command, args, { capture = false, label = command } = {}) {
  if (!capture) console.log(`\n${label}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    shell: false,
    windowsHide: true,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PROJ_NETWORK: 'OFF' },
  });
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.signal || result.status !== 0) {
    const detail = capture ? result.stderr?.toString('utf8').trim() : '';
    throw new Error(`${label} failed (${result.signal || `exit ${result.status}`})${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout;
}
const node = (script, args = []) => run(process.execPath, [script, ...args], { label: `${script}${args.length ? ` ${args.join(' ')}` : ''}` });

function originalReference() {
  const blobs = ORIGINALS.map(entry => {
    const bytes = run('git', ['show', `${BASE}:${entry.path}`], {
      capture: true, label: `read pinned Git reference ${entry.path}`,
    });
    if (bytesSha(bytes) !== entry.sha256) throw new Error(`original Git blob checksum mismatch: ${entry.path}`);
    return bytes;
  });
  const model = JSON.parse(blobs[0]);
  const migration = JSON.parse(blobs[1]);
  const generator = blobs[2].toString('utf8'), projection = blobs[3].toString('utf8');
  if (migration.generator !== 'course-geo/legacy-vector-migrator@1' || migration.groundId !== 'upsala' ||
      migration.source?.path !== ORIGINALS[0].path || migration.source.sha256 !== ORIGINALS[0].sha256 ||
      migration.target?.horizontalCrs !== 'EPSG:3006' || migration.target?.projValidation ||
      migration.coordinatePairCount !== 12925 ||
      !generator.includes("import { latLonToSweref99Tm } from './proj.mjs';") ||
      !projection.includes("'cs2cs'")) {
    throw new Error('pinned migration does not identify the original cs2cs lineage');
  }
  const frame = migration.source.localFrame;
  if (model.origin.lat !== frame.originWgs84.latitude || model.origin.lon !== frame.originWgs84.longitude ||
      model.mPerLat !== frame.metresPerLatitude || model.mPerLon !== frame.metresPerLongitude) {
    throw new Error('original model and migration frames differ');
  }
  return { model: blobs[0], migration: blobs[1] };
}

function uniqueBlock(source, constant, filename) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const marker = `export const ${constant} = Object.freeze({${eol}`;
  const start = source.indexOf(marker);
  if (start < 0 || source.indexOf(marker, start + marker.length) >= 0) {
    throw new Error(`${filename}: expected exactly one ${constant} declaration`);
  }
  const end = source.indexOf(`${eol}});`, start + marker.length);
  if (end < 0) throw new Error(`${filename}: cannot locate ${constant} end`);
  return { start, text: source.slice(start, end + eol.length + 3), eol };
}

function hashSlot(block, prefix, suffix, filename) {
  const start = block.text.indexOf(prefix);
  if (start < 0 || block.text.indexOf(prefix, start + prefix.length) >= 0) {
    throw new Error(`${filename}: expected exactly one course/path checksum context: ${prefix.trim()}`);
  }
  const at = start + prefix.length;
  const hash = block.text.slice(at, at + 64);
  if (!/^[a-f0-9]{64}$/.test(hash) || block.text.slice(at + 64, at + 64 + suffix.length) !== suffix) {
    throw new Error(`${filename}: course checksum context has changed; review the registry explicitly`);
  }
  return block.start + at;
}

// Identify the four exact source-code slots before generating anything. No
// global hash replacement, no evaluation of registry source, no test changes.
function registryPlans() {
  const control = fs.readFileSync(path.join(ROOT, CONTROL_REGISTRY), 'utf8');
  const inventory = fs.readFileSync(path.join(ROOT, INVENTORY_REGISTRY), 'utf8');
  const paths = uniqueBlock(control, 'COURSE_MODEL_PATHS', CONTROL_REGISTRY);
  const hashes = uniqueBlock(control, 'COURSE_MODEL_SHA256', CONTROL_REGISTRY);
  const legacy = uniqueBlock(inventory, 'LEGACY_COURSE_MODEL_SOURCES', INVENTORY_REGISTRY);
  for (const course of COURSES) {
    const entry = `${paths.eol}  ${course.key}: '${course.migration}',${paths.eol}`;
    const at = paths.text.indexOf(entry);
    if (at < 0 || paths.text.indexOf(entry, at + entry.length) >= 0) {
      throw new Error(`${CONTROL_REGISTRY}: ${course.slug} does not identify the expected migration path`);
    }
  }
  return [
    { path: CONTROL_REGISTRY, original: control, slots: COURSES.map(course => ({
      file: course.migration,
      at: hashSlot(hashes, `${hashes.eol}  ${course.key}: '`, `',${hashes.eol}`, CONTROL_REGISTRY),
    })) },
    { path: INVENTORY_REGISTRY, original: inventory, slots: COURSES.map(course => ({
      file: course.model,
      at: hashSlot(legacy, `${legacy.eol}  ${course.key}: Object.freeze({${legacy.eol}    path: '${course.model}',${legacy.eol}    sha256: '`,
        `',${legacy.eol}  }),`, INVENTORY_REGISTRY),
    })) },
  ];
}

function updateRegistries(plans) {
  const updates = plans.map(plan => {
    if (fs.readFileSync(path.join(ROOT, plan.path), 'utf8') !== plan.original) {
      throw new Error(`${plan.path} changed during generation; refusing to overwrite concurrent edits`);
    }
    let next = plan.original;
    for (const slot of plan.slots.slice().sort((a, b) => b.at - a.at)) {
      next = next.slice(0, slot.at) + textSha(slot.file) + next.slice(slot.at + 64);
    }
    return { ...plan, next };
  });
  for (const update of updates) {
    if (update.next !== update.original) fs.writeFileSync(path.join(ROOT, update.path), update.next);
    console.log(`${update.path}: refreshed only Upsala and Mellanbanan model hashes`);
  }
}

function assertRegisteredArtifacts() {
  const manifest = readJSON('geo_data/course-v2/upsala/source-manifest.json');
  for (const [id, expectedPath] of REGISTERED_ARTIFACTS) {
    const matches = manifest.artifacts.filter(entry => entry.id === id);
    if (matches.length !== 1 || matches[0].path !== expectedPath || !/^[a-f0-9]{64}$/.test(matches[0].sha256)) {
      throw new Error(`registered artifact ${id} must uniquely identify ${expectedPath}`);
    }
  }
}

function main(args) {
  if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }
  let python = process.env.CODEX_PRIMARY_RUNTIME_PYTHON || 'python3';
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--python' || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error(`unknown or incomplete argument ${args[i]}; use --help`);
    }
    python = args[++i];
  }
  const reference = originalReference();
  const registries = registryPlans();
  assertRegisteredArtifacts();
  run(python, ['-c', "import importlib.util, sys; missing = [m for m in ('numpy', 'matplotlib') if importlib.util.find_spec(m) is None]; sys.exit('Missing installed Python modules: ' + ', '.join(missing)) if missing else None"], {
    capture: true, label: 'verify installed overview-rendering dependencies',
  });
  console.log(`Verified original cs2cs reference at ${BASE}; rebuilding accepted Upsala mapping.`);
  fs.mkdirSync(path.join(ROOT, REFERENCE_DIR), { recursive: true });
  fs.writeFileSync(path.join(ROOT, REFERENCE_MODEL), reference.model);
  fs.writeFileSync(path.join(ROOT, REFERENCE_MIGRATION), reference.migration);

  node('upsalabuild/reconcile.mjs');
  node('tools/build-nine.mjs', ['upsalabuild/mellanbanan.json']);
  node('upsalabuild/render-design.mjs');
  node('upsalabuild/embed.mjs');
  for (const course of COURSES) {
    node('packages/course-pack/emit-pack.mjs', [course.build, `apps/golf/public/courses/${course.slug}`, course.slug]);
  }
  node('packages/course-pack/emit-manifest.mjs');
  node('packages/course-geo/acquisition/record-artifact-checksum.mjs', [
    '--ground', 'upsala', ...REGISTERED_ARTIFACTS.slice(0, 3).flatMap(([id]) => ['--id', id]),
  ]);
  node('packages/course-geo/migrate-legacy.mjs', ['--write', '--ground', 'upsala']);
  for (const course of COURSES) {
    node('tools/rebind-v2-routing.mjs', ['--slug', course.slug, '--build', course.build, '--migration', course.migration, '--write']);
  }
  assertRegisteredArtifacts();
  node('packages/course-geo/acquisition/record-artifact-checksum.mjs', [
    '--ground', 'upsala', ...REGISTERED_ARTIFACTS.flatMap(([id]) => ['--id', id]),
  ]);
  updateRegistries(registries);
  node('geobuild/export-ground-map.mjs', [
    '--build', 'upsalabuild', '--also-build', 'upsalamellanbuild', '--ground', 'upsala',
    '--out', 'upsalabuild/mapping/ground-map.geojson',
  ]);
  run(python, ['geobuild/render-ground-map.py', '--source', 'upsalabuild/mapping/ground-map.geojson',
    '--out', 'upsalabuild/mapping/overview.svg'], { label: 'render geographic overview' });
  console.log('\nUpsala models, packs, routing references, registries and geographic map refreshed. Run the project validation gates before committing.');
}

try { main(process.argv.slice(2)); }
catch (error) { console.error(`Upsala refresh stopped: ${error.message}`); process.exitCode = 1; }
