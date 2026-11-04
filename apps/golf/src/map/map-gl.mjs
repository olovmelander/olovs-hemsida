/* The map's renderer: raw WebGL2, no engine.

   This is deliberately not the simulator's renderer. A map needs a handful of
   materials and no post, so three.js would be most of the download and none of
   the picture. But it draws the same world: the same 1 m heights, and the same
   trees, as the billboards of the simulator's own impostors (see
   engine/tree-impostor.mjs, whose mapping the tree shaders here must keep to).

   One frame, in order:
   - the ground: one shared grid per patch, moved by each tile's height texture.
     The mesh only carries the silhouette; light, contours and surface read every
     1 m sample per pixel, so it stays a few tens of thousands of triangles;
   - the shadows: every tree and building flattened along the sun onto the ground.
     Stencil lets each pixel darken once, so a wood's shadows join instead of
     stacking up into black;
   - buildings, then trees, then the sky behind what is left. */
import { SLOPE_LIMIT } from './map-height.mjs';
import { SHADE_SIZE } from './map-horizon.mjs';
import { PATCH_GRIDS, TILE_SAMPLES, TILE_SEGMENTS } from './map-lod.mjs';

const GROUND_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aGrid;
uniform mat4 uClip;
uniform vec3 uPatch;      /* world x, z and size of this patch */
uniform vec3 uRange;      /* u, v and span of this patch in its tile */
uniform vec2 uHeight;     /* the tile's height base, its skirt's depth */
uniform float uExaggeration;
uniform sampler2D uHeights;
out vec2 vUv;
out vec2 vSample;
out vec3 vWorld;
out vec3 vShown;
void main() {
  vec2 uv = uRange.xy + aGrid.xy * uRange.z;
  vec2 st = (uv * ${TILE_SEGMENTS}.0 + 0.5) / ${TILE_SAMPLES}.0;
  float ground = textureLod(uHeights, st, 0.0).r + uHeight.x;
  vec3 world = vec3(uPatch.x + aGrid.x * uPatch.z,
                    ground * uExaggeration - aGrid.z * uHeight.y,
                    uPatch.y + aGrid.y * uPatch.z);
  vUv = uv;
  vSample = st;
  vWorld = vec3(world.x, ground, world.z);
  vShown = world;
  gl_Position = uClip * vec4(world, 1.0);
}`;

const GROUND_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
in vec2 vSample;
in vec3 vWorld;
in vec3 vShown;
uniform sampler2D uPaint;
uniform sampler2D uMask;     /* water, mown turf, sand; all three is forest */
uniform sampler2D uRelief;
uniform sampler2D uHeights;
uniform sampler2D uDetail;
uniform float uBaseHeight;
uniform vec3 uSun;
uniform vec3 uFill;
uniform float uSlopeGain;
uniform vec3 uEye;
uniform vec2 uFog;
uniform vec3 uHaze;
uniform vec3 uZenith;
uniform vec3 uContour;    /* interval, strength, index every Nth */
uniform vec2 uTint;       /* the course's height range, for the broad tint */
uniform vec4 uShading;    /* darkest, brightest, near relief, broad relief */
uniform float uCloseness; /* 0 from afar, 1 close enough to see the turf */
uniform vec3 uGrade;      /* the light's exposure and colour */
uniform vec3 uWarm;       /* what sunlit ground takes on */
uniform vec3 uCool;       /* and shaded ground */
uniform float uSunShare;  /* how much of the shaping light is direct sun */
uniform vec2 uCloud;      /* how much sky is cloud, how much sun its shade takes */
uniform vec3 uWaterNear;
uniform vec3 uWaterFar;
uniform float uSaturation;
uniform float uAutumn;
uniform float uDormant;
uniform float uSnow;
uniform float uIce;
uniform sampler2D uHillShade;
uniform float uHillDark;  /* how much sun a hill's shadow takes; 0 for a high sun */
out vec4 colour;

const float SLOPE_LIMIT = ${SLOPE_LIMIT.toFixed(1)};

void main() {
  vec3 ground = texture(uPaint, vUv).rgb;
  vec3 kind = texture(uMask, vUv).rgb;
  vec4 baked = texture(uRelief, vSample);
  vec4 fine = texture(uDetail, vWorld.xz / 21.0);
  vec4 broad = texture(uDetail, vWorld.xz / 187.0);
  float blades = texture(uDetail, vWorld.xz / 4.7).r;

  /* White is forest. The classes stay separate through the texture's filtering,
     because a blend of two pure colours is still a sum of the two. */
  float forest = min(kind.r, min(kind.g, kind.b));
  float water = kind.r - forest;
  float turf = (kind.g - forest) * (1.0 - water), sand = (kind.b - forest) * (1.0 - water);
  float wild = max(1.0 - water - turf - sand - forest, 0.0);

  /* The surface itself: rough in clumps, mown turf nearly even, sand grained. */
  ground *= 1.0
    + wild * ((broad.g - 0.5) * 0.13 + ((fine.g - 0.5) * 0.3 + (blades - 0.5) * 0.28) * uCloseness)
    + turf * ((broad.b - 0.5) * 0.04 + (blades - 0.5) * 0.09 * uCloseness)
    + sand * (blades - 0.5) * 0.08 * uCloseness;

  /* The seasons: broadleaves turn in stands, the rough goes to straw. */
  if (uAutumn > 0.0) {
    float stand = smoothstep(0.42, 0.6, broad.g + (fine.g - 0.5) * 0.3);
    ground = mix(ground, ground * vec3(1.9, 1.16, 0.5), forest * stand * uAutumn * 0.62);
    ground = mix(ground, ground * vec3(1.13, 1.02, 0.8), wild * uAutumn * 0.42);
  }
  if (uDormant > 0.0) {
    float grey = dot(ground, vec3(0.3, 0.59, 0.11));
    vec3 straw = grey * vec3(1.12, 1.0, 0.72);
    ground = mix(ground, straw, (wild * 0.62 + turf * 0.3) * uDormant);
  }

  /* Snow settles over everything, thinnest under the trees, and leaves the course
     just visible beneath it: a map still has to show where the fairway is. */
  if (uSnow > 0.0) {
    float settled = uSnow * (wild * 0.97 + turf * 0.72 + sand * 0.9 + forest * 0.52);
    ground = mix(ground, vec3(0.92, 0.95, 0.99) * (1.0 + (broad.g - 0.5) * 0.05), settled);
  }

  vec2 e = baked.rg * 2.0 - 1.0;
  vec2 slope = sign(e) * e * e * SLOPE_LIMIT * uSlopeGain;
  vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));

  /* Level ground keeps its colour exactly: the light only ever departs from it,
     so a green is the same green on every hole. The fill comes from the top left
     of the screen and turns with the map, so slopes still read when the sun is
     behind the view. */
  float lit = (dot(normal, uSun) - uSun.y) * 1.25 * uSunShare + (dot(normal, uFill) - uFill.y) * 0.5;
  /* Sand is bright and takes less from the light than grass does: a bunker's
     face should read as a slope, not as a grey stain. */
  float shade = 1.0 + clamp(lit, uShading.x, uShading.y) * (1.0 - 0.45 * sand);

  /* Hollows hold shade and crests catch light, near and broad. */
  shade *= 1.0 + (baked.b - 0.5) * -uShading.z + (baked.a - 0.5) * -uShading.w;

  /* A little more light higher up, which reads as height from any distance. */
  float rise = clamp((vWorld.y - uTint.x) / max(uTint.y - uTint.x, 1.0), 0.0, 1.0);
  shade *= 0.95 + 0.1 * rise;

  /* The shadow of the land itself, when the sun is low enough to throw one. */
  if (uHillDark > 0.0) {
    float lit = texture(uHillShade, (vUv * ${SHADE_SIZE - 1}.0 + 0.5) / ${SHADE_SIZE}.0).r;
    shade *= 1.0 - (1.0 - lit) * uHillDark;
  }

  /* Cloud shade drifting over the land, the largest scale the eye reads as air. */
  if (uCloud.y > 0.0) {
    float cloud = smoothstep(0.62 - uCloud.x, 0.84 - uCloud.x, texture(uDetail, vWorld.xz / 2600.0).g);
    shade *= 1.0 - cloud * uCloud.y * 0.34;
  }

  vec3 shown = ground * shade;
  /* Sunlit ground warms and shaded ground cools, as it does outdoors. */
  shown *= mix(uWarm, uCool, clamp(0.5 + (1.0 - shade) * 1.8, 0.0, 1.0)) * uGrade;

  if (water > 0.01) {
    vec3 toEye = normalize(uEye - vShown);
    vec2 ripple = (fine.ab - 0.5) * 0.09 + (broad.ab - 0.5) * 0.05;
    vec3 surface = normalize(vec3(ripple.x, 1.0, ripple.y));
    float facing = 1.0 - max(dot(surface, toEye), 0.0);
    float fresnel = 0.03 + 0.97 * facing * facing * facing * facing * facing;
    vec3 reflected = reflect(-toEye, surface);
    vec3 sky = mix(uHaze, uZenith, pow(clamp(reflected.y, 0.0, 1.0), 0.65));
    float glint = pow(max(dot(reflected, uSun), 0.0), 260.0) * 1.2;
    /* How far from the shore, read off a wide mip of the mask: shallows run teal
       and the open water deep. */
    vec3 wide = textureLod(uMask, vUv, 4.0).rgb;
    float open = smoothstep(0.45, 0.98, wide.r - min(wide.g, wide.b));
    vec3 body = mix(uWaterNear, uWaterFar, open);
    vec3 open_water = mix(body, sky, clamp(fresnel * 1.6 + 0.16, 0.0, 1.0)) + glint;
    /* A lake frozen and snowed over; the sea stays open. */
    vec3 ice = mix(vec3(0.8, 0.87, 0.93), vec3(0.93, 0.95, 0.98), broad.g) * shade;
    shown = mix(shown, mix(open_water, ice, uIce), clamp(water * 1.4, 0.0, 1.0));
  }

  float height = texture(uHeights, vSample).r + uBaseHeight;
  float level = height / uContour.x;
  float across = fwidth(level);
  /* Wide enough on a dense screen to stay a line instead of breaking into dots. */
  float line = 1.0 - smoothstep(0.9, 2.0, abs(fract(level - 0.5) - 0.5) / max(across, 1e-5));
  /* Contours thin out rather than fill in where the ground is too steep for
     the eye to separate them. */
  float room = 1.0 - smoothstep(0.16, 0.34, across);
  float major = 1.0 - step(0.5 / uContour.z, abs(fract(level / uContour.z - 0.5 / uContour.z + 0.5) - 0.5));
  shown = mix(shown, shown * 0.66, (1.0 - water) * line * room * uContour.y * (0.55 + 0.45 * major));

  float reach = length(vShown.xz - uEye.xz);
  float fog = smoothstep(uFog.x, uFog.y, reach);
  /* Blue scatters first, so distance goes blue before it goes pale. */
  shown = mix(shown, uHaze, pow(vec3(fog), vec3(1.5, 1.2, 0.9)));
  shown = mix(vec3(dot(shown, vec3(0.3, 0.59, 0.11))), shown, uSaturation);
  colour = vec4(shown, 1.0);
}`;

