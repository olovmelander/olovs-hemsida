import { describe, expect, it } from 'vitest';
import model from '../../../../../nvgkbuild/course-model.json' with { type: 'json' };
import site from './norrfallsviken-range-site.json' with { type: 'json' };
import refined from './norrfallsviken-range-shelter-meshes.json' with { type: 'json' };
import architecture from './norrfallsviken-facilities-meshes.json' with { type: 'json' };
import { isReviewedRangeFeature, prepareRangeScenery, rangeFeatureIds, rangePlatformPlane, rangeSite,
  renderRangeDetails, tessellateRangeSurface } from './norrfallsviken-range.mjs';
import { compileFacilityGeometry, installedArchitectureParts } from './norrfallsviken-facilities.mjs';
import { applySurfaceAppearance, customMappedKinds, renderCourtyard } from './norrfallsviken.js';

const DATUM = 20.3432;
const centre = ring => ring.reduce((c, p) => [c[0] + p[0] / ring.length, c[1] + p[1] / ring.length], [0, 0]);
const byId = features => new Map(features.map(f => [f.id, f]));
const inside = (x, z, ring) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[j];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) hit = !hit;
  }
  return hit;
};

describe('Norrfallsviken reviewed range outlines', () => {
  it('replaces the intake mat markers by id, adds the four platforms, and passes every other feature through by identity', () => {
    const source = model.scenery;
    const revised = prepareRangeScenery(source);
    const before = byId(source.mappedFeatures), after = byId(revised.mappedFeatures);
    expect(rangeFeatureIds).toHaveLength(20);
    expect(after.size).toBe(before.size + site.pads.length);
    for (const feature of source.mappedFeatures) {
      if (isReviewedRangeFeature(feature)) continue;
      expect(after.get(feature.id)).toBe(feature);
    }
    const mats = revised.mappedFeatures.filter(f => f.kind === 'range_mat');
    expect(mats).toHaveLength(12);
    for (const mat of mats) {
      expect(mat.rings[0]).toHaveLength(4);
      expect(mat.prov).toBe('lm-orthophoto');
      expect(mat.notSurveyed).toBe(true);
      expect(mat.padId).toMatch(/^lm-range-platform-0[1-4]$/);
      expect(before.get(mat.id).kind).toBe('range_mat');
    }
    expect(revised.mappedFeatures.filter(f => f.kind === 'range_platform')).toHaveLength(4);
    expect(revised.mappedFeatures.filter(f => f.kind === 'range_target_surface')).toHaveLength(3);
    const hardstanding = after.get('lm-range-hardstanding');
    expect(hardstanding.kind).toBe('paved_path');
    expect(hardstanding.material).toBe('gravel');
    // The generic mapped-surface pass must skip what the range module draws itself.
    for (const kind of ['range_mat', 'range_platform', 'range_target_surface']) expect(customMappedKinds).toContain(kind);
    // Every mat centre lies inside its own platform, and every platform inside the range field.
    for (const mat of rangeSite.mats) {
      const pad = rangeSite.pads.find(p => p.id === mat.padId);
      expect(pad.matIds).toContain(mat.id);
      expect(inside(...centre(mat.ring), pad.ring)).toBe(true);
    }
  });

  it('is a display revision: source inspection returns the scenery itself and reapplying re-derives it', () => {
    const source = model.scenery;
    expect(applySurfaceAppearance(source, { sourceView: true })).toBe(source);
    const once = applySurfaceAppearance(source), twice = applySurfaceAppearance(once);
    expect(twice.mappedFeatures.length).toBe(once.mappedFeatures.length);
    expect(twice.mappedFeatures.map(f => f.id)).toEqual(once.mappedFeatures.map(f => f.id));
    expect(twice.mappedFeatures.map(f => f.rings)).toEqual(once.mappedFeatures.map(f => f.rings));
    expect(once.greens).toBe(source.greens);
    expect(once.range).toBe(source.range);
  });

  it('tessellates a range surface into short shared edges', () => {
    const ring = [[0, 0], [9.3, 0.4], [9.8, 5.1], [0.2, 4.6]];
    const mesh = tessellateRangeSurface(ring, .65);
    expect(mesh.faces.length).toBeGreaterThan(100);
    for (const face of mesh.faces) {
      for (let i = 0; i < 3; i++) {
        const p = mesh.vertices[face[i]], q = mesh.vertices[face[(i + 1) % 3]];
        expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThanOrEqual(.65 + 1e-9);
      }
    }
    expect(mesh.vertices.flat().every(Number.isFinite)).toBe(true);
  });

  it('fits each platform as a plane that clears the sampled ground everywhere', () => {
    const terrainH = (x, z) => 30 + .04 * (x + 350) - .02 * (z - 230) + .05 * Math.sin(x) * Math.cos(z);
    for (const pad of rangeSite.pads) {
      const plane = rangePlatformPlane(pad.ring, terrainH);
      expect(plane.samples).toBeGreaterThan(20);
      expect(plane.lift).toBeGreaterThanOrEqual(.075 - 1e-9);
      for (const [x, z] of tessellateRangeSurface(pad.ring, .5).vertices) {
        expect(plane.heightAt(x, z)).toBeGreaterThanOrEqual(terrainH(x, z) + .075 - 1e-9);
      }
    }
    expect(() => rangePlatformPlane(rangeSite.pads[0].ring, () => NaN)).toThrow(/ground unavailable/);
  });

  it('draws twelve mats on four platforms with trays, one gravel hardstanding and three target patches', () => {
    const emitted = [];
    const result = renderRangeDetails({ terrainH: (x, z) => 31 + .01 * x - .015 * z,
      tri: (...t) => emitted.push(t), L: colour => colour });
    expect(result.counts).toMatchObject({ range_mat: 12, range_platform: 4, range_gravel: 1, range_target_surface: 3 });
    expect(result.counts.range_ball_tray).toBeGreaterThan(0);
    expect(result.counts.range_ball_tray).toBeLessThanOrEqual(12);
    expect(result.triangles).toBe(emitted.length);
    expect(result.platforms.map(p => p.id)).toEqual(site.pads.map(p => p.id));
    expect(emitted.flatMap(t => t.slice(0, 3)).flat().every(Number.isFinite)).toBe(true);
    expect(emitted.filter(t => t[3] === 0x377340).length).toBeGreaterThanOrEqual(24);
  });

  it('merges the range details into the courtyard pass without drawing the intake mats twice', () => {
    const emitted = [];
    const features = prepareRangeScenery(model.scenery).mappedFeatures;
    const result = renderCourtyard({ features, buildings: model.infra.buildings,
      terrainH: () => 31, tri: (...t) => emitted.push(t), L: colour => colour });
    expect(result.counts.range_mat).toBe(12);
    expect(result.counts.sports_court).toBe(1);
    expect(result.counts.terrace).toBe(1);
    expect(result.triangles).toBe(emitted.length);
    expect(result.range.platforms).toHaveLength(4);
    // The generic surface renderer's flat mat colour is absent: the mats are
    // drawn once, by the range module, as slabs standing on their platforms.
    expect(emitted.some(t => t[3] === 0x315c34)).toBe(false);
  });
});

