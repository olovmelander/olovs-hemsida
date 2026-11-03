import {Color,MeshBasicNodeMaterial,MeshStandardNodeMaterial,DoubleSide} from 'three/webgpu';
import {abs,cameraPosition,color,dot,float,fract,mix,mx_noise_float,normalize,normalWorldGeometry,positionLocal,positionWorld,pow,saturate,smoothstep,texture,uniform,vec2,vec3,vertexColor} from 'three/tsl';
import {CROWN_DEPTH} from './crown-depth.mjs';
import {FOLIAGE_PALETTES,AUTUMN_FOLIAGE} from './painted-world-palette.mjs';
import {coverOpaqueBackdrop,centredCoverageCut} from './msaa-coverage.mjs';
export {FOLIAGE_PALETTES} from './painted-world-palette.mjs';

export const foliageLight=uniform(new Color(0xffffff));
const foliageShadow=uniform(new Color(0xffffff)),foliageSun=uniform(new Color(0xffffff));
const foliageDirect=uniform(.9);
export const foliageBack=uniform(new Color(0,0,0));
/* THE SHARE OF ITS LIGHT A CROWN KEEPS IN A CLOUD'S FULL SHADE. A crown's
   strength is reckoned from the preset's sun and sky (0.30 a unit of the sun's
   intensity, 0.18 and 0.10 a unit of the sky's, below); without the sun it
   keeps the sky's part and the sky-lit share of the sun's (shadowSky, as a
   tree's shadow on the ground keeps). A cloud's shade then dims a crown by
   mix(this, 1, sunlit), as it dims open ground by mix(its own share, 1, sunlit)
   (shadow-tint.mjs): about 0.4 at noon, 0.3 against a low golden sun. */
export const foliageCloudShade=uniform(1);
export function foliageCloudShadeFor(p){
  const sun=.30*(p.int??0),sky=.18+.10*(p.hemiI??0);
  return (sky+sun*(p.shadowSky??0))/(sky+sun);
}
/* THE PAINTED CANOPY (2 November, owner request: "the tree canopy style in
   odyssey mode in serenity blocks ... or even better"). Serenity's Odyssey
   crowns are painted in TONES, not airbrushed: a wrapped sun term on the
   crown's own soft normal, cut by two wide band edges into shade, a mid tone
   and the lit tone, and the edges -- never the colour -- moved by how closed
   the crown is there, by each clump and by each tree, so neighbours separate
   by value and every crown reads lit on top and dark beneath
   (serenity-blocks src/rendering/odyssey/world/odyssey-world-renderer.js,
   FOREST_BAND_* and LEAF_LOOK). Golf's species keep their own three shades:
   shade, body and the bright pigment, which becomes the warm cap the sun
   puts on each up-and-sunward mass. The edges ride the sun's height
   (`canopyBandShift`, Odyssey's FOREST_SUN_BAND_SHIFT), so the tops land on
   the lit tone under a high noon and a golden hour alike, and an overcast
   light (little direct sun) keeps its soft wrap. ?canopy=0 is the before. */
export const CANOPY=Object.freeze({wrap:.70,topWrap:.66,sunRide:.5,bands:Object.freeze([.24,.52,.60,.78]),
  mid:.64,aoShift:.30,clump:1.6,jitter:.17,capGain:.70,capFacing:Object.freeze([.55,.92]),capOpen:Object.freeze([.70,.92]),
  softLift:.11});
