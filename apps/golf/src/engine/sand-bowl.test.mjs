/* The bunker's hollow: a bowl lit by the sun and the lip's crescent of shade,
   from the sand's own field; ?sandbowl=0 is the before. */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SAND_BOWL } from './ground-material-core.mjs';

describe('the bunker\'s hollow', () => {
  it('keeps its shade within bounds and its slope gentle', () => {
    expect(SAND_BOWL.range[0]).toBeGreaterThan(0.5);
    expect(SAND_BOWL.range[1]).toBeLessThan(1.3);
    /* the steepest slope of the bowl, 1.5 x depth / reach, stays under 25 degrees */
    expect(Math.atan(1.5 * SAND_BOWL.depth / SAND_BOWL.reach) * 180 / Math.PI).toBeLessThan(25);
    expect(SAND_BOWL.lipShade).toBeLessThan(0.5);
    expect(SAND_BOWL.farLip).toBeLessThan(1);
    expect(SAND_BOWL.sunLip).toBeGreaterThan(1);
    /* the field reaches 4 m: the taps and the lip's shadow stay inside it */
    expect(SAND_BOWL.step).toBeLessThan(1);
    expect(SAND_BOWL.lipShadowMax).toBeLessThanOrEqual(4);
  });
  it('reads the field from two taps, not screen steps, and is wired behind ?sandbowl=0', () => {
    const core = fs.readFileSync(new URL('./ground-material-core.mjs', import.meta.url), 'utf8');
    const block = core.slice(core.indexOf('if (sandBowl && uSun)'), core.indexOf('lipFacing = facing'));
    expect(block).toMatch(/sdfAt\(du\)/);
    expect(block).not.toMatch(/dFdx|dFdy/);
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/const SAND_BOWL_ON = new URLSearchParams\(location\.search\)\.get\('sandbowl'\) !== '0'/);
    expect(main).toMatch(/sandBowl: SAND_BOWL_ON/);
  });
});