const SKY_VERTEX = `#version 300 es
out vec2 vClip;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 2.0 - 1.0;
  vClip = p;
  gl_Position = vec4(p, 1.0, 1.0);
}`;
const SKY_FRAGMENT = `#version 300 es
precision mediump float;
in vec2 vClip;
uniform vec3 uHaze;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform sampler2D uDetail;
uniform vec2 uClouds;     /* how much cloud, how far the map has turned */
out vec4 colour;
void main() {
  float up = clamp(vClip.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 sky = mix(uHorizon, uZenith, up * up);
  /* Soft clouds near the horizon, turning with the view. */
  vec2 place = vec2(vClip.x * 0.22 + uClouds.y, 0.2 + up * 0.46);
  float cloud = smoothstep(0.5, 0.74, texture(uDetail, place).g) * uClouds.x;
  sky = mix(sky, mix(uHaze, vec3(1.0), 0.7), cloud * (1.0 - up * up));
  colour = vec4(sky, 1.0);
}`;

/* The impostor's mapping, in GLSL. engine/tree-impostor.mjs holds it in JS and TSL;
   these must keep to it, and map.test.mjs holds the JS and this file together. */
const IMPOSTOR_COMMON = `
const float FRAMES = 8.0;
void viewBasis(vec3 v, out vec3 right, out vec3 up) {
  float a = 1.0 / max(v.y + 1.0, 1e-4);
  right = vec3(1.0 - v.x * v.x * a, -v.x, -v.x * v.z * a);
  up = vec3(v.x * v.z * a, v.z, v.z * v.z * a - 1.0);
}
vec3 turnBack(vec3 v, float c, float s) { return vec3(v.x * c - v.z * s, v.y, v.x * s + v.z * c); }
vec3 frameDirection(vec2 frame) {
  vec2 t = frame / (FRAMES - 1.0) * 2.0 - 1.0;
  float x = (t.x - t.y) * 0.5, z = (t.x + t.y) * 0.5;
  return normalize(vec3(x, max(1.0 - abs(x) - abs(z), 0.0), z));
}
vec2 inFrame(vec2 frame, vec3 local, float radius) {
  vec3 right, up;
  viewBasis(frameDirection(frame), right, up);
  return vec2(dot(local, right), dot(local, up)) / (2.0 * radius) + 0.5;
}
vec2 gridOf(vec3 local) {
  float l1 = max(abs(local.x) + abs(local.y) + abs(local.z), 1e-6);
  float px = local.x / l1, pz = local.z / l1;
  return clamp(vec2(px + pz, pz - px) * 0.5 + 0.5, 0.0, 1.0) * (FRAMES - 1.0);
}`;

