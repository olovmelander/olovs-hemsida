/* One material for one ground mesh. Polygon-derived surfaces come from the
   runtime atlas; procedural rough/forest colour remains in the terrain's vertex
   colour until that procedural shading is moved to TSL. */

import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, attribute, texture, positionWorld, cameraPosition,
  mix, smoothstep, clamp, pow, abs, sin, normalize, oneMinus, fwidth,
  bumpMap, saturate, step, max, vec4, select,
} from 'three/tsl';
import { SURFACE, surfaceTransitionWidthMetres } from './surface.js';

const MIGRATED = [
  SURFACE.SEMI, SURFACE.FAIRWAY, SURFACE.FRINGE, SURFACE.GREEN,
  SURFACE.TEE, SURFACE.SAND, SURFACE.PATH, SURFACE.ASPHALT,
  SURFACE.GRAVEL, SURFACE.DIRT, SURFACE.MUD, SURFACE.ROCK,
  SURFACE.WETLAND, SURFACE.SHORE,
];
const PREVIEW_NATURAL = [SURFACE.ROUGH, SURFACE.FOREST, SURFACE.HEATH];

const STYLE_WIDTH = 32;
const STYLE_ROWS = 4;

/* Per-class mow phase, rebuilt in the shader from linearly-filtered coordinates:
   [k_sdf, k_route, k_diag] in radians per metre. Greens and collars are cut in
   rings around their own edge (the old overlays' -ringSD * k, which the SDF is),
   tees diagonally in world space, fairway and semi along the route. Storing the
   coordinate and multiplying per fragment is what keeps a 1.5 m green stripe
   crisp in a 1 m raster -- a baked phase byte aliases AND tears at every wrap. */
const MOW_SOURCE = {
  [SURFACE.GREEN]: [4.19, 0, 0],
  [SURFACE.FRINGE]: [2.9, 0, 0],
  [SURFACE.TEE]: [0, 0, 2.86],
  [SURFACE.FAIRWAY]: [0, 0.95, 0],
  [SURFACE.SEMI]: [0, 1.05, 0],
};

/* The overlays this material replaced did NOT shade from the terrain's SHADE
   table -- they carried their own literals in shadeGreen/shadeCollar/shadeSemi,
   and the two disagree. Driving everything from SHADE therefore gave greens
   gloss 0.54 where the mown overlay used 0.42, which reads as a washed-out,
   plasticky putting surface under sun instead of a deep one. These are the
   overlay's own numbers, restored. They live HERE and not in SHADE, because
   SHADE also shades every terrain vertex and the whole mesh path: editing it
   would move pixels far outside the atlas. */
const SHADE_OVERRIDE = {
  [SURFACE.GREEN]: [2.85, 0.13, 0.42, 0.85],
  [SURFACE.FRINGE]: [2.0, 0.30, 0.34, 0.80],
  [SURFACE.SEMI]: [1.15, 0.62, 0.17, 0.45],
};

const HARD_SURFACES = new Set([SURFACE.PATH, SURFACE.ASPHALT, SURFACE.GRAVEL, SURFACE.DIRT, SURFACE.ROCK]);

function classColours(C) {
  return {
    [SURFACE.ROUGH]: C.rough, [SURFACE.FOREST]: C.forest,
    [SURFACE.HEATH]: C.heath,
    [SURFACE.SEMI]: C.semi, [SURFACE.FAIRWAY]: C.fair,
    [SURFACE.FRINGE]: C.fringe, [SURFACE.GREEN]: C.green,
    [SURFACE.TEE]: C.tee, [SURFACE.SAND]: C.sand,
    /* compacted gravel, pale: the path class lies under every road and cart
       path ribbon, and the trodden-earth brown it used to be read as a dark
       overlay wider than the road it belonged to */
    [SURFACE.PATH]: C.hard, [SURFACE.ASPHALT]: C.aspL,
    [SURFACE.GRAVEL]: C.hard, [SURFACE.DIRT]: C.soil,
    [SURFACE.MUD]: C.wet.map(v => v * 0.72), [SURFACE.ROCK]: C.rock,
    [SURFACE.WETLAND]: C.wet, [SURFACE.SHORE]: C.shore,
  };
}

/* One class's complete material row: the same four rows the style texture
   carries, as plain numbers, so the per-class SDF material can bake them as
   constants instead of fetching them per fragment. */