export const canopyBandShift=uniform(0);
/** How far the band edges move for a sun at this height (dir is toward the sun). */
export function canopyBandShiftFor(dir){
  const [x=0,y=1,z=0]=dir??[];
  const len=Math.hypot(x,y,z)||1;
  /* half of Odyssey's full ride: its sun sits near one height, and the whole
     ride at a Swedish noon put the crowns' sides in shade (measured 2 November) */
  return ((y/len+CANOPY.wrap)/(1+CANOPY.wrap)-CANOPY.topWrap)*CANOPY.sunRide;
}
export function setFoliageLighting(p){
  canopyBandShift.value=canopyBandShiftFor(p.dir);
  const strength=p.foliage?.strength??Math.max(.35,Math.min(1,.18+p.int*.30+p.hemiI*.10));
  const direct=p.foliage?.direct??Math.min(.9,p.int/2.5);
  foliageDirect.value=direct;
  foliageLight.value.setRGB(strength,strength,strength);
  foliageShadow.value.setHex(p.hemiS).lerp(new Color(0xffffff),p.foliage?.shadowWhite??.62);
  foliageSun.value.setHex(p.sun).lerp(new Color(0xffffff),p.foliage?.sunWhite??.70);
  foliageSun.value.lerp(foliageShadow.value,1-direct);
  foliageBack.value.setHex(p.sun??0xffffff).multiplyScalar(p.foliage?.back??0);
  foliageCloudShade.value=foliageCloudShadeFor(p);
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
// `sunlit` is the share of the sun a crown keeps past the clouds (cloud-shadow.mjs,
// per vertex): in a cloud's shade its direct light, highlight and back-light
// give way to the sky's, as on its own shaded side, and it dims as open ground
// does (foliageCloudShade). Without it, the before.
export function paintedFoliageColour({key,normal,sunDirection,position=null,tint=vec3(1),autumn=float(0),seed=float(.5),lighting=foliageLight,noisePerPixel=false,backLight=null,sunlit=null,canopy=false,openness=null,perVertex=false}){
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
  const direct=sunlit?foliageDirect.mul(sunlit):foliageDirect;
  const lit=mix(diffuse,smoothstep(-.18,.85,alignment.add(dabs)),direct);
  // Concentrate the bright pigment on the sun-facing tops, with a smooth
  // transition into the stronger green body rather than a pale overall wash.
  const highlight=mix(normal.y.max(0).mul(.10),smoothstep(.48,.98,alignment.add(dabs.mul(.65))).mul(.74),direct);
  const pigment=noise?noise.y.mul(.0125).add(1):float(1);
  let lightTint=mix(foliageShadow,foliageSun,lit);
  let body=mix(mix(shades[0],shades[1],lit),shades[2],highlight);
  if(canopy){
    const C=CANOPY,[b0,b1,b2,b3]=C.bands;
    const wrap=alignment.add(C.wrap).div(1+C.wrap);
    /* openness through the crown (crown-depth.mjs, 0 at its floor, 1 open) moves both edges toward shade */
    const open=openness?smoothstep(CROWN_DEPTH.floor,1,openness):float(1);
    const shift=canopyBandShift.add(float(1).sub(open).mul(C.aoShift)).add(dabs.mul(C.clump));
    const jitter=fract(seed.mul(13.73).add(.31)).sub(.5).mul(C.jitter);
    const lo=smoothstep(shift.add(b0),shift.add(b1),wrap);
    const hi=smoothstep(shift.add(jitter).add(b2),shift.add(jitter).add(b3),wrap);
    /* little direct sun: the soft wrap, as before -- less the lift the puffs'
       upward lean gives it on average (crown-puffs.mjs, `up`), so the storm, the
       mist and the blue hour keep their crowns as dark as they were */
    const soft=diffuse.sub(C.softLift);
    const sunXZ=normalize(sunDirection.xz.add(vec2(1e-4,0)));
    const capFacing=normal.y.add(dot(normal.xz,sunXZ).mul(.35)).add(dabs.mul(C.clump*.6));
    const cap=smoothstep(C.capFacing[0],C.capFacing[1],capFacing).mul(smoothstep(C.capOpen[0],C.capOpen[1],open)).mul(C.capGain);
    /* the warm pigment: on each up-and-sunward cap, and as before on the faces turned to the sun */
    let bands=vec3(mix(soft,lo,direct),mix(soft.mul(soft),hi,direct),cap.mul(direct).max(highlight));
    /* on a mesh the bands are reckoned per vertex: each leaf card takes its tone, as a painter's dab does */
    if(perVertex)bands=bands.toVertexStage();
    const midTone=mix(shades[0],shades[1],C.mid);
    body=mix(mix(mix(shades[0],midTone,bands.x),shades[1],bands.y),shades[2],bands.z);
    lightTint=mix(foliageShadow,foliageSun,bands.x);
  }
  const cloudShade=sunlit?mix(foliageCloudShade,float(1),sunlit):null;
  if(!backLight){const plain=body.mul(pigment).mul(tint).mul(lighting).mul(lightTint);return cloudShade?plain.mul(cloudShade):plain;}
  // the leaf's brightest pigment, lit from behind in the sun's colour
  const glow=shades[2].mul(foliageBack).mul(backLight);
  const through=(sunlit?glow.mul(sunlit):glow).toVertexStage();
  const colour=body.mul(lightTint).add(through).mul(pigment).mul(tint).mul(lighting);
  return cloudShade?colour.mul(cloudShade):colour;
}

// Transparent atlas texels contain black RGB. Undo that dark fringe after
// filtering, then keep just a little leaf pigment within the broad crown light.
// The impostor bake uses the same correction; alpha still defines the silhouette.
export function foliageSurfacePigment(texel,realistic=false){
  if(realistic)return realisticLeafPigment(texel);
  return mix(vec3(1),texel.rgb.div(texel.a.max(.01)).min(1),.30);
}
/* THE REALISTIC CATALOGUE'S LEAVES (treeset v2): its sprigs are drawn leaf by leaf in near-neutral
   colours round `mean` with the colour bled into the clear texels (tools/blender-tree-study/realistic/
   make_leaf_atlas.mjs), so the texel is read as it is -- straight alpha, no fringe to undo -- and most
   of each leaf's own lightness, fold, veins and warm/cool turn is multiplied into the species' palette,
   which still gives the tree its green and its autumn. */
export const REALISTIC_LEAVES=Object.freeze({mean:.75,share:.85,bias:-.6});
export function realisticLeafPigment(texel){
  return mix(vec3(1),texel.rgb.div(REALISTIC_LEAVES.mean),REALISTIC_LEAVES.share);
}

// The shadow pass cuts the cards at the atlas's own resolution. With the
// atlas as `map`, three tested its MIPMAPPED alpha there, at the mip the
// shadow map's texel picks, so a card averaged under half opacity dropped
// out: in the 850 m box a crown kept on average three quarters of its shadow
// on a desktop's map and under two thirds on a phone's (as little as 38 %),
// so shadows faded as the camera pulled back (docs/tree-shadows-zoom.md). The
// colour pass never read `map` -- colorNode and opacityNode replace it -- so
// it is unchanged. mipShadow (?foliageshadow=mip) is the before.
//
// THE CARDS' CUT, THROUGH THE SAMPLES. The colour pass cut the cards with a
// hard alpha test at 0.5: each pixel all leaf or all sky, which MSAA does not
// smooth, so as the camera moved every sub-pixel gap and edge of a crown
// flipped, and the crowns sparkled against the bright sky -- the sparkle the
// owner saw moving the camera (docs/tree-sparkle-2026-09-28.md). With
// `coverage` the same cut chooses the pixel's MSAA samples, as the impostors'
// already does (msaa-coverage.mjs), centred on 0.5 so a crown keeps its area.
// The shadow pass keeps its own cut (maskShadowNode, and the 0.5 it copies).
// coverage=false (?crowncoverage=0) is the before.
/* THE CANOPY'S BANDS, PER PIXEL (3 November). Reckoned per vertex, a few vertices of the hero
   pine and spruce crowns came out unbounded in a low sun's direction, and the glow spread
   each of their triangles into a green orb in the trees (Veckefjärden's 13th under the
   midnight sun). Per pixel, from the same per-vertex noise, they stay in their range: a few
   smoothsteps a crown pixel. ?canopybands=vertex is the before. */
export function makeGhibliFoliageMaterial({key,map=null,sunDirection,tint,autumn,seed,lighting=foliageLight,noisePerPixel=false,mipShadow=false,backLight=true,sunlit=null,coverage=true,canopy=false,bandsPerVertex=false,realistic=false}){
  /* the realistic crowns are lit as a volume, without the painted canopy's bands */
  if(realistic)canopy=false;
  const m=new MeshBasicNodeMaterial({vertexColors:true,side:DoubleSide});
  /* the crown-depth bake's openness rides in the vertex colours the material already multiplies */
  m.colorNode=paintedFoliageColour({key,normal:normalWorldGeometry,sunDirection,position:positionLocal,tint,autumn,seed,lighting,noisePerPixel,
    backLight:backLight?foliageBackLight({normal:normalWorldGeometry,sunDirection}):null,sunlit,
    canopy,openness:canopy?vertexColor().r:null,perVertex:canopy&&!noisePerPixel&&bandsPerVertex});
  if(map){
    /* the realistic sprigs are read half a mip sharper: their leaves blurred into streaks at the
       distance a crown is seen from, and the temporal AA steadies what the sharper mip adds */
    const texel=realistic?texture(map).bias(REALISTIC_LEAVES.bias):texture(map);
    m.colorNode=m.colorNode.mul(foliageSurfacePigment(texel,realistic));m.opacityNode=texel.a;
    m.alphaTest=.5;
    if(coverage){coverOpaqueBackdrop(m);m.alphaTestNode=centredCoverageCut(texel.a,m.alphaTest);}
    else m.alphaToCoverage=false;
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