const TREE_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aTree;    /* x, ground, z, yaw */
layout(location = 2) in vec4 aSize;    /* crown scale, height scale, species layer, tone */
uniform mat4 uClip;
uniform float uExaggeration;
uniform vec3 uEye;
uniform vec2 uFade;
uniform vec2 uFog;
uniform vec3 uShapes[6];               /* radius, centre, height of each layer */
${IMPOSTOR_COMMON}
out vec4 vFramesAB;
out vec4 vFrameCDominant;
out vec4 vUvAB;
out vec2 vUvC;
out vec3 vWeights;
out vec4 vTree;                        /* layer, tone, cos yaw, sin yaw */
out vec2 vLevel;                       /* how far up the tree, how far away */
void main() {
  vec3 shape = uShapes[int(aSize.z)];
  float reach = distance(vec2(aTree.x, aTree.z), uEye.xz);
  /* Trees sink into the painted canopy before the 1 m tiles end. */
  float grown = 1.0 - smoothstep(uFade.x, uFade.y, reach);
  vec3 scale = vec3(aSize.x, aSize.y, aSize.x) * max(grown, 0.0001);
  vec3 base = vec3(aTree.x, aTree.y * uExaggeration, aTree.z);
  vec3 centre = base + vec3(0.0, shape.y * scale.y, 0.0);
  vec3 view = normalize(uEye - centre);
  vec3 right, up;
  viewBasis(view, right, up);
  float halfW = length(right * scale) * shape.x, halfH = length(up * scale) * shape.x;
  vec3 offset = right * (aCorner.x * halfW * 2.0) + up * (aCorner.y * halfH * 2.0);
  vec3 world = centre + offset;

  float c = cos(aTree.w), s = sin(aTree.w);
  vec3 local = normalize(turnBack(view, c, s) / scale);
  vec3 localOffset = turnBack(offset, c, s) / scale;
  vec2 grid = clamp(gridOf(local), 0.0, FRAMES - 1.0 - 1e-4);
  vec2 i0 = floor(grid), f = grid - i0;
  bool lower = f.x + f.y <= 1.0;
  vec2 frameA = i0 + (lower ? 0.0 : 1.0), frameB = vec2(i0.x + 1.0, i0.y), frameC = vec2(i0.x, i0.y + 1.0);
  vec3 weights = lower ? vec3(1.0 - f.x - f.y, f.x, f.y) : vec3(f.x + f.y - 1.0, 1.0 - f.y, 1.0 - f.x);
  vFramesAB = vec4(frameA, frameB);
  vFrameCDominant = vec4(frameC, weights.x >= weights.y && weights.x >= weights.z ? frameA : weights.y >= weights.z ? frameB : frameC);
  vUvAB = vec4(inFrame(frameA, localOffset, shape.x), inFrame(frameB, localOffset, shape.x));
  vUvC = inFrame(frameC, localOffset, shape.x);
  vWeights = weights;
  vTree = vec4(aSize.z, aSize.w, c, s);
  vLevel = vec2(clamp((world.y - base.y) / max(shape.z * scale.y, 0.01), 0.0, 1.0), smoothstep(uFog.x, uFog.y, reach));
  gl_Position = uClip * vec4(world, 1.0);
}`;

const TREE_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec4 vFramesAB;
in vec4 vFrameCDominant;
in vec4 vUvAB;
in vec2 vUvC;
in vec3 vWeights;
in vec4 vTree;
in vec2 vLevel;
uniform sampler2DArray uColours;
uniform sampler2DArray uNormals;
uniform vec3 uSun;
uniform vec3 uHaze;
uniform vec3 uSunLight;
uniform vec3 uSkyLight;
uniform float uAutumn;
uniform float uBare;
uniform float uSnow;
uniform vec3 uRamps[27];
uniform vec2 uBreaks[3];
uniform float uSaturation;
out vec4 colour;
const float FRAMES = 8.0;
vec4 picture(sampler2DArray atlas, vec2 frame, vec2 p) {
  if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) return vec4(0.0);
  return texture(atlas, vec3((frame + clamp(p, 0.004, 0.996)) / FRAMES, vTree.x));
}
void main() {
  vec4 albedo = picture(uColours, vFramesAB.xy, vUvAB.xy) * vWeights.x
              + picture(uColours, vFramesAB.zw, vUvAB.zw) * vWeights.y
              + picture(uColours, vFrameCDominant.xy, vUvC) * vWeights.z;
  float coverage = albedo.a;
  /* Cut through the MSAA samples: a hard alpha test keeps or drops whole pixels,
     which is what makes a crown sparkle against the ground as the map moves. */
  float cut = clamp((coverage - 0.42) / max(fwidth(coverage), 0.0001) + 0.5, 0.0, 1.0);
  if (cut <= 0.0) discard;
  vec3 skin = albedo.rgb / max(coverage, 0.001);

  vec2 dominant = vFrameCDominant.zw == vFramesAB.xy ? vUvAB.xy : vFrameCDominant.zw == vFramesAB.zw ? vUvAB.zw : vUvC;
  vec3 local = picture(uNormals, vFrameCDominant.zw, dominant).rgb * 2.0 - 1.0;
  float c = vTree.z, s = vTree.w;
  vec3 normal = normalize(vec3(local.x * c + local.z * s, local.y, -local.x * s + local.z * c));

  /* Sunlit needles are warm and the crown's far side takes the sky. */
  /* A bare broadleaf keeps its trunk, and its crown thins to a grey haze of twigs:
     the same outline at a fraction of the coverage, which the MSAA samples turn
     into something see-through. Leaves are told from bark by their green. */
  if (uBare > 0.0 && vTree.x > 1.5) {
    float leaf = smoothstep(0.0, 0.05, skin.g - skin.b);
    cut *= 1.0 - leaf * uBare * 0.68;
    skin = mix(skin, vec3(0.3, 0.26, 0.23), leaf * uBare);
  }

  /* Broadleaves turn by the simulator's own ramps. A birch's white trunk has no
     green in it and keeps its colour. */
  if (uAutumn > 0.0 && vTree.x > 1.5) {
    int family = vTree.x < 2.5 ? 0 : vTree.x < 3.5 ? 2 : 1;
    vec2 breaks = uBreaks[family];
    int ramp = vTree.y < breaks.x ? 0 : vTree.y < breaks.y ? 1 : 2;
    vec3 c0 = uRamps[family * 9 + ramp * 3], c1 = uRamps[family * 9 + ramp * 3 + 1], c2 = uRamps[family * 9 + ramp * 3 + 2];
    float level = clamp(dot(skin, vec3(0.3, 0.59, 0.11)) * 1.9, 0.0, 1.0);
    vec3 turned = level < 0.5 ? mix(c0, c1, level * 2.0) : mix(c1, c2, level * 2.0 - 1.0);
    skin = mix(skin, turned, uAutumn * smoothstep(0.0, 0.05, skin.g - skin.b));
  }

  /* Snow lies on what faces the sky. */
  if (uSnow > 0.0 && vTree.x < 1.5) skin = mix(skin, vec3(0.9, 0.93, 0.97), uSnow * 0.62 * smoothstep(0.25, 0.85, normal.y));

  float sun = clamp(dot(normal, uSun) * 0.62 + 0.42, 0.0, 1.0);
  vec3 light = mix(uSkyLight, uSunLight, sun);
  /* A stand's lower crowns sit in each other's shade. */
  light *= mix(0.66, 1.08, smoothstep(0.08, 0.72, vLevel.x));
  vec3 tone = mix(vec3(0.9, 0.95, 0.84), vec3(1.1, 1.06, 0.94), vTree.y);
  vec3 lit = skin * tone * light;
  vec3 shown = mix(lit, uHaze, vLevel.y * vLevel.y);
  colour = vec4(mix(vec3(dot(shown, vec3(0.3, 0.59, 0.11))), shown, uSaturation), cut);
}`;