export function classStyle(C, SHADE, sid) {
  const colours = classColours(C);
  const c = colours[sid] || C.rough;
  const shade = SHADE_OVERRIDE[sid] || SHADE[sid] || SHADE[SURFACE.ROUGH];
  const mowSource = MOW_SOURCE[sid] || [0, 0, 0];
  return Object.freeze({
    colour: Object.freeze([c[0], c[1], c[2]]),
    shade: Object.freeze([shade[0], shade[1], shade[2], shade[3]]),
    meta: Object.freeze([1, sid === SURFACE.SAND ? 1 : 0, HARD_SURFACES.has(sid) ? 1 : 0, 0]),
    mow: Object.freeze([mowSource[0], mowSource[1], mowSource[2]]),
  });
}

/* Diagnostic labels, never authored material colours. Hand-spaced rather than
   a hue walk: a golden-ratio walk put rough and forest twenty degrees apart,
   and a harness classifying desaturated pixels by hue could not tell them
   apart. The classes that meet on a golf hole get the most separated hues;
   rough is achromatic so it reads as "nothing claimed". */
const SURFACE_DEBUG_COLOURS = {
  [SURFACE.ROUGH]: [0.55, 0.55, 0.55],
  [SURFACE.SEMI]: [0.95, 0.90, 0.20],
  [SURFACE.FAIRWAY]: [0.20, 0.45, 0.95],
  [SURFACE.FRINGE]: [0.95, 0.30, 0.90],
  [SURFACE.GREEN]: [0.20, 0.95, 0.75],
  [SURFACE.TEE]: [0.95, 0.55, 0.15],
  [SURFACE.SAND]: [0.95, 0.95, 0.85],
  [SURFACE.PATH]: [0.45, 0.30, 0.15],
  [SURFACE.FOREST]: [0.85, 0.15, 0.15],
  [SURFACE.HEATH]: [0.60, 0.20, 0.60],
  [SURFACE.SHORE]: [0.70, 0.60, 0.40],
  [SURFACE.WETLAND]: [0.15, 0.70, 0.70],
  [SURFACE.ROCK]: [0.35, 0.35, 0.50],
  [SURFACE.ASPHALT]: [0.20, 0.20, 0.22],
  [SURFACE.GRAVEL]: [0.60, 0.40, 0.85],
  [SURFACE.DIRT]: [0.55, 0.35, 0.20],
  [SURFACE.MUD]: [0.30, 0.25, 0.20],
};

export function surfaceDebugColour(surfaceId) {
  const fixed = SURFACE_DEBUG_COLOURS[surfaceId];
  if (fixed) return [...fixed];
  const hue = (surfaceId * 0.61803398875) % 1;
  const sector = hue * 6;
  const x = 0.22 + 0.73 * (1 - Math.abs(sector % 2 - 1));
  return sector < 1 ? [0.95, x, 0.22]
    : sector < 2 ? [x, 0.95, 0.22]
      : sector < 3 ? [0.22, 0.95, x]
        : sector < 4 ? [0.22, x, 0.95]
          : sector < 5 ? [x, 0.22, 0.95]
            : [0.95, 0.22, x];
}

export function createGroundStyleData(C, SHADE, { includeNatural = false } = {}) {
  /* Row 0: linear colour + atlas-active flag.
     Row 1: detail scale, bump, gloss, mow strength.
     Row 2: active, sand weight, hard-surface weight, spare.
     Row 3: mow phase source coefficients [k_sdf, k_route, k_diag]. */
  const data = new Float32Array(STYLE_WIDTH * STYLE_ROWS * 4);
  for (const sid of includeNatural ? [...MIGRATED, ...PREVIEW_NATURAL] : MIGRATED) {
    const style = classStyle(C, SHADE, sid);
    data.set([...style.colour, 1], sid * 4);
    data.set(style.shade, (STYLE_WIDTH + sid) * 4);
    data.set(style.meta, (STYLE_WIDTH * 2 + sid) * 4);
    if (MOW_SOURCE[sid]) {
      data.set([...style.mow, 0], (STYLE_WIDTH * 3 + sid) * 4);
    }
  }
  return Object.freeze({ data, width: STYLE_WIDTH, height: STYLE_ROWS });
}

