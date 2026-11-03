import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import * as THREE from 'three/webgpu';
import { texture } from 'three/tsl';
import { GOD_RAYS, createGodRays, godRayLobe, godRaysFor } from './god-rays.mjs';
import { ATMOSPHERE_PRESETS } from './atmosphere-presets.mjs';
import { preparedTintAllowed } from './prepared-ground-tint.mjs';

const sunWithMap = () => {
  const sun = new THREE.DirectionalLight();
  sun.castShadow = true;
  sun.shadow.map = new THREE.RenderTarget(16, 16, { depthTexture: new THREE.DepthTexture(16, 16) });
  return sun;
};
const make = () => createGodRays({ depthNode: texture(new THREE.DepthTexture(4, 4)), camera: new THREE.PerspectiveCamera(), light: sunWithMap() });

describe('god rays through the trees', () => {
  it('give every light its shafts, none where the sun is hidden or down', () => {
    expect(Object.keys(GOD_RAYS.presets).sort()).toEqual(Object.keys(ATMOSPHERE_PRESETS).sort());
    for (const name of ['storm', 'mist', 'bluehour']) expect(godRaysFor(name)).toBe(0);
    for (const name of ['golden', 'dawn', 'midnight']) expect(godRaysFor(name)).toBeGreaterThan(godRaysFor('noon'));
    for (const v of Object.values(GOD_RAYS.presets)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect(godRaysFor('no such light')).toBe(0);
  });

  it('glow toward the sun and hardly away from it (forward scatter)', () => {
    expect(godRayLobe(1)).toBeCloseTo(1, 12);
    expect(godRayLobe(-1)).toBeCloseTo(GOD_RAYS.lobe.floor, 12);
    expect(godRayLobe(0)).toBeLessThan(0.1);
    let previous = 0;
    for (let c = -1; c <= 1.0001; c += 0.1) { const v = godRayLobe(c); expect(v).toBeGreaterThanOrEqual(previous - 1e-12); previous = v; }
  });

  it('refuse to build before the sun has a shadow map (main.js attaches them once it does)', () => {
    const sun = new THREE.DirectionalLight();
    expect(() => createGodRays({ depthNode: texture(new THREE.DepthTexture(4, 4)), camera: new THREE.PerspectiveCamera(), light: sun }))
      .toThrow('shadow map');
  });

  it('run neither the march nor the blur for a light without shafts', () => {
    const rays = make();
    rays.setPreset('golden', { sunDirection: [0, 1, -3], sunColour: 0xffc890 });
    expect(rays.snapshot()).toMatchObject({ strength: godRaysFor('golden'), active: true, steps: GOD_RAYS.steps });
    expect(rays.blur.active).toBe(true);
    let ran = 0;
    const frame = { renderer: null };
    const three = Object.getPrototypeOf(Object.getPrototypeOf(rays.march)), original = three.updateBefore;
    three.updateBefore = () => { ran++; };
    try {
      rays.setPreset('storm');
      rays.march.updateBefore(frame);
      expect(ran).toBe(0);
      expect(rays.uniforms.strength.value).toBe(0);
      rays.setPreset('dawn');
      rays.march.updateBefore(frame);
      expect(ran).toBe(1);
    } finally { three.updateBefore = original; }
  });

  it('take the sun at its peak channel, toward it, and the shadow box from main.js', () => {
    const rays = make();
    rays.setPreset('golden', { sunDirection: [0, 2, 0], sunColour: 0x806040 });
    const c = rays.uniforms.colour.value;
    expect(Math.max(c.x, c.y, c.z)).toBeCloseTo(1, 12);
    expect(c.x).toBeGreaterThan(c.z);
    expect(rays.uniforms.sun.value.length()).toBeCloseTo(1, 12);
    rays.setShadowRadius(812);
    expect(rays.uniforms.boxRadius.value).toBe(812);
    rays.setShadowRadius(NaN);
    expect(rays.uniforms.boxRadius.value).toBe(812);
  });

  it('leave prepared startup eligible for the before', () => {
    expect(preparedTintAllowed('?bana=test&godrays=0')).toBe(true);
  });
  it('join the output in main.js only once the shadow map exists, never on the drop path, failures caught', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/const GOD_RAYS_ON = new URLSearchParams\(location\.search\)\.get\('godrays'\) !== '0';/);
    expect(main).toMatch(/if \(!sun\.shadow\.map\) return false;\n\s+godRays = createGodRays\(/);
    /* onto the scene's colour as the output takes it (with the contact shadows, contact-ao.mjs) */
    expect(main).toMatch(/post\.outputNode = vec4\(litColor\.rgb\.add\(godRays\.node\), litColor\.a\)\.add\(bloomNode\);\n\s+post\.needsUpdate = true;/);
    expect(main).toMatch(/if \(godRaysPending && !lowfx\) \{\n\s+try \{ if \(godRaysPending\(\)\) godRaysPending = null; \}\n\s+catch \(error\) \{ godRaysPending = null; godRays = null;/);
    expect(main).toMatch(/godRays\?\.setPreset\(presetName, \{ sunDirection: p\.dir, sunColour: p\.sun \}\);/);
    expect(main).toMatch(/godRays\?\.setShadowRadius\(SUN_BASIS\.R\);/);
  });
});
