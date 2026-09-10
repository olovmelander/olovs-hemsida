import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { applyReviewedTeePlacement, reviewPixel } from './reviewed-tee-placement.mjs';
import { lineBearingAt, inRing } from '../../apps/golf/src/engine/geom.js';
import { canRenderTeeMarker } from '../../apps/golf/src/engine/tee-marker-visibility.mjs';
import { reviewedTeeMarkerPositions } from '../../apps/golf/src/engine/reviewed-tee-marker-placement.mjs';
import { readPack, inflateStream } from '../../packages/course-pack/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const colours = ['white', 'yellow', 'blue', 'red', 'orange'];
function fixture() {
  const holes = Array.from({ length: 18 }, (_, i) => {
    const x = i * 30;
    return { n: i + 1, par: 4, idx: i + 1, t: [350, 330, 310, 290, 270],
      line: [[x, 0], [x + 20, 80], [x + 50, 160]], lineLen: 168,
      green: { c: [x + 50, 160], ring: [[x + 45, 155], [x + 55, 155], [x + 55, 165], [x + 45, 165]] },
      fairway: { rings: [] }, bunkers: [], pin: [x + 50, 160], elev: { tee: 10, green: 30, rise: 20 },
      tees: { inferPads: false, pads: [{ sourceFeatureId: `pad-${i + 1}`,
        ring: [[x - 5, -5], [x + 5, -5], [x + 5, 5], [x - 5, 5], [x - 5, -5]], preserveTerrain: true }],
      marks: colours.map((_, index) => ({ c: [x, 2], b: -50, m: 350 - 20 * index })) } };
  });
  const review = { id: 'synthetic-review', groundId: 'lidingo', horizontalCrs: 'EPSG:3006', capturedAt: '2025-05-31',
    holes: holes.map(hole => ({ hole: hole.n,
      image: { width: 40, height: 40, geoTransform: [677690.5 + (hole.n - 1) * 30, .5, 0, 6586409.5, 0, -.5] },
      pads: [{ id: `pad-${hole.n}`, pixels: [[10, 10], [30, 10], [30, 30], [10, 30]] }],
      marks: colours.map((colour, i) => ({ colour, status: 'guide-and-orthophoto-associated',
        padId: `pad-${hole.n}`, pixel: [20, 16 + i * 2], note: 'Synthetic test association, no real source claim.' })) })) };
  return { holes, review };
}

test('reviewed pixels use the declared projected image frame and reject outside or rotated inputs', () => {
  const { review } = fixture(), image = review.holes[0].image;
  assert.deepEqual(reviewPixel(image, [20, 20]), [677700.5, 6586399.5]);
  for (const pixel of [[-1, 20], [41, 20], [20, NaN]]) assert.throws(() => reviewPixel(image, pixel), /image coordinates/);
  assert.throws(() => reviewPixel({ ...image, geoTransform: [677690.5, .5, .1, 6586409.5, 0, -.5] }, [20, 20]), /image coordinates/);
});

test('all colours fit reviewed platforms while preserving source inputs, card, route and terrain policies', () => {
  const { holes, review } = fixture(), before = structuredClone({ holes, review });
  const sampled = [], output = applyReviewedTeePlacement(holes, review, (x, z) => { sampled.push([x, z]); return 20 + z; });
  assert.deepEqual({ holes, review }, before);
  assert.equal(sampled.length, 18);
  for (const [index, hole] of output.entries()) {
    assert.deepEqual(hole.line, holes[index].line);
    assert.deepEqual(hole.t, holes[index].t);
    assert.deepEqual(hole.green, holes[index].green);
    assert.deepEqual(hole.pin, holes[index].pin);
    assert.equal(hole.lineLen, holes[index].lineLen);
    assert.equal(hole.tees.inferPads, false);
    assert.deepEqual(hole.tees.pads[0].ring, holes[index].tees.pads[0].ring);
    assert.equal(hole.tees.pads[0].preserveTerrain, true);
    assert.deepEqual(sampled[index], hole.tees.marks[1].c);
    assert.equal(hole.elev.tee, 19);
    assert.equal(hole.elev.rise, 11);
    for (const [colour, mark] of hole.tees.marks.entries()) {
      assert.equal(mark.m, holes[index].tees.marks[colour].m);
      assert.equal(mark.b, lineBearingAt(hole.line, mark.c) * 180 / Math.PI);
      assert.deepEqual(mark.orthophotoReference.originalReference.c, holes[index].tees.marks[colour].c);
      assert.equal(canRenderTeeMarker(hole, mark, 'mapped-only'), true);
      const pair = reviewedTeeMarkerPositions(hole, mark);
      assert.equal(pair.length, 2);
      assert.ok(pair.every(point => inRing(...point, hole.tees.pads[0].ring)));
    }
  }
});

