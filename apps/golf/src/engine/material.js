/* One material for one ground mesh. Polygon-derived surfaces come from the
   runtime atlas; procedural rough/forest colour remains in the terrain's vertex
   colour until that procedural shading is moved to TSL. */

import * as THREE from 'three/webgpu';
import { paintedDirect, paintedSeason, paintedTurfStrength, paintedGrassSheen } from './painted-world-lighting.mjs';
import {
  float, vec2, vec3, attribute, texture, positionWorld, cameraPosition,
  mix, smoothstep, clamp, pow, abs, sin, normalize, oneMinus, fwidth,
  bumpMap, saturate, step, max, vec4, select, floor, normalWorld,
} from 'three/tsl';

/* The painted ground (?ghibli=1). A Ghibli field is a flat saturated colour
   with low-frequency hand-painted blotches, a warm sunlit side and a cool
   blue-green shade side, and no photographic grain or relief. This
   takes a material's base colour and returns what to draw instead of the
   photoreal finish; the callers keep their class blending and mow bands. */
export function paintedGround({ base, wp, DETAIL, uSun, mow = float(0), turf = float(1), seasonal = float(0) }) {
  const blotchA = texture(DETAIL, wp.mul(0.012)).b.sub(0.5);
  const blotchB = texture(DETAIL, wp.mul(0.038)).g.sub(0.5);
  const blotchC = texture(DETAIL, wp.mul(0.11)).r.sub(0.5);
  /* turf is blotched like a meadow; gravel and sand keep a quieter grain */
  const blotch = blotchA.mul(0.18).add(blotchB.mul(0.08)).add(blotchC.mul(0.035)).mul(mix(float(0.35), float(1), turf));
  const wrap = saturate(normalWorld.dot(uSun).mul(0.5).add(0.5));
  const band = mix(float(.55), smoothstep(0.30, 0.80, wrap), paintedDirect);
  /* the sunlit band goes yellow-green, the way a painter warms a lit meadow;
     the shade stays blue-green. Only TURF takes the hue swing: a grey road
     under the warm band turned brown, and sand went orange */
  const turfTone = mix(vec3(0.91, 0.97, 1.06), vec3(1.04, 1.02, 0.94), band);
  const flatTone = mix(vec3(0.90, 0.91, 0.95), vec3(1.03, 1.03, 1.02), band);
  const tone = mix(flatTone, turfTone, turf);
  /* the palette carries the chroma now; the finish only shapes it */
  // Uncut surroundings acquire an ochre undertone in autumn; mown playing
  // surfaces keep their distinct sage/moss hues and readable mowing pattern.
  const seasonTone = mix(vec3(1), vec3(1.14,.93,.75), paintedSeason.mul(seasonal).mul(turf));
  const c = base.mul(float(1).add(blotch).add(mow.mul(0.55))).mul(tone).mul(seasonTone)
    .mul(mix(float(1), paintedTurfStrength, turf));
  // Broad grass reflections use the standard light/shadow response, so the
  // sun catches the turf at grazing angles and tree shadows still occlude it.
  // Reuse the existing blotch/mowing samples; no glints, normal map or pass.
  const sheenRoughness = float(.59).add(blotchA.mul(.12)).sub(mow.mul(.35)).clamp(.52,.68);
  return { colorNode: c, roughnessNode: mix(float(.96),sheenRoughness,paintedGrassSheen.mul(turf)) };
}
import { SURFACE, surfaceTransitionWidthMetres } from './surface.js';
import { createGroundReliefNormal, groundReliefTier } from './ground-surface-relief.mjs';

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
const PAVED_SURFACES = [SURFACE.PATH, SURFACE.ASPHALT, SURFACE.GRAVEL];

const pavedClassWeight = id => PAVED_SURFACES.reduce(
  (weight, sid) => weight.add(oneMinus(step(0.5, abs(id.sub(sid))))), float(0));

// Paving uses the palette's linear albedo once, like the road and authored
// facility materials. Retain the established colour response of turf and sand.
export function groundSurfaceAlbedo(base, pavingWeight, naturalLinearShare = 0) {
  const natural = mix(base.mul(base), base, naturalLinearShare);
  return mix(natural, base, pavingWeight);
}
/* These classes take their colour from the same procedural near/far ground
   tint instead of a flat palette row. Rough is included explicitly here so
   both the class-SDF and compatibility pair-SDF materials follow one rule. */
const GROUND_TINT_CLASSES = new Set([
  SURFACE.ROUGH, SURFACE.FOREST, SURFACE.HEATH,
  SURFACE.WETLAND, SURFACE.SHORE,
]);

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
    [SURFACE.PATH]: C.gravel || C.hard, [SURFACE.ASPHALT]: C.aspL,
    [SURFACE.GRAVEL]: C.gravel || C.hard, [SURFACE.DIRT]: C.soil,
    [SURFACE.MUD]: C.mud || C.wet.map(v => v * 0.72), [SURFACE.ROCK]: C.rock,
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
    meta: Object.freeze([
      1,
      sid === SURFACE.SAND ? 1 : 0,
      HARD_SURFACES.has(sid) ? 1 : 0,
      GROUND_TINT_CLASSES.has(sid) ? 1 : 0,
    ]),
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
     Row 2: active, sand weight, hard-surface weight, ground-tint weight.
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

const decodeSurfaceDistance = sample => sample.r.mul(16).sub(8);

/* Surface ids must remain nearest-filtered integers, but their 1 m raster must
   not become the visible outline of a fairway or green. Reconstruct the signed
   distance with a small cross filter before applying the material transition.
   The centre-heavy kernel removes one-texel staircase corners without moving a
   reviewed edge by more than the source grid can actually resolve. */