/* A tree's shadow is its picture as the sun sees it, laid along the sun's rays. */
const SHADOW_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aTree;
layout(location = 2) in vec4 aSize;
uniform mat4 uClip;
uniform float uExaggeration;
uniform vec3 uEye;
uniform vec2 uFade;
uniform vec3 uSun;
uniform vec3 uShapes[6];
${IMPOSTOR_COMMON}
out vec2 vUv;
flat out float vLayer;
void main() {
  vec3 shape = uShapes[int(aSize.z)];
  float reach = distance(vec2(aTree.x, aTree.z), uEye.xz);
  float grown = 1.0 - smoothstep(uFade.x, uFade.y, reach);
  vec3 scale = vec3(aSize.x, aSize.y, aSize.x) * max(grown, 0.0001);
  vec3 base = vec3(aTree.x, aTree.y * uExaggeration, aTree.z);
  vec3 centre = base + vec3(0.0, shape.y * scale.y, 0.0);
  vec3 right, up;
  viewBasis(uSun, right, up);
  float halfW = length(right * scale) * shape.x, halfH = length(up * scale) * shape.x;
  vec3 offset = right * (aCorner.x * halfW * 2.0) + up * (aCorner.y * halfH * 2.0);
  vec3 world = centre + offset;
  vec3 ground = world - uSun * ((world.y - base.y) / uSun.y);

  float c = cos(aTree.w), s = sin(aTree.w);
  vec3 local = normalize(turnBack(uSun, c, s) / scale);
  vec3 localOffset = turnBack(offset, c, s) / scale;
  vec2 frame = floor(clamp(gridOf(local), 0.0, FRAMES - 1.0) + 0.5);
  vec2 p = inFrame(frame, localOffset, shape.x);
  vUv = (frame + clamp(p, 0.004, 0.996)) / FRAMES;
  vLayer = aSize.z;
  gl_Position = uClip * vec4(ground, 1.0);
}`;
const SHADOW_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 vUv;
flat in float vLayer;
uniform sampler2DArray uColours;
uniform vec3 uShadow;
uniform float uBare;
out vec4 colour;
void main() {
  /* A bare tree throws little more than its trunk. */
  if (vLayer > 1.5 && uBare > 0.5) discard;
  /* A shadow is softer than the leaves that cast it, so it reads a mip above the
     crown, and its edge goes through the MSAA samples as a crown's does. */
  float cover = texture(uColours, vec3(vUv, vLayer), 0.8).a;
  float cut = clamp((cover - 0.3) / max(fwidth(cover), 0.0001) + 0.5, 0.0, 1.0);
  if (cut <= 0.0) discard;
  colour = vec4(uShadow, cut);
}`;

