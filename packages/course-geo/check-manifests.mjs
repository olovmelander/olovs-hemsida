import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readJson,
  validateGroundCoverage,
  validateSourceCatalog,
  validateSourceManifest,
} from './manifest.mjs';

/* --ground <id> narrows the EXIT CODE to one ground. Every manifest is still
   read, validated and printed -- the coverage check needs them all and a
   silent gate is worse than a noisy one -- but a run that is publishing one
   ground is not the place to discover that another ground's in-flight work has
   not re-pinned its checksums yet. Without the flag nothing changes: every
   failure still fails, which is what CI on a shared branch wants. */
const groundFilterIndex = process.argv.indexOf('--ground');
const GROUND_FILTER = groundFilterIndex >= 0 ? process.argv[groundFilterIndex + 1] : null;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'geo_data/course-v2');
const catalogFile = path.join(DATA, 'source-catalog.json');
const catalog = readJson(catalogFile);
const catalogErrors = validateSourceCatalog(catalog);
const expectedCatalogSchema = path.join(ROOT, 'packages/course-geo/source-catalog.schema.json');
const actualCatalogSchema = path.resolve(path.dirname(catalogFile), catalog.$schema || '');
if (actualCatalogSchema !== expectedCatalogSchema || !fs.existsSync(actualCatalogSchema)) {
  catalogErrors.push('catalog.$schema: must resolve to ' + path.relative(ROOT, expectedCatalogSchema));
}
if (catalogErrors.length) {
  console.error('source catalog FAILED\n' + catalogErrors.map(error => '  ' + error).join('\n'));
  process.exit(1);
}
console.log('  ok   source catalog (' + catalog.products.length + ' products)');

const files = fs.readdirSync(DATA, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => path.join(DATA, entry.name, 'source-manifest.json'))
  .filter(file => fs.existsSync(file))
  .sort();
const manifests = [];
let failed = 0;
let ignored = 0;

for (const file of files) {
  const relative = path.relative(ROOT, file);
  const manifest = readJson(file);
  manifests.push(manifest);
  const errors = validateSourceManifest(manifest, {
    catalog,
    label: relative,
    repoRoot: ROOT,
  });
  const expectedSchema = path.join(ROOT, 'packages/course-geo/source-manifest.schema.json');
  const actualSchema = path.resolve(path.dirname(file), manifest.$schema || '');
  if (actualSchema !== expectedSchema || !fs.existsSync(actualSchema)) {
    errors.push(relative + '.$schema: must resolve to ' + path.relative(ROOT, expectedSchema));
  }
  if (errors.length) {
    const counts = !GROUND_FILTER || manifest.groundId === GROUND_FILTER;
    if (counts) failed++; else ignored++;
    console.log('  ' + (counts ? 'FAIL' : 'warn') + ' ' + manifest.groundId + ' (' + errors.length + ' errors'
      + (counts ? '' : '; not the selected ground, so it does not fail this run') + ')');
    errors.forEach(error => console.log('       ' + error));
  } else {
    console.log(
      '  ok   ' + manifest.groundId.padEnd(18) +
      String(manifest.sources.length).padStart(2) + ' sources, ' +
      String(manifest.artifacts.length).padStart(2) + ' checksummed artifacts, ' +
      manifest.blockers.length + ' open gates',
    );
  }
}

const coverageErrors = validateGroundCoverage(manifests);
if (coverageErrors.length) {
  failed++;
  console.log('  FAIL ground coverage');
  coverageErrors.forEach(error => console.log('       ' + error));
} else {
  const slugs = manifests.reduce((sum, manifest) => sum + manifest.courseSlugs.length, 0);
  console.log('  ok   all ' + manifests.length + ' physical grounds and ' + slugs + ' course slugs inventoried');
}

console.log(failed ? '\nsource-manifest gate FAILED'
  : '\nsource-manifest gate passed' + (GROUND_FILTER ? ' for ' + GROUND_FILTER + (ignored ? ' (' + ignored + ' other ground(s) failing, reported above)' : '') : ''));
process.exit(failed ? 1 : 0);
