import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContinuousOcean } from './continuous-ocean.mjs';

const ring = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const sea = (...box) => ({ isSea: true, ring: ring(...box) });
const defaults = { bounds: { x0: -64, z0: -64, x1: 64, z1: 64 }, seaLevel: 20.3432,
  spacing: 16, refineSpacing: 4, tolerance: 0.15, bodies: [sea(-60, -60, -30, 60)] };
const meshCovers = (field, x, z) => {
  const { positions: p, indices } = field;
  for (let k = 0; k < indices.length; k += 3) {
    const a = indices[k] * 3, b = indices[k + 1] * 3, c = indices[k + 2] * 3;
    const cross = (u, v, px, pz) => (p[v] - p[u]) * (pz - p[u + 2]) - (p[v + 2] - p[u + 2]) * (px - p[u]);
    const ab = cross(a, b, x, z), bc = cross(b, c, x, z), ca = cross(c, a, x, z);
    if ((ab >= -1e-8 && bc >= -1e-8 && ca >= -1e-8) || (ab <= 1e-8 && bc <= 1e-8 && ca <= 1e-8)) return true;
  }
  return false;
};

test('one datum-correct sea spans both sides of a legacy polygon closure without artificial edge foam', () => {
  const field = buildContinuousOcean({ ...defaults, heightAt: () => 20.3432 });
  assert.equal(field.kind, 'continuous-ocean');
  assert.equal(field.sourceBounds, null);
  assert.ok(Math.abs(field.maximumCoveredTerrainHeight - 20.4932) < 1e-12);
  assert.equal(field.cells, 64);
  assert.equal(field.quads, 8, 'open rows merge instead of submitting a triangle per terrain sample');
  assert.equal(field.refinedCells, 0);
  assert.equal(field.shorelineSegments, 0);
  assert.equal(field.shorelineDistances.length, field.positions.length / 3);
  assert.ok(field.shorelineDistances.every(d => d === 60), 'neither source crop nor world crop is a shore');
  for (let i = 1; i < field.positions.length; i += 3) assert.equal(field.positions[i], 20.3432, 'no second datum shift or display lift');
  for (const x of [-60, -31, -29, 0, 63]) {
    assert.equal(field.isSeaAt(x, 3), true);
    assert.equal(meshCovers(field, x, 3), true);
  }
});

test('an oblique analytic coast is clipped continuously and coast refinement keeps tint membership equal to the mesh', () => {
  const heightAt = (x, z) => 20.3432 + (x + 0.37 * z) * 0.1;
  const field = buildContinuousOcean({ ...defaults, heightAt });
  assert.ok(field.refinedCells > 0);
  assert.ok(field.shorelineSegments > 0);
  let boundary = 0;
  for (let i = 0; i < field.shorelineDistances.length; i++) if (field.shorelineDistances[i] === 0) {
    const x = field.positions[i * 3], z = field.positions[i * 3 + 2];
    assert.ok(Math.abs(x + 0.37 * z - 1.5) < 1e-8, 'interpolated vertices follow the contour, not grid steps');
    boundary++;
  }
  assert.ok(boundary > 20);
  for (let j = 0; j < 23; j++) for (let i = 0; i < 23; i++) {
    const x = -63 + i * 5.49, z = -62.7 + j * 5.52;
    const expected = heightAt(x, z) <= field.maximumCoveredTerrainHeight;
    assert.equal(field.isSeaAt(x, z), expected, `${x},${z}`);
    assert.equal(meshCovers(field, x, z), expected, `rendered contour ${x},${z}`);
  }
});

test('a high island remains dry while the connected sea passes around both sides', () => {
  const field = buildContinuousOcean({ ...defaults,
    heightAt: (x, z) => 20.3432 + Math.max(-0.1, (18 - Math.hypot(x - 9, z - 3)) * 0.3) });
  for (const [x, z] of [[9, 3], [0, 0], [15, 8]]) {
    assert.equal(field.isSeaAt(x, z), false);
    assert.equal(meshCovers(field, x, z), false);
  }
  for (const [x, z] of [[9, -30], [9, 35], [55, 3], [-55, 3]]) assert.equal(field.isSeaAt(x, z), true);
  assert.ok(field.shorelineDistances.some(d => d === 0));
});

