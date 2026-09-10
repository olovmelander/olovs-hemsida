import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import layout from './lidingo-practice-surfaces.json' with { type: 'json' };
import { createPracticeSurfaceFeatures, isPracticeSurfaceInterior } from './lidingo-practice-surfaces.mjs';
import { applySurfaceAppearance, isFacilityInterior, architectureStatus } from './lidingo.js';
import { loadArchitectureFixture } from '../../../../../lidingobuild/architecture-fixture.mjs';
import { buildGroundSurfaceFeatures } from '../surface-features.mjs';
import { rasterizeGroundAtlas } from '../atlas.js';
import { SURFACE } from '../surface.js';

const { model } = loadArchitectureFixture();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
afterEach(() => applySurfaceAppearance(model.scenery, { sourceView: true }));

describe('Lidingö confidence-traced practice surfaces', () => {
  it('pins the reviewed source and converts all seven native traces without moving any boundary', () => {
    const input = readFileSync(new URL('../../../../../lidingobuild/facilities/practice-surface-layout.json', import.meta.url));
    expect(hash(input)).toBe(layout.sourceLayout.sha256);
    const original = JSON.parse(input), features = createPracticeSurfaceFeatures();
    expect(features).toHaveLength(7);
    expect(features.filter(f => f.kind === 'practice_green')).toHaveLength(3);
    expect(features.filter(f => f.kind === 'practice_bunker')).toHaveLength(4);
    for (const f of features) {
      const source = original.features.find(s => s.id === f.id);
      expect(f.rings.map(r => r.map(([x,z]) => [x+677700.5,6586399.5-z]))).toEqual(source.geometry.coordinates);
      expect(f.sourceEpoch).toBe('2025-05-31'); expect(f.notSurveyed).toBe(true);
      expect(f.displayOnly).toBe(true); expect(f.preserveTerrain).toBe(true);
      expect(f.interpretationUncertaintyMetres).toBeGreaterThan(0);
      expect(f.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('adds surfaces idempotently while preserving every original source feature and source inspection', () => {
    const original = structuredClone(model), result = applySurfaceAppearance(model.scenery, { sourceView: false });
    const additional = result.mappedFeatures.filter(f => f.displayOnly);
    expect(additional).toHaveLength(7);
    expect(applySurfaceAppearance(result, { sourceView: false }).mappedFeatures).toHaveLength(result.mappedFeatures.length);
    for (const source of model.scenery.mappedFeatures) {
      const actual = result.mappedFeatures.find(f => f.id === source.id);
      expect(actual.rings).toBe(source.rings);
      if (source.id !== 'lidingo-courtyard-hardstanding-2019') expect(actual).toBe(source);
    }
    expect(result.greens).toBe(model.scenery.greens); expect(result.bunkers).toBe(model.scenery.bunkers);
    expect(model).toEqual(original);
    expect(model.infra.terrainPlacement).toBe('measured-only');
    const sourceView = applySurfaceAppearance(model.scenery, { sourceView: true });
    expect(sourceView).toBe(model.scenery);
    expect(sourceView.mappedFeatures.some(f => f.displayOnly)).toBe(false);
    expect(architectureStatus().practiceSurfaceCount).toBe(0);
    expect(model.infra.buildings.filter(b => b.roofSurface).reduce((n,b) => n+b.roofSurface.triangleIndices.length/3,0)).toBe(7069);
  });

  it('paints all seven interior probes through the actual shared terrain atlas', () => {
    const scenery = applySurfaceAppearance(model.scenery, { sourceView: false });
    const additions = scenery.mappedFeatures.filter(f => f.displayOnly);
    const all = additions.flatMap(f => f.rings.flat());
    const CORE = { x0: Math.floor(Math.min(...all.map(p => p[0])))-4,
      x1: Math.ceil(Math.max(...all.map(p => p[0])))+4,
      z0: Math.floor(Math.min(...all.map(p => p[1])))-4, z1: Math.ceil(Math.max(...all.map(p => p[1])))+4 };
    const features = buildGroundSurfaceFeatures({ model: { ...model, scenery }, holes: model.holes });
    const raster = rasterizeGroundAtlas({ CORE, features, res: 1, classesOnly: true, canopyFloor: model.cover });
    for (const f of additions) {
      const expected = f.kind === 'practice_green' ? SURFACE.GREEN : SURFACE.SAND;
      const compiled = features.find(g => g.sourceId === f.id);
      expect(compiled.surface).toBe(expected); expect(compiled.polygons).toEqual([{ rings: f.rings }]);
      const [x,z] = f.interiorProbeLocal, { x0,z0,w,res } = raster.bounds;
      const sample = raster.classes[Math.floor((z-z0)/res)*w + Math.floor((x-x0)/res)];
      expect(sample, `${f.id} terrain material at ${x},${z}`).toBe(expected);
      expect(isFacilityInterior(x,z), `${f.id} v2 tree exclusion`).toBe(true);
    }
    expect(architectureStatus().practiceSurfaceCount).toBe(7);
    expect(architectureStatus().practiceSurfaceIds).toEqual(additions.map(f => f.id));
  });

  it('preserves holes and concave exclusions in material painting and tree placement', () => {
    const outer = [[0,0],[12,0],[12,3],[8,3],[8,8],[0,8],[0,0]];
    const hole = [[2,2],[4,2],[4,4],[2,4],[2,2]];
    const feature = { id: 'synthetic-practice', kind: 'practice_green', rings: [outer,hole] };
    const forest = [[-2,-2],[14,-2],[14,10],[-2,10]];
    const features = buildGroundSurfaceFeatures({ model: { scenery: { mappedFeatures: [feature] }, veg: { forest: [forest] } } });
    const raster = rasterizeGroundAtlas({ CORE: { x0:-2,z0:-2,x1:14,z1:10 }, features, res:.5, classesOnly:true });
    const sample = (x,z) => raster.classes[Math.floor((z+2)/.5)*raster.bounds.w+Math.floor((x+2)/.5)];
    expect(sample(1,1)).toBe(SURFACE.GREEN); expect(sample(3,3)).toBe(SURFACE.FOREST);
    expect(sample(10,5)).toBe(SURFACE.FOREST);
    expect(isPracticeSurfaceInterior([feature],1,1)).toBe(true);
    expect(isPracticeSurfaceInterior([feature],3,3)).toBe(false);
    expect(isPracticeSurfaceInterior([feature],10,5)).toBe(false);
    expect(isPracticeSurfaceInterior([feature],-1,1)).toBe(false);
  });

  it('bypasses all new tree exclusions in source inspection and rejects a mismatched native frame', () => {
    const additions = applySurfaceAppearance(model.scenery, { sourceView:false }).mappedFeatures.filter(f => f.displayOnly);
    const point = additions[0].interiorProbeLocal;
    expect(isFacilityInterior(...point)).toBe(true);
    applySurfaceAppearance(model.scenery, { sourceView:true });
    expect(isFacilityInterior(...point)).toBe(false);
    const wrong = structuredClone(layout); wrong.frame.originEpsg3006[1] += 1;
    expect(() => createPracticeSurfaceFeatures(wrong)).toThrow('frame');
  });
});
