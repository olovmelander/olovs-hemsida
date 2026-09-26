import {Color} from 'three/webgpu';
import {CLOUD_GLOW} from './glow.mjs';
import {float,mix,mx_noise_float,normalize,positionWorld,cameraPosition,pow,saturate,smoothstep,time,uniform,vec2,vec3,vec4} from 'three/tsl';

// A separate cloud coverage field lets blue sky and cream clouds keep their
// own pigments. Four broad noise octaves; one sky draw and no cloud textures.
// `drift` (one-wind.mjs skyDrift) carries the clouds downwind with the one
// wind: their offset across the cloud plane (x, y) and how far they have run
// (z), which also turns their shapes over. Without it, the before: a drift west
// at the preset's speed.
// `cloudGlow` (glow.mjs): toward a low sun the clouds' lit centres shine past
// their paint in the sun glow's colour, so the glow's threshold picks them out
// and nothing else in the sky; their edges, and every cloud away from the sun,
// keep the paint. Black is the before (?cloudglow=0).
// `sunLit` (docs/visual-clouds-2026-09-26.md): THE CLOUDS LIT BY THE SUN. Their
// light and shade came from their noise alone, the same whichever way the sun
// stood, so they read flat: blotched cream. Now, at the preset's `cloudSun`
// share (skyCloudSun, painted-world-palette.mjs), a cloud is lit where its
// thickness falls away toward the light and shaded where it gathers: the light
// climbs over each cloud from the sun's side and over its top -- on the cloud
// plane, the edge nearer the eye, which stands higher in the sky -- so tops and
// sunward flanks take the lit paint and bases and far flanks the preset's base
// colour (skyCloudBase), a lavender or grey the sky's blue does not swallow.
// Seen toward a low sun a cloud shows its own shade, seen away from it its lit
// face; overhead, its belly. Near the sun light scatters through them and they
// keep their lit paint, as the glow's shine expects; round that, toward the
// sun, the thin edge just inside each cloud takes the lit paint: a lining. Never
// brighter than the lit paint, so the glow's thresholds stand. Two more noise
// octaves, on the sky pixels the world leaves (the sky draws last). Without it
// (?cloudlight=0), the before.
export const CLOUD_SUN=Object.freeze({
  /* how far along the light the cloud's thickness is looked up, in the noise's units (a broad cloud is about one across) */
  reach:.22,
  /* the thinning toward the light that lights a cloud in full, and the thickening that shades it (the field's units) */
  width:.06,
  /* the light's weight from the sun's side (times its cosine: a high sun lights from above) and over the top */
  side:.7,top:1,
  /* a cloud's share of the lit paint seen straight toward a low sun, and the most its belly loses overhead */
  backlit:.6,belly:.3,
  /* the darkest a cloud goes: this share of the way from its base colour to its lit paint */
  floor:.2,
  /* the lining toward the sun: inside the cloud's edge, from this far past the field's threshold to this */
  lining:[.06,.18],
});
export function paintedSkyColour({sky,zenith,horizon,cloudLit,cloudShade,cloudBase=null,groundHaze,deterministic,drift=null,sunLit=false}){
  const exposure=uniform(1);
  const sunGlow=uniform(new Color(0xffffff)),sunGlowStrength=uniform(0),hazeGlow=uniform(0),cloudGlow=uniform(new Color(0,0,0));
  const cloudSun=uniform(0);
  const direction=normalize(positionWorld.sub(cameraPosition));
  const up=saturate(direction.y);
  const t=deterministic?float(0):time.mul(sky.cloudSpeed).mul(35);
  const uv=direction.xz.div(up.mul(mix(float(1),float(.4),sky.cloudElevation)).add(.12))
    .mul(sky.cloudScale.mul(3600));
  const p=drift?vec3(uv.x.sub(drift.x),uv.y.sub(drift.y),drift.z.mul(.15)):vec3(uv.x.add(t),uv.y,t.mul(.15));
  const large=mx_noise_float(p.mul(1.1));
  const medium=mx_noise_float(p.mul(2.25).add(vec3(4.7,1.3,0)));
  const small=mx_noise_float(p.mul(4.6).add(vec3(2.3,7.1,0)));
  const edge=mx_noise_float(p.mul(9.3));
  const field=large.mul(.55).add(medium.mul(.26)).add(small.mul(.13)).add(edge.mul(.06)).add(.5);
  const threshold=float(.66).sub(sky.cloudCoverage.mul(.55));
  const coverage=smoothstep(threshold,threshold.add(.105),field)
    .mul(sky.cloudDensity.mul(1.5).min(1)).mul(smoothstep(.012,.09,up));
  const light=smoothstep(-.28,.28,medium.add(large.mul(.35)));
  // A broad glow follows the actual light direction. Keeping it directional
  // preserves blue sky away from the sun instead of greying the whole dome.
  const sunward=pow(saturate(direction.dot(normalize(sky.sunPosition)).mul(.5).add(.5)),6);
  const glow=sunward.mul(smoothstep(.10,.68,up).oneMinus()).mul(sunGlowStrength);
  let cloud=mix(cloudShade,cloudLit,light.mul(.65).add(.35)),lining=null;
  if(sunLit){
    const s=normalize(sky.sunPosition),flat=vec2(s.x,s.z),low=flat.length();
    const toward=flat.div(low.max(1e-4));
    const across=direction.xz.length(),look=direction.xz.div(across.max(1e-4));
    /* the way the light climbs over each cloud on its plane: from the sun's side, and over its top */
    const climb=toward.mul(low.mul(CLOUD_SUN.side)).sub(look.mul(across.mul(CLOUD_SUN.top)));
    const way=climb.div(climb.length().max(1e-4)).mul(CLOUD_SUN.reach);
    const q=p.add(vec3(way.x,way.y,0));
    /* how much thinner the cloud is that way (its broad octaves; the fine ones are shared) */
    const thinning=large.sub(mx_noise_float(q.mul(1.1))).mul(.55)
      .add(medium.sub(mx_noise_float(q.mul(2.25).add(vec3(4.7,1.3,0)))).mul(.26));
    const lit=smoothstep(-CLOUD_SUN.width,CLOUD_SUN.width,thinning);
    const face=mix(float(CLOUD_SUN.backlit),float(1),saturate(look.dot(toward).mul(-.5).add(.5)));
    const shaded=lit.mul(mix(float(1),face,low)).mul(float(1).sub(up.mul(up).mul(CLOUD_SUN.belly)));
    const sunLight=mix(shaded,float(1),sunward.mul(sunward));
    cloud=mix(cloud,mix(cloudBase,cloudLit,mix(float(CLOUD_SUN.floor),float(1),sunLight)),cloudSun);
    lining=float(1).sub(smoothstep(threshold.add(CLOUD_SUN.lining[0]),threshold.add(CLOUD_SUN.lining[1]),field))
      .mul(sunward).mul(low).mul(cloudSun);
  }
  cloud=mix(cloud,cloudLit,glow.mul(.6));
  if(lining)cloud=mix(cloud,cloudLit,lining);
  // The shine is a narrower lobe than the glow's (its square), on the cloud's
  // thick interior past its soft edge.
  const centre=smoothstep(threshold.add(CLOUD_GLOW.centre[0]),threshold.add(CLOUD_GLOW.centre[1]),field);
  const shining=cloud.mul(cloudGlow.mul(sunward.mul(sunward).mul(centre)).add(1));
  const clear=mix(mix(horizon,zenith,pow(up,.38)),sunGlow,glow);
  const painted=mix(clear,shining,coverage).mul(exposure);
  // The band under the horizon is the ground's haze, warmed toward the sun as
  // the aerial perspective warms it (aerial-perspective.mjs), so they still meet.
  const haze=mix(groundHaze,sunGlow,sunward.mul(hazeGlow));
  return{node:vec4(mix(haze,painted,smoothstep(-.06,.07,direction.y)),1),exposure,sunGlow,sunGlowStrength,hazeGlow,cloudGlow,cloudSun};
}
