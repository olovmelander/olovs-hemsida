import { describe, expect, it } from 'vitest';
import {
  V2_STREAM_PROBE_BUDGETS,
  compareStreamHeights,
  summarizeStreamProbe,
} from './v2-stream-probe.mjs';

const BOUNDS = Object.freeze({ x0: -100, x1: 100, z0: -100, z1: 100 });
const plane = (x, z) => 40 + x * 0.01 + z * 0.02;

function snapshot(overrides = {}) {
  return {
    backend: 'webgl2',
    mobile: false,
    renderer: { renderedTiles: 12, residentLayers: 12, drawCalls: 1 },
    stream: {
      readyTileIds: ['l0/2/1', 'l0/3/1'],
      loadingTileIds: [],
      failedTileIds: [],
      plan: { activeTileIds: ['l0/2/1'] },
    },
    requests: { started: 14, completed: 14 },
    ...overrides,
  };
}

describe('compareStreamHeights', () => {
  it('reports full agreement when both samplers describe the same ground', () => {
    const parity = compareStreamHeights({
      bounds: BOUNDS, samples: 8,
      streamHeightAt: (x, z) => ({ height: plane(x, z) }),
      pilotHeightAt: plane,
    });
    expect(parity.requested).toBe(64);
    expect(parity.compared).toBe(64);
    expect(parity.agreed).toBe(64);
    expect(parity.agreedFraction).toBe(1);
    expect(parity.maximumAbsoluteDifferenceMetres).toBe(0);
    expect(parity.streamMissing).toBe(0);
  });

  it('accepts a one-centimetre quantization tie but not a real disagreement', () => {
    const tie = compareStreamHeights({
      bounds: BOUNDS, samples: 4,
      streamHeightAt: (x, z) => plane(x, z) + 0.01,
      pilotHeightAt: plane,
    });
    expect(tie.agreedFraction).toBe(1);

    const drifted = compareStreamHeights({
      bounds: BOUNDS, samples: 4,
      streamHeightAt: (x, z) => plane(x, z) + 0.4,
      pilotHeightAt: plane,
    });
    expect(drifted.agreed).toBe(0);
    expect(drifted.maximumAbsoluteDifferenceMetres).toBeCloseTo(0.4, 3);
  });

  it('counts a sampler that returns nothing instead of silently agreeing', () => {
    const parity = compareStreamHeights({
      bounds: BOUNDS, samples: 4,
      streamHeightAt: () => Number.NaN,
      pilotHeightAt: plane,
    });
    expect(parity.compared).toBe(0);
    expect(parity.streamMissing).toBe(16);
    expect(parity.agreedFraction).toBe(0);
  });

  it('validates its inputs', () => {
    expect(() => compareStreamHeights({ bounds: { x0: 0 }, streamHeightAt: plane, pilotHeightAt: plane }))
      .toThrow(/finite probe bounds/);
    expect(() => compareStreamHeights({ bounds: BOUNDS, streamHeightAt: plane }))
      .toThrow(/both height samplers/);
    expect(() => compareStreamHeights({ bounds: BOUNDS, samples: 1, streamHeightAt: plane, pilotHeightAt: plane }))
      .toThrow(/samples must be/);
  });
});

