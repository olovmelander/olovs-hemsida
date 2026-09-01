import { describe, expect, it } from 'vitest';
import {
  assertV2LegacyCutoutContract,
  planV2LegacyCutout,
} from './v2-legacy-cutout.mjs';
import { inscribedLegacyBounds, legacyGridBridge } from './geodetic-frame.mjs';
import { PUTTOM_PREVIEW_CONFIG } from './v2-puttom-preview.mjs';

/* Runtime CORE after main.js has smoothed mown edges. The raw pack would snap
   z0 to -792; the reviewed contract below intentionally rejects that stale
   pre-normalisation footprint. */
const PUTTOM_CORE = Object.freeze({
  dx: 4,
  x0: -648,
  x1: 648,
  z0: -756,
  z1: 756,
});

/* Bounds of the retained 16-tile EPSG:5845 preview after its reviewed bridge
   into the immutable Puttom GPK1 local frame. */
const PUTTOM_PREVIEW_BOUNDS = Object.freeze({
  x0: -581.5217079999857,
  x1: 442.47829200001433,
  z0: -596.7605410004035,
  z1: 427.23945899959654,
});

/* What the adapter actually plans against: the largest axis-aligned legacy
   rectangle still inside that grid rectangle once the frame bridge has rotated
   it 3.52 degrees. Derived here from the shipped bridge rather than copied, so
   a change to either one shows up as a changed count instead of agreeing with
   itself. */
const PUTTOM_LEGACY_BOUNDS = inscribedLegacyBounds(
  legacyGridBridge(PUTTOM_PREVIEW_CONFIG.legacyFrame),
  PUTTOM_PREVIEW_BOUNDS,
);

describe('v2 legacy CORE cutout planner', () => {
  it('does not validate or cut anything unless explicitly enabled', () => {
    expect(planV2LegacyCutout()).toBeNull();
    expect(planV2LegacyCutout({
      enabled: false,
      preflightStatus: false,
      grid: null,
      previewBounds: null,
    })).toBeNull();
  });

  it('proves the guarded Puttom CORE reduction with the strict terrain test', () => {
    const plan = planV2LegacyCutout({
      enabled: true,
      preflightStatus: 'ready',
      grid: PUTTOM_CORE,
      previewBounds: PUTTOM_LEGACY_BOUNDS,
    });

    expect(plan).toEqual({
      innerBounds: {
        x0: -537.8292806781035,
        x1: 409.8156542660675,
        z0: -563.3064401972929,
        z1: 385.8107585801303,
      },
      guardCells: 2,
      guardMetres: 8,
      nx: 325,
      nz: 379,
      totalBasePoints: 123_175,
      skippedBasePoints: 56_169,
    });
    expect(plan.skippedBasePoints / plan.totalBasePoints * 100).toBeCloseTo(45.60, 2);
    expect(PUTTOM_PREVIEW_CONFIG.legacyCoreCutout).toEqual({
      guardCells: 2,
      guardMetres: 8,
      expectedCoreGrid: {
        dx: 4,
        x0: -648,
        x1: 648,
        z0: -756,
        z1: 756,
        nx: 325,
        nz: 379,
      },
      expectedSkippedBasePoints: 56_169,
      expectedTotalBasePoints: 123_175,
    });
    expect(assertV2LegacyCutoutContract({
      grid: PUTTOM_CORE,
      plan,
      contract: PUTTOM_PREVIEW_CONFIG.legacyCoreCutout,
    })).toBe(plan);

    let strictCount = 0;
    for (let j = 0; j < plan.nz; j++) for (let i = 0; i < plan.nx; i++) {
      const x = PUTTOM_CORE.x0 + i * PUTTOM_CORE.dx;
      const z = PUTTOM_CORE.z0 + j * PUTTOM_CORE.dx;
      if (x > plan.innerBounds.x0 + 1e-6 && x < plan.innerBounds.x1 - 1e-6 &&
          z > plan.innerBounds.z0 + 1e-6 && z < plan.innerBounds.z1 - 1e-6) strictCount++;
    }
    expect(strictCount).toBe(plan.skippedBasePoints);
  });

  it('rejects stale or shape-colliding CORE footprints despite matching counts', () => {
    const contract = PUTTOM_PREVIEW_CONFIG.legacyCoreCutout;
    const staleCore = { ...PUTTOM_CORE, z0: -792 };
    const stalePlan = planV2LegacyCutout({
      enabled: true,
      preflightStatus: 'ready',
      grid: staleCore,
      previewBounds: PUTTOM_LEGACY_BOUNDS,
    });
    expect(stalePlan.skippedBasePoints).toBe(contract.expectedSkippedBasePoints);
    expect(() => assertV2LegacyCutoutContract({
      grid: staleCore, plan: stalePlan, contract,
    })).toThrow(/expected 325x379.*got 325x388/);

    const collidingCore = {
      dx: 4, x0: -756, x1: 756, z0: -648, z1: 648,
    };
    const collidingPlan = planV2LegacyCutout({
      enabled: true,
      preflightStatus: 'ready',
      grid: collidingCore,
      previewBounds: PUTTOM_LEGACY_BOUNDS,
    });
    expect(collidingPlan.totalBasePoints).toBe(contract.expectedTotalBasePoints);
    expect(collidingPlan.skippedBasePoints).toBe(contract.expectedSkippedBasePoints);
    expect(() => assertV2LegacyCutoutContract({
      grid: collidingCore, plan: collidingPlan, contract,
    })).toThrow(/expected 325x379.*got 379x325/);
  });

  it('fails closed on invalid grids and preview bounds outside CORE', () => {
    const enabled = {
      enabled: true,
      preflightStatus: 'ready',
      grid: PUTTOM_CORE,
      previewBounds: PUTTOM_LEGACY_BOUNDS,
    };
    expect(() => planV2LegacyCutout({ ...enabled, grid: { ...PUTTOM_CORE, dx: 0 } }))
      .toThrow(/grid\.dx must be positive/);
    expect(() => planV2LegacyCutout({ ...enabled, grid: { ...PUTTOM_CORE, x1: 647 } }))
      .toThrow(/exact multiple/);
    expect(() => planV2LegacyCutout({
      ...enabled,
      previewBounds: { ...PUTTOM_PREVIEW_BOUNDS, x0: PUTTOM_CORE.x0 - 1 },
    })).toThrow(/inside the legacy grid/);
    expect(() => planV2LegacyCutout({
      ...enabled,
      previewBounds: { x0: 1, x1: 1, z0: -2, z1: 2 },
    })).toThrow(/positive x and z extents/);
  });

  it('rejects degenerate guards, empty interiors and a failed preflight', () => {
    const enabled = {
      enabled: true,
      preflightStatus: 'ready',
      grid: PUTTOM_CORE,
      previewBounds: PUTTOM_LEGACY_BOUNDS,
    };
    expect(() => planV2LegacyCutout({ ...enabled, preflightStatus: false }))
      .toThrow(/ready verified preview preflight/);
    expect(() => planV2LegacyCutout({
      ...enabled,
      previewBounds: { x0: 0, x1: 12, z0: 0, z1: 12 },
    })).toThrow(/too small/);
    expect(() => planV2LegacyCutout({
      ...enabled,
      guardCells: 0,
      previewBounds: { x0: 0.1, x1: 3.9, z0: 0.1, z1: 3.9 },
    })).toThrow(/contain no legacy grid points/);
  });
});
