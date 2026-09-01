import { describe, expect, it, vi } from 'vitest';
import { V2TerrainLiveAdapter } from './v2-terrain-live-adapter.mjs';

const CORE = Object.freeze({ dx: 4, x0: -12, x1: 12, z0: -12, z1: 12 });
const BOUNDS = Object.freeze({ x0: -8, x1: 8, z0: -8, z1: 8 });

/* The surface raster is a SUBSET of the terrain frontier and is addressed the
   way the real atlas addresses it: floor((x - x0) / res) into a w x h grid, so
   the upper bound is EXCLUSIVE and the last sample sits one step inside it.
   The fixture reproduced neither for a long time -- inclusive corners and no
   res at all -- which let it agree with a preflight that asked for a corner no
   real atlas has ever contained. Same trap as the checker that hardcoded the
   left/right normal: a fixture that restates the rule cannot test it, so this
   one restates the INDEXING and lets the rule be read off it. */
const SURFACE_BOUNDS = Object.freeze({
  x0: BOUNDS.x0, z0: BOUNDS.z0, x1: BOUNDS.x0 + 4, z1: BOUNDS.z0 + 2, w: 4, h: 2, res: 1,
});
const surfaceIndexAt = (x, z) => {
  const column = Math.floor((x - SURFACE_BOUNDS.x0) / SURFACE_BOUNDS.res);
  const row = Math.floor((z - SURFACE_BOUNDS.z0) / SURFACE_BOUNDS.res);
  return column < 0 || row < 0 || column >= SURFACE_BOUNDS.w || row >= SURFACE_BOUNDS.h
    ? -1 : row * SURFACE_BOUNDS.w + column;
};
const CUTOUT = Object.freeze({
  guardCells: 1,
  guardMetres: 4,
  expectedCoreGrid: Object.freeze({
    ...CORE,
    nx: 7,
    nz: 7,
  }),
  expectedSkippedBasePoints: 1,
  expectedTotalBasePoints: 49,
});

function fixture({ ready = true, surfaceTileIds = ['l0/0/0', 'l0/1/0'] } = {}) {
  const resources = ['l0/0/0', 'l0/1/0'].map((tileId, index) => Object.freeze({
    tileId,
    noDataCount: 0,
    sampleSpacingMetres: 1,
    index,
  }));
  const disposeSurface = vi.fn();
  const source = {
    requested: true,
    ready,
    status: ready ? 'ready' : 'fallback',
    bounds: BOUNDS,
    /* The fixture's frame bridge is the identity, so its inscribed legacy
       rectangle is its grid rectangle; a real course's is smaller. */
    legacyBounds: BOUNDS,
    descriptor: { tiles: resources.map(resource => ({ id: resource.tileId })) },
    surfaceDescriptor: { tiles: resources.map(resource => ({ id: resource.tileId })) },
    surfaceAtlas: {
      data: {
        tileIds: surfaceTileIds,
        bounds: SURFACE_BOUNDS,
        classCounts: Uint32Array.from([2, 3, 3]),
        noDataCount: 0,
      },
      bounds: SURFACE_BOUNDS,
      contains: (x, z) => surfaceIndexAt(x, z) >= 0,
      dispose: disposeSurface,
    },
    renderResources: vi.fn(() => resources),
    heightAt: vi.fn((x, z) => x >= BOUNDS.x0 && x <= BOUNDS.x1 && z >= BOUNDS.z0 && z <= BOUNDS.z1
      ? { height: 21.5, tileId: 'l0/0/0', sampleSpacingMetres: 1 }
      : Number.NaN),
  };
  const batch = {
    group: { name: 'test-v2-group' },
    sync: vi.fn(items => ({ renderedTiles: items.length, morphing: false })),
    stats: vi.fn(() => ({
      batches: [{}], renderedTiles: 2, residentLayers: 2, drawCalls: 1, triangles: 8,
    })),
    tick: vi.fn(() => ({ morphing: false })),
    dispose: vi.fn(),
  };
  const batchFactory = vi.fn(async () => batch);
  const adapter = new V2TerrainLiveAdapter({
    source,
    courseSlug: 'fixture',
    expectedCourseSlug: 'fixture',
    expectedTileCount: 2,
    expectedSurfaceTileCount: 2,
    cutoutContract: CUTOUT,
    batchFactory,
  });
  return { adapter, source, batch, batchFactory, disposeSurface };
}

