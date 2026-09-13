import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { Color } from 'three/webgpu';
import { Fn, cameraPosition, float, luminance, mix, normalize, positionWorld, pow, saturate, smoothstep, uniform, vec4 } from 'three/tsl';

/* Both visual styles share the r186 atmosphere. Attenuate its HDR radiance
 * before bloom/tone mapping so cloud detail survives the course's exposure.
 * World lighting and the sun direction still come from the selected preset.
 */
export const SKY_RADIANCE = 0.35;
const controls = new WeakMap();

export function createAtmosphericSky({ reversedDepth = false, deterministic = false } = {}) {
  const sky = new SkyMesh();
  sky.name = 'atmospheric-sky';
  // A tiny HDR sun disc sparkling through foliage creates distracting bloom.
  sky.showSunDisc.value = 0;
  if (deterministic) sky.cloudSpeed.value = 0;
  const radiance = uniform(SKY_RADIANCE);
  const tint = uniform(new Color(0xffffff));
  const paletteBlend = uniform(0), minimumLight = uniform(0), twilightLift = uniform(0);
  const zenith = uniform(new Color(0x6688bb)), horizon = uniform(new Color(0xccddee));
  const groundHaze = uniform(new Color(0xc1b8a9));
  controls.set(sky, { deterministic, radiance, tint, paletteBlend, minimumLight, twilightLift, zenith, horizon, groundHaze });
  const atmosphere = sky.material.colorNode;
  sky.material.colorNode = Fn(() => {
    const c = vec4(atmosphere).toVar();
    const lit = c.rgb.mul(radiance).mul(tint).toVar();
    const elevation = normalize(positionWorld.sub(cameraPosition)).y;
    const up = saturate(elevation);
    const palette = mix(horizon, zenith, pow(up, 0.6));
    // Change chromaticity without flattening r186's cloud self-shading. The
    // native radiance still describes cloud shapes, silver linings and haze.
    const hue = palette.div(luminance(palette).max(0.02));
    // Below the horizon the physical model approaches black. Lift its remaining
    // variation continuously: clamping to an ambient floor erases the clouds.
    const light = luminance(lit).max(0);
    const coloured = hue.mul(light.add(light.sqrt().mul(twilightLift)).add(minimumLight));
    const skyColour = mix(lit, coloured, paletteBlend);
    // An elevated camera sees below the geometric horizon. Meet the same fog
    // as distant hills instead of exposing SkyMesh's dark lower hemisphere.
    return vec4(mix(groundHaze, skyColour, smoothstep(-0.06, 0.10, elevation)), c.a);
  })();
  // SkyMesh pins z=w, which is the near plane with reversed depth. r186 fixes
  // renderOrder sorting, but the sky's far clip depth must still be zero.
  if (reversedDepth) {
    const vertex = sky.material.vertexNode;
    sky.material.vertexNode = Fn(() => {
      const p = vec4(vertex).toVar();
      return vec4(p.x, p.y, float(0), p.w);
    })();
  }
  sky.scale.setScalar(12000);
  sky.renderOrder = -2;
  return sky;
}

export function setAtmospherePreset(sky, preset) {
  const c = controls.get(sky);
  if (!c) throw new Error('Unknown atmospheric sky');
  sky.turbidity.value = preset.turb;
  sky.rayleigh.value = preset.ray;
  sky.mieCoefficient.value = preset.mie;
  sky.mieDirectionalG.value = preset.mieG;
  sky.cloudCoverage.value = preset.cloud;
  sky.cloudDensity.value = preset.cloudDensity;
  sky.cloudScale.value = preset.cloudScale;
  sky.cloudElevation.value = preset.cloudElevation;
  sky.cloudSpeed.value = c.deterministic ? 0 : preset.cloudSpeed;
  sky.sunPosition.value.set(...preset.dir).normalize().multiplyScalar(450000);
  c.radiance.value = preset.skyRadiance;
  c.tint.value.setHex(preset.skyTint);
  c.paletteBlend.value = preset.skyPalette;
  c.minimumLight.value = preset.skyFloor ?? 0;
  c.twilightLift.value = preset.skyLift ?? 0;
  c.zenith.value.setHex(preset.skyZenith ?? 0x6688bb);
  c.horizon.value.setHex(preset.skyHorizon ?? 0xccddee);
  c.groundHaze.value.setHex(preset.fog);
}

export function atmosphereState(sky) {
  const c = controls.get(sky);
  return { kind: sky.isSkyMesh ? 'SkyMesh' : null, radiance: c.radiance.value,
    cloudCoverage: sky.cloudCoverage.value, cloudDensity: sky.cloudDensity.value,
    cloudScale: sky.cloudScale.value, cloudElevation: sky.cloudElevation.value, cloudSpeed: sky.cloudSpeed.value,
    paletteBlend: c.paletteBlend.value, sun: sky.sunPosition.value.toArray() };
}
