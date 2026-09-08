import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { createGroundAtlas } from '../apps/golf/src/engine/atlas.js';
import { buildGroundSurfaceFeatures } from '../apps/golf/src/engine/surface-features.mjs';
import { withInferredTeePads } from '../apps/golf/src/engine/tee-pads.mjs';
import { SURFACE } from '../apps/golf/src/engine/surface.js';
import { collectCoordinatePairs } from '../packages/course-geo/migration.mjs';

const model = JSON.parse(fs.readFileSync(new URL('../upsalabuild/course-model.json', import.meta.url)));
const osm = JSON.parse(fs.readFileSync(new URL('../upsalabuild/osm-features.json', import.meta.url)));
describe('reviewed Upsala ground mapping', () => {
  it('retains every source bunker even when no Stora hole claims it', () => {
    const ids = new Set([...model.holes.flatMap(h => h.bunkers.map(b => b.sourceId)), ...model.scenery.sourceFeatures.filter(f => f.kind === 'bunker').map(f => f.id), ...model.scenery.mappedFeatures.flatMap(f => f.replacesSourceIds || []), ...(model.scenery.retiredSourceFeatures || []).filter(f => f.kind === 'bunker').map(f => f.id)]);
    expect(osm.bunkers.filter(b => !ids.has(b.id))).toEqual([]);
    expect(osm.bunkers).toHaveLength(86);
    expect(model.scenery.retiredSourceFeatures.filter(f => f.kind === 'bunker').map(f => f.id)).toEqual(['w438984738']);
    expect(model.infra.buildings).toHaveLength(444);
  });
  it('keeps the practice-green island out of the putting turf', () => {
    const features = buildGroundSurfaceFeatures({ model: { scenery: model.scenery } });
    const atlas = createGroundAtlas({ CORE: { x0: -20, z0: -265, x1: 30, z1: -205 }, features, res: 0.25 });
    expect(atlas.sampleAt(3.5, -233.5).surface).not.toBe(SURFACE.GREEN);
    expect(atlas.sampleAt(12, -233.5).surface).toBe(SURFACE.GREEN);
    const targets = model.scenery.mappedFeatures.filter(f => f.kind === 'range_target_surface');
    expect(targets).toHaveLength(6);
    expect(features.filter(f => targets.some(t => t.id === f.sourceId))).toEqual([]);
  });
  it('does not recreate false tee decks beneath provisional markers', () => {
    const holes = withInferredTeePads(model.holes.filter(h => [8, 9].includes(h.n)));
    expect(holes.map(h => h.tees.pads.length)).toEqual([3, 3]);
    expect(holes.flatMap(h => h.tees.pads).every(p => p.preserveTerrain)).toBe(true);
  });
  it('does not feed source EPSG coordinates or pixel traces to the local-frame migration', () => {
    const collected = collectCoordinatePairs(model);
    expect(collected.coordinates.length).toBeGreaterThan(12000);
    for (const { pair } of collected.coordinates) expect(Math.max(...pair.map(Math.abs))).toBeLessThan(10000);
  });
});
