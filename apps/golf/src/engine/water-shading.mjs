/* Water, shaded by hand rather than lit (main.js makeWater keeps the sheet's
   render passes, depth and mask; this is its colour and opacity, moved here
   unchanged so an isolated page can draw the player's own water).

   Running it through the standard BRDF makes the reflection colours behave as if they
   were paint: they get multiplied by the sun and the sky a second time and the fjord
   comes out as a flat pale sheet you would read as haze. What water actually looks
   like is almost entirely reflection and almost not at all diffuse, so this computes
   the four terms that matter -- what colour the depth is, what the sky looks like in
   the direction you are reflecting toward, where the sun's glare falls, and where the
   surface runs out into foam -- and writes the answer.

   `nordic` and `wind` are the water batch's (nordic-water.mjs): the lakes' light,
   and the ripples on the one wind; without them, the before. `road`, `mirror`,
   `relief` and `sea` are the water road pass's (water-road.mjs): the sun's road
   sparkling to the horizon, the water mirroring more of a low sun's glowing sky,
   the waves' relief from above, and the open sea, which has no far shore to
   mirror. `cloudShade` and `lanes` are the water from above's (water-above.mjs):
   the body in a cloud's shade as level ground is, and the calm and gusty patches
   seen from above. */
import { attribute, cameraPosition, color, float, mix, normalize, oneMinus, positionWorld, pow, reflect, saturate, smoothstep, texture, time, vec2, vec3 } from 'three/tsl';
import { paintedWaterShallow, paintedWaterDeep, paintedWaterSparkle } from './painted-world-lighting.mjs';
import { NORDIC_WATER, SLOPE_SCALE, expectedGlitter, reflectedSunGlow, treeLineShare, waterSun, waterSkyGlow, waterTreeLine,
  waterFlow, waterChop, waterPatchChop } from './nordic-water.mjs';
import { sunRoad, mirrorShare, bodyRelief } from './water-road.mjs';
import { bodySunlit, bodyCloudShade, waterRoughness, waterLanes } from './water-above.mjs';

