import {Color,MeshBasicNodeMaterial,MeshStandardNodeMaterial,DoubleSide} from 'three/webgpu';
import {abs,cameraPosition,color,dot,float,fract,mix,mx_noise_float,normalize,normalWorldGeometry,positionLocal,positionWorld,pow,saturate,smoothstep,texture,uniform,vec2,vec3} from 'three/tsl';
import {FOLIAGE_PALETTES,AUTUMN_FOLIAGE} from './painted-world-palette.mjs';
export {FOLIAGE_PALETTES} from './painted-world-palette.mjs';

export const foliageLight=uniform(new Color(0xffffff));
const foliageShadow=uniform(new Color(0xffffff)),foliageSun=uniform(new Color(0xffffff));
const foliageDirect=uniform(.9);
export const foliageBack=uniform(new Color(0,0,0));
export function setFoliageLighting(p){
  const strength=p.foliage?.strength??Math.max(.35,Math.min(1,.18+p.int*.30+p.hemiI*.10));
  const direct=p.foliage?.direct??Math.min(.9,p.int/2.5);
  foliageDirect.value=direct;
  foliageLight.value.setRGB(strength,strength,strength);
  foliageShadow.value.setHex(p.hemiS).lerp(new Color(0xffffff),p.foliage?.shadowWhite??.62);
  foliageSun.value.setHex(p.sun).lerp(new Color(0xffffff),p.foliage?.sunWhite??.70);
  foliageSun.value.lerp(foliageShadow.value,1-direct);
  foliageBack.value.setHex(p.sun??0xffffff).multiplyScalar(p.foliage?.back??0);
}

/* THE SUN THROUGH THE LEAVES. Looking toward a low sun, a crown's thin outer
   leaves glow with the light passing through them, along the silhouette where
   the canopy normal turns side-on to the eye; the thick core stays dark.
   `foliage.back` sets it per preset -- golden hour, the midnight sun, dawn and
   autumn -- and a preset without a low sun has none. The glow's colour is
   reckoned per vertex and interpolated: per pixel a crown adds one addition. */
export const foliageFacingSun=(toward,sunDirection)=>pow(saturate(dot(toward,sunDirection)),4);
export function foliageBackLight({normal,sunDirection}){
  const toward=normalize(positionWorld.sub(cameraPosition));
  const edge=float(1).sub(abs(dot(normal,toward)));
  return foliageFacingSun(toward,sunDirection).mul(edge.mul(edge));
}
/* A billboard has one normal per vertex, facing the eye, so an impostor takes
   one edge weight for the whole crown: 0.34, at which the five species'
   impostors gain as much light against the sun as their mesh crowns, at golden
   hour and under the midnight sun (docs/visual-lighting-2026-09-25.md). */
export const IMPOSTOR_BACK_EDGE=.34;

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
export function paintedFoliageColour({key,normal,sunDirection,position=null,tint=vec3(1),autumn=float(0),seed=float(.5),lighting=foliageLight,noisePerPixel=false,backLight=null}){
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
  const body=mix(mix(shades[0],shades[1],lit),shades[2],highlight);
  if(!backLight)return body.mul(pigment).mul(tint).mul(lighting).mul(lightTint);
  // the leaf's brightest pigment, lit from behind in the sun's colour
  const through=shades[2].mul(foliageBack).mul(backLight).toVertexStage();
  return body.mul(lightTint).add(through).mul(pigment).mul(tint).mul(lighting);
}

// Transparent atlas texels contain black RGB. Undo that dark fringe after
// filtering, then keep just a little leaf pigment within the broad crown light.
// The impostor bake uses the same correction; alpha still defines the silhouette.
export function foliageSurfacePigment(texel){
  return mix(vec3(1),texel.rgb.div(texel.a.max(.01)).min(1),.30);
}

// The shadow pass cuts the cards at the atlas's own resolution. With the
// atlas as `map`, three tested its MIPMAPPED alpha there, at the mip the
// shadow map's texel picks, so a card averaged under half opacity dropped
// out: in the 850 m box a crown kept on average three quarters of its shadow
// on a desktop's map and under two thirds on a phone's (as little as 38 %),
// so shadows faded as the camera pulled back (docs/tree-shadows-zoom.md). The
// colour pass never read `map` -- colorNode and opacityNode replace it -- so
// it is unchanged. mipShadow (?foliageshadow=mip) is the before.
export function makeGhibliFoliageMaterial({key,map=null,sunDirection,tint,autumn,seed,lighting=foliageLight,noisePerPixel=false,mipShadow=false,backLight=true}){
  const m=new MeshBasicNodeMaterial({vertexColors:true,side:DoubleSide});
  m.colorNode=paintedFoliageColour({key,normal:normalWorldGeometry,sunDirection,position:positionLocal,tint,autumn,seed,lighting,noisePerPixel,
    backLight:backLight?foliageBackLight({normal:normalWorldGeometry,sunDirection}):null});
  if(map){
    const texel=texture(map);
    m.colorNode=m.colorNode.mul(foliageSurfacePigment(texel));m.opacityNode=texel.a;
    m.alphaTest=.5;m.alphaToCoverage=false;
    if(mipShadow)m.map=map;
    else m.maskShadowNode=texture(map).level(0).a.greaterThan(.5);
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
