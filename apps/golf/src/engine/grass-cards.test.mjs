import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GRASS_CARDS, GRASS_CARDS_ASSET, grassCardTemplate } from './grass-cards.mjs';

describe('grass cards in the rough', () => {
  it('is the published Blender render: bytes, sha256 and its record', () => {
    const bytes = fs.readFileSync(new URL(`../../public/${GRASS_CARDS_ASSET.url}`, import.meta.url));
    expect(bytes.length).toBe(GRASS_CARDS_ASSET.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(GRASS_CARDS_ASSET.sha256);
    const record = JSON.parse(fs.readFileSync(new URL('../../public/models/props/grass-cards.json', import.meta.url)));
    expect(record.asset).toEqual({ url: GRASS_CARDS_ASSET.url, sha256: GRASS_CARDS_ASSET.sha256, bytes: GRASS_CARDS_ASSET.bytes });
    expect(record.meanLinear).toEqual([...GRASS_CARDS_ASSET.meanLinear]);
    expect(record.layout.tiles).toBe(GRASS_CARDS_ASSET.tiles);
    expect(fs.existsSync(new URL('../../../../tools/blender-props/grass_cards.py', import.meta.url))).toBe(true);
  });
  it('is two quads crossed, with the tiles\' shares adding up', () => {
    const g = grassCardTemplate();
    expect(g.getAttribute('position').count).toBe(8);
    expect(g.index.count).toBe(12);
    expect(GRASS_CARDS.tileShare.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(GRASS_CARDS.tileShare).toHaveLength(GRASS_CARDS_ASSET.tiles);
  });
  it('stays inside the grass round the ball\'s ground grid, and shorter by the cut', () => {
    for (const q of Object.values(GRASS_CARDS.quality)) expect(q.fade[1]).toBeLessThanOrEqual(q.cell * q.cells / 2);
    expect(GRASS_CARDS.short).toBeLessThan(1);
    expect(GRASS_CARDS.edge[0]).toBeGreaterThan(0);
  });
  it('is made with the tour turf behind ?grasscards=0 in main.js, updated each frame', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toContain("if (TOUR_TURF_ON && new URLSearchParams(location.search).get('grasscards') === '1') {");
    expect(main).toContain('grassCards?.update(camera, nearGrass?.mesh.visible);');
  });
});
