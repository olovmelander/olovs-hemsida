import assert from 'node:assert/strict';
import { basename } from 'node:path';

/** Preserve legacy migration naming, while Upsala's shipped nine supersedes
 * its historical banguide model. Both source artifacts remain inventoried;
 * the registered current migration path is the runtime/control contract. */
export function selectMigrationInputs(manifest) {
  let models = manifest.artifacts.filter(artifact => artifact.kind === 'composite'
    && artifact.id.startsWith('legacy-') && /model\.json$/.test(artifact.path));
  const current = manifest.groundId === 'upsala'
    ? manifest.artifacts.filter(artifact => artifact.id === 'shipped-middle-course-model') : [];
  assert(current.length <= 1, 'duplicate shipped middle-course source');
  let currentOutput = null;
  if (current.length) {
    assert.equal(current[0].kind, 'composite', 'shipped middle-course source must be a composite');
    assert.equal(current[0].path, 'upsalamellanbuild/course-model.json', 'shipped middle-course source path changed');
    const output = manifest.artifacts.filter(artifact => artifact.id === 'migration-mellanbanan-course-model-epsg3006');
    assert.equal(output.length, 1, 'shipped middle course requires exactly one registered migration output');
    assert.equal(output[0].path, 'geo_data/course-v2/upsala/migration/mellanbanan-course-model.epsg3006.json',
      'shipped middle-course migration path changed');
    currentOutput = basename(output[0].path);
    models = models.filter(artifact => artifact.id !== 'legacy-middle-model').concat(current);
  }
  assert(models.length, `${manifest.groundId} has no inventoried model`);
  assert.equal(new Set(models.map(model => model.id)).size, models.length, 'duplicate migration source id');
  const used = new Set();
  return models.map(artifact => {
    let outputName = artifact === current[0] ? currentOutput : basename(artifact.path).replace(/\.json$/, '.epsg3006.json');
    if (used.has(outputName) && artifact !== current[0]) {
      outputName = `${artifact.id.replace(/^legacy-/, '')}.epsg3006.json`;
    }
    assert(!used.has(outputName), `${manifest.groundId} has colliding migration output ${outputName}`);
    used.add(outputName);
    return { artifact, outputName };
  });
}