describe('summarizeStreamProbe', () => {
  const parity = Object.freeze({ compared: 64, agreed: 64, agreedFraction: 1, streamMissing: 0 });

  it('records the budget comparison without ever claiming performance evidence', () => {
    const summary = summarizeStreamProbe({
      timings: { shellVisibleMilliseconds: 812.4, activeHoleRefinedMilliseconds: 2310.9 },
      snapshot: snapshot(),
      parity,
    });
    expect(summary.performanceEvidence).toBe(false);
    expect(summary.timings.shellVisibleMilliseconds).toBe(812.4);
    expect(summary.budgets.shellWithinBudget).toBe(true);
    expect(summary.budgets.activeHoleWithinBudget).toBe(true);
    expect(summary.budgets.drawCallsWithinBudget).toBe(true);
    expect(summary.budgets.terrainDrawCalls).toBe(V2_STREAM_PROBE_BUDGETS.terrainDrawCalls);
    expect(summary.correctnessPassed).toBe(true);
    expect(summary.stream.activeTileIds).toEqual(['l0/2/1']);
  });

  it('separates a slow run from an incorrect one', () => {
    const slow = summarizeStreamProbe({
      timings: { shellVisibleMilliseconds: 9000, activeHoleRefinedMilliseconds: 21000 },
      snapshot: snapshot(),
      parity,
    });
    expect(slow.budgets.shellWithinBudget).toBe(false);
    expect(slow.budgets.activeHoleWithinBudget).toBe(false);
    /* Slow on a software adapter is a measurement, not a correctness failure. */
    expect(slow.correctnessPassed).toBe(true);
  });

  it('fails correctness on a lost tile, a missing sample or a height disagreement', () => {
    const timings = { shellVisibleMilliseconds: 100, activeHoleRefinedMilliseconds: 200 };
    expect(summarizeStreamProbe({
      timings, parity,
      snapshot: snapshot({ stream: { ...snapshot().stream, failedTileIds: ['l0/3/1'] } }),
    }).correctnessPassed).toBe(false);

    expect(summarizeStreamProbe({
      timings, snapshot: snapshot(),
      parity: { ...parity, streamMissing: 3 },
    }).correctnessPassed).toBe(false);

    expect(summarizeStreamProbe({
      timings, snapshot: snapshot(),
      parity: { ...parity, agreed: 60, agreedFraction: 60 / 64 },
    }).correctnessPassed).toBe(false);

    expect(summarizeStreamProbe({
      timings, parity,
      snapshot: snapshot({ renderer: { renderedTiles: 0, residentLayers: 0, drawCalls: 0 } }),
    }).correctnessPassed).toBe(false);
  });

  it('never reports a timing it did not observe as within budget', () => {
    const summary = summarizeStreamProbe({
      timings: { shellVisibleMilliseconds: null, activeHoleRefinedMilliseconds: null },
      snapshot: snapshot(),
      parity,
    });
    expect(summary.timings.shellVisibleMilliseconds).toBe(null);
    expect(summary.budgets.shellWithinBudget).toBe(false);
    expect(summary.budgets.activeHoleWithinBudget).toBe(false);
  });

  it('distinguishes running out of time from streaming nothing', () => {
    const timedOut = summarizeStreamProbe({
      timings: {
        shellVisibleMilliseconds: null, activeHoleRefinedMilliseconds: null,
        deadlineMilliseconds: 180000, settledBeforeDeadline: false, elapsedMilliseconds: 180004.6,
      },
      snapshot: snapshot({
        renderer: { renderedTiles: 0, residentLayers: 0, drawCalls: 0 },
        stream: { readyTileIds: [], loadingTileIds: ['l0/2/1'], failedTileIds: [], plan: { activeTileIds: [] } },
      }),
      parity: { compared: 0, agreed: 0, agreedFraction: 0, streamMissing: 576 },
    });
    expect(timedOut.timings.settledBeforeDeadline).toBe(false);
    expect(timedOut.timings.deadlineMilliseconds).toBe(180000);
    expect(timedOut.timings.elapsedMilliseconds).toBe(180004.6);
    expect(timedOut.stream.loadingTiles).toBe(1);
    expect(timedOut.correctnessPassed).toBe(false);

    const settled = summarizeStreamProbe({
      timings: {
        shellVisibleMilliseconds: 400, activeHoleRefinedMilliseconds: 900,
        deadlineMilliseconds: 180000, settledBeforeDeadline: true, elapsedMilliseconds: 950,
      },
      snapshot: snapshot(),
      parity,
    });
    expect(settled.timings.settledBeforeDeadline).toBe(true);
    expect(settled.correctnessPassed).toBe(true);
  });
});
