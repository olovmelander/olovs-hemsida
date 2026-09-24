import { describe, expect, it } from 'vitest';
import { playerTerrainDetail, TERRAIN_MAXIMUM_SELECTED_TILES, TERRAIN_OUTSIDE_COURSE_TARGET_ERROR_PIXELS,
  TERRAIN_TARGET_ERROR_PIXELS } from './terrain-detail.mjs';
import { preparedTintAllowed } from './prepared-ground-tint.mjs';

describe('player terrain detail', () => {
  it('draws native tiles, one pixel on the course and three off it, with the desktop budget, whatever the quality', () => {
    const desktop = { renderStride: 1,
      profile: { targetErrorPixels: 1, outsideCourseTargetErrorPixels: 3, maximumSelectedTiles: 128 } };
    expect(playerTerrainDetail()).toEqual(desktop);
    expect([TERRAIN_TARGET_ERROR_PIXELS, TERRAIN_OUTSIDE_COURSE_TARGET_ERROR_PIXELS, TERRAIN_MAXIMUM_SELECTED_TILES])
      .toEqual([1, 3, 128]);
    // phone-style visits carry q=lo and the WebGL2 switch; neither reaches the terrain
    for (const search of ['?q=lo&qualitylock=1', '?q=lo&gl=1', '?q=hi', '?gl=1']) {
      expect(playerTerrainDetail(search)).toEqual(desktop);
    }
  });

  it('compares the off-course target with ?offcourse, where 1 is the course rule everywhere', () => {
    expect(playerTerrainDetail('?offcourse=1').profile.outsideCourseTargetErrorPixels).toBe(1);
    expect(playerTerrainDetail('?q=lo&offcourse=6').profile.outsideCourseTargetErrorPixels).toBe(6);
    for (const value of ['0', '0.5', '5', '9', '', 'off']) {
      expect(playerTerrainDetail(`?offcourse=${value}`).profile.outsideCourseTargetErrorPixels).toBe(3);
    }
    expect(playerTerrainDetail('?offcourse=8').profile.targetErrorPixels).toBe(1);
    // drawn terrain detail does not change what the prepared startup data was baked from
    expect(preparedTintAllowed('?bana=veckefjarden&q=lo&offcourse=1')).toBe(true);
  });

  it('keeps ?terrainStride=2 as the reduced-grid comparison and ignores other values', () => {
    expect(playerTerrainDetail('?terrainStride=2').renderStride).toBe(2);
    expect(playerTerrainDetail('?q=lo&gl=1&terrainStride=2').renderStride).toBe(2);
    for (const value of ['1', '3', '0', '', 'half']) {
      expect(playerTerrainDetail(`?terrainStride=${value}`).renderStride).toBe(1);
    }
    expect(playerTerrainDetail('?terrainStride=2').profile).toEqual(playerTerrainDetail().profile);
  });

  it('returns frozen settings', () => {
    const detail = playerTerrainDetail();
    expect(Object.isFrozen(detail)).toBe(true);
    expect(Object.isFrozen(detail.profile)).toBe(true);
  });
});