describe('Norrfallsviken refined range shelter', () => {
  it('substitutes the photographed shelter parts under the base facility contract', () => {
    const parts = installedArchitectureParts();
    const baseShelter = architecture.parts.filter(p => p.facilityId === 'lm-range-shelter');
    expect(baseShelter).toHaveLength(22);
    expect(refined.parts).toHaveLength(23);
    expect(parts).toHaveLength(architecture.parts.length - baseShelter.length + refined.parts.length);
    expect(parts.filter(p => p.facilityId === 'lm-range-shelter')).toEqual(refined.parts);
    expect(parts.filter(p => p.facilityId !== 'lm-range-shelter'))
      .toEqual(architecture.parts.filter(p => p.facilityId !== 'lm-range-shelter'));
    expect(refined.originEpsg3006RH2000).toEqual(architecture.originEpsg3006RH2000);
    const layout = compileFacilityGeometry({ terrainH: () => 45, v2Active: true, verticalDatumOffsetMetres: DATUM });
    expect(layout.parts).toBe(parts.length);
    expect(layout.refinedRangeShelterParts).toBe(23);
    expect(layout.placements.find(p => p.id === 'lm-range-shelter').roofHeightWorld)
      .toEqual(refined.facilities[0].roofHeightRH2000.map(h => h + DATUM));
  });
});
