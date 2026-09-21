import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3, WebGLCoordinateSystem } from 'three/webgpu';
import { readPack, inflateStream } from '../../../../packages/course-pack/lib.mjs';
import { coastalCameraNear } from './coastal-camera-depth.mjs';

const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
// Execute the actual application eligibility gate. Testing the near-plane
// formula alone missed the sea-only gate that excluded Tortuna's ponds.
const gate = main.match(/const COASTAL_DEPTH_ENABLED = ([^\n]+);/)[1];
const pack = readPack(readFileSync(new URL('../../public/courses/tortuna/pack.bin', import.meta.url)));
const model = JSON.parse(inflateStream(pack.sv));
const enabled = (M = model, IS_GPU = false) => runInNewContext(gate, { M, IS_GPU, CONTINUOUS_OCEAN_ENABLED: false });
const quantize = depth => Math.round(depth * (2 ** 24 - 1));
function depthAt(near, distance) {
  const top = near * Math.tan(48 * Math.PI / 360);
  const projection = new Matrix4().makePerspective(-top, top, top, -top, near, 14000, WebGLCoordinateSystem);
  return quantize(new Vector3(0, 0, -distance).applyMatrix4(projection).z * .5 + .5);
}

describe('Tortuna measured pond depth', () => {
  it('enables the production precision policy for the published inland-water pack', () => {
    expect(model.infra.terrainPlacement).toBe('measured-only');
    expect(model.water.some(w => w.isSea)).toBe(false);
    expect(enabled()).toBe(true);
    expect(enabled(model, true)).toBe(false); // WebGPU already uses reversed floating-point depth.
    expect(enabled({ ...model, water: [] })).toBe(false);
    expect(enabled({ ...model, infra: { ...model.infra, terrainPlacement: 'carved' } })).toBe(false);
  });

  it('separates pond, submerged terrain and foreground bank while zooming and moving', () => {
    let oldTies = 0;
    for (const distance of [250, 750, 1500, 3000]) for (const pitch of [15, 30, 60]) {
      const sine = Math.sin(pitch * Math.PI / 180);
      for (const movement of [-.02, 0, .02]) {
        const d = distance + movement;
        const near = coastalCameraNear({ enabled: enabled(), cameraHeight: 18.81 + d * sine,
          terrainCeiling: 69.52, focusDistance: d });
        // Four centimetres is below the app's nominal 6 cm display clearance.
        const bed = d + .04 / sine, bank = d - .04 / sine;
        expect(depthAt(near, d), `${distance}m / ${pitch}° / ${movement}m`).toBeLessThan(depthAt(near, bed));
        expect(depthAt(near, d)).toBeGreaterThan(depthAt(near, bank));
        if (depthAt(1, d) === depthAt(1, bed)) oldTies++;
      }
    }
    expect(oldTies).toBeGreaterThan(0); // Negative control reproduces fixed-depth fighting.
  });
});
