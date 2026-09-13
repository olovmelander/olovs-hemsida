// Art-study material only. Broad painted light and colour replace leaf detail.
import { Color, MeshBasicNodeMaterial, MeshStandardNodeMaterial, DoubleSide, Vector3 } from 'three/webgpu';
import { color, mix, mx_noise_float, normalWorldGeometry, positionLocal, smoothstep, texture, uniform, vec3 } from 'three/tsl';

const sunDirection=uniform(new Vector3(-12,22,10).normalize());
const palettes={
  tall:[0x123b26,0x427823,0x91b843],
  gran:[0x0d3629,0x2f6532,0x71a543],
  bjork:[0x244f26,0x6e992a,0xb1ce50],
  al:[0x123f2b,0x397936,0x7aad49],
  ek:[0x1c3f1a,0x537e20,0xa0bc43],
};
export function makePaintedCanopyMaterial(baseColour,map,key,lightDirection=sunDirection){
  const palette=palettes[key];
  const base=new Color(palette?.[1]??baseColour);
  const shade=new Color(palette?.[0]??0x173e26);
  const light=new Color(palette?.[2]??0x98be43);
  const alignment=normalWorldGeometry.dot(lightDirection);
  const broadDabs=mx_noise_float(positionLocal.mul(.48)).mul(.22);
  const lit=smoothstep(-.35,.72,alignment.add(broadDabs));
  const highlight=smoothstep(.45,.95,alignment.add(broadDabs.mul(.65)));
  const painted=mix(mix(color(shade),color(base),lit),color(light),highlight);
  const pigment=mx_noise_float(positionLocal.mul(1.25)).mul(.025).add(1);
  const m=new MeshBasicNodeMaterial({vertexColors:true,side:DoubleSide});
  m.colorNode=painted.mul(pigment).mul(1.15);
  if(map){
    m.map=map;
    m.colorNode=m.colorNode.mul(texture(map).rgb);
    m.opacityNode=texture(map).a;
    m.alphaTest=.5;m.alphaToCoverage=false;
  }
  return m;
}

export function makeBirchBarkMaterial(){
  const m=new MeshStandardNodeMaterial({roughness:1});
  const markings=smoothstep(.29,.43,mx_noise_float(positionLocal.mul(vec3(1.6,12,1.6))));
  m.colorNode=mix(color(0xe6e3d2),color(0x55594e),markings);
  return m;
}
