import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const start = main.indexOf('/* Beyond the planted middle ring');
const end = main.indexOf("lap('far vista cones'", start);
if (start < 0 || end < start) throw new Error('Cannot find the renderer far-vegetation pass');
const vistaPass = main.slice(start, end);

async function runVista(vegetationPlacement) {
  let sourceReads = 0;
  const context = {
    M: { infra: { vegetationPlacement }, get cover() { sourceReads++; return null; } },
    LOWQ: false, FARR: { x0: 0, x1: 0, z0: 0, z1: 0 },
    /* The far ring now stands on a land-cover record where a measured-only
       ground has one, so the pass reads LANDCOVER_REC before deciding whether
       to enter at all. Null is the case this test is about: a measured-only
       ground with nothing measured out there still plants nothing. */
    LANDCOVER_REC: null,
    /* the far ring calibrates itself on the measured stands where the lattice
       planted nothing (engine/far-ring-calibration.mjs); with no v2 plan the
       calibration is null and the pass is the generator it always was */
    treeWhy: [[], [], []], WHY_V2_INDIVIDUAL: 5, V2_VEG_PLAN: null, V2_VEG_COVER: null, V2_VEGETATION: null,
    calibrateFarRing: () => null, farRingSpacing: () => 30, farRingTree: () => null, treeFraction: () => -1,
    stats: {}, VISTA_PTS: null,
  };
  await runInNewContext(`(async () => { ${vistaPass} })()`, context);
  return { sourceReads, points: context.VISTA_PTS, stats: context.stats };
}

describe('far vegetation source policy', () => {
  it('does not enter procedural vista generation on a measured-only ground with no land-cover record', async () => {
    const result = await runVista('measured-only');
    expect(result.sourceReads).toBe(0);
    expect(result.points).toBeNull();
    expect(result.stats).toEqual({});
  });

  it('retains the existing generator for grounds without a measured-only policy', async () => {
    const result = await runVista(undefined);
    expect(result.sourceReads).toBe(1);
    expect(result.points).toEqual([]);
  });
});
