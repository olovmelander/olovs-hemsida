import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { DRAPE_DEPTH, drapeDepthMetres, drapeOverDrawnTerrain } from './drape-depth.mjs';

/* a pixel's angle in a 48-degree view 1080 pixels high */
const pixelAngle = 2 * Math.tan(48 / 2 * Math.PI / 180) / 1080;

describe('what lies on the ground stays on it at a distance', () => {
  it('leaves near ground alone, where the drawn ground is within a pixel', () => {
    expect(drapeDepthMetres(30, 0.1, { pixelAngle })).toBe(0);
    expect(drapeDepthMetres(DRAPE_DEPTH.from[0], 0.5, { pixelAngle })).toBe(0);
  });
  it('moves a far ribbon by the terrain\'s error allowance, more seen low, never more than its share', () => {
    const fromAbove = drapeDepthMetres(1000, 0.8, { pixelAngle });
    const low = drapeDepthMetres(1000, 0.05, { pixelAngle });
    /* six pixels at 1 km is about 5 m of height; from above that is about 6 m of the ray */
    expect(fromAbove).toBeGreaterThan(5);
    expect(fromAbove).toBeLessThan(8);
    expect(low).toBeGreaterThan(fromAbove);
    expect(low).toBeLessThanOrEqual(1000 * DRAPE_DEPTH.share + 1e-9);
  });
  it('moves the depth only: the material takes a clip position and keeps its own vertex setup', () => {
    const m = drapeOverDrawnTerrain(new MeshStandardNodeMaterial());
    expect(m.vertexNode).toBeTruthy();
    expect(m.positionNode).toBeNull();
    expect(m.userData.drapeDepth).toBe(true);
  });
  it('is on every surface draped on the terrain in main.js, ?drape=before the before', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toContain("const DRAPE_DEPTH_ON = new URLSearchParams(location.search).get('drape') !== 'before';");
    expect(main).toContain('return DRAPE_DEPTH_ON ? drapeOverDrawnTerrain(m) : m;');
  });
});
