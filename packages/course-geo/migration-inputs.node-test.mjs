import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMigrationInputs } from './migration-inputs.mjs';

const historical = () => ({ groundId: 'upsala', artifacts: [
  { id: 'legacy-course-model', kind: 'composite', path: 'upsalabuild/course-model.json' },
  { id: 'legacy-middle-model', kind: 'composite', path: 'upsalabuild/mellanbanan-model.json' },
] });
const current = () => ({ ...historical(), artifacts: [...historical().artifacts,
  { id: 'shipped-middle-course-model', kind: 'composite', path: 'upsalamellanbuild/course-model.json' },
  { id: 'migration-mellanbanan-course-model-epsg3006', kind: 'migration', path: 'geo_data/course-v2/upsala/migration/mellanbanan-course-model.epsg3006.json' },
] });

test('current shipped Mellan replaces only historical migration input, preserving inventory', () => {
  const manifest = current(), before = structuredClone(manifest);
  const selected = selectMigrationInputs(manifest);
  assert.deepEqual(selected.map(input => [input.artifact.id, input.outputName]), [
    ['legacy-course-model', 'course-model.epsg3006.json'],
    ['shipped-middle-course-model', 'mellanbanan-course-model.epsg3006.json'],
  ]);
  assert.deepEqual(manifest, before);
});

test('historical manifests and other grounds keep existing selection and names', () => {
  assert.deepEqual(selectMigrationInputs(historical()).map(input => input.outputName),
    ['course-model.epsg3006.json', 'mellanbanan-model.epsg3006.json']);
  const other = current(); other.groundId = 'other';
  assert.deepEqual(selectMigrationInputs(other).map(input => input.artifact.id),
    ['legacy-course-model', 'legacy-middle-model']);
});

test('missing current output binding and colliding generated names fail before writes', () => {
  const missing = current(); missing.artifacts.pop();
  assert.throws(() => selectMigrationInputs(missing), /exactly one registered migration output/);
  assert.throws(() => selectMigrationInputs({ groundId: 'fixture', artifacts: [
    { id: 'legacy-first-model', kind: 'composite', path: 'first/course-model.json' },
    { id: 'legacy-course-model', kind: 'composite', path: 'second/course-model.json' },
  ] }), /colliding migration output/);
});
