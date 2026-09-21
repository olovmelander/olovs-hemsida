/* Historical realistic shaders for isolated inspection fixtures, never player modes. */
import { float, vec3, texture, cameraPosition, positionWorld, mix, smoothstep,
  clamp, pow, abs, normalize, oneMinus, bumpMap, saturate } from 'three/tsl';
import { createGroundReliefNormal } from '../engine/ground-surface-relief.mjs';
import { makeGround as makeGroundCore, createV2GroundMaterialDecorator as createV2DecoratorCore } from '../engine/ground-material-core.mjs';
import { makeGround as makePaintedGround, createV2GroundMaterialDecorator as createPaintedDecorator } from '../engine/material.js';

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


const REALISTIC_SHADING = {
  toneExponent: 1.1, cutLift: 0.5, mowDivisor: 1,
  vertexLinearShare: 0, atlasLinearShare: 0.18, requiresSun: false,
  vertexAlbedo: colour => colour.mul(colour),
  finishGround({ material: m, col, wp, DETAIL, SANDN, uSun, det, bmp, gls, strength, band, sandWeight, hardWeight }) {
    const cd = cameraPosition.sub(positionWorld).length();
    const near = oneMinus(smoothstep(60, 420, cd));
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
  },
  finishV2({ material, litBase, wp, DETAIL, mow, shade, meta, graphicsPolish, surfaceRelief }) {
    const { surfaceDetail, roughness, clumpSample, grainSample } = v2SurfaceDetail({ DETAIL, wp, shade, meta, graphicsPolish });
    material.colorNode = litBase.mul(float(1).add(surfaceDetail).add(mow));
    material.roughnessNode = surfaceRelief === 'off' ? roughness
      : roughness.sub(mow.mul(surfaceRelief === 'high' ? 0.18 : 0.10)).clamp(0.42, 0.99);
    if (surfaceRelief !== 'off') {
      material.normalNode = createGroundReliefNormal({ baseNormal: material.normalNode,
        clumpSample, grainSample, wp, shade, meta, tier: surfaceRelief, textureSize: DETAIL.image.width });
    }
  },
};

export function makeGround(options) {
  return options.look === 'ghibli' ? makePaintedGround(options) : makeGroundCore(options, REALISTIC_SHADING);
}

export function createV2GroundMaterialDecorator(options) {
  return options.look === 'ghibli' ? createPaintedDecorator(options) : createV2DecoratorCore(options, REALISTIC_SHADING);
}