/* The dark at a tree's foot, whichever way the sun falls: what stands it on the
   ground instead of floating over it. */
const CONTACT_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aTree;
layout(location = 2) in vec4 aSize;
uniform mat4 uClip;
uniform float uExaggeration;
uniform vec3 uEye;
uniform vec2 uFade;
uniform vec3 uShapes[6];
out vec2 vSpot;
void main() {
  float reach = distance(vec2(aTree.x, aTree.z), uEye.xz);
  float grown = 1.0 - smoothstep(uFade.x, uFade.y, reach);
  float size = uShapes[int(aSize.z)].x * aSize.x * 1.15 * max(grown, 0.0001);
  vec3 place = vec3(aTree.x + aCorner.x * size, aTree.y * uExaggeration, aTree.z + aCorner.y * size);
  vSpot = aCorner * 2.0;
  gl_Position = uClip * vec4(place, 1.0);
}`;
const CONTACT_FRAGMENT = `#version 300 es
precision mediump float;
in vec2 vSpot;
out vec4 colour;
void main() {
  float d = dot(vSpot, vSpot);
  if (d >= 1.0) discard;
  float dark = (1.0 - d) * (1.0 - d);
  colour = vec4(mix(vec3(1.0), vec3(0.62, 0.68, 0.66), dark), 1.0);
}`;

const HOUSE_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPlace;    /* x, height above its ground, z */
layout(location = 1) in float aGround;
layout(location = 2) in vec3 aNormal;
layout(location = 3) in vec3 aColour;
uniform mat4 uClip;
uniform float uExaggeration;
uniform vec3 uEye;
uniform vec2 uFade;
uniform vec2 uFog;
uniform vec3 uSun;
uniform vec3 uHaze;
uniform vec3 uSunLight;
uniform vec3 uSkyLight;
out vec3 vColour;
void main() {
  float reach = distance(aPlace.xz, uEye.xz);
  float grown = 1.0 - smoothstep(uFade.x, uFade.y, reach);
  vec3 world = vec3(aPlace.x, aGround * uExaggeration + aPlace.y * grown, aPlace.z);
  float sun = max(dot(aNormal, uSun), 0.0);
  vec3 lit = aColour * (uSkyLight + uSunLight * 0.56 * sun);
  float fog = smoothstep(uFog.x, uFog.y, reach);
  vColour = mix(lit, uHaze, fog * fog);
  gl_Position = uClip * vec4(world, 1.0);
}`;
const HOUSE_FRAGMENT = `#version 300 es
precision mediump float;
in vec3 vColour;
out vec4 colour;
void main() { colour = vec4(vColour, 1.0); }`;

