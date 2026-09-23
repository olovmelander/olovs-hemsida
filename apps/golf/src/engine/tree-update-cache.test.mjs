import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { createTreeReplay } from '../../../../tools/tree-update-replay.mjs';

const { createReplay, stepReplay, assertReplayEqual, treeFunctions } = createTreeReplay(THREE);

const baseline = readFileSync(new URL('../../../../tests/fixtures/tree-update-main-2026-09-22.txt', import.meta.url), 'utf8');
const candidate = treeFunctions(readFileSync(new URL('../main.js', import.meta.url), 'utf8'));

function fixture(low) {
  const n = 240, mats = [], imp = [], tint = [], zones = [], cells = [];
  for (let c = 0; c < 12; c++) {
    const x = (c % 4 - 1.5) * 60, z = (Math.floor(c / 4) - 1) * 60, list = [];
    for (let j = 0; j < 20; j++) {
      const k = c * 20 + j; list.push(k); zones.push(k % 4);
      const px = x + j / 2, pz = z + j / 3;
      const m = new THREE.Matrix4().makeTranslation(px, 0, pz); mats.push(...m.elements);
      imp.push(px, 0, pz, k / n, 1, 1); tint.push(1, 1, 1, k / n);
    }
    cells.push({ x0: x, x1: x + 20, z0: z, z1: z + 20, y0: 0, y1: 24,
      min: [x, 0, z], max: [x + 20, 24, z + 20], lists: [list, []] });
  }
  return { config: { cell: 60, fadeS: low ? .25 : .3, cellMode: false, nominalHeight: 12,
    heroPx: low ? 200 : 64, switchPx: low ? 60 : 24, impostorPx: low ? 22 : 8, hysteresis: .1,
    lodMode: 'zone', zoneTiers: [1, 1, 4, 4], dwell: 6, floors: [1, 1], floorReach: low ? [250, 500] : [500, 900], force: 0 },
    detailHeight: low ? 450 : 900, cells, mats: [mats, []], imp: [imp, []], tint: [tint, []],
    tiers: [{ n, treeH: Array(n).fill(24), treeCY: Array(n).fill(12), zone: zones }, null] };
}

describe('settled geographic tree decisions', () => {
  for (const low of [false, true]) for (const coordinateSystem of [THREE.WebGLCoordinateSystem, THREE.WebGPUCoordinateSystem]) {
    it(`matches the pre-cache application through settings, fades and frustum changes (${low}, ${coordinateSystem})`, () => {
      const input = fixture(low), a = createReplay(input, baseline, coordinateSystem, true), b = createReplay(input, candidate, coordinateSystem, true);
      const settings = new Map([
        [25, { force: 4 }], [28, { force: 1 }], [31, { force: 4 }], // active fade reversals
        [36, { force: 0 }], [38, { resetPending: true }],
        [60, { zoneTiers: [4, 1, 1, 4] }], // pending dwell must finish
        [62, { dwell: 10 }], [76, { zoneTiers: [1, 1, 4, 4] }],
        [90, { lodMode: 'screen' }], [112, { cellMode: true, resetPending: true }],
        [125, { force: 2 }], [128, { force: 3 }], [131, { force: 0 }],
        [140, { lodMode: 'zone' }], [141, { frozen: true }],
        [146, { zoneTiers: [4, 4, 1, 1] }], [150, { frozen: false }],
        [180, { force: 4 }], [181, { force: 1 }], [185, { force: 0, fadeS: 0 }],
        [190, { force: 4, fadeS: .3 }], [191, { force: 1 }],
        [220, { force: 0, zoneTiers: [1, 1, 4, 4], resetPending: true }],
      ]);
      let rebased = false, sawPending = false, sawQueue = false;
      for (let i = 0; i < 280; i++) {
        const x = i >= 95 && i < 125 ? Math.sin(i) * 2200 : i >= 225 && i < 245 ? 2200 : 0;
        const time = i < 190 ? i / 60 : 511.98 + (i - 190) / 60;
        const frame = { position: [x, 100, 300], target: [x, 12, 0], time, settings: settings.get(i) };
        stepReplay(a, frame); stepReplay(b, frame); assertReplayEqual(a, b);
        expect(a.audit().ok && b.audit().ok).toBe(true);
        sawPending ||= a.lod.tiers[0].pendN.some(n => n > 0);
        sawQueue ||= a.lod.queue.length > a.lod.qHead;
        rebased ||= a.lod.fadeClock < time;
      }
      expect(sawPending && sawQueue && rebased).toBe(true);
      expect(a.lod.stats.reversals).toBeGreaterThan(0);
      expect(b.counters.decisions).toBeLessThan(a.counters.decisions);
      expect(b.counters.uploadBytes).toBe(a.counters.uploadBytes);
      expect(b.counters.uploads).toBe(a.counters.uploads);
      expect(b.counters.sorts).toBeLessThan(a.counters.sorts);
      expect(b.counters.sortedSlots).toBeLessThan(a.counters.sortedSlots);
    });

    it(`skips settled decisions but keeps visibility checks (${low}, ${coordinateSystem})`, () => {
      const input = fixture(low), a = createReplay(input, baseline, coordinateSystem, true), b = createReplay(input, candidate, coordinateSystem, true);
      for (let i = 0; i < 60; i++) {
        const frame = { position: [0, 100, 300], target: [0, 12, 0], time: i / 60 };
        stepReplay(a, frame); stepReplay(b, frame); assertReplayEqual(a, b);
      }
      expect(b.counters.decisions).toBe(a.counters.decisions / 60);
      // Geographic selection is stationary even while the camera moves.
      for (const x of [1, 2, 3, 2200, 0]) {
        const frame = { position: [x, 100, 300], target: [x, 12, 0], time: 1.2 };
        stepReplay(a, frame); stepReplay(b, frame); assertReplayEqual(a, b);
      }
    });
  }
});

describe('shared dirty-slot runs', () => {
  const extract = source => {
    const start = source.indexOf('function flushRanges('), end = source.indexOf('\n}', start) + 2;
    return new Function(`${source.slice(start, end)}; return flushRanges;`)();
  };
  const before = extract(baseline), after = extract(candidate);
  for (const dirty of [[], [9, 1, 1, 3, 2, 80], Array.from({ length: 150 }, (_, i) => i * 3).reverse()]) {
    it(`preserves exact ranges and versions across strides (${dirty.length} dirty slots)`, () => {
      const groups = [2, 3, 4, 16].map(stride => [[new THREE.InstancedBufferAttribute(new Float32Array(500 * stride), stride)], stride]);
      const expected = groups.map(([attrs, stride]) => [attrs.map(a => a.clone()), stride]);
      for (const [attrs, stride] of expected) before(attrs, [...dirty], stride);
      const pending = [...dirty]; after(groups, pending);
      expect(pending).toEqual([]);
      for (let i = 0; i < groups.length; i++) {
        expect(groups[i][0][0].updateRanges).toEqual(expected[i][0][0].updateRanges);
        expect(groups[i][0][0].version).toBe(expected[i][0][0].version);
      }
    });
  }
});
