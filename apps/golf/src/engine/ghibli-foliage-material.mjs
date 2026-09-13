import {Color,MeshBasicNodeMaterial,MeshStandardNodeMaterial,DoubleSide} from 'three/webgpu';
import {color,float,mix,mx_noise_float,normalWorldGeometry,positionLocal,smoothstep,texture,uniform,vec3} from 'three/tsl';

export const FOLIAGE_PALETTES={
  // Muted forest greens: lifted shadows and restrained sunlit tips keep a
  // whole stand soft under the app's exposure, without fluorescent yellow.
  tall:[0x293e30,0x4c6640,0x7a8b5c],gran:[0x293c33,0x435c45,0x718568],
  bjork:[0x354a32,0x5e784b,0x8a9d6b],al:[0x304737,0x526f51,0x7e966d],ek:[0x37482f,0x60754a,0x8c9b69],
};
const autumnPalettes={bjork:[0x5f4b32,0x8b7140,0xb19a60],ek:[0x514431,0x79563b,0xa17e50]};
export const foliageLight=uniform(new Color(0xffffff));
export function setFoliageLighting(p){
  const strength=Math.max(.20,Math.min(1,.18+p.int*.30+p.hemiI*.10));
  foliageLight.value.setHex(p.hemiS).lerp(new Color(0xffffff),Math.min(1,p.int/2)).multiplyScalar(strength);
}

// Meshes and all impostor rings share this light/season response. Impostors
// use the baked custom normals, not the normals of the foliage card planes.
export function paintedFoliageColour({key,normal,sunDirection,position=null,tint=vec3(1),autumn=float(0),seed=float(.5),lighting=foliageLight}){
  const palette=FOLIAGE_PALETTES[key];
  if(!palette)throw new Error(`Unknown foliage palette: ${key}`);
  const autumnPalette=autumnPalettes[key];
  const turned=autumn.mul(smoothstep(.12,.70,seed));
  const shades=palette.map((hex,i)=>autumnPalette?mix(color(hex),color(autumnPalette[i]),turned):color(hex));
  const alignment=normal.dot(sunDirection);
  const dabs=position?mx_noise_float(position.mul(.48)).mul(.12):float(0);
  const lit=smoothstep(-.5,.85,alignment.add(dabs));
  const highlight=smoothstep(.25,.98,alignment.add(dabs.mul(.65))).mul(.72);
  const pigment=position?mx_noise_float(position.mul(1.25)).mul(.025).add(1):float(1);
  return mix(mix(shades[0],shades[1],lit),shades[2],highlight).mul(pigment).mul(tint).mul(lighting);
}

export function makeGhibliFoliageMaterial({key,map=null,sunDirection,tint,autumn,seed,lighting=foliageLight}){
  const m=new MeshBasicNodeMaterial({vertexColors:true,side:DoubleSide});
  m.colorNode=paintedFoliageColour({key,normal:normalWorldGeometry,sunDirection,position:positionLocal,tint,autumn,seed,lighting});
  if(map){
    m.map=map;m.colorNode=m.colorNode.mul(texture(map).rgb);m.opacityNode=texture(map).a;
    m.alphaTest=.5;m.alphaToCoverage=false;
  }
  m.userData.foliageKey=key;
  return m;
}

export function makeGhibliBirchBarkMaterial(){
  const m=new MeshStandardNodeMaterial({roughness:1});
  const markings=smoothstep(.29,.43,mx_noise_float(positionLocal.mul(vec3(1.6,12,1.6))));
  m.colorNode=mix(color(0xd5d4c4),color(0x606158),markings);
  return m;
}