const HOUSE_SHADOW_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPlace;
layout(location = 1) in float aGround;
uniform mat4 uClip;
uniform float uExaggeration;
uniform vec3 uSun;
void main() {
  vec3 world = vec3(aPlace.x, aGround * uExaggeration + aPlace.y, aPlace.z);
  gl_Position = uClip * vec4(world - uSun * (aPlace.y / uSun.y), 1.0);
}`;
const HOUSE_SHADOW_FRAGMENT = `#version 300 es
precision mediump float;
uniform vec3 uShadow;
out vec4 colour;
void main() { colour = vec4(uShadow, 1.0); }`;

function compile(gl, vertex, fragment) {
  const program = gl.createProgram();
  for (const [kind, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
    const shader = gl.createShader(kind);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(`map shader: ${gl.getShaderInfoLog(shader)}`);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`map program: ${gl.getProgramInfoLog(program)}`);
  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const { name } = gl.getActiveUniform(program, i);
    uniforms[name.replace('[0]', '')] = gl.getUniformLocation(program, name);
  }
  return { program, u: uniforms };
}

/* A square of n x n quads plus a skirt: the edge repeated and dropped, which
   closes the crack where two patches of different density meet. */
function createGrid(gl, n) {
  const side = n + 1, inner = side * side, vertices = new Float32Array((inner + 4 * side) * 3);
  let v = 0;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    vertices[v++] = i / n; vertices[v++] = j / n; vertices[v++] = 0;
  }
  const indices = [];
  const quad = (a, b, c, d) => indices.push(a, c, b, b, c, d);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * side + i;
    quad(a, a + 1, a + side, a + side + 1);
  }
  let next = inner;
  const edge = at => {
    const start = next;
    for (let i = 0; i <= n; i++) {
      const [x, y] = at(i);
      vertices[v++] = x / n; vertices[v++] = y / n; vertices[v++] = 1;
      next++;
      if (i) {
        const [px, py] = at(i - 1);
        quad(py * side + px, y * side + x, start + i - 1, start + i);
      }
    }
  };
  edge(i => [i, 0]);
  edge(i => [i, n]);
  edge(i => [0, i]);
  edge(i => [n, i]);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: indices.length };
}

export function createMapRenderer(canvas, { onLost, onRestored } = {}) {
  const options = { alpha: false, antialias: true, depth: true, stencil: true, preserveDrawingBuffer: false };
  const gl = canvas.getContext('webgl2', options);
  if (!gl) throw new Error('den här webbläsaren saknar WebGL2');

  let ground, sky, tree, shadow, contact, house, houseShadow, grids, anisotropy, anisotropyLimit, cornerBuffer, detailTexture;
  let atlases = null, atlasSource = null, detailSource = null, noShade = null;

  function texture(unit, internal, width, height, filter, levels = 1) {
    const handle = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, handle);
    gl.texStorage2D(gl.TEXTURE_2D, levels, internal, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    return handle;
  }

  /* A white pixel: every tile's hill shade until it has one of its own. */
  function whiteTexture() {
    const handle = gl.createTexture();
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, handle);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return handle;
  }

  function uploadDetail({ pixels, size }) {
    detailSource = { pixels, size };
    detailTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, detailTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (anisotropy) gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, anisotropyLimit);
  }

  function arrayTexture(unit, images, premultiplied) {
    const handle = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, handle);
    const { width, height } = images[0];
    const levels = 1 + Math.floor(Math.log2(Math.max(width, height)));
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.RGBA8, width, height, images.length);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiplied);
    images.forEach((image, layer) => {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, width, height, 1, gl.RGBA, gl.UNSIGNED_BYTE, image);
    });
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return handle;
  }

  function uploadAtlases(source) {
    atlasSource = source;
    atlases = {
      colours: arrayTexture(5, source.colours, true),
      normals: arrayTexture(6, source.normals, false),
      shapes: new Float32Array(source.shapes.flat()),
    };
  }

  function build() {
    ground = compile(gl, GROUND_VERTEX, GROUND_FRAGMENT);
    sky = compile(gl, SKY_VERTEX, SKY_FRAGMENT);
    tree = compile(gl, TREE_VERTEX, TREE_FRAGMENT);
    shadow = compile(gl, SHADOW_VERTEX, SHADOW_FRAGMENT);
    contact = compile(gl, CONTACT_VERTEX, CONTACT_FRAGMENT);
    house = compile(gl, HOUSE_VERTEX, HOUSE_FRAGMENT);
    houseShadow = compile(gl, HOUSE_SHADOW_VERTEX, HOUSE_SHADOW_FRAGMENT);
    grids = new Map(PATCH_GRIDS.map(n => [n, createGrid(gl, n)]));
    cornerBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
    anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
    anisotropyLimit = anisotropy ? Math.min(8, gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) : 1;
    gl.useProgram(ground.program);
    gl.uniform1i(ground.u.uPaint, 0);
    gl.uniform1i(ground.u.uRelief, 1);
    gl.uniform1i(ground.u.uHeights, 2);
    gl.uniform1i(ground.u.uMask, 3);
    gl.uniform1i(ground.u.uDetail, 4);
    gl.uniform1i(ground.u.uHillShade, 7);
    gl.useProgram(tree.program);
    gl.uniform1i(tree.u.uColours, 5);
    gl.uniform1i(tree.u.uNormals, 6);
    gl.useProgram(shadow.program);
    gl.uniform1i(shadow.u.uColours, 5);
    gl.useProgram(sky.program);
    gl.uniform1i(sky.u.uDetail, 4);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0.7, 0.84, 0.9, 1);
    atlases = null;
    detailTexture = null;
    noShade = whiteTexture();
    if (detailSource) uploadDetail(detailSource);
    if (atlasSource) uploadAtlases(atlasSource);
  }

  build();
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); onLost?.(); });
  canvas.addEventListener('webglcontextrestored', () => { build(); onRestored?.(); });

  function instanceVao(buffer) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    return vao;
  }

  function houseVao(buffer) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 40, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 40, 16);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 40, 28);
    gl.bindVertexArray(null);
    return vao;
  }

  const setShared = (program, view) => {
    gl.useProgram(program.program);
    const u = program.u;
    gl.uniformMatrix4fv(u.uClip, false, view.clip);
    if (u.uExaggeration) gl.uniform1f(u.uExaggeration, view.exaggeration);
    if (u.uEye) gl.uniform3fv(u.uEye, view.eye);
    if (u.uSun) gl.uniform3fv(u.uSun, view.sun);
    if (u.uHaze) gl.uniform3fv(u.uHaze, view.haze);
    if (u.uFog) gl.uniform2f(u.uFog, view.fog[0], view.fog[1]);
    if (u.uFade) gl.uniform2f(u.uFade, view.treeFade[0], view.treeFade[1]);
    if (u.uShadow) gl.uniform3fv(u.uShadow, view.shadow);
    if (u.uShapes && atlases) gl.uniform3fv(u.uShapes, atlases.shapes);
    if (u.uSunLight) gl.uniform3fv(u.uSunLight, view.treeSun);
    if (u.uSkyLight) gl.uniform3fv(u.uSkyLight, view.treeSky);
    if (u.uAutumn) gl.uniform1f(u.uAutumn, view.autumn);
    if (u.uBare) gl.uniform1f(u.uBare, view.bare);
    if (u.uSnow) gl.uniform1f(u.uSnow, view.snow);
    if (u.uSaturation) gl.uniform1f(u.uSaturation, view.saturation);
    if (u.uRamps) {
      gl.uniform3fv(u.uRamps, view.ramps.colours);
      gl.uniform2fv(u.uBreaks, view.ramps.breaks);
    }
  };

  return {
    gl,
    uploadDetail,
    uploadAtlases,
    resize(width, height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    },

    uploadTile(node, decoded, relief, paint) {
      const { width, height, heights, min } = decoded;
      const relative = new Float32Array(heights.length);
      for (let i = 0; i < heights.length; i++) relative[i] = heights[i] - min;

      const heightTexture = texture(2, gl.R16F, width, height, gl.LINEAR);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED, gl.FLOAT, relative);

      const reliefTexture = texture(1, gl.RGBA8, width, height, gl.LINEAR);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, relief);

      const mips = image => 1 + Math.floor(Math.log2(image.width));
      const paintTexture = texture(0, gl.RGBA8, paint.colour.width, paint.colour.height, gl.LINEAR_MIPMAP_LINEAR, mips(paint.colour));
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, paint.colour);
      gl.generateMipmap(gl.TEXTURE_2D);
      if (anisotropy) gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, anisotropyLimit);

      const maskTexture = texture(3, gl.RGBA8, paint.mask.width, paint.mask.height, gl.LINEAR_MIPMAP_LINEAR, mips(paint.mask));
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, paint.mask);
      gl.generateMipmap(gl.TEXTURE_2D);

      node.gpu = { heightTexture, reliefTexture, paintTexture, maskTexture, trees: null, houses: null };
      if (node.trees?.length) {
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, node.trees, gl.STATIC_DRAW);
        node.gpu.trees = { vao: instanceVao(buffer), buffer, count: node.trees.length / 8 };
      }
      if (node.houses?.length) {
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, node.houses, gl.STATIC_DRAW);
        node.gpu.houses = { vao: houseVao(buffer), buffer, count: node.houses.length / 10 };
      }
    },

    uploadShade(node, pixels) {
      if (!node.gpu) return;
      if (!node.gpu.shadeTexture) node.gpu.shadeTexture = texture(7, gl.R8, SHADE_SIZE, SHADE_SIZE, gl.LINEAR);
      gl.activeTexture(gl.TEXTURE7);
      gl.bindTexture(gl.TEXTURE_2D, node.gpu.shadeTexture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SHADE_SIZE, SHADE_SIZE, gl.RED, gl.UNSIGNED_BYTE, pixels);
    },

    releaseTile(node) {
      if (!node.gpu) return;
      for (const handle of [node.gpu.heightTexture, node.gpu.reliefTexture, node.gpu.paintTexture, node.gpu.maskTexture, node.gpu.shadeTexture]) if (handle) gl.deleteTexture(handle);
      for (const set of [node.gpu.trees, node.gpu.houses]) {
        if (!set) continue;
        gl.deleteVertexArray(set.vao);
        gl.deleteBuffer(set.buffer);
      }
      node.gpu = null;
    },

    draw(patches, view) {
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

      setShared(ground, view);
      const u = ground.u;
      gl.uniform3fv(u.uFill, view.fill);
      gl.uniform1f(u.uSlopeGain, view.slopeGain);
      gl.uniform3fv(u.uZenith, view.zenith);
      gl.uniform3fv(u.uContour, view.contour);
      gl.uniform2f(u.uTint, view.tint[0], view.tint[1]);
      gl.uniform4fv(u.uShading, view.shading);
      gl.uniform1f(u.uCloseness, view.closeness);
      gl.uniform3fv(u.uGrade, view.grade);
      gl.uniform3fv(u.uWarm, view.warm);
      gl.uniform3fv(u.uCool, view.cool);
      gl.uniform1f(u.uSunShare, view.sunShare);
      gl.uniform2f(u.uCloud, view.cloud[0], view.cloud[1]);
      gl.uniform3fv(u.uWaterNear, view.waterNear);
      gl.uniform3fv(u.uWaterFar, view.waterFar);
      gl.uniform1f(u.uDormant, view.dormant);
      gl.uniform1f(u.uIce, view.ice);
      gl.uniform1f(u.uHillDark, view.hillDark);
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, detailTexture);

      let triangles = 0, bound = null, boundGrid = null;
      for (const { node, u0, v0, span, grid } of patches) {
        if (node !== bound) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, node.gpu.paintTexture);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, node.gpu.reliefTexture);
          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_2D, node.gpu.heightTexture);
          gl.activeTexture(gl.TEXTURE3);
          gl.bindTexture(gl.TEXTURE_2D, node.gpu.maskTexture);
          gl.activeTexture(gl.TEXTURE7);
          gl.bindTexture(gl.TEXTURE_2D, node.gpu.shadeTexture ?? noShade);
          gl.uniform1f(u.uBaseHeight, node.minHeight);
          bound = node;
        }
        const size = node.size * span;
        gl.uniform3f(u.uPatch, node.x0 + u0 * node.size, node.z0 + v0 * node.size, size);
        gl.uniform3f(u.uRange, u0, v0, span);
        gl.uniform2f(u.uHeight, node.minHeight, Math.max(1.5, size / grid * 0.5) * view.exaggeration);
        const mesh = grids.get(grid);
        if (grid !== boundGrid) { gl.bindVertexArray(mesh.vao); boundGrid = grid; }
        gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
        triangles += mesh.count / 3;
      }

      /* The nearest tiles' trees, as many as the budget holds. Each tile's list is
         shuffled, so a thinner wood far off is the same wood with fewer trees. */
      const planted = new Map();
      for (const { node, reach } of patches) {
        if (!node.gpu.trees && !node.gpu.houses) continue;
        if (reach < view.treeFade[1] && !planted.has(node)) planted.set(node, reach);
      }
      let trees = 0;
      const lists = [];
      if (atlases) {
        for (const [node, reach] of planted) {
          if (!node.gpu.trees) continue;
          const share = 1 - Math.min(1, Math.max(0, reach / view.treeFade[1])) * 0.55;
          const count = Math.min(Math.round(node.gpu.trees.count * share), Math.max(0, view.treeBudget - trees));
          if (!count) break;
          lists.push({ vao: node.gpu.trees.vao, count });
          trees += count;
        }
      }

      /* Shadows sit on the ground, so depth stays out of it: the ground is already
         drawn and the plane under a shadow can dip below a slope. */
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
      gl.enable(gl.STENCIL_TEST);
      gl.stencilFunc(gl.EQUAL, 0, 255);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
      if (lists.length) {
        setShared(contact, view);
        gl.disable(gl.STENCIL_TEST);
        for (const { vao, count } of lists) {
          gl.bindVertexArray(vao);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
        }
        gl.enable(gl.STENCIL_TEST);
        setShared(shadow, view);
        gl.uniform3fv(shadow.u.uSun, view.shadowSun);
        gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
        for (const { vao, count } of lists) {
          gl.bindVertexArray(vao);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
        }
        gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      }
      setShared(houseShadow, view);
      gl.uniform3fv(houseShadow.u.uSun, view.shadowSun);
      for (const node of planted.keys()) {
        if (!node.gpu.houses) continue;
        gl.bindVertexArray(node.gpu.houses.vao);
        gl.drawArrays(gl.TRIANGLES, 0, node.gpu.houses.count);
      }
      gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);

      setShared(house, view);
      for (const node of planted.keys()) {
        if (!node.gpu.houses) continue;
        gl.bindVertexArray(node.gpu.houses.vao);
        gl.drawArrays(gl.TRIANGLES, 0, node.gpu.houses.count);
        triangles += node.gpu.houses.count / 3;
      }

      if (lists.length) {
        setShared(tree, view);
        gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
        for (const { vao, count } of lists) {
          gl.bindVertexArray(vao);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
        }
        gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      }

      gl.useProgram(sky.program);
      gl.uniform3fv(sky.u.uHaze, view.haze);
      gl.uniform3fv(sky.u.uZenith, view.zenith);
      gl.uniform3fv(sky.u.uHorizon, view.horizon);
      gl.uniform2f(sky.u.uClouds, view.skyClouds, view.turn);
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, detailTexture);
      gl.depthMask(false);
      gl.bindVertexArray(null);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.depthMask(true);
      return { triangles: triangles + trees * 2, trees, patches: patches.length };
    },
  };
}