describe('v2 terrain live adapter', () => {
  it('keeps construction and visible heights behind separate fail-closed gates', async () => {
    const { adapter, source, batch, batchFactory } = fixture();
    const preflight = vi.fn(async () => {});

    expect(adapter.snapshot()).toMatchObject({
      kind: 'fixed-frontier', phase: 'pending', preflightReady: false, active: false,
    });
    expect(adapter.constructionHeightAt(0, 0)).toBeNaN();
    expect(adapter.heightAt(0, 0)).toBeNaN();
    expect(source.heightAt).not.toHaveBeenCalled();

    const result = await adapter.prepare({
      coreGrid: CORE,
      renderStride: 1,
      decorateMaterial: () => {},
      preflight,
    });
    expect(result.ok).toBe(true);
    expect(result.prepared.plan).toMatchObject({
      guardMetres: 4,
      skippedBasePoints: 1,
      totalBasePoints: 49,
    });
    expect(batchFactory).toHaveBeenCalledWith(expect.objectContaining({
      maximumTiles: 2,
      morphDurationMilliseconds: 0,
    }));
    expect(preflight).toHaveBeenCalledWith(batch);
    expect(adapter.constructionHeightAt(0, 0)).toBe(21.5);
    expect(adapter.heightAt(0, 0)).toBeNaN();

    const renderer = adapter.activate({
      legacyBuild: {
        nx: 7, nz: 7, skippedBasePoints: 1, emittedBasePoints: 48, totalBasePoints: 49,
      },
      cut: { removedTriangles: 4 },
    });
    expect(adapter.active).toBe(true);
    expect(adapter.group).toBe(batch.group);
    expect(adapter.heightAt(0, 0)).toMatchObject({
      height: 21.5,
      tileId: 'l0/0/0',
    });
    expect(renderer).toMatchObject({
      status: 'ready', renderedTiles: 2, drawCalls: 1,
      skippedBasePoints: 1, emittedBasePoints: 48, removedTriangles: 4,
      fallbackRebuilt: false,
    });
    adapter.tick(100);
    expect(batch.tick).toHaveBeenCalledWith(100);
  });

  it('does not create a batch when the explicit source already fell back', async () => {
    const { adapter, batchFactory, source } = fixture({ ready: false });
    const result = await adapter.prepare({ preflight: vi.fn() });
    expect(result).toEqual({ ok: false, status: 'fallback', error: null });
    expect(batchFactory).not.toHaveBeenCalled();
    expect(source.renderResources).not.toHaveBeenCalled();
    expect(adapter.snapshot()).toMatchObject({ phase: 'fallback', active: false });
  });

  it('disposes a mismatched or backend-failed frontier and never exposes its heights', async () => {
    const { adapter, batch, disposeSurface } = fixture();
    const result = await adapter.prepare({
      coreGrid: CORE,
      preflight: async () => { throw new Error('shader rejected'); },
    });
    expect(result).toMatchObject({ ok: false, status: 'failed', error: 'shader rejected' });
    expect(batch.dispose).toHaveBeenCalledTimes(1);
    expect(disposeSurface).toHaveBeenCalledTimes(1);
    expect(adapter.constructionHeightAt(0, 0)).toBeNaN();
    expect(adapter.heightAt(0, 0)).toBeNaN();
    expect(adapter.rendererState).toEqual({
      status: 'failed', fallbackRebuilt: false, error: 'shader rejected',
    });
    expect(adapter.confirmFallbackRebuilt()).toMatchObject({ fallbackRebuilt: true });
  });

  it('rejects a surface atlas that cannot address its own last sample', async () => {
    /* The corner check was relaxed once, from the terrain frontier to the
       atlas's own extent, because the surface became a subset. This is what
       stops that relaxation becoming no check at all: a raster truncated by a
       row still reports its full bounds, and only asking it to resolve the
       sample those bounds promise catches it. */
    const { adapter, source, batchFactory, disposeSurface } = fixture();
    const whole = source.surfaceAtlas.contains;
    source.surfaceAtlas.contains = (x, z) => whole(x, z) && z < SURFACE_BOUNDS.z1 - SURFACE_BOUNDS.res;
    const result = await adapter.prepare({ coreGrid: CORE, preflight: vi.fn() });
    expect(result).toMatchObject({ ok: false, status: 'failed' });
    expect(result.error).toMatch(/fixed-frontier preflight requires/);
    expect(batchFactory).not.toHaveBeenCalled();
    expect(disposeSurface).toHaveBeenCalledTimes(1);
    expect(adapter.active).toBe(false);
    expect(adapter.heightAt(0, 0)).toBeNaN();
  });

  it('rejects incomplete terrain/surface agreement before creating GPU resources', async () => {
    const { adapter, batchFactory, disposeSurface } = fixture({
      surfaceTileIds: ['l0/0/0', 'l0/missing'],
    });
    const result = await adapter.prepare({ coreGrid: CORE, preflight: vi.fn() });
    expect(result.error).toMatch(/2 terrain tiles and 2 surface tiles drawn from them/);
    expect(batchFactory).not.toHaveBeenCalled();
    expect(disposeSurface).toHaveBeenCalledTimes(1);
  });

  it('disposes a malformed batch returned by an injected renderer factory', async () => {
    const { adapter, disposeSurface } = fixture();
    const disposeBatch = vi.fn();
    adapter.batchFactory = vi.fn(async () => ({ group: {}, dispose: disposeBatch }));
    const result = await adapter.prepare({ coreGrid: CORE, preflight: vi.fn() });
    expect(result.error).toMatch(/must implement group\/sync\/stats\/tick\/dispose/);
    expect(disposeBatch).toHaveBeenCalledTimes(1);
    expect(disposeSurface).toHaveBeenCalledTimes(1);
  });

  it('does not activate until the actual legacy builder and cut telemetry agree', async () => {
    const { adapter, batch } = fixture();
    await adapter.prepare({ coreGrid: CORE, preflight: vi.fn() });
    expect(() => adapter.activate({
      legacyBuild: {
        nx: 7, nz: 7, skippedBasePoints: 0, emittedBasePoints: 49, totalBasePoints: 49,
      },
      cut: { removedTriangles: 4 },
    })).toThrow(/reviewed omission plan exactly/);
    expect(adapter.active).toBe(false);
    adapter.fail(new Error('install rejected'));
    expect(batch.dispose).toHaveBeenCalledTimes(1);
  });

  it('refuses to cut against a source that never bridged its bounds', async () => {
    const { adapter, source, disposeSurface } = fixture();
    delete source.legacyBounds;
    const result = await adapter.prepare({ coreGrid: CORE, preflight: vi.fn(async () => {}) });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no bridged legacy bounds/);
    expect(adapter.active).toBe(false);
    expect(adapter.constructionHeightAt(0, 0)).toBeNaN();
    expect(disposeSurface).toHaveBeenCalledTimes(1);
  });
});