function makeStyleTexture(C, SHADE, options) {
  const { data, width, height } = createGroundStyleData(C, SHADE, options);
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function makeSurfaceDebugPaletteTexture() {
  const data = new Float32Array(STYLE_WIDTH * 4);
  for (let surfaceId = 0; surfaceId < STYLE_WIDTH; surfaceId++) {
    data.set([...surfaceDebugColour(surfaceId), 1], surfaceId * 4);
  }
  const tex = new THREE.DataTexture(data, STYLE_WIDTH, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/* Surface ids must remain nearest-filtered integers, but their 1 m raster must
   not become the visible outline of a fairway or green. Reconstruct the signed
   distance with a small cross filter before applying the material transition.
   The centre-heavy kernel removes one-texel staircase corners without moving a
   reviewed edge by more than the source grid can actually resolve. */
function filteredSurfaceDistance(fieldTexture, uvAtlas, texel, centreFields) {
  const decode = sample => sample.r.mul(16).sub(8);
  const centre = decode(centreFields).mul(0.5);
  const horizontal = decode(texture(fieldTexture, uvAtlas.sub(vec2(texel.x, 0))))
    .add(decode(texture(fieldTexture, uvAtlas.add(vec2(texel.x, 0)))))
    .mul(0.125);
  const vertical = decode(texture(fieldTexture, uvAtlas.sub(vec2(0, texel.y))))
    .add(decode(texture(fieldTexture, uvAtlas.add(vec2(0, texel.y)))))
    .mul(0.125);
  return centre.add(horizontal).add(vertical);
}

export function makeGround({ atlas, DETAIL, SANDN, uSun, C, SHADE }) {
  /* vertexColors is OFF, and the square below is why.
     NodeMaterial does `colorNode = colorNode.mul(vertexColor())` whenever
     vertexColors is true and the geometry has a color attribute. Every material
     here -- makeTurf, makeSand, every overlay tier -- ALSO reads
     attribute('color') itself, so this engine has always rendered the vertex
     colour SQUARED, and the whole palette is tuned to that. It is not a bug to
     fix; it is the convention to match.
     What broke was the atlas: its colour comes from the style texture, so the
     implicit multiply was multiplying SAND by the green terrain vertex under it.
     C.sand x turf is olive, which is exactly what the bunkers had gone. Taking
     the multiply into our own hands lets each region square its OWN colour --
     turf outside the atlas, the class colour inside it, which is what the sand
     overlay did when it was still geometry. */
  const m = new THREE.MeshStandardNodeMaterial({ metalness: 0, vertexColors: false });
  const aDet = attribute('aDet', 'float');
  const aBmp = attribute('aBmp', 'float');
  const aGls = attribute('aGls', 'float');
  const aStr = attribute('aStr', 'float');
  const aMow = attribute('aMow', 'vec2');
  const aAO = attribute('aAO', 'float');
  const vertCol = attribute('color', 'vec3');
  const wp = positionWorld.xz;
  const cd = cameraPosition.sub(positionWorld).length();
  const near = oneMinus(smoothstep(60, 420, cd));

  function finish(col, det, bmp, gls, strength, phase, sandWeight = float(0), hardWeight = float(0)) {
    const sc = det.max(0.45);
    const dtF = texture(DETAIL, wp.mul(sc.mul(0.33)));
    const dt = texture(DETAIL, wp.mul(sc.mul(0.055)));
    const dtM = texture(DETAIL, wp.mul(0.0085));
    const micro = mix(
      dt.g.sub(0.5).mul(0.55).add(dtM.b.sub(0.5).mul(0.45)),
      dtF.r.sub(0.5).mul(0.58).add(dt.g.sub(0.5).mul(0.30)).add(dtM.b.sub(0.5).mul(0.16)),
      near,
    );
    const amount = clamp(bmp.mul(0.44), 0.08, 0.56);
    let shaded = col.mul(float(1).add(micro.mul(amount.mul(2.1))));

    /* Sand keeps its own low-contrast grain and warm, dark cut wall. Hard surfaces
       use slower aggregate variation instead of grass-blade contrast. */
    const sandFine = texture(DETAIL, wp.mul(0.22)).r.mul(0.14)
      .add(texture(DETAIL, wp.mul(0.045)).b.mul(0.12)).add(0.88);
    const hardGrain = texture(DETAIL, wp.mul(0.13)).g.sub(0.5).mul(0.16).add(1);
    shaded = mix(shaded, col.mul(sandFine), sandWeight);
    shaded = mix(shaded, col.mul(hardGrain), hardWeight);

    const V = normalize(cameraPosition.sub(positionWorld));
    const band = sin(phase);
    const bandAA = oneMinus(smoothstep(0.55, 1.7, fwidth(phase)));
    const intoSun = pow(saturate(V.negate().dot(uSun)), 3);
    const sheen = oneMinus(abs(V.y)).mul(0.075).add(0.038).mul(oneMinus(intoSun.mul(0.75)));
    shaded = shaded.mul(float(1).add(
      band.mul(strength.min(1.8)).mul(sheen).mul(near.mul(0.35).add(0.65)).mul(bandAA),
    ));

    const turf = oneMinus(sandWeight.max(hardWeight));
    const sss = pow(saturate(V.dot(uSun.negate())), 3.4).mul(0.16);
    shaded = shaded.add(vec3(0.07, 0.15, 0.035).mul(sss).mul(strength.add(0.4).min(1.2)).mul(turf));

    m.colorNode = shaded;
    m.roughnessNode = clamp(
      float(0.97).sub(gls.mul(0.62)).sub(band.mul(bandAA).mul(strength).mul(0.05)),
      0.40,
      0.99,
    );
    const grassNormal = bumpMap(texture(DETAIL, wp.mul(sc.mul(0.33))).r, bmp.add(0.25).mul(near).mul(0.5));
    const sandNormal = bumpMap(texture(SANDN, wp.mul(0.30)).r, near.mul(0.30));
    const hardNormal = bumpMap(texture(DETAIL, wp.mul(0.18)).g, near.mul(0.12));
    m.normalNode = mix(mix(grassNormal, sandNormal, sandWeight), hardNormal, hardWeight);
    return m;
  }

  if (!atlas) return finish(vertCol.mul(vertCol), aDet, aBmp, aGls, aStr, aMow.x.mul(aMow.y));

  const styleTexture = makeStyleTexture(C, SHADE);
  m.userData.groundStyleTexture = styleTexture;

  const b = atlas.bounds;
  const spanX = b.x1 - b.x0, spanZ = b.z1 - b.z0;
  /* The half-texel offset aligns world-space texel centres with DataTexture
     centres. Without it every cut moves half a metre and edge probes fail. */
  const uvAtlas = vec2(
    wp.x.sub(float(b.x0)).add(b.res * 0.5).div(spanX),
    wp.y.sub(float(b.z0)).add(b.res * 0.5).div(spanZ),
  );
  const inBounds = step(0, uvAtlas.x).mul(step(uvAtlas.x, 1))
    .mul(step(0, uvAtlas.y)).mul(step(uvAtlas.y, 1));
  const ids = texture(atlas.texID, uvAtlas);
  const fields = texture(atlas.texF, uvAtlas);
  const primId = ids.r.mul(255);
  const secId = ids.g.mul(255);
  const texel = vec2(1 / b.w, 1 / b.h);
  const sdf = filteredSurfaceDistance(atlas.texF, uvAtlas, texel, fields);
  /* Half a source texel is the honest minimum uncertainty of a centre-sampled
     raster. Blending over that footprint gives cut grass a soft natural edge;
     screen derivatives widen it further when the course recedes. */
  const edgeWidth = fwidth(sdf).max(b.res * 0.55);
  const primaryWeight = smoothstep(edgeWidth.negate(), edgeWidth, sdf);

  const styleUv = (id, row) => vec2(id.add(0.5).div(STYLE_WIDTH), float((row + 0.5) / STYLE_ROWS));
  const primColor = texture(styleTexture, styleUv(primId, 0));
  const secColor = texture(styleTexture, styleUv(secId, 0));
  const primShade = texture(styleTexture, styleUv(primId, 1));
  const secShade = texture(styleTexture, styleUv(secId, 1));
  const primMeta = texture(styleTexture, styleUv(primId, 2));
  const secMeta = texture(styleTexture, styleUv(secId, 2));
  /* Non-migrated texels have active=0 and therefore retain groundAt's procedural
     vertex colour. Migrated class colours receive the separate horizon AO once. */
  const atlasColor = mix(secColor.rgb, primColor.rgb, primaryWeight).mul(aAO);
  const atlasActive = mix(secMeta.r, primMeta.r, primaryWeight).mul(inBounds);
  /* pick the source colour first, THEN square it -- see the note on the material */
  const base = mix(vertCol, atlasColor, atlasActive);
  const col = base.mul(base);
  const shade = mix(secShade, primShade, primaryWeight);
  const det = mix(aDet, shade.r, atlasActive);
  const bmp = mix(aBmp, shade.g, atlasActive);
  const gls = mix(aGls, shade.b, atlasActive);
  const strength = mix(aStr, shade.a, atlasActive);
  const sandWeight = mix(secMeta.g, primMeta.g, primaryWeight).mul(inBounds);
  const hardWeight = mix(secMeta.b, primMeta.b, primaryWeight).mul(inBounds);
  /* Mow phase from the PRIMARY class's coordinate source. The route byte holds
     0.25 m steps and the SDF 6 cm ones; both filter linearly, so sin() lands on
     a smooth coordinate per fragment. Phases from two classes must never be
     mixed across an edge -- they are different cuts -- so the secondary side
     simply fades with its band strength. */
  const mowK = texture(styleTexture, styleUv(primId, 3));
  const routeDist = fields.g.mul(255 / 4);
  /* the green's own ring coordinate: distance to its edge, unclamped, so the
     rings run all the way to the middle instead of stopping at the SDF's 8 m */
  const ringDist = fields.a.mul(255 * 0.16);
  /* Where the route byte saturates (the range, scenery turf far from any hole
     line) there is no meaningful mow direction: zero the phase so those surfaces
     read as flat cut, as their overlays did, instead of a fixed sin() tint. */
  const routeValid = oneMinus(step(0.999, fields.g));
  const diag = wp.x.sub(wp.y).mul(0.70710678);
  const atlasPhase = ringDist.mul(mowK.r).add(routeDist.mul(mowK.g).mul(routeValid)).add(diag.mul(mowK.b));
  const phase = mix(aMow.x.mul(aMow.y), atlasPhase, inBounds);
  return finish(col, det, bmp, gls, strength, phase, sandWeight, hardWeight);
}

/* The BVCH terrain has its own vertex texture and geometric normals, so it
   cannot reuse makeGround's legacy per-vertex colour attributes. It can reuse
   the same 1 m surface atlas, palette and mowing coordinates, though. This
   decorator keeps the one-draw WebGPU/WebGL2 terrain batch while making the
   provisional raw DTM read as the same golf course instead of a green slab. */
/* The per-class SDF material. One exact signed distance per non-rough class
   arrives in the atlas's RGBA8 SDF textures; rough is their complement. Each
   class becomes a normalized weight and the weights blend COMPLETE material
   rows -- colour, detail scale, bump, gloss, mow strength, sand/hard metadata
   -- that are constants of the decoration, never fetched. No id is ever
   sampled, so no id is ever filtered, and a three-way junction or a 3 m
   fringe band is just three or five weights that sum to one.

   Mowing is the one thing not blended by parameter: each class's band is
   evaluated on ITS OWN coordinate source and the resulting stripe intensity
   is cross-faded by weight, because a green's rings and a fairway's route
   bands are different cuts and averaging their phases would draw a third. */
/* classes whose colour is the surroundings', taken from the ground tint rather
   than from a flat style so the surface window has no visible edge */
const TINTED_CLASSES = new Set([SURFACE.FOREST, SURFACE.HEATH, SURFACE.WETLAND, SURFACE.SHORE]);

function createClassSdfDecorator({ atlas, DETAIL, C, SHADE, debugMode, tint = null }) {
  const channels = atlas.data.channels;
  const classes = [...channels, SURFACE.ROUGH];
  const roughIndex = classes.length - 1;
  const styles = classes.map(sid => classStyle(C, SHADE, sid));
  const widths = classes.map(sid => surfaceTransitionWidthMetres(sid));
  const roughWidth = surfaceTransitionWidthMetres(SURFACE.ROUGH);
  const debugColours = classes.map(sid => surfaceDebugColour(sid));
  const swizzle = ['r', 'g', 'b', 'a'];
  return material => {
    /* Sampled at the LEGACY world position for the same reason the pair
       material is: the descriptor's samplingFrame says which world the raster
       was drawn in, and for the migration preview that is the pack's own. */
    const wp = positionWorld.xz;
    const b = atlas.bounds;
    const uvAtlas = vec2(
      wp.x.sub(float(b.x0)).div(b.x1 - b.x0),
      wp.y.sub(float(b.z0)).div(b.z1 - b.z0),
    );
    const inBounds = step(0, uvAtlas.x).mul(step(uvAtlas.x, 1))
      .mul(step(0, uvAtlas.y)).mul(step(uvAtlas.y, 1));
    const samples = atlas.texSdf.map(tex => texture(tex, uvAtlas));
    const sdfs = channels.map((_, index) => samples[index >> 2][swizzle[index & 3]].mul(8).sub(4));
    /* A pair blends over the WIDER of its two widths, on both sides: with
       asymmetric widths one class fades before the other has risen and the
       sliver between reads as rough. Which class each one meets is found per
       fragment from the two largest distances -- the nearest other class of
       the leader is the runner-up, of everyone else it is the leader -- and
       when the runner-up is far (nothing else within a metre) the leader is
       meeting rough and takes rough's width. */
    let best = sdfs[0];
    let bestWidth = float(widths[0]);
    let second = float(-8);
    let secondWidth = float(roughWidth);
    for (let index = 1; index < sdfs.length; index++) {
      const sdf = sdfs[index];
      const width = float(widths[index]);
      const leads = sdf.greaterThan(best);
      const runsUp = sdf.greaterThan(second).and(leads.not());
      const nextSecond = select(leads, best, select(runsUp, sdf, second));
      const nextSecondWidth = select(leads, bestWidth, select(runsUp, width, secondWidth));
      best = select(leads, sdf, best);
      bestWidth = select(leads, width, bestWidth);
      second = nextSecond;
      secondWidth = nextSecondWidth;
    }
    const leaderMeets = select(second.greaterThan(float(-1)), secondWidth, float(roughWidth));
    /* physical half-width per class, widened only when the screen needs it */
    const classRaws = sdfs.map((sdf, index) => {
      const meets = select(sdf.greaterThanEqual(best), leaderMeets, bestWidth);
      const width = fwidth(sdf).mul(0.75).max(max(float(widths[index]), meets));
      return smoothstep(width.negate(), width, sdf);
    });
    let classSum = classRaws[0];
    for (let index = 1; index < classRaws.length; index++) classSum = classSum.add(classRaws[index]);
    /* Rough is what no class claims: 1 - the sum of the class weights, never
       -max(sdf). The complement of the DISTANCES is zero on every boundary
       between two mown classes -- both distances are zero there -- and would
       hand rough a third of every green edge. The complement of the WEIGHTS
       is zero there, and rises only where every class has genuinely faded. */
    const roughRaw = saturate(float(1).sub(classSum));
    const raws = [...classRaws, roughRaw];
    const inverse = float(1).div(max(classSum, float(1)));
    /* outside the surface window every fragment is rough */
    const weights = raws.map((raw, index) => index === roughIndex
      ? raw.mul(inverse).mul(inBounds).add(oneMinus(inBounds))
      : raw.mul(inverse).mul(inBounds));
    const blend3 = pick => weights.reduce((acc, weight, index) => {
      const term = vec3(...pick(index)).mul(weight);
      return acc ? acc.add(term) : term;
    }, null);
    const blend4 = pick => weights.reduce((acc, weight, index) => {
      const term = vec4(...pick(index)).mul(weight);
      return acc ? acc.add(term) : term;
    }, null);

    if (debugMode === 'weights') {
      material.colorNode = vec3(0, 0, 0);
      material.emissiveNode = blend3(index => debugColours[index]);
      material.roughnessNode = float(1);
      material.metalness = 0;
      /* categorical, not photographic: a harness reads these pixels back and
         classifies them, so neither tone mapping nor fog may recolour them */
      material.toneMapped = false;
      material.fog = false;
      material.userData.surfaceDebugMode = debugMode;
      material.userData.surfaceRepresentation = 'class-sdf-v1';
      material.userData.surfaceChannels = [...channels];
      material.userData.terrainPreviewTextures = [];
      return material;
    }

    /* Rough is the one class that reaches beyond the course: on a world
       graph it runs to the horizon, where the legacy rings painted forest
       floor, fields, gardens and rock per vertex. The tint rasters carry that
       same classification (main.js builds them from the same functions), a
       near one at fine spacing and a far one to the horizon; outside both the
       flat rough colour remains. */
    /* A raster's edge is a square drawn on the ground unless the hand-over is
       gradual: each layer fades out over `fadeMetres` inside its own border,
       so the near tint dissolves into the far one and the far one into the
       flat rough, and no line is drawn where a texture happens to end. */
    const tintSample = (layer, fadeMetres) => {
      const tb = layer.bounds;
      const uv = vec2(wp.x.sub(float(tb.x0)).div(tb.x1 - tb.x0), wp.y.sub(float(tb.z0)).div(tb.z1 - tb.z0));
      const edge = uv.x.min(oneMinus(uv.x)).min(uv.y).min(oneMinus(uv.y));
      const inside = smoothstep(0, fadeMetres / (tb.x1 - tb.x0), edge);
      return { colour: texture(layer.texture, uv).rgb, inside };
    };
    let roughColour = vec3(...styles[roughIndex].colour);
    if (tint?.far) { const far = tintSample(tint.far, tint.far.fadeMetres ?? 600); roughColour = mix(roughColour, far.colour, far.inside); }
    if (tint?.near) { const near = tintSample(tint.near, tint.near.fadeMetres ?? 300); roughColour = mix(roughColour, near.colour, near.inside); }
    /* The surroundings' classes -- forest floor, heath, wetland, shore -- are
       painted by the tint outside the surface window, from the same rings and
       the same imagery. Inside it they must be painted the same way, or the
       window's edge is a square where a flat class colour meets a tinted one:
       measured, a near-black forest floor against a mottled green one. */
    const colourNodes = styles.map((style, index) => (index === roughIndex || TINTED_CLASSES.has(classes[index])
      ? roughColour : vec3(...style.colour)));
    const base = weights.reduce((acc, weight, index) => {
      const term = colourNodes[index].mul(weight);
      return acc ? acc.add(term) : term;
    }, null);
    const shade = blend4(index => styles[index].shade);
    const meta = blend4(index => styles[index].meta);

    const detailScale = shade.x.max(0.45);
    const fine = texture(DETAIL, wp.mul(detailScale.mul(0.11))).r.sub(0.5);
    const macro = texture(DETAIL, wp.mul(0.0085)).b.sub(0.5);
    const turfDetail = fine.mul(0.30).add(macro.mul(0.18));
    const sandDetail = texture(DETAIL, wp.mul(0.22)).r.sub(0.5).mul(0.16);
    const hardDetail = texture(DETAIL, wp.mul(0.13)).g.sub(0.5).mul(0.13);
    const surfaceDetail = mix(mix(turfDetail, sandDetail, meta.g), hardDetail, meta.b);

    const fields = texture(atlas.texF, uvAtlas);
    const routeDistance = fields.r.mul(255 * atlas.data.routeStepMetres);
    const ringDistance = fields.g.mul(255 * atlas.data.ringStepMetres);
    const routeValid = oneMinus(step(0.999, fields.r));
    const diagonal = wp.x.sub(wp.y).mul(0.70710678);
    let mow = null;
    classes.forEach((sid, index) => {
      const k = styles[index].mow;
      if (!k[0] && !k[1] && !k[2]) return;
      const phase = ringDistance.mul(k[0])
        .add(routeDistance.mul(k[1]).mul(routeValid))
        .add(diagonal.mul(k[2]));
      const bandAA = oneMinus(smoothstep(0.55, 1.7, fwidth(phase)));
      const term = sin(phase).mul(bandAA).mul(styles[index].shade[3]).mul(weights[index]);
      mow = mow ? mow.add(term) : term;
    });
    const mowNode = (mow || float(0)).mul(0.045);
    /* the same linear share the pair material restores -- see its note */
    const litBase = mix(base.mul(base), base, 0.18);
    material.colorNode = litBase.mul(float(1).add(surfaceDetail).add(mowNode));
    material.roughnessNode = clamp(float(0.97).sub(shade.z.mul(0.62)), 0.42, 0.99);
    material.metalness = 0;
    /* the atlas owns its textures; nothing was created here to dispose */
    material.userData.terrainPreviewTextures = [];
    material.userData.surfaceDebugMode = debugMode;
    material.userData.surfaceRepresentation = 'class-sdf-v1';
    material.userData.surfaceChannels = [...channels];
    return material;
  };
}

export function createV2GroundMaterialDecorator({ atlas, DETAIL, C, SHADE, debugMode = 'off', tint = null }) {
  if (!['off', 'weights'].includes(debugMode)) throw new TypeError(`unknown surface debug mode: ${debugMode}`);
  if (atlas?.data?.representation === 'class-sdf-v1') {
    if (!atlas.texSdf?.length || !atlas.texF || !atlas.data.channels?.length) {
      throw new TypeError('the per-class v2 terrain material requires SDF textures and a channel palette');
    }
    return createClassSdfDecorator({ atlas, DETAIL, C, SHADE, debugMode, tint });
  }
  if (!atlas?.texID || !atlas?.texF) throw new TypeError('the v2 terrain material requires a ground atlas');
  const styleTexture = makeStyleTexture(C, SHADE, { includeNatural: true });
  const debugPaletteTexture = debugMode === 'weights' ? makeSurfaceDebugPaletteTexture() : null;
  return material => {
    /* Sampled with the LEGACY world position, deliberately, even though the
       mesh under it is drawn rotated out of EPSG:3006. The two v2 artefacts are
       not in the same frame: the terrain tiles are real grid-north DTM, but the
       surface atlas is the pack's own legacy vectors rasterised onto the tile
       lattice by compile-puttom-surface-preview.mjs with a translation and
       nothing else. So a green sits in this raster at its LEGACY coordinate,
       and reading it there is what puts the pack's green on the ground that is
       genuinely under it. Measured: addressed this way 14 of 18 green centres
       land on green, addressed through the bridge only 3 of 18. */
    const wp = positionWorld.xz;
    const b = atlas.bounds;
    const uvAtlas = vec2(
      /* v2 bounds already start half a sample before the first texel centre.
         Adding another half sample here shifted every surface 0.5 m. */
      wp.x.sub(float(b.x0)).div(b.x1 - b.x0),
      wp.y.sub(float(b.z0)).div(b.z1 - b.z0),
    );
    const inBounds = step(0, uvAtlas.x).mul(step(uvAtlas.x, 1))
      .mul(step(0, uvAtlas.y)).mul(step(uvAtlas.y, 1));
    const ids = texture(atlas.texID, uvAtlas);
    const fields = texture(atlas.texF, uvAtlas);
    const primaryId = ids.r.mul(255);
    const secondaryId = ids.g.mul(255);
    /* This distance was compiled from the source vectors on a 25 cm grid, then
       sampled onto the 1 m payload. Keep the close transition narrow; fwidth
       expands it only when required for screen-space antialiasing. */
    const sdf = fields.r.mul(16).sub(8);
    const edgeWidth = fwidth(sdf).mul(0.75).max(0.22);
    const primaryWeight = smoothstep(edgeWidth.negate(), edgeWidth, sdf);
    const styleUv = (id, row) => vec2(id.add(0.5).div(STYLE_WIDTH), float((row + 0.5) / STYLE_ROWS));
    const primaryColor = texture(styleTexture, styleUv(primaryId, 0));
    const secondaryColor = texture(styleTexture, styleUv(secondaryId, 0));
    const primaryShade = texture(styleTexture, styleUv(primaryId, 1));
    const secondaryShade = texture(styleTexture, styleUv(secondaryId, 1));
    const primaryMeta = texture(styleTexture, styleUv(primaryId, 2));
    const secondaryMeta = texture(styleTexture, styleUv(secondaryId, 2));
    if (debugPaletteTexture) {
      const primaryDebug = texture(
        debugPaletteTexture, vec2(primaryId.add(0.5).div(STYLE_WIDTH), 0.5),
      );
      const secondaryDebug = texture(
        debugPaletteTexture, vec2(secondaryId.add(0.5).div(STYLE_WIDTH), 0.5),
      );
      /* The pair weights are normalized by construction. Rendering them through
         an emissive categorical palette removes lighting, scenery material and
         geometric-normal variation from surface-boundary review. */
      const debugColor = mix(secondaryDebug.rgb, primaryDebug.rgb, primaryWeight);
      material.colorNode = vec3(0, 0, 0);
      material.emissiveNode = mix(vec3(0.015, 0.015, 0.015), debugColor, inBounds);
      material.roughnessNode = float(1);
      material.metalness = 0;
      material.toneMapped = false;
      material.fog = false;
      material.userData.surfaceDebugMode = debugMode;
      material.userData.surfaceRepresentation = 'pair-sdf-v1';
      material.userData.terrainPreviewTextures = [styleTexture, debugPaletteTexture];
      return material;
    }
    const active = mix(secondaryMeta.r, primaryMeta.r, primaryWeight).mul(inBounds);
    const roughColor = vec3(C.rough[0], C.rough[1], C.rough[2]);
    const classColor = mix(secondaryColor.rgb, primaryColor.rgb, primaryWeight);
    const base = mix(roughColor, classColor, active);
    const roughShade = vec3(
      SHADE[SURFACE.ROUGH][0], SHADE[SURFACE.ROUGH][1], SHADE[SURFACE.ROUGH][2],
    );
    const classShade = mix(secondaryShade.rgb, primaryShade.rgb, primaryWeight);
    const shade = mix(roughShade, classShade, active);
    const strength = mix(float(0), mix(secondaryShade.a, primaryShade.a, primaryWeight), active);
    const meta = mix(secondaryMeta, primaryMeta, primaryWeight).mul(inBounds);

    const detailScale = shade.x.max(0.45);
    const fine = texture(DETAIL, wp.mul(detailScale.mul(0.11))).r.sub(0.5);
    const macro = texture(DETAIL, wp.mul(0.0085)).b.sub(0.5);
    const turfDetail = fine.mul(0.30).add(macro.mul(0.18));
    const sandDetail = texture(DETAIL, wp.mul(0.22)).r.sub(0.5).mul(0.16);
    const hardDetail = texture(DETAIL, wp.mul(0.13)).g.sub(0.5).mul(0.13);
    const surfaceDetail = mix(mix(turfDetail, sandDetail, meta.g), hardDetail, meta.b);

    const mowK = texture(styleTexture, styleUv(primaryId, 3));
    const routeDistance = fields.g.mul(255 / 4);
    const ringDistance = fields.a.mul(255 * 0.16);
    const routeValid = oneMinus(step(0.999, fields.g));
    const diagonal = wp.x.sub(wp.y).mul(0.70710678);
    const phase = ringDistance.mul(mowK.r)
      .add(routeDistance.mul(mowK.g).mul(routeValid))
      .add(diagonal.mul(mowK.b));
    const mow = sin(phase).mul(strength).mul(0.045)
      .mul(oneMinus(smoothstep(0.55, 1.7, fwidth(phase))));
    /* The legacy mesh deliberately squares its authored vertex colour. BVCH has
       no procedural vertex colour beneath the atlas, so a small linear share
       restores the missing ambient body without flattening class contrast. */
    const litBase = mix(base.mul(base), base, 0.18);
    material.colorNode = litBase.mul(float(1).add(surfaceDetail).add(mow));
    material.roughnessNode = clamp(float(0.97).sub(shade.z.mul(0.62)), 0.42, 0.99);
    material.metalness = 0;
    material.userData.terrainPreviewTextures = [styleTexture];
    material.userData.surfaceDebugMode = debugMode;
    material.userData.surfaceRepresentation = 'pair-sdf-v1';
    return material;
  };
}
