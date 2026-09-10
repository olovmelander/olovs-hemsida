import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyObAlignmentReview, reviewedObLines, referencePosts } from './reviewed-ob-alignment.mjs';

const review = JSON.parse(fs.readFileSync(new URL('./ob-alignment-review-2026-09-09.json', import.meta.url), 'utf8'));
const fixture = () => ({ origin: structuredClone(review.frame.origin),
  holes: Array.from({ length: 18 }, (_, i) => ({ n: i + 1, tees: { pads: [], marks: [] } })),
  water: [{ ring: [[0, 0], [1, 1], [0, 1]] }],
  marking: [{ id: 'unrelated-penalty-area', c: 'r', pts: [[12, 45]] }] });
function distanceToLine(point, line) {
  return Math.min(...line.slice(1).map((b, i) => {
    const a = line[i], dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dz);
  }));
}

test('native source pixels retain exact EPSG:3006 placement and intended rule holes', () => {
  const lines = reviewedObLines(review);
  assert.deepEqual(lines.map(({ feature }) => feature.hole), [2, 11, 12, 14, 15]);
  for (const { feature, line } of lines) {
    const window = review.sourceWindows.find(window => window.id === feature.sourceWindowId);
    feature.pixels.forEach(([col, row], i) => {
      assert.ok(Math.abs(line[i][0] + review.frame.easting - window.geoTransform[0] - col * .16) < .00051);
      assert.ok(Math.abs(review.frame.northing - line[i][1] - window.geoTransform[3] + row * .16) < .00051);
    });
  }
});

test('display posts stay on original road edges across bends and preserve endpoints', () => {
  const result = applyObAlignmentReview(fixture(), review);
  for (const marking of result.marking.filter(marking => marking.c === 'w')) {
    assert.deepEqual(marking.pts[0], marking.line[0]);
    assert.deepEqual(marking.pts.at(-1), marking.line.at(-1));
    for (const [i, point] of marking.pts.entries()) {
      assert.ok(distanceToLine(point, marking.line) < .001);
      if (i) assert.ok(Math.hypot(point[0] - marking.pts[i - 1][0], point[1] - marking.pts[i - 1][1]) <= 12.002);
    }
    assert.equal(marking.physicalPostPositionsObserved, false);
    assert.equal(marking.boundaryDefinition, 'course-side-asphalt-edge');
  }
  assert.deepEqual(referencePosts([[0, 0], [0, 10], [10, 10]], 10), [[0, 0], [0, 10], [10, 10]]);
});

test('OB integration preserves other marks, playing surfaces and terrain, and is idempotent', () => {
  const input = fixture(), before = structuredClone(input), output = applyObAlignmentReview(input, review);
  assert.deepEqual(input, before);
  assert.deepEqual(output.holes, input.holes);
  assert.deepEqual(output.water, input.water);
  assert.deepEqual(output.marking[0], input.marking[0]);
  assert.equal(output.marking.length, 6);
  assert.deepEqual(applyObAlignmentReview(output, review), output);
  assert.equal(output.obPlacementReview.completePhysicalStakeCensus, false);
  const northLimit = review.frame.northing - output.marking.find(row => row.hole === 15).pts[0][1];
  assert.ok(northLimit < 6586840, 'the canopy-hidden northern H15 edge stays unpopulated');
});

test('rejects source transform drift, out-of-window traces, unsupported rule holes and measured-stake claims', () => {
  for (const corrupt of [
    copy => { copy.sourceWindows[0].geoTransform[0] += 1; },
    copy => { copy.features[0].pixels[0][0] = -1; },
    copy => { copy.features[0].hole = 3; },
    copy => { copy.method.physicalPostPositionsObserved = true; },
    copy => { copy.postPlacement.maximumSpacingMetres = 0; },
  ]) {
    const copy = structuredClone(review); corrupt(copy);
    assert.throws(() => applyObAlignmentReview(fixture(), copy));
  }
  const wrongFrame = fixture(); wrongFrame.origin.lat += .00001;
  assert.throws(() => applyObAlignmentReview(wrongFrame, review), /origin/);
});
