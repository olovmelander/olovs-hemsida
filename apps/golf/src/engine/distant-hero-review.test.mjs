import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { distantHeroReviewPixels } from './distant-hero-review.mjs';
import { preparedTintAllowed } from './prepared-ground-tint.mjs';
import { preparedWaterAllowed } from './prepared-water.mjs';
import { preparedVistaAllowed } from './prepared-vista.mjs';
import { preparedScatterAllowed } from './prepared-scatter.mjs';
import { createTreeReplay } from '../../../../tools/tree-update-replay.mjs';

const { createReplay, stepReplay, treeFunctions } = createTreeReplay(THREE);
const source = treeFunctions(readFileSync(new URL('../main.js', import.meta.url), 'utf8'));
function fixture(threshold, detailHeight, coordinateSystem) {
  const mats = Array.from({ length: 4 }, () => new THREE.Matrix4().elements).flat();
  const input = { config: { fadeS: .3, cellMode: false, nominalHeight: 12, heroPx: 64, switchPx: 24,
    impostorPx: 8, hysteresis: .1, lodMode: 'zone', zoneTiers: [1, 1, 4, 4], distantHeroPx: threshold,
    dwell: 6, floors: [1, 1], floorReach: [500, 900], force: 0 }, detailHeight,
    cells: [{ min: [-10, 0, -10], max: [10, 24, 10], lists: [[0, 1, 2, 3]] }],
    mats: [mats], imp: [[0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1]],
    tint: [Array(16).fill(1)], tiers: [{ n: 4, treeH: [24, 24, 24, 24], treeCY: [12, 12, 12, 12], zone: [1, 2, 3, 0] }] };
  const replay = createReplay(input, source, coordinateSystem);
  let time = 0;
  const step = (px, count = 1, settings) => {
    for (let i = 0; i < count; i++) {
      time += 1 / 60;
      const z = 24 * detailHeight / (2 * Math.tan(48 * Math.PI / 360) * px);
      stepReplay(replay, { position: [0, 12, z], target: [0, 12, 0], time, settings });
      expect(replay.audit().ok).toBe(true);
      expect(replay.lod.tiers[0].t[2].count + replay.lod.tiers[0].t[3].count).toBe(0);
    }
    return Array.from(replay.lod.tiers[0].tierOf);
  };
  return { replay, step };
}

describe('distant Hero policy', () => {
  it('defaults ordinary course URLs to the measured 24 px policy', () => {
    for (const search of ['', '?bana=puttom&q=hi', '?bana=veckefjarden&q=lo&gl=1'])
      expect(distantHeroReviewPixels(search)).toBe(24);
  });
  it('retains the geographic opt-out and measured review overrides', () => {
    for (const search of ['?distanthero=0', '?distanthero=', '?distanthero=32', '?distanthero=NaN'])
      expect(distantHeroReviewPixels(search)).toBe(0);
    expect(distantHeroReviewPixels('?distanthero=1')).toBe(24);
    expect(distantHeroReviewPixels('?distanthero=24')).toBe(24);
    expect(distantHeroReviewPixels('?distanthero=16')).toBe(16);
  });
  it('keeps the independent prepared startup paths eligible during review', () => {
    for (const allowed of [preparedTintAllowed, preparedWaterAllowed, preparedVistaAllowed, preparedScatterAllowed])
      for (const value of ['0', '16', '24']) expect(allowed(`?bana=puttom&distanthero=${value}`)).toBe(true);
  });
  for (const backend of [THREE.WebGLCoordinateSystem, THREE.WebGPUCoordinateSystem]) for (const height of [450, 1080]) {
    it(`keeps explicit opt-out geographic detail at every distance (${backend}, ${height})`, () => {
      const { step } = fixture(distantHeroReviewPixels('?distanthero=0'), height, backend);
      for (const px of [40, 20, 8, 50]) expect(step(px, 30)).toEqual([1, 1, 4, 4]);
    });
    for (const threshold of [16, distantHeroReviewPixels('')]) {
      it(`retains near Hero, outer impostors, hysteresis, dwell and fades (${backend}, ${height}, ${threshold})`, () => {
        const { replay, step } = fixture(threshold, height, backend);
        expect(step(threshold * 1.3)).toEqual([1, 1, 4, 4]);
        expect(step(threshold * .95, 10)).toEqual([1, 1, 4, 4]);
        expect(step(threshold * .89, 5)).toEqual([1, 1, 4, 4]);
        expect(step(threshold * .89)).toEqual([4, 4, 4, 4]);
        expect(Array.from(replay.lod.tiers[0].outTier)).toEqual([1, 1, 0, 0]);
        expect(step(threshold * 1.05, 30)).toEqual([4, 4, 4, 4]);
        expect(Array.from(replay.lod.tiers[0].outTier)).toEqual([0, 0, 0, 0]);
        expect(step(threshold * 1.11, 5)).toEqual([4, 4, 4, 4]);
        expect(step(threshold * 1.11)).toEqual([1, 1, 4, 4]);
        expect(step(threshold * 1.11, 30)).toEqual([1, 1, 4, 4]);
        expect(Array.from(replay.lod.tiers[0].outTier)).toEqual([0, 0, 0, 0]);
        expect(replay.lod.stats.switches).toBe(4);
        expect(step(threshold * .5, 1, { force: 1 })).toEqual([1, 1, 1, 1]);
      });
    }
  }
});
