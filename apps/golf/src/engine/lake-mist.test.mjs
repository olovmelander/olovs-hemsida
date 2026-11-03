import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BufferGeometry, DataTexture, Float32BufferAttribute } from 'three/webgpu';
import { LAKE_MIST, createLakeMist, lakeMistFor, mergeLakeSheets } from './lake-mist.mjs';

/* a square sheet of water at height `y`, `size` metres across, at (cx, cz), its shore distance per vertex */
const sheet = (cx, cz, size = 40, y = 2) => {
  const g = new BufferGeometry();
  const h = size / 2;
  g.setAttribute('position', new Float32BufferAttribute([cx - h, y, cz - h, cx + h, y, cz - h, cx + h, y, cz + h, cx - h, y, cz + h, cx, y, cz], 3));
  g.setAttribute('aShore', new Float32BufferAttribute([0, 0, 0, 0, h], 1));
  g.setIndex([0, 4, 1, 1, 4, 2, 2, 4, 3, 3, 4, 0]);
  return g;
};

describe('mist on the lakes', () => {
  it('merges the lakes near the course into one geometry, their shore distances and lifts kept', () => {
    const g = mergeLakeSheets([{ geometry: sheet(0, 0) }, { geometry: sheet(100, 0), y: 0.06 }, { geometry: sheet(9000, 0) }],
      { x0: -50, x1: 150, z0: -50, z1: 50 });
    expect(g.getAttribute('position').count).toBe(10);
    expect(g.index.count).toBe(24);
    expect(g.index.getX(12)).toBe(5);
    expect(g.getAttribute('position').getY(5)).toBeCloseTo(2.06, 6);
    expect(g.getAttribute('aShore').getX(9)).toBe(20);
    expect(mergeLakeSheets([{ geometry: sheet(9000, 0) }], { x0: -50, x1: 50, z0: -50, z1: 50 })).toBeNull();
  });
  it('lies in the dawn and the mist, never at noon, on the summer day or in the storm', () => {
    expect(lakeMistFor('dawn')).toBe(1);
    expect(lakeMistFor('mist')).toBeGreaterThan(0.5);
    for (const name of ['noon', 'summer', 'storm']) expect(lakeMistFor(name)).toBe(0);
  });
  it('draws three thin layers after the water, writing no depth, shown only in its lights, held still when asked', () => {
    const mist = createLakeMist({ geometry: mergeLakeSheets([{ geometry: sheet(0, 0) }]), detail: new DataTexture(new Uint8Array(4), 1, 1) });
    expect(mist.group.children).toHaveLength(LAKE_MIST.layers.length);
    for (const m of mist.group.children) {
      expect(m.renderOrder).toBe(7);
      expect(m.material.depthWrite).toBe(false);
      expect(m.material.transparent).toBe(true);
      expect(m.castShadow).toBe(false);
    }
    expect(mist.group.children.map(m => m.position.y)).toEqual(LAKE_MIST.layers.map(([h]) => h));
    mist.setPreset('noon');
    expect(mist.group.visible).toBe(false);
    mist.setPreset('dawn', { haze: 0xa0b0c0, sun: 0xffaa66, sunDirection: [0.5, 0.2, 0.3] });
    expect(mist.group.visible).toBe(true);
    mist.update({ dt: 0.1, air: { x: 3, z: 0 }, still: true });
    mist.update({ dt: 0.1, air: { x: 3, z: 0 } });
    expect(mist.stats().amount).toBe(1);
    mist.dispose();
  });
  it('is made from the lakes\' own sheets behind ?lakemist=0 in main.js, and drifts each frame', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/get\('lakemist'\) !== '0'/);
    expect(main).toContain('mergeLakeSheets(sheets, playB)');
    expect(main).toContain('lakeMist?.update({ dt, air: AIR, still: cameraMotionPreference.matches });');
    expect(main.indexOf('let lakeMist = null;')).toBeLessThan(main.indexOf('function setPreset('));
  });
});
