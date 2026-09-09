import {
  Fn, float, max, min, normalize, oneMinus, positionView, positionWorld,
  cameraPosition, smoothstep,
} from 'three/tsl';

export const GROUND_RELIEF_TIERS = Object.freeze({
  low: Object.freeze({ fadeStartMetres: 5, fadeEndMetres: 14, maximumSlope: 0.22, clumpMetres: 0.03, sandMetres: 0.009 }),
  high: Object.freeze({ fadeStartMetres: 10, fadeEndMetres: 28, maximumSlope: 0.35, clumpMetres: 0.045, sandMetres: 0.014 }),
});

export function groundReliefTier(value = 'off') {
  if (!['off', 'low', 'high'].includes(value)) throw new TypeError(`unknown ground relief tier: ${value}`);
  return value;
}

/** Surface-gradient bump mapping around the DECODED terrain normal in view
 * space. Three's generic bumpMap starts from the geometry normal instead and
 * takes two additional texture samples. Here the existing fixed-world-scale
 * samples supply derivatives; the low tier omits the fine-grain band entirely.
 * Weights/fades multiply gradients AFTER differentiation, avoiding fake lips
 * at material boundaries and circular ridges at the distance cutoff.
 */
export function createGroundReliefNormal({ baseNormal, clumpSample, grainSample, wp, shade, meta, tier, textureSize }) {
  groundReliefTier(tier);
  if (tier === 'off') return baseNormal;
  if (!baseNormal?.isNode) throw new TypeError('ground relief requires the terrain normal');
  const policy = GROUND_RELIEF_TIERS[tier];
  return Fn(() => {
    const normal = normalize(baseNormal).toVar();
    const dx = positionView.dFdx().toVar(), dy = positionView.dFdy().toVar();
    const r1 = dy.cross(normal).toVar(), r2 = normal.cross(dx).toVar();
    const determinant = dx.dot(r1).toVar();
    const footprint = max(wp.dFdx().length(), wp.dFdy().length()).toVar();
    const rangeFade = oneMinus(smoothstep(policy.fadeStartMetres, policy.fadeEndMetres,
      cameraPosition.sub(positionWorld).length()));
    // G is smooth three-octave clump noise, with its finest lattice at about
    // 0.23 cycles/texel. R is texel-scale grain and needs the earlier fade below.
    const clumpFade = oneMinus(smoothstep(0.75, 2, footprint.mul(textureSize * 0.13 * 0.23)));
    const clumpAmount = shade.y.clamp(0.1, 1.3).mul(policy.clumpMetres)
      .mix(float(policy.sandMetres), meta.g).mul(clumpFade);
    let hx = clumpSample.dFdx().mul(clumpAmount);
    let hy = clumpSample.dFdy().mul(clumpAmount);
    if (tier === 'high') {
      const grainFade = oneMinus(smoothstep(0.35, 1.1, footprint.mul(textureSize * 0.22)));
      const grainAmount = shade.y.clamp(0.1, 1.3).mul(0.004).add(0.002)
        .mix(float(0.004), meta.g).mul(grainFade);
      hx = hx.add(grainSample.dFdx().mul(grainAmount));
      hy = hy.add(grainSample.dFdy().mul(grainAmount));
    }
    const gradient = r1.mul(hx).add(r2.mul(hy))
      .mul(determinant.sign().div(max(determinant.abs(), 1e-10))).toVar();
    // Limit extreme derivatives at grazing angles and keep hard surfaces on
    // their existing material. This changes lighting only, never displacement.
    const bounded = min(float(1), float(policy.maximumSlope).div(max(gradient.length(), 1e-8)));
    return normalize(normal.sub(gradient.mul(bounded).mul(rangeFade).mul(oneMinus(meta.b))));
  })();
}