test('a disconnected inland depression is never seeded by the height threshold alone', () => {
  const field = buildContinuousOcean({ ...defaults,
    heightAt: (x, z) => x < -15 || (x > 25 && x < 50 && Math.abs(z) < 13) ? 20.3432 : 30 });
  assert.equal(field.isSeaAt(-50, 0), true);
  assert.equal(field.isSeaAt(35, 0), false);
  assert.equal(meshCovers(field, 35, 0), false);
  assert.equal(field.isSeaAt(0, 0), false);
});

test('missing samples break connectivity and do not acquire invented shoreline foam', () => {
  const field = buildContinuousOcean({ ...defaults,
    heightAt: x => Math.abs(x) <= 5 ? null : 20.3432 });
  assert.equal(field.isSeaAt(-40, 0), true);
  assert.equal(field.isSeaAt(0, 0), false);
  assert.equal(field.isSeaAt(40, 0), false, 'the unseeded side cannot connect through the missing strip');
  assert.equal(meshCovers(field, 0, 0), false);
  assert.equal(field.shorelineSegments, 0, 'unknown extent is not an observed land boundary');
  assert.ok(field.shorelineDistances.every(d => d === 60));
});

test('every terrain mask cell has complete water geometry; refined coastal cells retain terrain', () => {
  const field = buildContinuousOcean({ ...defaults, heightAt: (x, z) => 20.3432 + (x + z * 0.2) * 0.2 });
  let masked = 0;
  for (let j = 0; j < field.height; j++) for (let i = 0; i < field.width; i++) {
    if (!field.terrainCoverage[j * field.width + i]) continue;
    masked++;
    for (const v of [0.001, 0.25, 0.5, 0.75, 0.999]) for (const u of [0.001, 0.25, 0.5, 0.75, 0.999]) {
      const x = field.bounds.x0 + (i + u) * field.spacing, z = field.bounds.z0 + (j + v) * field.spacing;
      assert.equal(field.isSeaAt(x, z), true);
      assert.equal(meshCovers(field, x, z), true, 'mask cannot punch a hole beyond the water surface');
    }
  }
  assert.ok(masked > 0 && masked < field.cells);
});

test('irregular world dimensions retain their exact bounds and do not produce inverted or degenerate triangles', () => {
  const field = buildContinuousOcean({ ...defaults, bounds: { x0: -63.2, z0: -59.1, x1: 61.7, z1: 65.3 },
    heightAt: (x, z) => 20.3432 + (x + z * 0.21) * 0.1 });
  for (let i = 0; i < field.positions.length; i += 3) {
    assert.ok(field.positions[i] >= field.bounds.x0 && field.positions[i] <= field.bounds.x1);
    assert.ok(field.positions[i + 2] >= field.bounds.z0 && field.positions[i + 2] <= field.bounds.z1);
  }
  for (let k = 0; k < field.indices.length; k += 3) {
    const a = field.indices[k] * 3, b = field.indices[k + 1] * 3, c = field.indices[k + 2] * 3, p = field.positions;
    const upward = (p[b + 2] - p[a + 2]) * (p[c] - p[a]) - (p[b] - p[a]) * (p[c + 2] - p[a + 2]);
    assert.ok(upward > 0, 'all nonempty faces point upward');
  }
  assert.equal(field.isSeaAt(Number.NaN, 0), false);
  assert.equal(field.isSeaAt(field.bounds.x1, 0), false);
});

test('no sea source means no invented ocean; invalid and excessive sampling requests fail explicitly', () => {
  let calls = 0;
  const field = buildContinuousOcean({ ...defaults, bodies: [{ isSea: false, ring: ring(-10, -10, 10, 10) }], heightAt: () => { calls++; return 0; } });
  assert.equal(field.indices.length, 0);
  assert.equal(calls, 0);
  assert.equal(field.isSeaAt(0, 0), false);
  assert.throws(() => buildContinuousOcean({ ...defaults, heightAt: () => 0, spacing: 0 }), /spacing/);
  assert.throws(() => buildContinuousOcean({ ...defaults, heightAt: () => 0, seaLevel: Infinity }), /finite/);
  assert.throws(() => buildContinuousOcean({ ...defaults, heightAt: () => 0, spacing: 0.01 }), /budget/);
});
