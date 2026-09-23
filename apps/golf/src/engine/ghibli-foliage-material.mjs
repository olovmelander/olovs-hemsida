import {Color,MeshBasicNodeMaterial,MeshStandardNodeMaterial,DoubleSide} from 'three/webgpu';
import {color,float,fract,mix,mx_noise_float,normalWorldGeometry,positionLocal,smoothstep,texture,uniform,vec2,vec3} from 'three/tsl';
import {FOLIAGE_PALETTES,AUTUMN_FOLIAGE} from './painted-world-palette.mjs';
export {FOLIAGE_PALETTES} from './painted-world-palette.mjs';

export const foliageLight=uniform(new Color(0xffffff));
const foliageShadow=uniform(new Color(0xffffff)),foliageSun=uniform(new Color(0xffffff));
const foliageDirect=uniform(.9);
export function setFoliageLighting(p){
  const strength=p.foliage?.strength??Math.max(.35,Math.min(1,.18+p.int*.30+p.hemiI*.10));
  const direct=p.foliage?.direct??Math.min(.9,p.int/2.5);
  foliageDirect.value=direct;
  foliageLight.value.setRGB(strength,strength,strength);
  foliageShadow.value.setHex(p.hemiS).lerp(new Color(0xffffff),p.foliage?.shadowWhite??.62);
  foliageSun.value.setHex(p.sun).lerp(new Color(0xffffff),p.foliage?.sunWhite??.70);
  foliageSun.value.lerp(foliageShadow.value,1-direct);
}

// The two noise terms are broad (3.3 m and 1.4 m wavelengths) and small, so
// they are evaluated per vertex and interpolated: per pixel they were 20-25% of
// a 1080p frame in tree views (docs/performance-plan-2026-09-23.md, 3.3). The
// position is the same one the pixel path read -- instanced and wind-swayed --
// so the pattern still varies from tree to tree. noisePerPixel is the before.
function foliageNoise(position,noisePerPixel){
  const noise=vec2(mx_noise_float(position.mul(.30)),mx_noise_float(position.mul(.70)));
  return noisePerPixel?noise:noise.toVarying('vFoliageNoise');
}

// Meshes and all impostor rings share this light/season response. Impostors
// use the baked custom normals, not the normals of the foliage card planes.
export function paintedFoliageColour({key,normal,sunDirection,position=null,tint=vec3(1),autumn=float(0),seed=float(.5),lighting=foliageLight,noisePerPixel=false}){
  const palette=FOLIAGE_PALETTES[key];
  if(!palette)throw new Error(`Unknown foliage palette: ${key}`);
  const seasonal=AUTUMN_FOLIAGE[key];
  const family=fract(seed.mul(7.13).add(.17));
  const turned=autumn.mul(smoothstep(.03,.14,seed));
  const shades=palette.map((hex,i)=>{
    if(!seasonal)return color(hex);
    const warm=mix(mix(color(seasonal.ramps[0][i]),color(seasonal.ramps[1][i]),
      smoothstep(seasonal.breaks[0]-.025,seasonal.breaks[0]+.025,family)),
      color(seasonal.ramps[2][i]),smoothstep(seasonal.breaks[1]-.025,seasonal.breaks[1]+.025,family));
    return mix(color(hex),warm,turned);
  });
  const alignment=normal.dot(sunDirection);
  const noise=position?foliageNoise(position,noisePerPixel):null;
  const dabs=noise?noise.x.mul(.07):float(0);
  // Broad canopy normals need a deeper light-to-shade transition: wrapping
  // sunlight too far around them lifts the whole crown into pale midtones.
  const diffuse=normal.y.mul(.28).add(.50);
  const lit=mix(diffuse,smoothstep(-.18,.85,alignment.add(dabs)),foliageDirect);
  // Concentrate the bright pigment on the sun-facing tops, with a smooth
  // transition into the stronger green body rather than a pale overall wash.
  const highlight=mix(normal.y.max(0).mul(.10),smoothstep(.48,.98,alignment.add(dabs.mul(.65))).mul(.74),foliageDirect);
  const pigment=noise?noise.y.mul(.0125).add(1):float(1);
  const lightTint=mix(foliageShadow,foliageSun,lit);
  return mix(mix(shades[0],shades[1],lit),shades[2],highlight).mul(pigment).mul(tint).mul(lighting).mul(lightTint);
}

// Transparent atlas texels contain black RGB. Undo that dark fringe after
// filtering, then keep just a little leaf pigment within the broad crown light.
// The impostor bake uses the same correction; alpha still defines the silhouette.
export function foliageSurfacePigment(texel){
  return mix(vec3(1),texel.rgb.div(texel.a.max(.01)).min(1),.30);
}

export function makeGhibliFoliageMaterial({key,map=null,sunDirection,tint,autumn,seed,lighting=foliageLight,noisePerPixel=false}){
  const m=new MeshBasicNodeMaterial({vertexColors:true,side:DoubleSide});
  m.colorNode=paintedFoliageColour({key,normal:normalWorldGeometry,sunDirection,position:positionLocal,tint,autumn,seed,lighting,noisePerPixel});
  if(map){
    const texel=texture(map);
    m.map=map;m.colorNode=m.colorNode.mul(foliageSurfacePigment(texel));m.opacityNode=texel.a;
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
