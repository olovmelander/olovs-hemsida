import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_GROUNDS,
  readJson,
  validateGroundCoverage,
  validateSourceCatalog,
  validateSourceManifest,
} from './manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'geo_data/course-v2');
const catalog = readJson(path.join(DATA, 'source-catalog.json'));
const clone = value => structuredClone(value);
const manifest = groundId => readJson(path.join(DATA, groundId, 'source-manifest.json'));
const validate = value => validateSourceManifest(value, {
  catalog,
  label: value.groundId || 'fixture',
  repoRoot: ROOT,
});

test('product and licence catalog is valid', () => {
  assert.deepEqual(validateSourceCatalog(catalog), []);
  assert.ok(catalog.products.some(product => product.id === 'lantmateriet-markhojdmodell-1m'));
  assert.equal(
    catalog.products.find(product => product.id === 'esri-world-imagery').licence.reviewStatus,
    'blocked',
  );
});

test('all six physical-ground manifests and committed checksums validate', () => {
  for (const groundId of Object.keys(EXPECTED_GROUNDS)) {
    assert.deepEqual(validate(manifest(groundId)), [], groundId);
  }
});

test('all nine course slugs are accounted for exactly once', () => {
  const manifests = Object.keys(EXPECTED_GROUNDS).map(manifest);
  assert.deepEqual(validateGroundCoverage(manifests), []);
  assert.equal(manifests.flatMap(item => item.courseSlugs).length, 9);
});

test('unapproved canonical origin is rejected', () => {
  const value = clone(manifest('angso'));
  value.canonicalFrame.origin.easting = 600000;
  assert.match(validate(value).join('\n'), /pending origins must remain null/);
});

test('source with a pending product licence cannot become authoritative', () => {
  const value = clone(manifest('angso'));
  const source = value.sources.find(item => item.id === 'imagery-lm-ortho');
  source.lifecycle = 'approved';
  source.use = 'authoritative';
  source.acquiredAt = '2026-08-30';
  source.checksum = 'a'.repeat(64);
  source.checksumReason = null;
  assert.match(validate(value).join('\n'), /licence is not approved/);
});

test('acquisition date and checksum are required after planned state', () => {
  const value = clone(manifest('angso'));
  value.sources.find(item => item.id === 'terrain-lm-1m').lifecycle = 'acquired';
  assert.match(
    validate(value).join('\n'),
    /acquired sources require a checksum and acquisition date/,
  );
});

test('licence-blocked products stay migration or reference only', () => {
  const value = clone(manifest('angso'));
  const source = value.sources.find(item => item.id === 'esri-imagery-legacy');
  source.use = 'supporting';
  source.replacementSourceId = null;
  assert.match(validate(value).join('\n'), /blocked products are migration\/reference only/);
});

test('migration-only sources resolve to an existing replacement', () => {
  const value = clone(manifest('angso'));
  value.sources.find(item => item.id === 'terrarium-legacy').replacementSourceId = 'missing-source';
  assert.match(validate(value).join('\n'), /replacementSourceId: does not resolve/);
});

test('checksum drift in a migration artifact is detected', () => {
  const value = clone(manifest('angso'));
  value.artifacts[0].sha256 = '0'.repeat(64);
  assert.match(validate(value).join('\n'), /checksum mismatch/);
});

test('duplicate sources and repository path traversal are rejected', () => {
  const value = clone(manifest('norrfallsviken'));
  value.sources[1].id = value.sources[0].id;
  value.artifacts[0].path = '../outside.json';
  const errors = validate(value).join('\n');
  assert.match(errors, /duplicate source id/);
  assert.match(errors, /must stay inside the repository/);
});
