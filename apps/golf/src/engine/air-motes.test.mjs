import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { AIR_MOTES, airMotesFor, createAirMotes, wrapToBox } from './air-motes.mjs';
import { ATMOSPHERE_PRESETS } from './atmosphere-presets.mjs';
import { preparedTintAllowed } from './prepared-ground-tint.mjs';

const camera = (y = 1.7) => { const c = new THREE.PerspectiveCamera(); c.position.set(10, y, -20); return c; };
const air = { x: 4, z: -3 };

describe('the air\'s motes', () => {
  it('give every light an air, none in the storm and the mist', () => {
    for (const name of Object.keys(ATMOSPHERE_PRESETS)) {
      const kinds = airMotesFor(name);
      expect(kinds, name).toHaveLength(2);
      for (const k of kinds) { expect(k).toBeGreaterThanOrEqual(0); expect(k).toBeLessThanOrEqual(1); }
    }
    expect(airMotesFor('storm')).toEqual([0, 0]);
    expect(airMotesFor('mist')).toEqual([0, 0]);
    expect(airMotesFor('no such light')).toEqual([0, 0]);
    expect(Object.keys(AIR_MOTES.presets).sort()).toEqual(Object.keys(ATMOSPHERE_PRESETS).sort());
  });

  it('wrap their drift to the box, so a long drift never pops', () => {
    expect(wrapToBox(70, 64)).toBeCloseTo(6, 12);
    expect(wrapToBox(-1, 64)).toBeCloseTo(63, 12);
    const motes = createAirMotes();
    motes.setPreset('golden');
    for (let i = 0; i < 1237; i++) motes.update({ dt: 0.1, air, camera: camera(), groundY: 0 });
    const { drift, time } = motes.snapshot();
    expect(time).toBeCloseTo(123.7, 6);
    for (let k = 0; k < 4; k++) {
      expect(drift[k]).toBeGreaterThanOrEqual(0);
      expect(drift[k]).toBeLessThan(k % 2 ? AIR_MOTES.box[2] : AIR_MOTES.box[0]);
    }
    // down drifts at 0.6 of the air, pollen with it: their wrapped drifts differ
    expect(drift[2]).not.toBeCloseTo(drift[0], 3);
  });

  it('hold still under reduced motion, and pin their clock under det=1', () => {
    const still = createAirMotes();
    still.setPreset('summer');
    still.update({ dt: 0.1, air, camera: camera(), groundY: 0, still: true });
    expect(still.snapshot()).toMatchObject({ time: 0, drift: [0, 0, 0, 0], visible: true });
    const det = createAirMotes({ deterministic: true });
    det.setPreset('summer');
    det.update({ dt: 0.1, air, camera: camera(), groundY: 0 });
    expect(det.snapshot()).toMatchObject({ time: 3.25, drift: [0, 0, 0, 0] });
  });

  it('show in a light that has them near the ground, and hide high up or in the storm', () => {
    const motes = createAirMotes({ quality: 'lo' });
    expect(motes.snapshot().count).toBe(AIR_MOTES.count.lo);
    motes.setPreset('golden', { sunDirection: [0.3, 0.1, -1], sunColour: 0xffd29a });
    motes.update({ dt: 0, air, camera: camera(1.7), groundY: 0 });
    expect(motes.mesh.visible).toBe(true);
    expect(motes.uniforms.uBase.value).toBe(0);
    motes.update({ dt: 0, air, camera: camera(80), groundY: 0 });
    expect(motes.mesh.visible).toBe(false);
    motes.update({ dt: 0, air, camera: camera(30), groundY: 0 });
    expect(motes.uniforms.uBase.value).toBe(30 - AIR_MOTES.box[1] / 2);
    motes.setPreset('storm');
    motes.update({ dt: 0, air, camera: camera(1.7), groundY: 0 });
    expect(motes.mesh.visible).toBe(false);
    // the sun's colour at its peak channel, its direction normalised
    motes.setPreset('golden', { sunDirection: [0, 2, 0], sunColour: 0x806040 });
    const c = motes.uniforms.uSunColour.value;
    expect(Math.max(c.r, c.g, c.b)).toBeCloseTo(1, 12);
    expect(motes.uniforms.uSun.value.length()).toBeCloseTo(1, 12);
  });

  it('are one additive overlay that writes no depth and takes no fog, and leave prepared startup eligible', () => {
    const { mesh } = createAirMotes();
    expect(mesh.material.blending).toBe(THREE.AdditiveBlending);
    expect(mesh.material.depthWrite).toBe(false);
    expect(mesh.material.fog).toBe(false);
    expect(mesh.frustumCulled).toBe(false);
    expect(mesh.geometry.instanceCount).toBe(AIR_MOTES.count.hi);
    expect(preparedTintAllowed('?bana=test&airmotes=0')).toBe(true);
  });
});
