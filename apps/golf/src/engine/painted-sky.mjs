import {float,mix,mx_noise_float,normalize,positionWorld,cameraPosition,pow,saturate,smoothstep,time,uniform,vec3,vec4} from 'three/tsl';

// A separate cloud coverage field lets blue sky and cream clouds keep their
// own pigments. Four broad noise octaves; one sky draw and no cloud textures.
export function paintedSkyColour({sky,zenith,horizon,cloudLit,cloudShade,groundHaze,deterministic}){
  const exposure=uniform(1);
  const direction=normalize(positionWorld.sub(cameraPosition));
  const up=saturate(direction.y);
  const t=deterministic?float(0):time.mul(sky.cloudSpeed).mul(35);
  const uv=direction.xz.div(up.mul(mix(float(1),float(.4),sky.cloudElevation)).add(.12))
    .mul(sky.cloudScale.mul(3600));
  const p=vec3(uv.x.add(t),uv.y,t.mul(.15));
  const large=mx_noise_float(p.mul(1.1));
  const medium=mx_noise_float(p.mul(2.25).add(vec3(4.7,1.3,0)));
  const small=mx_noise_float(p.mul(4.6).add(vec3(2.3,7.1,0)));
  const edge=mx_noise_float(p.mul(9.3));
  const field=large.mul(.55).add(medium.mul(.26)).add(small.mul(.13)).add(edge.mul(.06)).add(.5);
  const threshold=float(.66).sub(sky.cloudCoverage.mul(.55));
  const coverage=smoothstep(threshold,threshold.add(.105),field)
    .mul(sky.cloudDensity.mul(1.5).min(1)).mul(smoothstep(.012,.09,up));
  const light=smoothstep(-.28,.28,medium.add(large.mul(.35)));
  const cloud=mix(cloudShade,cloudLit,light.mul(.65).add(.35));
  const clear=mix(horizon,zenith,pow(up,.38));
  const painted=mix(clear,cloud,coverage).mul(exposure);
  return{node:vec4(mix(groundHaze,painted,smoothstep(-.06,.07,direction.y)),1),exposure};
}