export function waterShading({ WATERN, DETAIL, sun, waterLighting, glint, chop, cloud = null, ocean = false, showBed = true, nordic = false, wind = false,
  road = false, mirror = false, relief = false, sea = false, cloudShade = false, lanes = false }) {
  const uSun = sun, uWaterGlint = glint, uWaterChop = chop;
  const aSh = attribute('aShore', 'float');
  const aFoam = attribute('aFoam', 'float');
  const wp = positionWorld.xz;
  const t = time;

  /* Four wave scales crossing at four angles. One scrolling layer repeats visibly;
     four at incommensurate speeds do not, and the two fine ones fade out with
     distance where they would otherwise be finer than a pixel and just shimmer. */
  const cd = cameraPosition.sub(positionWorld).length();
  const near = oneMinus(smoothstep(90, 900, cd));
  /* on the one wind each layer drifts downwind by the offset the air has carried it
     (nordic-water.mjs); ?waterwind=0 keeps each on its own clock and heading */
  const drift = (i, scale, own) => wind ? wp.mul(scale).sub(waterFlow[i]) : wp.mul(scale).add(own);
  const n1 = texture(WATERN, drift(0, 0.115, vec2(t.mul(0.028), t.mul(0.017)))).xy.sub(0.5);
  const n2 = texture(WATERN, drift(1, 0.052, vec2(t.mul(-0.021), t.mul(0.033)))).xy.sub(0.5);
  const n3 = texture(WATERN, drift(2, 0.245, vec2(t.mul(0.047), t.mul(-0.038)))).xy.sub(0.5);
  const n4 = texture(WATERN, drift(3, 0.014, vec2(t.mul(0.008), t.mul(0.011)))).xy.sub(0.5);
  /* The fine chop is kept at three tenths out to the horizon rather than faded to
     nothing. Water seen far off is almost all reflection, and if the reflection is
     unbroken it is a mirror of a pale sky -- which is to say, indistinguishable from
     haze. The glitter is the thing that says water. */
  /* a pond has no fetch: the fjord's chop on a 20 m pond tilted enough normals that
     the fresnel term fired everywhere and fifteen ponds rendered as ice sheets */
  /* the chop follows the wind, and the air carries calm and gusty patches across a lake */
  const patchChop = wind ? waterPatchChop({ p: wp, distance: cd }) : null;
  const rippleAmp = wind ? mix(float(0.38), float(1), aFoam).mul(waterChop).mul(patchChop)
    : mix(float(0.38), float(1), aFoam);
  const fineWeight = near.mul(0.45).add(0.30).mul(uWaterChop), finestWeight = near.mul(0.30).add(0.16).mul(uWaterChop);
  const ripple = n1.mul(near.mul(0.45).add(0.30)).add(n3.mul(near.mul(0.30).add(0.16))).mul(uWaterChop)
                   .add(n2.mul(0.7)).add(n4.mul(0.9)).mul(rippleAmp);
  const waveSlope = ocean ? 0.4 : 0.55;
  const N = normalize(vec3(ripple.x.mul(waveSlope), float(1), ripple.y.mul(waveSlope)));

  const V = normalize(cameraPosition.sub(positionWorld));
  const fres = pow(oneMinus(saturate(N.dot(V))), 4.2).mul(0.93).add(0.035);

  /* The preview uses the indirect-light palette for the analytic reflection.
     Angle, Fresnel, waves and the water body's own depth colours stay the same. */
  const R = reflect(V.negate(), N);
  const up = saturate(R.y);
  const sunUp = uSun.y.max(0.02);
  let skyC = waterLighting.reflectedSkyColour(up, sunUp);
  let glowShare = null;
  if (nordic) {
    /* the sky's own sun glow, as the sky draws it, then the far shore's wood in front of it: a lake's in
       full, a pond's half, none on the open sea (the ocean's sheets, and with `sea` every sea's) */
    glowShare = reflectedSunGlow({ R, up, sun: uSun });
    skyC = mix(skyC, waterSkyGlow, glowShare);
    if (!ocean && !sea) {
      /* the shore is read off a calmer surface: a quarter of the chop near, none far (nordic-water.mjs) */
      const { calm, calmFarMetres } = NORDIC_WATER.treeLine;
      const shoreTilt = oneMinus(smoothstep(calmFarMetres[0], calmFarMetres[1], cd)).mul(waveSlope * calm);
      const Rs = reflect(V.negate(), normalize(vec3(ripple.x.mul(shoreTilt), float(1), ripple.y.mul(shoreTilt))));
      skyC = mix(skyC, waterTreeLine, treeLineShare({ R: Rs, up: saturate(Rs.y) }).mul(mix(float(NORDIC_WATER.treeLine.pond), float(1), aFoam)));
    }
  }

  /* depth: the bed falls away from the bank, so the shallows keep their own colour.
     The ramp is the water's own scale -- 30 m of shallows suits a fjord, but on a
     pond whose whole radius is ten metres it kept every pixel pale */
  /* the deep body is the blue the club's aerials show, not steel grey */
  const depth = smoothstep(0.0, 1.0, saturate(aSh.div(ocean ? float(14) : mix(float(7), float(30), aFoam))));
  /* the regulated fjärd's bottom reading up through thin water: pale silt in the
     shallowest film, then the dark olive weed the close aerial shows */
  const aDp = attribute('aDepth', 'float');
  // A surface-only DTM supplies no bed observation. Keep its water shader
  // independent of the coplanar terrain instead of displaying invented silt.
  const bed = showBed ? oneMinus(smoothstep(0.12, 1.1, aDp)).mul(aFoam) : float(0);
  const bedCol = mix(color(0x8a7a5c), color(0x2e4a35), smoothstep(0.18, 0.6, aDp));

  /* the share of the sun past the clouds, read per pixel here, where a pond's few large triangles would blur
     the cloud's edge per vertex: the sparkle's, and with `cloudShade` the body's (water-above.mjs) */
  const sunlit = cloud ? cloud.sunlightAt(positionWorld) : null;
  const bodySun = cloudShade && sunlit ? bodySunlit({ sunlit, V, sunUp: uSun.y }) : null;
  const shade = bodySun ? bodyCloudShade(bodySun) : null;
  /* from above, the calm and gusty patches: glassy and ruffled (water-above.mjs) */
  const rough = lanes && patchChop ? waterRoughness({ chop: patchChop, V }) : null;

  // Teal shallows, blue depths and the active atmosphere's reflected sky.
  let body = mix(paintedWaterShallow, paintedWaterDeep, depth);
  body = mix(body, bedCol, bed.mul(0.6));
  /* the waves from above: a facet toward the sun lighter, away darker (water-road.mjs), as rough as the patch, giving
     way in a cloud's shade */
  if (relief) body = body.mul(bodyRelief({ N, sun: uSun, sunlit: bodySun, rough }));
  /* from above: the body in a cloud's shade as level ground is, and ruffled water a little lighter (water-above.mjs) */
  if (shade) body = body.mul(shade);
  if (rough) body = body.mul(waterLanes({ chop: patchChop, V }));
  /* toward a low sun the water mirrors more of its glowing sky (water-road.mjs) */
  let c = mix(body, skyC, mirror && glowShare ? mirrorShare({ fres, glow: glowShare }) : fres.mul(0.42));
  /* the sun's own reflection -- the single thing that says a surface is moving */
  const H = normalize(V.add(uSun));
  /* painted sparkle: dabs of white where the ripple faces the sun, not a pinpoint glint */
  /* a cloud's shade puts the sparkle out (`sunlit`, above) */
  const dabs = smoothstep(0.985, 0.996, saturate(N.dot(H)));
  /* the water batch's road: past a few hundred metres the dabs gave way to their expectation over the
     ripples' own spread of slopes (these very weights, chop and slope), in the sun's colour (nordic-water.mjs) */
  const sigma = nordic && !road ? fineWeight.mul(fineWeight).add(finestWeight.mul(finestWeight)).add(0.7 * 0.7 + 0.9 * 0.9).sqrt()
    .mul(rippleAmp).mul(waveSlope * SLOPE_SCALE) : null;
  /* THE SUN'S ROAD, SPARKLING TO THE HORIZON: the dabs at every distance, brighter toward grazing, in the sun's
     colour, put out by a cloud's shade only under a high sun (water-road.mjs) */
  const sparkle = road
    ? waterSun.mul(sunRoad({ nh: N.dot(H), vh: V.dot(H), sunUp: uSun.y, sunlight: sunlit }))
      .mul(paintedWaterSparkle).mul(uWaterGlint)
    : nordic
    ? waterSun.mul(mix(expectedGlitter({ V, L: uSun, sigma }), dabs, oneMinus(smoothstep(NORDIC_WATER.sharpMetres[0], NORDIC_WATER.sharpMetres[1], cd))))
      .mul(paintedWaterSparkle).mul(uWaterGlint)
    : color(0xfff4d9).mul(dabs).mul(paintedWaterSparkle).mul(uWaterGlint);
  c = c.add(sunlit && !road ? sparkle.mul(sunlit) : sparkle);
  /* foam, broken up by noise so a shoreline is a shoreline and not a stripe */
  /* Foam only where there is enough water behind it to make a wave. A metre-deep
     pond in a field has none at all, and drawing a three-metre white band round every
     one of them made fifteen ponds look like fifteen holes cut in an ice sheet. The
     lake gets a thin, broken line -- thresholded against noise so it is a scatter of
     wash rather than a rim. */
  const fw = texture(DETAIL, drift(4, 0.55, vec2(t.mul(0.035), t.mul(0.02)))).g;
  const foam = saturate(oneMinus(smoothstep(0.15, ocean ? 0.7 : 1.5, aSh)).mul(smoothstep(0.44, 0.72, fw)))
                 .mul(aFoam).mul(oneMinus(bed.mul(0.85)));
  /* the wash is lit as the ground is, and takes the body's cloud shade */
  c = mix(c, shade ? color(0xdfeeee).mul(shade) : color(0xdfeeee), foam.mul(ocean ? 0.4 : 0.24));

  /* a pond bed a metre down should be a hint, not the picture: ponds start denser */
  const opacity = mix(mix(float(0.86), float(0.97), depth),
                      mix(float(0.62), float(0.97), depth), aFoam)
                    .add(foam.mul(0.2)).sub(bed.mul(0.28)).clamp(0.4, 1);
  return { colour: c, opacity, wp };
}
