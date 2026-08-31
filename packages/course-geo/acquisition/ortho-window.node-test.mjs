import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orthoWindowPlan } from './ortho-window.mjs';

const HASH = 'a'.repeat(64);

function discoveryReport(overrides = {}) {
  return {
    groundId: 'puttom',
    aoi: { bboxEpsg3006: [696000, 7024000, 698500, 7026000] },
    orthophoto: {
      collection: 'orto-u2-2024',
      resolutionMetres: 0.16,
      coverage: { complete: true },
      items: [{
        id: 'orto-item-1',
        assets: { data: { href: 'https://dl1.lantmateriet.se/bild/orto/item-1.tif', bytes: 1024, sha256: HASH } },
      }],
    },
    ...overrides,
  };
}

test('a bounded window is planned inside the discovered AOI', () => {
  const plan = orthoWindowPlan(discoveryReport(), '/tmp/cache', {
    bboxEpsg3006: [697000, 7024800, 697512, 7025312],
  });
  assert.equal(plan.collection, 'orto-u2-2024');
  assert.equal(plan.pixelWidth, 3200);
  assert.equal(plan.pixelHeight, 3200);
  assert.equal(plan.megapixels, 10.24);
  /* projwin is west, north, east, south -- getting that order wrong silently
     returns a mirrored or empty window rather than failing. */
  const projwin = plan.translateArgs.indexOf('-projwin');
  assert.deepEqual(plan.translateArgs.slice(projwin + 1, projwin + 5),
    ['697000', '7025312', '697512', '7024800']);
  assert.ok(plan.buildVrtArgs.some(argument => argument.startsWith('/vsicurl/https://dl1.lantmateriet.se/bild/')));
});

test('the megapixel budget is what keeps imagery an offline source', () => {
  /* The full Puttom AOI at 16 cm is 785 Mpx and 3.1 GB decoded. A caller that
     forgets to bound its window should be told, not quietly handed it. */
  assert.throws(() => orthoWindowPlan(discoveryReport(), '/tmp/cache'), /bounded budget/);
  assert.doesNotThrow(() => orthoWindowPlan(discoveryReport(), '/tmp/cache', {
    bboxEpsg3006: [697000, 7024800, 697512, 7025312],
  }));
});

test('resampling makes a whole-course window affordable and is recorded as such', () => {
  const plan = orthoWindowPlan(discoveryReport(), '/tmp/cache', {
    bboxEpsg3006: [696800, 7024200, 698100, 7025600],
    targetResolutionMetres: 0.5,
  });
  assert.equal(plan.resolutionMetres, 0.5);
  assert.equal(plan.sourceResolutionMetres, 0.16);
  assert.equal(plan.resampled, true);
  assert.equal(plan.pixelWidth, 2600);
  assert.equal(plan.pixelHeight, 2800);
  assert.equal(plan.megapixels, 7.28);
  const tr = plan.translateArgs.indexOf('-tr');
  assert.deepEqual(plan.translateArgs.slice(tr + 1, tr + 3), ['0.5', '0.5']);
  assert.equal(plan.translateArgs[plan.translateArgs.indexOf('-r') + 1], 'average');

  /* The same extent at the campaign's own 16 cm is 71 Mpx -- over budget, and
     that is the point: imagery is bounded input, never a free whole-course
     read. */
  assert.throws(() => orthoWindowPlan(discoveryReport(), '/tmp/cache', {
    bboxEpsg3006: [696800, 7024200, 698100, 7025600],
  }), /bounded budget/);

  /* Claiming detail the campaign does not have is refused outright. */
  assert.throws(() => orthoWindowPlan(discoveryReport(), '/tmp/cache', {
    bboxEpsg3006: [697000, 7024800, 697512, 7025312],
    targetResolutionMetres: 0.05,
  }), /no finer than the source campaign/);
});

test('a window outside the discovered AOI is refused', () => {
  assert.throws(() => orthoWindowPlan(discoveryReport(), '/tmp/cache', {
    bboxEpsg3006: [695000, 7024800, 695512, 7025312],
  }), /inside the discovered AOI/);
});

test('only checked Lantmäteriet image assets are accepted', () => {
  const foreign = discoveryReport();
  foreign.orthophoto.items[0].assets.data.href = 'https://example.invalid/bild/item.tif';
  assert.throws(() => orthoWindowPlan(foreign, '/tmp/cache', {
    bboxEpsg3006: [697000, 7024800, 697512, 7025312],
  }), /refusing non-orthophoto asset/);

  const heightAsset = discoveryReport();
  heightAsset.orthophoto.items[0].assets.data.href = 'https://dl1.lantmateriet.se/hojd/item.tif';
  assert.throws(() => orthoWindowPlan(heightAsset, '/tmp/cache', {
    bboxEpsg3006: [697000, 7024800, 697512, 7025312],
  }), /refusing non-orthophoto asset/);

  const credentialled = discoveryReport();
  credentialled.orthophoto.items[0].assets.data.href = 'https://user:pass@dl1.lantmateriet.se/bild/item.tif';
  assert.throws(() => orthoWindowPlan(credentialled, '/tmp/cache', {
    bboxEpsg3006: [697000, 7024800, 697512, 7025312],
  }), /no query, fragment or credentials/);
});

test('incomplete coverage is refused before any request is planned', () => {
  const partial = discoveryReport();
  partial.orthophoto.coverage.complete = false;
  assert.throws(() => orthoWindowPlan(partial, '/tmp/cache', {
    bboxEpsg3006: [697000, 7024800, 697512, 7025312],
  }), /does not cover the AOI/);
});
