import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { Color } from 'three/webgpu';
import { paintedSkyColour } from './painted-sky.mjs';
import { hazeGlowStrength } from './aerial-perspective.mjs';
import { cloudGlowOf } from './glow.mjs';
import { Fn, cameraPosition, float, luminance, mix, normalize, positionWorld, pow, saturate, smoothstep, uniform, vec4 } from 'three/tsl';

/* The natural look attenuates r186's HDR atmosphere before tone mapping.
 * The painted look uses a cloud coverage field with separate sky pigments.
 * Both use the same preset controls, sun direction and sky geometry.
 */
export const SKY_RADIANCE = 0.35;
const controls = new WeakMap();

/* THE SKY IS DRAWN LAST OF THE OPAQUE WORLD, before the overlays (render order 1
   and up). It writes no depth and sits at the far plane, so behind the terrain,
   trees and buildings the depth test now rejects it before its four noise
   octaves are shaded; drawn first, it shaded every pixel of the screen and the
   world painted over most of them. Every opaque object at order 0 writes depth,
   and what does not is transparent and follows the sky anyway. `drawLast:
   false` is the before (?skyorder=first). */
export const SKY_RENDER_ORDER = 0.5;

export function createAtmosphericSky({ reversedDepth = false, deterministic = false, painted = false, drawLast = true, drift = null, sunLit = false } = {}) {
  const sky = new SkyMesh();
  sky.name = 'atmospheric-sky';
  // A tiny HDR sun disc sparkling through foliage creates distracting bloom.
  sky.showSunDisc.value = 0;
  if (deterministic) sky.cloudSpeed.value = 0;
  const radiance = uniform(SKY_RADIANCE);
  const tint = uniform(new Color(0xffffff));
  const paletteBlend = uniform(0), minimumLight = uniform(0), twilightLift = uniform(0);
  const zenith = uniform(new Color(0x6688bb)), horizon = uniform(new Color(0xccddee));
  const cloudLit = uniform(new Color(0xfff5df)), cloudShade = uniform(new Color(0xa5b5c6)), cloudBase = uniform(new Color(0xa5b5c6));
  const groundHaze = uniform(new Color(0xc1b8a9));
  const settings={ deterministic, radiance, tint, paletteBlend, minimumLight, twilightLift, zenith, horizon, groundHaze, cloudLit, cloudShade, cloudBase };
  controls.set(sky, settings);
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
  if(painted){
    const layer=paintedSkyColour({sky,zenith,horizon,cloudLit,cloudShade,cloudBase,groundHaze,deterministic,drift,sunLit});
    sky.material.colorNode=layer.node;
    settings.paintedExposure=layer.exposure;
    settings.sunGlow=layer.sunGlow;
    settings.sunGlowStrength=layer.sunGlowStrength;
    settings.hazeGlow=layer.hazeGlow;
    settings.cloudGlow=layer.cloudGlow;
    if(sunLit)settings.cloudSun=layer.cloudSun;
  }
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
  sky.renderOrder = drawLast ? SKY_RENDER_ORDER : -2;
  return sky;
}

/* The band under the horizon is the haze the ground fades into, so it takes the
   fog's FINAL colour: setPreset tints the fog toward the painted fog after the
   preset is applied here, and the band stayed on the untinted colour -- a few
   levels apart at every horizon in golden, dawn, midnight, mist and autumn. */
export function setSkyGroundHaze(sky, colour) {
  const c = controls.get(sky);
  if (!c) throw new Error('Unknown atmospheric sky');
  c.groundHaze.value.copy(colour);
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
  if(c.paintedExposure)c.paintedExposure.value=preset.paintedSkyExposure??1;
  if(c.sunGlow){
    c.sunGlow.value.setHex(preset.skySunGlow??0xffffff);
    c.sunGlowStrength.value=preset.skySunGlowStrength??0;
    c.hazeGlow.value=hazeGlowStrength(preset);
    cloudGlowOf(preset,c.cloudGlow.value);
  }
  /* the clouds lit by the sun (painted-sky.mjs sunLit): its share, and their base colour, the lit paint's shaded side */
  if(c.cloudSun)c.cloudSun.value=preset.skyCloudSun??0;
  c.cloudLit.value.setHex(preset.skyCloudLit ?? 0xfff5df);
  c.cloudShade.value.setHex(preset.skyCloudShade ?? 0xa5b5c6);
  c.cloudBase.value.setHex(preset.skyCloudBase ?? preset.skyCloudShade ?? 0xa5b5c6);
}

export function atmosphereState(sky) {
  const c = controls.get(sky);
  return { kind: sky.isSkyMesh ? 'SkyMesh' : null, radiance: c.radiance.value,
    cloudCoverage: sky.cloudCoverage.value, cloudDensity: sky.cloudDensity.value,
    cloudScale: sky.cloudScale.value, cloudElevation: sky.cloudElevation.value, cloudSpeed: sky.cloudSpeed.value,
    paletteBlend: c.paletteBlend.value, sun: sky.sunPosition.value.toArray(),
    sunGlowStrength: c.sunGlowStrength?.value??0, hazeGlow: c.hazeGlow?.value??0, cloudGlow: c.cloudGlow?.value.toArray()??null, groundHaze: c.groundHaze.value.getHex(),
    sunLit: !!c.cloudSun, cloudSun: c.cloudSun?.value??0, cloudBase: c.cloudBase.value.getHex() };
}
