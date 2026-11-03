import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DataTexture } from 'three/webgpu';
import { FLOWER_RIM, MEADOW_FLOWERS, createMeadowFlowers, meadowFlowerTemplate, meadowFlowersFor } from './meadow-flowers.mjs';

const atlas = { bounds: { x0: -100, x1: 100, z0: -100, z1: 100 }, texSdf: [new DataTexture(new Uint8Array(4), 1, 1)], channels: [2] };
const clip = { texture: new DataTexture(new Float32Array(16), 2, 2), texels: 2, metres: 1 };

describe('meadow flowers in the rough', () => {
  it('builds a stem and a head of six notched petals round its heart', () => {
    const g = meadowFlowerTemplate();
    expect(FLOWER_RIM % 2).toBe(0);
    expect(g.getAttribute('position').count).toBe(4 + FLOWER_RIM);
    expect(g.index.count).toBe(3 + FLOWER_RIM * 3);
    /* every head triangle has the heart at its first corner */
    for (let t = 1; t <= FLOWER_RIM; t++) expect(g.index.getX(t * 3)).toBe(3);
  });
  it('spreads the drifts over species whose shares add up, in each light', () => {
    const total = MEADOW_FLOWERS.species.reduce((sum, s) => sum + s.share, 0);
    expect(total).toBeCloseTo(1, 9);
    expect(meadowFlowersFor('golden')).toBe(1);
    expect(meadowFlowersFor('host')).toBeLessThan(0.5);
    expect(MEADOW_FLOWERS.fade[1]).toBeLessThanOrEqual(30);
  });
  it('is one instanced draw round the eye, shown with the grass, receiving shadows and casting none', () => {
    const flowers = createMeadowFlowers({ atlas, clip, quality: 'lo' });
    expect(flowers.mesh.geometry.instanceCount).toBe(MEADOW_FLOWERS.cells.lo ** 2);
    expect(flowers.mesh.castShadow).toBe(false);
    const camera = { position: { x: 3.2, y: 1.7, z: -8.1 }, fov: 48 };
    flowers.update(camera, false);
    expect(flowers.mesh.visible).toBe(false);
    flowers.update(camera, true);
    expect(flowers.mesh.visible).toBe(true);
    flowers.setPreset('host');
    expect(flowers.stats().amount).toBeLessThan(0.5);
    flowers.dispose();
  });
  it('needs the class fields and the grass\'s ground grid', () => {
    expect(() => createMeadowFlowers({ atlas: null, clip })).toThrow(TypeError);
    expect(() => createMeadowFlowers({ atlas, clip: null })).toThrow(TypeError);
  });
  it('is made with the grass round the ball behind ?flowers=0, updated after it each frame', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/get\('flowers'\) !== '0'/);
    const frame = main.indexOf('  nearGrass?.update(camera, renderer.domElement.height);\n');
    expect(main.indexOf('meadowFlowers?.update(camera, nearGrass?.mesh.visible', frame)).toBe(frame + '  nearGrass?.update(camera, renderer.domElement.height);\n'.length + 2);
  });
});
