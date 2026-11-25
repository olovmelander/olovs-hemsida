/* A mapped surface is drawn once.

   A mapped feature (a waste area, a practice green, a hardstanding) reaches the screen one of two ways: the
   ground paints it as one of its own classes (surface-features.mjs), or main.js lays a sheet over the ground for
   it. At Bro Hof the waste areas went both ways: the ground painted them tan and a gravel sheet lay over that, and
   the course turned grey with distance. A picture found it, after release.

   The two rules live in two files, so this holds them together. The ground's rule is run as it is. The sheet's
   rule is the top of one loop in main.js, which cannot be imported without starting the player, so its own lines
   are lifted out as text and run: if that loop is moved or reshaped this test fails and says so, which is the
   right time to move the rule into a module both can call. Test files are not part of the engine's source
   revision, so holding the rule here costs no bake. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildGroundSurfaceFeatures, isTurfRangeTarget, mappedPathSurface } from './surface-features.mjs';

const ROOT = new URL('../../../../', import.meta.url);
const read = file => readFileSync(new URL(file, ROOT), 'utf8');
const RING = [[0, 0], [12, 0], [12, 9], [0, 9]];

/** Whether the ground paints this feature as one of its classes: the engine's own function, on the feature alone. */
function paintedByTheGround(feature) {
  const empty = buildGroundSurfaceFeatures({ holes: [], model: { scenery: {} } }).length;
  return buildGroundSurfaceFeatures({ holes: [], model: { scenery: { mappedFeatures: [{ ...feature, id: 'probe', rings: [RING] }] } } }).length > empty;
}

/** Whether main.js lays a sheet for this feature: the first lines of its own loop, lifted out and run. */
function sheetRule() {
  const source = read('apps/golf/src/main.js');
  const open = 'for (const feature of M.scenery.mappedFeatures || []) {\n', close = 'const key = JSON.stringify([feature.kind, feature.material ?? null]);';
  const start = source.indexOf(`const groups = new Map();\n  ${open}`), end = source.indexOf(close, start);
  if (start < 0 || end < 0) throw new Error('the loop that lays sheets for mapped features has moved in main.js: point this test at it, or move its rule into a module');
  const body = source.slice(source.indexOf(open, start) + open.length, end);
  expect(body.split('\n').length, 'the rule is a handful of lines; more than that is not the loop this test knows').toBeLessThan(14);
  expect(body).toMatch(/if \(inAtlas\) continue;/);
  return new Function('feature', 'SCENERY', 'mappedPathSurface', 'isTurfRangeTarget', `${body.replaceAll('continue;', 'return false;')}\nreturn true;`);
}
const laidAsASheet = (rule, feature) => rule({ ...feature, rings: [RING] }, null, mappedPathSurface, isTurfRangeTarget);

describe('a mapped surface', () => {
  const rule = sheetRule();

  it('is painted by the ground or laid as a sheet, never both, on every published course', () => {
    const seen = new Map();
    for (const course of JSON.parse(read('apps/golf/public/courses/index.json')).courses) {
      for (const feature of JSON.parse(read(`${course.build}/course-model.json`)).scenery?.mappedFeatures ?? []) {
        const key = `${feature.kind} | ${feature.material ?? ''}`;
        if (!seen.has(key)) seen.set(key, { kind: feature.kind, material: feature.material, courses: [] });
        seen.get(key).courses.push(course.slug);
      }
    }
    expect(seen.size, 'the published courses hold many kinds of mapped feature').toBeGreaterThan(12);
    const twice = [...seen.values()].filter(feature => paintedByTheGround(feature) && laidAsASheet(rule, feature))
      .map(feature => `${feature.kind}${feature.material ? ` (${feature.material})` : ''} on ${[...new Set(feature.courses)].join(', ')}`);
    expect(twice, 'drawn twice: the ground paints it and a sheet is laid over it').toEqual([]);
  });

  it('goes the way it is meant to: the cases that have gone wrong, and one of each kind of path', () => {
    const waste = { kind: 'waste_sand', material: 'waste_sand' };
    expect(paintedByTheGround(waste)).toBe(true);
    expect(laidAsASheet(rule, waste), 'Bro Hof: a gravel sheet over the ground\'s own waste sand greyed with distance').toBe(false);
    for (const feature of [{ kind: 'practice_green', material: 'putting-turf' }, { kind: 'practice_bunker', material: 'sand' }, { kind: 'range_target_surface', material: 'turf' },
      { kind: 'range_tee_pad', material: 'unverified-turf-surface' }, { kind: 'mown_approach' }]) {
      expect(paintedByTheGround(feature), feature.kind).toBe(true);
      expect(laidAsASheet(rule, feature), feature.kind).toBe(false);
    }
    for (const feature of [{ kind: 'range_mat', material: 'synthetic-turf' }, { kind: 'range_target_surface', material: 'unknown-bright-surface' }, { kind: 'range_tee_pad', material: 'mixed-hardstanding-and-mats' }]) {
      expect(paintedByTheGround(feature), feature.kind).toBe(false);
      expect(laidAsASheet(rule, feature), feature.kind).toBe(true);
    }
    // A hard surface is in the ground's atlas by its own path, so no sheet is laid for it either.
    expect(laidAsASheet(rule, { kind: 'hardstanding', material: 'gravel' })).toBe(false);
    expect(laidAsASheet(rule, { kind: 'paved_path', material: 'asphalt' })).toBe(false);
  });

  it('would be caught: a kind the ground paints, with its skip taken out of the loop, is drawn twice', () => {
    const source = read('apps/golf/src/main.js');
    const skip = 'if (feature.kind === \'waste_sand\') continue;';
    expect(source).toContain(skip);
    const open = 'for (const feature of M.scenery.mappedFeatures || []) {\n', start = source.indexOf(`const groups = new Map();\n  ${open}`);
    const body = source.slice(source.indexOf(open, start) + open.length, source.indexOf('const key = JSON.stringify([feature.kind, feature.material ?? null]);', start)).replace(skip, '');
    const broken = new Function('feature', 'SCENERY', 'mappedPathSurface', 'isTurfRangeTarget', `${body.replaceAll('continue;', 'return false;')}\nreturn true;`);
    const waste = { kind: 'waste_sand', material: 'waste_sand', rings: [RING] };
    expect(paintedByTheGround(waste) && broken(waste, null, mappedPathSurface, isTurfRangeTarget)).toBe(true);
  });
});