function filteredSurfaceDistance(fieldTexture, uvAtlas, texel, centreFields) {
  const centre = decodeSurfaceDistance(centreFields).mul(0.5);
  const horizontal = decodeSurfaceDistance(texture(fieldTexture, uvAtlas.sub(vec2(texel.x, 0))))
    .add(decodeSurfaceDistance(texture(fieldTexture, uvAtlas.add(vec2(texel.x, 0)))))
    .mul(0.125);
  const vertical = decodeSurfaceDistance(texture(fieldTexture, uvAtlas.sub(vec2(0, texel.y))))
    .add(decodeSurfaceDistance(texture(fieldTexture, uvAtlas.add(vec2(0, texel.y)))))
    .mul(0.125);
  return centre.add(horizontal).add(vertical);
}

/* THE PAIR FIELD IS NOT A DISTANCE FIELD, and filtering it as one draws a ring
   round every bunker.

   `fieldData`'s signed distance is signed by which of a texel's TWO classes has
   priority, so it describes ONE edge -- the edge between that pair. The pair
   changes across the raster: two neighbouring texels deep inside the same
   fairway read -8 (the nearest other class is the bunker, which outranks
   fairway) and +8 (it is the semi, which does not). Both are true, both render
   fairway on their own, and both describe eight metres of untouched grass. But
   linear filtering between them sweeps the whole way through zero, the
   transition smoothstep sees a crossing, and the shader paints a full-strength
   edge in the pair's higher-priority class -- sand. That is the pale
   stair-stepped ring every bunker wore about eight metres out, on every course
   and in BOTH ground paths. On one synthetic bunker 108 texel pairs carry the
   flip; the same watershed runs through greens, tees and paths.

   A filtered distance is only meaningful while the fragment could genuinely lie
   inside the blend of the edge its nearest texel names. At a real cut that
   texel reads 0.5 to about 1.3 m; past `start` nothing but a pair mismatch can
   still move the weight, so the texel's own sign is the whole answer and taking
   it removes the manufactured edge without touching a reviewed one. Where two
   texels genuinely disagree the result is a hard one-texel step in the weight
   between two texels that render the SAME class, which is invisible by
   construction.

   The guard is never tighter than the pixel footprint, so a distant edge keeps
   the wide screen-space ramp that antialiases it. It is measured against the
   FOOTPRINT and not against the transition width, because `fwidth` of the field
   is itself inflated at the discontinuity -- scaling the guard by it would
   relax the guard exactly where it is needed. */
export const SURFACE_PAIR_GUARD = Object.freeze({
  startTexels: 1.3, endTexels: 2.5, startFootprints: 2, endFootprints: 4,
});

/** The guard's two thresholds in metres, for a raster of `res` m texels seen at
 *  a pixel footprint of `footprintMetres` m. Shared by the shader and the probe
 *  so the two can never disagree about where a blend stops being meaningful. */
export function surfacePairGuardMetres(res, footprintMetres = 0) {
  return {
    start: Math.max(SURFACE_PAIR_GUARD.startTexels * res, SURFACE_PAIR_GUARD.startFootprints * footprintMetres),
    end: Math.max(SURFACE_PAIR_GUARD.endTexels * res, SURFACE_PAIR_GUARD.endFootprints * footprintMetres),
  };
}

const smoothstep01 = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The primary class's share at one fragment, in plain numbers. `filtered` is
 *  the linearly reconstructed distance, `nearest` the stored value of the texel
 *  the ids were read from, both in metres. */
export function surfacePairWeight({ filtered, nearest, halfWidth, res, footprintMetres = 0 }) {
  const blended = smoothstep01(-halfWidth, halfWidth, filtered);
  const { start, end } = surfacePairGuardMetres(res, footprintMetres);
  const interior = smoothstep01(start, end, Math.abs(nearest));
  return blended + ((nearest >= 0 ? 1 : 0) - blended) * interior;
}

/* One class's mow stripe: sin() of its own coordinate, faded out where the
   stripe has become finer than the fragment can resolve. Two classes' bands are
   cross-faded as BANDS and never as phases or coefficients -- a fairway's route
   frequency averaged with a bunker's zero is a chirp, and averaging two phases
   draws a third cut that neither class has. */
function mowBand(phase) {
  return sin(phase).mul(oneMinus(smoothstep(0.55, 1.7, fwidth(phase))));
}

/* Sampling exactly at a texel centre makes the bilinear weights (1, 0, 0, 0),
   so the stored value of the texel the NEAREST-filtered ids came from costs one
   tap and no second texture. Snapped from the material's OWN uv, so the guard
   and the id lookup can never land on different texels. */
function nearestSurfaceDistance(fieldTexture, uvAtlas, texel) {
  const size = vec2(float(1).div(texel.x), float(1).div(texel.y));
  return decodeSurfaceDistance(texture(fieldTexture, floor(uvAtlas.mul(size)).add(0.5).div(size)));
}

/* `weight` is the primary class's share. `deepSecondary` is 1 where the guard
   has taken over AND the texel's own class is the SECONDARY of its pair -- the
   fairway whose nearest other class is a bunker six metres away. Only that
   fragment may take its mow coordinate from the secondary; everywhere else the
   reviewed rule (the primary's cut, the secondary side fading with its own band
   strength) is left exactly as it was. */
function guardedPairWeight({ fieldTexture, uvAtlas, texel, filtered, halfWidth, res, wp }) {
  const nearest = nearestSurfaceDistance(fieldTexture, uvAtlas, texel);
  const footprint = fwidth(wp).length();
  const start = max(float(SURFACE_PAIR_GUARD.startTexels * res), footprint.mul(SURFACE_PAIR_GUARD.startFootprints));
  const end = max(float(SURFACE_PAIR_GUARD.endTexels * res), footprint.mul(SURFACE_PAIR_GUARD.endFootprints));
  const interior = smoothstep(start, end, abs(nearest));
  const ownIsPrimary = step(0, nearest);
  return {
    weight: mix(smoothstep(halfWidth.negate(), halfWidth, filtered), ownIsPrimary, interior),
    deepSecondary: interior.mul(oneMinus(ownIsPrimary)),
  };
}

