import { describe, expect, it, vi } from 'vitest';
import { createGroundHeightSampler } from './ground-height-sampler.mjs';

describe('visible ground height sampler', () => {
  it('uses v2 only after the renderer is active and preserves runtime metadata', () => {
    let active = false;
    const preview = vi.fn(() => ({
      height: 42.75,
      tileId: 'l0/1/2',
      sampleSpacingMetres: 1,
    }));
    const sampler = createGroundHeightSampler({
      previewActive: () => active,
      previewHeightAt: preview,
      legacyMeshHeightAt: () => 41.5,
      fallbackHeightAt: () => 40,
    });

    expect(sampler.inspectAt(3, 4)).toEqual({
      height: 41.5,
      source: 'legacy-rendered-mesh',
    });
    expect(preview).not.toHaveBeenCalled();

    active = true;
    expect(sampler.heightAt(3, 4)).toBe(42.75);
    expect(sampler.inspectAt(3, 4)).toEqual({
      height: 42.75,
      source: 'v2-preview',
      tileId: 'l0/1/2',
      sampleSpacingMetres: 1,
    });
  });

  it('falls through preview gaps to the visible legacy mesh, then analytic terrain', () => {
    const sampler = createGroundHeightSampler({
      previewActive: () => true,
      previewHeightAt: x => x < 10 ? 18 : Number.NaN,
      legacyMeshHeightAt: x => x < 20 ? 17 : null,
      fallbackHeightAt: () => 16,
    });

    expect(sampler.inspectAt(5, 0)).toMatchObject({ height: 18, source: 'v2-preview' });
    expect(sampler.inspectAt(15, 0)).toEqual({ height: 17, source: 'legacy-rendered-mesh' });
    expect(sampler.inspectAt(25, 0)).toEqual({ height: 16, source: 'legacy-analytic-fallback' });
  });

  it('fails closed on invalid coordinates or a missing final height', () => {
    const sampler = createGroundHeightSampler({
      legacyMeshHeightAt: () => null,
      fallbackHeightAt: () => Number.NaN,
    });
    expect(() => sampler.heightAt(Number.NaN, 0)).toThrow(/worldX must be finite/);
    expect(() => sampler.heightAt(0, 0)).toThrow(/no finite fallback/);
  });
});
