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
    stats: {}, VISTA_PTS: null,
  };
  await runInNewContext(`(async () => { ${vistaPass} })()`, context);
  return { sourceReads, points: context.VISTA_PTS, stats: context.stats };
}

describe('far vegetation source policy', () => {
  it('does not enter procedural vista generation on a measured-only ground', async () => {
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
