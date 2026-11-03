import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GRASS_MAT_ASSET, GRASS_SHELLS, grassShellTemplate } from './grass-shells.mjs';

describe('the grass mat in shells', () => {
  it('is the published Blender bake: bytes, sha256 and its record, colour in RGB and height in A', () => {
    const bytes = fs.readFileSync(new URL(`../../public/${GRASS_MAT_ASSET.url}`, import.meta.url));
    expect(bytes.length).toBe(GRASS_MAT_ASSET.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(GRASS_MAT_ASSET.sha256);
    const record = JSON.parse(fs.readFileSync(new URL('../../public/models/props/grass-mat.json', import.meta.url)));
    expect(record.asset).toEqual({ url: GRASS_MAT_ASSET.url, sha256: GRASS_MAT_ASSET.sha256, bytes: GRASS_MAT_ASSET.bytes });
    expect(record.meanLinear).toEqual([...GRASS_MAT_ASSET.meanLinear]);
    /* a mat: most of the ground covered at its base, a good share standing over half its height */
    expect(record.cover['0.05']).toBeGreaterThan(0.8);
    expect(record.cover['0.5']).toBeGreaterThan(0.4);
    expect(fs.existsSync(new URL('../../../../tools/blender-props/grass_mat.py', import.meta.url))).toBe(true);
  });
  it('is one grid of world cells drawn once a shell, short and fading out inside the grass\'s ground grid', () => {
    const g = grassShellTemplate(4);
    expect(g.getAttribute('position').count).toBe(25);
    expect(g.index.count).toBe(4 * 4 * 6);
    expect(GRASS_SHELLS.layers).toBeGreaterThanOrEqual(12);
    expect(GRASS_SHELLS.fade[1]).toBeLessThanOrEqual(GRASS_SHELLS.cell * GRASS_SHELLS.cells / 2);
    expect(GRASS_SHELLS.rough).toBeLessThan(0.12);
  });
  it('is made at high quality with the tour turf, behind ?grassmat=0, updated each frame', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toContain("if (TOUR_TURF_ON && !LOWQ && new URLSearchParams(location.search).get('grassmat') !== '0') {");
    expect(main).toContain('grassShells?.update(camera, nearGrass?.mesh.visible);');
  });
});