export function makeGround({ atlas, DETAIL, SANDN, uSun, C, SHADE, look = 'real' }) {
  /* The atlas supplies its own colour, so implicit vertex multiplication must
     stay off. Natural ground retains its established colour response; paving
     uses linear albedo once, avoiding near-black asphalt and parking areas. */
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

  function finish(col, det, bmp, gls, strength, band, sandWeight = float(0), hardWeight = float(0)) {
    if (look === 'ghibli') {
      const painted = paintedGround({ base: col, wp, DETAIL, uSun, mow: band.mul(strength.min(1.8)).mul(0.05), turf: oneMinus(sandWeight.max(hardWeight)) });
      m.colorNode = painted.colorNode;
      m.roughnessNode = painted.roughnessNode;
      return m;
    }
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
    const intoSun = pow(saturate(V.negate().dot(uSun)), 3);
    const sheen = oneMinus(abs(V.y)).mul(0.075).add(0.038).mul(oneMinus(intoSun.mul(0.75)));
    shaded = shaded.mul(float(1).add(
      band.mul(strength.min(1.8)).mul(sheen).mul(near.mul(0.35).add(0.65)),
    ));

    const turf = oneMinus(sandWeight.max(hardWeight));
    const sss = pow(saturate(V.dot(uSun.negate())), 3.4).mul(0.16);
    shaded = shaded.add(vec3(0.07, 0.15, 0.035).mul(sss).mul(strength.add(0.4).min(1.2)).mul(turf));

    m.colorNode = shaded;
    m.roughnessNode = clamp(
      float(0.97).sub(gls.mul(0.62)).sub(band.mul(strength).mul(0.05)),
      0.40,
      0.99,
    );
    const grassNormal = bumpMap(texture(DETAIL, wp.mul(sc.mul(0.33))).r, bmp.add(0.25).mul(near).mul(0.5));
    const sandNormal = bumpMap(texture(SANDN, wp.mul(0.30)).r, near.mul(0.30));
    const hardNormal = bumpMap(texture(DETAIL, wp.mul(0.18)).g, near.mul(0.12));
    m.normalNode = mix(mix(grassNormal, sandNormal, sandWeight), hardNormal, hardWeight);
    return m;
  }

  if (!atlas) return finish(look === 'ghibli' ? vertCol : vertCol.mul(vertCol), aDet, aBmp, aGls, aStr, mowBand(aMow.x.mul(aMow.y)));

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
  const pair = guardedPairWeight({
    fieldTexture: atlas.texF, uvAtlas, texel, filtered: sdf, halfWidth: edgeWidth, res: b.res, wp,
  });
  const primaryWeight = pair.weight;

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
  const base = mix(vertCol, atlasColor, atlasActive);
  const pavingWeight = mix(pavedClassWeight(secId), pavedClassWeight(primId), primaryWeight).mul(inBounds);
  const col = groundSurfaceAlbedo(base, pavingWeight, look === 'ghibli' ? 1 : 0);
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
     simply fades with its band strength.
     Deep inside a class, though, the primary can be a bunker six metres away
     and its coefficients are all zero: taking them switched a fairway's stripes
     off in a patch round every bunker, bounded by the same watershed the guard
     exists for. There the fragment shows exactly one class, and it is the one
     whose cut this is. */
  const routeDist = fields.g.mul(255 / 4);
  /* the green's own ring coordinate: distance to its edge, unclamped, so the
     rings run all the way to the middle instead of stopping at the SDF's 8 m */
  const ringDist = fields.a.mul(255 * 0.16);
  /* Where the route byte saturates (the range, scenery turf far from any hole
     line) there is no meaningful mow direction: zero the phase so those surfaces
     read as flat cut, as their overlays did, instead of a fixed sin() tint. */
  const routeValid = oneMinus(step(0.999, fields.g));
  const diag = wp.x.sub(wp.y).mul(0.70710678);
  const classBand = id => mowBand((k => ringDist.mul(k.r)
    .add(routeDist.mul(k.g).mul(routeValid))
    .add(diag.mul(k.b)))(texture(styleTexture, styleUv(id, 3))));
  const atlasBand = mix(classBand(primId), classBand(secId), pair.deepSecondary);
  const band = mix(mowBand(aMow.x.mul(aMow.y)), atlasBand, inBounds);
  return finish(col, det, bmp, gls, strength, band, sandWeight, hardWeight);
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
/* V2TerrainLiveAdapter reads this non-enumerable identity only for the reviewed
   zero-v2-surface path. It proves that the material submitted in preflight is
   sampling the same complete GPK atlas the adapter inspected, rather than an
   unrelated decorator that merely happens to compile. */
function bindV2SurfaceAuthority(decorator, atlas) {
  Object.defineProperty(decorator, 'v2SurfaceAuthority', { value: atlas });
  return decorator;
}

/* One sampler for both v2 surface representations. Keeping this outside the
   class-SDF branch prevents a compatibility atlas from silently falling back
   to flat C.rough over most of a course even when main.js supplied the same
   near/far tint textures used by the full Puttom material. */
function groundTintColour(tint, wp, fallbackColour) {
  const tintSample = (layer, fadeMetres) => {
    const tb = layer.bounds;
    const uv = vec2(
      wp.x.sub(float(tb.x0)).div(tb.x1 - tb.x0),
      wp.y.sub(float(tb.z0)).div(tb.z1 - tb.z0),
    );
    const edge = uv.x.min(oneMinus(uv.x)).min(uv.y).min(oneMinus(uv.y));
    const inside = smoothstep(0, fadeMetres / (tb.x1 - tb.x0), edge);
    return { colour: texture(layer.texture, uv).rgb, inside };
  };
  let colour = vec3(...fallbackColour);
  if (tint?.far) {
    const far = tintSample(tint.far, tint.far.fadeMetres ?? 600);
    colour = mix(colour, far.colour, far.inside);
  }
  if (tint?.near) {
    const near = tintSample(tint.near, tint.near.fadeMetres ?? 300);
    colour = mix(colour, near.colour, near.inside);
  }
  return colour;
}

/* Both v2 representations use the same four detail samples. The polish only
   reuses channels from those samples for roughness: smooth putting turf stays
   quiet, while clumps and aggregate break up broad highlights. It adds scalar
   shader work, not textures, normal sampling, geometry or a render pass.
   graphicsPolish=false builds the previous constant-roughness material for A/B. */
function v2SurfaceDetail({ DETAIL, wp, shade, meta, graphicsPolish }) {
  const detailScale = shade.x.max(0.45);
  const fineSample = texture(DETAIL, wp.mul(detailScale.mul(0.11)));
  const macroSample = texture(DETAIL, wp.mul(0.0085));
  const sandSample = texture(DETAIL, wp.mul(0.22));
  const hardSample = texture(DETAIL, wp.mul(0.13));
  const turfDetail = fineSample.r.sub(0.5).mul(0.30).add(macroSample.b.sub(0.5).mul(0.18));
  const sandDetail = sandSample.r.sub(0.5).mul(0.16);
  const hardDetail = hardSample.g.sub(0.5).mul(0.13);
  const surfaceDetail = mix(mix(turfDetail, sandDetail, meta.g), hardDetail, meta.b);
  let roughness = float(0.97).sub(shade.z.mul(0.62));
  if (graphicsPolish) {
    // The existing bump strength describes the cut: green 0.13, rough 1.25.
    // Even at texture extrema the roughness change stays below 0.05. The
    // texture's existing mipmaps also remove this variation under minification.
    const turfAmount = clamp(shade.y, 0.1, 1.3).mul(0.06).add(0.02);
    const turfVariation = fineSample.g.sub(0.5).mul(turfAmount);
    const sandVariation = sandSample.g.sub(0.5).mul(0.045);
    const hardVariation = hardSample.r.sub(0.5).mul(0.065);
    roughness = roughness.add(mix(mix(turfVariation, sandVariation, meta.g), hardVariation, meta.b));
  }
  return { surfaceDetail, roughness: clamp(roughness, 0.42, 0.99), clumpSample: hardSample.g, grainSample: sandSample.r };
}

/* Natural ground grades into its neighbour over metres and keeps its physical
   ramp. Every other class is a CUT or a laid surface, and a cut is a line. */
const SOFT_EDGE_SURFACES = new Set([SURFACE.FOREST, SURFACE.HEATH, SURFACE.SHORE, SURFACE.WETLAND,
  SURFACE.ROCK, SURFACE.DIRT, SURFACE.MUD]);
/* a mower leaves a line a few centimetres wide; never thinner than this however
   close the camera comes, and never thinner than the pixel that has to draw it */
const CUT_EDGE_FLOOR_METRES = 0.03;

/* HEIGHT OF CUT, AS TONE. A mown line reads as real because the two sides are
   different HEIGHTS of grass, and taller grass shades itself: measured on nine
   reference renders (Trackman, EA PGA Tour) the taller cut sits at 0.70-0.73x
   the luminance of the shorter one at fairway->rough and 0.82-0.92x at
   green->collar. This palette separated its five turf classes by HUE alone --
   painted display luma rough 110, semi 107, fairway 105, fringe 95, green 94 --
   so even an exact contour had almost nothing to be the edge OF.

   The ratios are DISPLAY luminance against today's colour, and they lift the
   mown cuts rather than sink the rough, because rough is the class that runs
   to the horizon: darkening it 28% would darken the world. Rough stays 1.
   Resulting steps at strength 1: rough/fairway 0.85, semi/fairway 0.90,
   fringe/green 0.92 -- deliberately short of the references, an owner's-eye
   starting point; ?cuts= scales the whole table (0 = the palette as it was). */
const CUT_TONE = Object.freeze({
  [SURFACE.GREEN]: 1.32, [SURFACE.FRINGE]: 1.21, [SURFACE.TEE]: 1.15,
  [SURFACE.FAIRWAY]: 1.23, [SURFACE.SEMI]: 1.08,
});
/* millimetres of grass standing over the ground; sand sits BELOW its surround */
const CUT_HEIGHT_MM = Object.freeze({
  [SURFACE.GREEN]: 4, [SURFACE.TEE]: 9, [SURFACE.FRINGE]: 10, [SURFACE.FAIRWAY]: 13, [SURFACE.SEMI]: 28,
  [SURFACE.ROUGH]: 50, [SURFACE.SAND]: -25, [SURFACE.FOREST]: 50, [SURFACE.HEATH]: 50, [SURFACE.WETLAND]: 50,
  [SURFACE.SHORE]: 20,
});
/* Width of one mown pass, metres: a fairway unit cuts ~2.5 m and tournament
   pass here is a little over one; a green is walked at 0.55 m and drawn at a metre so it
   survives a camera further off than the fringe of the green; a collar lap and a
   tee pass are one mower wide. */
const MOW_BAND_METRES = Object.freeze({ fairway: 3.2, semi: 3.2, green: 1.1, fringe: 1.1, tee: 1.1 });
/* where two passes overlap the lay is mixed: the edge of a stripe is this wide */
const MOW_OVERLAP_METRES = 0.22;
/* how much of a stripe is left seen square across it, or from straight above */
const MOW_SEEN_ACROSS = 0.7;
/* the clean-up lap round a green: one pass, laid one way, so it reads as a band */
const MOW_CLEAN_UP_METRES = 1.2;
/* light-to-dark as DISPLAY luminance either side of the class's own tone */
const MOW_AMPLITUDE = Object.freeze({
  [SURFACE.FAIRWAY]: 0.05, [SURFACE.SEMI]: 0.025, [SURFACE.GREEN]: 0.04,
  [SURFACE.FRINGE]: 0.03, [SURFACE.TEE]: 0.04,
});
const CONTACT_CASTERS = new Set([SURFACE.GREEN, SURFACE.TEE, SURFACE.FRINGE, SURFACE.FAIRWAY, SURFACE.SEMI, SURFACE.SAND]);

function createClassSdfDecorator({ atlas, DETAIL, C, SHADE, debugMode, tint = null, graphicsPolish, surfaceRelief, look = 'real', uSun = null, cutTone = 0, mowStrength = 0 }) {
  const channels = atlas.data.channels;
  /* EXACT fields (exact-class-sdf.mjs) follow the vectors to a couple of
     centimetres, so their cut classes are drawn ONE PIXEL wide. The physical
     widths in surface.js were chosen for fields compiled from a binary mask,
     whose 25 cm waver a narrow ramp would show; on an exact field they are
     0.3-0.6 m of blur with nothing left to hide (measured on the GPU: 10-90%
     blend 0.41-0.53 m stock, 0.05-0.09 m one pixel, same contour). */
  const exactEdges = atlas.data.exactEdges === true;
  const classes = [...channels, SURFACE.ROUGH];
  const roughIndex = classes.length - 1;
  const styles = classes.map(sid => classStyle(C, SHADE, sid));
  const widths = classes.map(sid => surfaceTransitionWidthMetres(sid));
  const debugColours = classes.map(sid => surfaceDebugColour(sid));
  const swizzle = ['r', 'g', 'b', 'a'];
  return material => {
    material.userData.graphicsPolish = graphicsPolish && debugMode === 'off';
    material.userData.surfaceRelief = debugMode === 'off' ? surfaceRelief : 'off';
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
    /* One pixel's footprint on the ground, from the WORLD POSITION and not from
       the distance: fwidth of a bilinearly filtered field is piecewise constant
       per texel and jumps at every texel border. */
    const pixelHalf = exactEdges ? fwidth(wp).length().mul(0.7).max(CUT_EDGE_FLOOR_METRES) : null;
    /* A CUT class is a mown or a laid surface. Its edge is a line WHATEVER lies
       beside it: the first version of this kept "the wider of the pair" for
       every pair, so a road running along forest floor took the forest's 0.45 m
       ramp and came out crisp on its rough side and a metre of smear on the
       other (Lidingo, from above). Only natural against natural -- or against
       rough -- is a soft ramp. Rough is neither: it is what is left over. */
    const isCut = index => exactEdges && index !== roughIndex && !SOFT_EDGE_SURFACES.has(classes[index]);
    let classRaws;
    if (exactEdges) {
      /* No pairing is needed to know any of this. A cut is one pixel against
         anything, so it never asks what it meets; a natural class only asks
         whether a cut lies within a metre of the fragment, which is one max()
         over the cut distances; and natural against natural blends over ONE
         common ramp, the widest any of them has, which is symmetric by
         construction. The leader/runner-up chain below does the same job for
         fields that need it and costs ten nested selects per channel: measured
         on the RTX 3070 it took the terrain material's compile from 1.7 s to
         4.9 s, three seconds of every boot, and a phone compiles slower. */
      const cutDistances = sdfs.filter((_, index) => isCut(index));
      const nearestCut = cutDistances.length
        ? cutDistances.reduce((a, b) => max(a, b)) : float(-8);
      const meetsCut = smoothstep(-1.5, -0.5, nearestCut);
      const softRamp = Math.max(...classes.map((sid, index) => (isCut(index) ? 0 : widths[index])));
      const softWidth = mix(max(float(softRamp), pixelHalf), pixelHalf, meetsCut);
      classRaws = sdfs.map((sdf, index) => {
        const width = isCut(index) ? pixelHalf : softWidth;
        return smoothstep(width.negate(), width, sdf);
      });
    } else {
      const widthOf = index => float(widths[index]);
      const roughWidthNode = widthOf(roughIndex);
      /* A pair blends over the WIDER of its two widths, on both sides: with
         asymmetric widths one class fades before the other has risen and the
         sliver between reads as rough. Which class each one meets is found per
         fragment from the two largest distances -- the nearest other class of
         the leader is the runner-up, of everyone else it is the leader -- and
         when the runner-up is far (nothing else within a metre) the leader is
         meeting rough and takes rough's width. */
      let best = sdfs[0];
      let bestWidth = widthOf(0);
      let second = float(-8);
      let secondWidth = roughWidthNode;
      for (let index = 1; index < sdfs.length; index++) {
        const sdf = sdfs[index];
        const width = widthOf(index);
        const leads = sdf.greaterThan(best);
        const runsUp = sdf.greaterThan(second).and(leads.not());
        const nextSecond = select(leads, best, select(runsUp, sdf, second));
        const nextSecondWidth = select(leads, bestWidth, select(runsUp, width, secondWidth));
        best = select(leads, sdf, best);
        bestWidth = select(leads, width, bestWidth);
        second = nextSecond;
        secondWidth = nextSecondWidth;
      }
      const leaderMeets = select(second.greaterThan(float(-1)), secondWidth, roughWidthNode);
      /* physical half-width per class, widened only when the screen needs it */
      classRaws = sdfs.map((sdf, index) => {
        const meets = select(sdf.greaterThanEqual(best), leaderMeets, bestWidth);
        const width = fwidth(sdf).mul(0.75).max(max(float(widths[index]), meets));
        return smoothstep(width.negate(), width, sdf);
      });
    }
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
       gradual; groundTintColour fades near -> far -> the fallback colour. */
    const roughColour = groundTintColour(tint, wp, styles[roughIndex].colour);
    /* The surroundings' classes -- forest floor, heath, wetland, shore -- are
       painted by the tint outside the surface window, from the same rings and
       the same imagery. Inside it they must be painted the same way, or the
       window's edge is a square where a flat class colour meets a tinted one:
       measured, a near-black forest floor against a mottled green one. */
    /* The palette is linear and the two looks take it to the screen differently
       -- painted shows it as it is, the realistic finish squares most of it --
       so a DISPLAY ratio r is r^2.2 of linear colour in one and about r^1.1 in
       the other. */
    const toneExponent = look === 'ghibli' ? 2.2 : 1.1;
    /* The realistic palette is already at the references' fairway brightness
       (139 against Trackman's 141), so the full lift took it to 171. There the
       step comes from the primary rough standing darker (main.js groundAt) and
       only half of it from the cuts standing lighter. */
    const lift = (exactEdges ? cutTone : 0) * (look === 'ghibli' ? 1 : 0.5);
    const toneOf = sid => Math.pow(1 + ((CUT_TONE[sid] ?? 1) - 1) * lift, toneExponent);
    const colourNodes = styles.map((style, index) => (GROUND_TINT_CLASSES.has(classes[index])
      ? roughColour : vec3(...style.colour.map(v => v * toneOf(classes[index])))));
    const base = weights.reduce((acc, weight, index) => {
      const term = colourNodes[index].mul(weight);
      return acc ? acc.add(term) : term;
    }, null);
    const shade = blend4(index => styles[index].shade);
    const meta = blend4(index => styles[index].meta);

    const { surfaceDetail, roughness, clumpSample, grainSample } = v2SurfaceDetail({ DETAIL, wp, shade, meta, graphicsPolish });

    const fields = texture(atlas.texF, uvAtlas);
    /* an exact boot atlas stores the SIGNED distance across the hole in R (128 on
       the line); published chunks store the unsigned one, 255 = no route */
    const lateral = atlas.data.mowDirections
      ? fields.r.mul(255).sub(128).mul(atlas.data.lateralStepMetres) : null;
    const routeDistance = lateral ? lateral.abs() : fields.r.mul(255 * atlas.data.routeStepMetres);
    const ringDistance = fields.g.mul(255 * atlas.data.ringStepMetres);
    const routeValid = lateral ? float(1) : oneMinus(step(0.999, fields.r));
    const diagonal = wp.x.sub(wp.y).mul(0.70710678);
    let mowNode;
    if (exactEdges && mowStrength > 0 && atlas.data.mowDirections) {
      /* THE MOWING, AS IT IS DONE. A stripe is grass laid toward you or away from
         you, and this engine drew it as a soft sine wave at +/-2-4% in the
         realistic look and half that in the painted one -- present in the code,
         absent from the picture -- with the green cut in RINGS from its edge to
         its middle, which is how nobody mows a green.
           fairway  passes ALONG the hole, alternating straight across its whole
                    width off the SIGNED lateral coordinate, so they neither
                    mirror about the middle nor wrap round the ends of the line
           semi     one quieter pass beside the fairway, on the same coordinate
           green    straight passes one way, 35 degrees off the hole so they
                    never line up with the fairway's, and a clean-up lap round
                    the edge -- the only ring a green has
           collar   its perimeter laps
           tee      straight passes along the tee's own axis
         The first version of this drew each pass as ONE flat tone with a
         one-pixel edge, and it read as vector art: lanes on a running track. A
         mown pass is none of those things. Its edge is where two passes overlap,
         a hand's width of mixed lay (MOW_OVERLAP_METRES, never under a pixel); its
         tone wanders along its length with the grass (one low tap of the detail
         texture); and how much of it shows depends on where you stand -- strongest
         looking down the passes, where the laid blades face or turn from you,
         weakest across them and from straight above. A pattern finer than the
         pixel fades out before it can moire. */
      const footprint = fwidth(wp).length();
      const pass = (coordinate, k) => {
        const pixel = footprint.mul(k);
        const edge = max(pixel.mul(0.9), float(MOW_OVERLAP_METRES * k));
        return clamp(sin(coordinate.mul(k)).div(edge), -1, 1).mul(oneMinus(smoothstep(0.55, 1.7, pixel)));
      };
      const raw = vec2(fields.b, fields.a).mul(255).sub(127.5).div(127);
      const length = raw.length().max(0.001);
      const dir = raw.div(length);
      /* a vector whose length has left 1 is two holes' bearings blended across an
         ownership line: plain turf over that texel, not the blend */
      const settled = oneMinus(abs(length.sub(1)).mul(10)).clamp(0, 1);
      const along = wp.dot(dir);
      const across = wp.y.mul(dir.x).sub(wp.x.mul(dir.y));
      const greenCoordinate = across.mul(0.8192).sub(along.mul(0.5736));
      const cleanUp = oneMinus(smoothstep(MOW_CLEAN_UP_METRES - 0.2, MOW_CLEAN_UP_METRES + 0.2, ringDistance));
      const patterns = {
        [SURFACE.FAIRWAY]: pass(lateral, Math.PI / MOW_BAND_METRES.fairway),
        [SURFACE.SEMI]: pass(lateral, Math.PI / MOW_BAND_METRES.semi),
        [SURFACE.GREEN]: mix(pass(greenCoordinate, Math.PI / MOW_BAND_METRES.green), float(0.5), cleanUp),
        [SURFACE.FRINGE]: pass(ringDistance, Math.PI / MOW_BAND_METRES.fringe),
        [SURFACE.TEE]: pass(across, Math.PI / MOW_BAND_METRES.tee),
      };
      /* where you stand: the horizontal part of the view direction against the
         hole's bearing -- 0 from straight above or square across, 1 down the hole */
      const toCamera = cameraPosition.sub(positionWorld).normalize();
      const downThePasses = abs(toCamera.x.mul(dir.x).add(toCamera.z.mul(dir.y)));
      const seen = mix(float(MOW_SEEN_ACROSS), float(1), smoothstep(0.1, 0.8, downThePasses));
      /* the grass is not uniform along a pass */
      const wander = texture(DETAIL, wp.mul(0.017)).g.mul(0.7).add(0.65);
      /* a DISPLAY amplitude: x2.2 of linear colour painted, x1.1 realistic */
      const toLinear = (look === 'ghibli' ? 2.2 : 1.1) * mowStrength;
      let mow = null;
      classes.forEach((sid, index) => {
        if (!patterns[sid]) return;
        /* a collar's laps run every way round, so where you stand takes nothing
           from them; a straight pass has a direction and does depend on it */
        const directional = sid === SURFACE.FRINGE ? float(1) : seen.mul(settled);
        const term = patterns[sid].mul(MOW_AMPLITUDE[sid] * toLinear).mul(weights[index]).mul(directional);
        mow = mow ? mow.add(term) : term;
      });
      /* paintedGround applies 0.55 of what it is handed; hand it the whole */
      mowNode = (mow || float(0)).mul(wander).div(look === 'ghibli' ? 0.55 : 1);
    } else {
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
      mowNode = (mow || float(0)).mul(0.045);
    }
    const pavingWeight = weights.reduce((sum, weight, index) =>
      PAVED_SURFACES.includes(classes[index]) ? sum.add(weight) : sum, float(0));
    let litBase = groundSurfaceAlbedo(base, pavingWeight, look === 'ghibli' ? 1 : 0.18);
    if (exactEdges && cutTone > 0) {
      /* THE CONTACT LINE. The taller cut stands over the shorter one and throws a
         thin shade onto ITS OWN side of the edge: for a caster class the line
         lives where that class's distance is just negative, decays as
         exp(d / L), is scaled by how much taller the ground there stands, and
         fades out as one pixel outgrows it -- a line thinner than a pixel is
         shimmer, not shade. A bunker sits 25 mm under its surround, so the same
         rule draws the lip's shadow on the grass round the sand. */
      const footprint = fwidth(wp).length();
      const standing = weights.reduce((acc, weight, index) => {
        const term = weight.mul(CUT_HEIGHT_MM[classes[index]] ?? 30);
        return acc ? acc.add(term) : term;
      }, null);
      const falloff = float(0.11).max(footprint.mul(1.2));
      let contact = float(0);
      channels.forEach((sid, index) => {
        if (!CONTACT_CASTERS.has(sid)) return;
        const rise = standing.sub(CUT_HEIGHT_MM[sid]);
        const amount = smoothstep(1, 5, rise).mul(float(0.07).add(saturate(rise.div(35)).mul(0.08))).mul(cutTone);
        contact = contact.max(sdfs[index].min(0).div(falloff).exp().mul(oneMinus(weights[index])).mul(amount));
      });
      litBase = litBase.mul(oneMinus(contact.mul(oneMinus(smoothstep(0.12, 0.5, footprint)))));
    }
    if (look === 'ghibli') {
      const painted = paintedGround({ base: litBase, wp, DETAIL, uSun, mow: mowNode, turf: oneMinus(meta.g.max(meta.b)), seasonal: meta.a });
      material.colorNode = painted.colorNode;
      material.roughnessNode = painted.roughnessNode;
      material.metalness = 0;
      material.userData.terrainPreviewTextures = [];
      material.userData.surfaceDebugMode = debugMode;
      material.userData.surfaceRepresentation = 'class-sdf-v1';
      material.userData.surfaceChannels = [...channels];
      return material;
    }
    material.colorNode = litBase.mul(float(1).add(surfaceDetail).add(mowNode));
    material.roughnessNode = surfaceRelief === 'off' ? roughness
      : roughness.sub(mowNode.mul(surfaceRelief === 'high' ? 0.18 : 0.10)).clamp(0.42, 0.99);
    if (surfaceRelief !== 'off') {
      material.normalNode = createGroundReliefNormal({ baseNormal: material.normalNode,
        clumpSample, grainSample, wp, shade, meta, tier: surfaceRelief, textureSize: DETAIL.image.width });
    }
    material.metalness = 0;
    /* the atlas owns its textures; nothing was created here to dispose */
    material.userData.terrainPreviewTextures = [];
    material.userData.surfaceDebugMode = debugMode;
    material.userData.surfaceRepresentation = 'class-sdf-v1';
    material.userData.surfaceChannels = [...channels];
    return material;
  };
}

export function createV2GroundMaterialDecorator({ atlas, DETAIL, C, SHADE, debugMode = 'off', tint = null, graphicsPolish = false, surfaceRelief = 'off', look = 'real', uSun = null, cutTone = 0, mowStrength = 0 }) {
  if (!(cutTone >= 0 && cutTone <= 2)) throw new TypeError('cutTone must lie in 0..2');
  if (!(mowStrength >= 0 && mowStrength <= 2)) throw new TypeError('mowStrength must lie in 0..2');
  if (!['off', 'weights'].includes(debugMode)) throw new TypeError(`unknown surface debug mode: ${debugMode}`);
  if (typeof graphicsPolish !== 'boolean') throw new TypeError('graphicsPolish must be a boolean');
  groundReliefTier(surfaceRelief);
  if (!graphicsPolish) surfaceRelief = 'off';
  if (look === 'ghibli' && !uSun) throw new TypeError('the painted ground needs the sun uniform');
  if (atlas?.data?.representation === 'class-sdf-v1') {
    if (!atlas.texSdf?.length || !atlas.texF || !atlas.data.channels?.length) {
      throw new TypeError('the per-class v2 terrain material requires SDF textures and a channel palette');
    }
    return bindV2SurfaceAuthority(
      createClassSdfDecorator({ atlas, DETAIL, C, SHADE, debugMode, tint, graphicsPolish, surfaceRelief, look, uSun }),
      atlas,
    );
  }
  if (atlas?.exactEdges) {
    /* The boot atlas carries exact per-class fields beside its class raster.
       They are drawn by the class-SDF material; the AUTHORITY stays the atlas
       the live adapter inspected, because it is that atlas's own outline. */
    const exact = atlas.exactEdges;
    const view = {
      bounds: atlas.bounds, texSdf: exact.texSdf, texF: exact.texF,
      data: { channels: exact.channels, routeStepMetres: exact.routeStepMetres,
        ringStepMetres: exact.ringStepMetres, lateralStepMetres: exact.lateralStepMetres,
        exactEdges: true, mowDirections: true },
    };
    return bindV2SurfaceAuthority(
      createClassSdfDecorator({ atlas: view, DETAIL, C, SHADE, debugMode, tint, graphicsPolish, surfaceRelief, look, uSun, cutTone, mowStrength }),
      atlas,
    );
  }
  if (!atlas?.texID || !atlas?.texF) throw new TypeError('the v2 terrain material requires a ground atlas');
  const styleTexture = makeStyleTexture(C, SHADE, { includeNatural: true });
  const debugPaletteTexture = debugMode === 'weights' ? makeSurfaceDebugPaletteTexture() : null;
  return bindV2SurfaceAuthority(material => {
    material.userData.graphicsPolish = graphicsPolish && debugMode === 'off';
    material.userData.surfaceRelief = debugMode === 'off' ? surfaceRelief : 'off';
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
    /* The PAIR field: one distance per texel, to the edge between that texel's
       two classes. Fed the boot atlas (`?edges=pair`) it is a chamfer grown from
       the 1 m class raster, NOT from the vectors -- this comment used to say "a
       25 cm grid", which was true of the first published tiles and of nothing
       since -- so its contour follows the raster, and no pair field can hold a
       collar narrower than ~5 m. The default is the per-class exact field above. */
    const sdf = decodeSurfaceDistance(fields);
    const edgeWidth = fwidth(sdf).mul(0.75).max(0.22);
    const pair = guardedPairWeight({
      fieldTexture: atlas.texF, uvAtlas, texel: vec2(1 / b.w, 1 / b.h),
      filtered: sdf, halfWidth: edgeWidth, res: b.res, wp,
    });
    const primaryWeight = pair.weight;
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
    const roughColor = groundTintColour(tint, wp, C.rough);
    /* Meta.a is the shared ground-tint flag. This makes rough, forest, heath,
       wetland and shore use exactly the same procedural colour source as the
       Puttom class-SDF path while preserving the pair atlas as the sole
       (provisional) surface authority. */
    const primaryClassColor = mix(primaryColor.rgb, roughColor, primaryMeta.a);
    const secondaryClassColor = mix(secondaryColor.rgb, roughColor, secondaryMeta.a);
    const classColor = mix(secondaryClassColor, primaryClassColor, primaryWeight);
    const base = mix(roughColor, classColor, active);
    const roughShade = vec3(
      SHADE[SURFACE.ROUGH][0], SHADE[SURFACE.ROUGH][1], SHADE[SURFACE.ROUGH][2],
    );
    const classShade = mix(secondaryShade.rgb, primaryShade.rgb, primaryWeight);
    const shade = mix(roughShade, classShade, active);
    const strength = mix(float(0), mix(secondaryShade.a, primaryShade.a, primaryWeight), active);
    const meta = mix(secondaryMeta, primaryMeta, primaryWeight).mul(inBounds);

    const { surfaceDetail, roughness, clumpSample, grainSample } = v2SurfaceDetail({ DETAIL, wp, shade, meta, graphicsPolish });

    const routeDistance = fields.g.mul(255 / 4);
    const ringDistance = fields.a.mul(255 * 0.16);
    const routeValid = oneMinus(step(0.999, fields.g));
    const diagonal = wp.x.sub(wp.y).mul(0.70710678);
    /* the primary's cut, except deep inside a class whose primary is a bunker
       metres away -- see makeGround's note on the same watershed */
    const classBand = id => mowBand((k => ringDistance.mul(k.r)
      .add(routeDistance.mul(k.g).mul(routeValid))
      .add(diagonal.mul(k.b)))(texture(styleTexture, styleUv(id, 3))));
    const mow = mix(classBand(primaryId), classBand(secondaryId), pair.deepSecondary)
      .mul(strength).mul(0.045);
    const pavingWeight = mix(pavedClassWeight(secondaryId), pavedClassWeight(primaryId), primaryWeight).mul(inBounds);
    const litBase = groundSurfaceAlbedo(base, pavingWeight, look === 'ghibli' ? 1 : 0.18);
    if (look === 'ghibli') {
      const painted = paintedGround({ base: litBase, wp, DETAIL, uSun, mow, turf: oneMinus(meta.g.max(meta.b)), seasonal: meta.a.add(oneMinus(inBounds)) });
      material.colorNode = painted.colorNode;
      material.roughnessNode = painted.roughnessNode;
    } else {
      material.colorNode = litBase.mul(float(1).add(surfaceDetail).add(mow));
      material.roughnessNode = surfaceRelief === 'off' ? roughness
        : roughness.sub(mow.mul(surfaceRelief === 'high' ? 0.18 : 0.10)).clamp(0.42, 0.99);
      if (surfaceRelief !== 'off') {
        material.normalNode = createGroundReliefNormal({ baseNormal: material.normalNode,
          clumpSample, grainSample, wp, shade, meta, tier: surfaceRelief, textureSize: DETAIL.image.width });
      }
    }
    material.metalness = 0;
    material.userData.terrainPreviewTextures = [styleTexture];
    material.userData.surfaceDebugMode = debugMode;
    material.userData.surfaceRepresentation = 'pair-sdf-v1';
    return material;
  }, atlas);
}
