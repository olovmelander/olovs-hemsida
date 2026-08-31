import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readJson,
  validateGroundCoverage,
  validateSourceCatalog,
  validateSourceManifest,
} from './manifest.mjs';

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
    failed++;
    console.log('  FAIL ' + manifest.groundId + ' (' + errors.length + ' errors)');
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

console.log(failed ? '\nsource-manifest gate FAILED' : '\nsource-manifest gate passed');
process.exit(failed ? 1 : 0);
