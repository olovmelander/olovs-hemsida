import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isCourseFrameVisible, rendererImageEvidence } from './visual-evidence.mjs';

function image(width, height, pixel) {
  const channels = 4;
  const data = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [red, green, blue] = pixel(x, y);
    const offset = (y * width + x) * channels;
    data[offset] = red;
    data[offset + 1] = green;
    data[offset + 2] = blue;
    data[offset + 3] = 255;
  }
  return { width, height, channels, data };
}

const solid = colour => image(160, 120, () => colour);

test('uniform dark teal clear frame is rejected', () => {
  const evidence = rendererImageEvidence(solid([3, 17, 19]));
  assert.equal(evidence.coreRobustLuminanceRange, 0);
  assert.equal(evidence.coreStructuredCellPercent, 0);
  assert.equal(isCourseFrameVisible(evidence), false);
});

test('uniform bright fog frame is rejected', () => {
  const evidence = rendererImageEvidence(solid([244, 247, 248]));
  assert.ok(evidence.meanLuminance > 0.95);
  assert.equal(evidence.coreLuminanceStdDev, 0);
  assert.equal(isCourseFrameVisible(evidence), false);
});

test('UI-like variation confined to frame edges cannot hide a blank centre', () => {
  const frame = image(160, 120, (x, y) => {
    const edge = x < 22 || x >= 138 || y < 18 || y >= 102;
    if (!edge) return [74, 104, 91];
    const checker = (Math.floor(x / 5) + Math.floor(y / 5)) % 2;
    return checker ? [255, 255, 255] : [13, 31, 45];
  });
  const evidence = rendererImageEvidence(frame);
  assert.ok(evidence.nearWhitePercent > 5, 'edge controls should affect whole-frame statistics');
  assert.equal(evidence.coreRobustLuminanceRange, 0);
  assert.equal(evidence.coreStrongEdgePercent, 0);
  assert.equal(isCourseFrameVisible(evidence), false);
});

test('daylight terrain with distributed relief and surface detail is accepted', () => {
  const frame = image(160, 120, (x, y) => {
    if (y < 31) {
      const sky = 188 + Math.floor(y * 0.8);
      return [sky - 24, sky, Math.min(255, sky + 24)];
    }
    const relief = Math.round(18 * Math.sin(x * 0.16) + 11 * Math.sin((x + y) * 0.11));
    const mowing = Math.floor(x / 10) % 2 ? 10 : -7;
    const depth = Math.round((y - 31) * 0.55);
    const green = 91 + relief + mowing + depth;
    return [Math.max(25, green - 39), Math.min(190, green), Math.max(22, green - 51)];
  });
  const evidence = rendererImageEvidence(frame);
  assert.ok(evidence.coreStructuredCellPercent >= 75);
  assert.ok(evidence.coreStrongEdgePercent >= 0.5);
  assert.equal(isCourseFrameVisible(evidence), true);
  assert.deepEqual(rendererImageEvidence(frame), evidence, 'measurement must be deterministic');
});

test('dark but structurally varied course scene remains acceptable', () => {
  const frame = image(160, 120, (x, y) => {
    const ridge = ((Math.floor(x / 9) + Math.floor(y / 8)) % 3) * 7;
    const relief = Math.round(4 * (1 + Math.sin(x * 0.22 + y * 0.13)));
    const depth = Math.floor(y / 24) * 2;
    const value = 3 + ridge + relief + depth;
    return [value, value + 3, value + 2];
  });
  const evidence = rendererImageEvidence(frame);
  assert.ok(evidence.meanLuminance < 0.1);
  assert.ok(evidence.nearBlackPercent > 3);
  assert.ok(evidence.coreRobustLuminanceRange >= 0.045);
  assert.equal(isCourseFrameVisible(evidence), true);
});