test('unresolved colours retain their inherited reference and cannot become physical marker pairs', () => {
  const { holes, review } = fixture();
  review.holes[0].marks[2] = { colour: 'blue', status: 'unresolved', note: 'Source association is not visible.' };
  const output = applyReviewedTeePlacement(holes, review), mark = output[0].tees.marks[2];
  assert.deepEqual(mark.c, holes[0].tees.marks[2].c);
  assert.equal(canRenderTeeMarker(output[0], mark, 'mapped-only'), false);
  assert.deepEqual(reviewedTeeMarkerPositions(output[0], mark), []);
});

test('stale pad pixels, outside references, wrong colour order and absent heights fail before source mutation', () => {
  for (const mutate of [
    ({ review }) => { review.holes[0].pads[0].pixels[0][0] += 1; },
    ({ review }) => { review.holes[0].marks[0].pixel = [0, 0]; },
    ({ review }) => { review.holes[0].marks[0].colour = 'orange'; },
    ({ review }) => { review.holes.pop(); },
  ]) {
    const input = fixture(); mutate(input);
    const before = structuredClone(input);
    assert.throws(() => applyReviewedTeePlacement(input.holes, input.review));
    assert.deepEqual(input, before);
  }
  const { holes, review } = fixture();
  assert.throws(() => applyReviewedTeePlacement(holes, review, () => NaN), /tee height unavailable/);
});

test('the real pack emitter retains platform identities, colour evidence, explicit opt-in and terrain placement', () => {
  const { holes, review } = fixture();
  const model = { origin: { lat: 59.3, lon: 18.1 }, mPerLon: 56000, seaLevel: 0,
    frame: 'synthetic-test', holes: applyReviewedTeePlacement(holes, review), water: [], streams: [], vegetation: [],
    scenery: {}, infra: { objectPlacement: 'mapped-only', terrainPlacement: 'measured-only', vegetationPlacement: 'measured-only' } };
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lidingo-tee-pack-'));
  try {
    const build = path.join(temporary, 'build'), out = path.join(temporary, 'pack');
    fs.mkdirSync(build);
    fs.writeFileSync(path.join(build, 'course-model.json'), JSON.stringify(model));
    const hf = { x0: 0, z0: 0, dx: 1, nx: 2, nz: 2, h0: 0, hs: .01, b64: deflateRawSync(Buffer.alloc(8)).toString('base64') };
    fs.writeFileSync(path.join(build, 'heightfields.json'), JSON.stringify({ hf0: hf, hf1: hf }));
    execFileSync(process.execPath, ['packages/course-pack/emit-pack.mjs', path.relative(ROOT, build), path.relative(ROOT, out), 'lidingo-test'], { cwd: ROOT, stdio: 'pipe' });
    const packed = JSON.parse(inflateStream(readPack(fs.readFileSync(path.join(out, 'pack.bin'))).sv));
    assert.deepEqual(packed.infra, model.infra);
    for (const [i, hole] of packed.holes.entries()) {
      const source = model.holes[i];
      assert.equal(hole.tees.markerPlacement, 'reviewed');
      assert.equal(hole.tees.markerLayout, 'separate-reviewed-colours');
      assert.equal(hole.tees.inferPads, false);
      assert.equal(hole.tees.pads[0].id, source.tees.pads[0].id);
      assert.equal(hole.tees.pads[0].preserveTerrain, true);
      assert.deepEqual(hole.tees.marks.map(mark => [mark.c, mark.sourcePadId, mark.orthophotoReference]),
        source.tees.marks.map(mark => [mark.c, mark.sourcePadId, mark.orthophotoReference]));
      assert.ok(hole.tees.marks.every(mark => canRenderTeeMarker(hole, mark, packed.infra.objectPlacement)));
    }
  } finally {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('lidingo-tee-pack-'));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
