import test from 'node:test';
import assert from 'node:assert/strict';
import { modelArtifacts, registerModels } from './inventory-models.mjs';
import { selectMigrationInputs } from './migration-inputs.mjs';

const courses = [{ slug: 'demo-links-main', model: 'demobuild/course-model.json' }, { slug: 'demo-links-short', model: 'demoshortbuild/course-model.json' }];

test('artifact ids and outputs are the ones the migration derives', () => {
  const models = modelArtifacts('demo-links', courses);
  assert.deepEqual(models.map(m => [m.id, m.output]), [
    ['legacy-course-model', 'geo_data/course-v2/demo-links/migration/course-model.epsg3006.json'],
    ['legacy-short-model', 'geo_data/course-v2/demo-links/migration/short-model.epsg3006.json']]);
  const inputs = selectMigrationInputs({ groundId: 'demo-links', artifacts: models.map(m => ({ id: m.id, kind: 'composite', path: m.path })) });
  assert.deepEqual(inputs.map(i => i.outputName), models.map(m => m.output.split('/').at(-1)));
});

test('a routing is registered once, and again only its hash moves', () => {
  const text = "export const COURSE_MODEL_PATHS = Object.freeze({\n  old: 'a.json',\n});\nexport const COURSE_MODEL_SHA256 = Object.freeze({\n  old: 'aa',\n});\n";
  const models = modelArtifacts('demo-links', courses).map((m, i) => ({ ...m, outputSha256: String(i + 1).repeat(64) }));
  const once = registerModels(text, models);
  assert.match(once, /COURSE_MODEL_PATHS = Object\.freeze\(\{\n {2}'demo-links-main': 'geo_data/);
  assert.equal(once.match(/'demo-links-short'/g).length, 2);
  assert.match(once, /old: 'a\.json'/);
  assert.equal(registerModels(once, models), once);
  const moved = registerModels(once, models.map(m => ({ ...m, outputSha256: 'f'.repeat(64) })));
  assert.equal(moved.match(/f{64}/g).length, 2);
  assert.equal(moved.length, once.length);
});
