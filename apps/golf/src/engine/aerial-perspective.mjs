import { Color, Vector3 } from 'three/webgpu';
import { abs, cameraPosition, densityFogFactor, dot, exp, float, luminance, mix, normalize, output, positionWorld, pow, reference, renderGroup, saturate, select, smoothstep, uniform, vec4 } from 'three/tsl';

/* Keep atmospheric perspective on the whole landscape, including tree tiers
 * and water. Fully opaque pale FogExp2 turned wooded ridges into white cutouts.
 * A preset's transmittance floor retains some surface shading at long range.
 * Use Three's depth accessor so thick lines and instanced materials keep their
 * own view-depth calculation instead of fogging their template geometry.
 */

/* HAZE WARMS TOWARD THE SUN. Air between a low sun and the eye scatters the
   sun's colour forward, so distant hills toward the sun dissolve into its glow
   while those behind the viewer keep the plain haze. The haze takes the sky's
   own sun glow -- its colour, its lobe around the sun (painted-sky.mjs) and a
   preset share of its strength -- so ground, water and the sky's band under the
   horizon agree in every direction. The lobe is reckoned per vertex and
   interpolated: tree crowns, most of the frame's cost, shade no more per pixel. */
export const sunwardLobe = (direction, sun) => pow(saturate(dot(direction, sun).mul(0.5).add(0.5)), 6);

/* VALLEY MIST. At dawn and in the mist preset the air is thickest low down:
   mist lies in the hollows and over the water, and the course's higher ground
   stands out of it in soft layers. Its density is `density` per metre at and
   below the course's low ground (`base`, from the ground under the holes) and
   falls e-fold every `height` metres above. What a ray from the eye loses to it
   is 1 - exp(-density x length x the mean of exp(-h / height) along the ray),
   which has a closed form; it is reckoned per vertex and joins the haze in the
   same colour, so the sky's band under the horizon still meets it, and the
   haze's own ceiling (hazeMax) still keeps a far ridge shaded. */
export const VALLEY_MIST = Object.freeze({
  /* the base: this share of the ground under the holes lies below it */
  basePercentile: 0.25,
  /* the holes' lines are sampled every this many metres for it */
  sampleMetres: 10,
});

/** The share of the view a ray loses to the mist (the shader's own formula, for the tests and the base). */
export function valleyMistAmount({ fromY, toY, length, base, height, density }) {
  if (!(density > 0) || !(length > 0)) return 0;
  const a = Math.max(0, (fromY - base) / height), b = Math.max(0, (toY - base) / height), d = b - a;
  /* the mean of exp(-h) from a to b; for a nearly level ray its series, e^-a (1 - d/2), to a few parts in ten million */
  const mean = Math.abs(d) > 1e-3 ? (Math.exp(-a) - Math.exp(-b)) / d : Math.exp(-a) * (1 - d / 2);
  return 1 - Math.exp(-density * length * mean);
}

/** The mist's base for a course: the `basePercentile` height of the ground sampled along its holes' lines. */
export function valleyMistBase(heights) {
  const h = heights.filter(Number.isFinite).sort((x, y) => x - y);
  if (!h.length) return 0;
  return h[Math.min(h.length - 1, Math.floor(h.length * VALLEY_MIST.basePercentile))];
}

/* THE LIGHT'S GLAZE ON THE LAND (docs/visual-lights-2026-09-25.md). Green turf
   and crowns stay green under any light: a blue hour's blue fill or a storm's
   grey only dims them, so the blue hour read as a lit lawn under a night sky.
   A painter lays the light's colour over the whole land, so everything the haze
   reaches -- ground, crowns, trunks, buildings, water -- gives a share of its
   colour (`amount`) to the glaze's tint at its own brightness: the blue hour's
   land goes blue-grey, a storm's grey, dawn's rose. The sky takes no haze and
   no glaze. The glaze gives way over bright colours -- lamps pushed past white,
   the sun's glints -- which keep their own. None where a light has none:
   mix(c, ..., 0) is c, so those lights draw exactly what they did. */
export const GLAZE = Object.freeze({
  /* it gives way over this range of a colour's linear luminance */
  bright: [0.5, 1.0],
});

/** A preset's glaze: `glaze: { tint, amount }` in its painted atmosphere, none without; the tint at unit luminance (linear). */
export function glazeOf(preset, tint = new Color()) {
  const g = preset?.glaze, amount = Math.min(1, Math.max(0, g?.amount ?? 0));
  tint.setHex(amount > 0 ? g.tint ?? 0xffffff : 0xffffff);
  tint.multiplyScalar(1 / Math.max(1e-3, 0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b));
  return { tint, amount };
}

/** A colour under a glaze: a share of it laid in the tint at its own luminance, giving way over bright colours. */
export const glazeColour = (colour, tint, amount) => {
  const l = luminance(colour);
  return mix(colour, tint.mul(l), amount.mul(float(1).sub(smoothstep(GLAZE.bright[0], GLAZE.bright[1], l))));
};

/** A preset's valley mist: `valleyMist: { density, height }` in its painted atmosphere, none without. */
export const valleyMistOf = preset => {
  const m = preset?.valleyMist;
  return m && m.density > 0 && m.height > 0 ? { density: m.density, height: m.height } : { density: 0, height: 1 };
};

export function createAerialPerspective(fog, { sunward = true, valleyMist = false } = {}) {
  const settings = { maximum: 0.85 };
  // Match native fog's render-group references: the current scene's haze must
  // reach every material, including programs shared with the reflection bake.
  const colour = reference('color', 'color', fog).setGroup(renderGroup);
  const density = reference('density', 'float', fog).setGroup(renderGroup);
  const maximum = reference('maximum', 'float', settings).setGroup(renderGroup);
  const glow = uniform(new Color(0, 0, 0)).setGroup(renderGroup);
  const glowStrength = uniform(0).setGroup(renderGroup);
  const sun = uniform(new Vector3(0, 1, 0)).setGroup(renderGroup);
  const haze = densityFogFactor(density).mul(maximum);
  const mistDensity = uniform(0).setGroup(renderGroup), mistHeight = uniform(1).setGroup(renderGroup), mistBase = uniform(0).setGroup(renderGroup);
  /* ?valleymist=0 is the before: the haze alone. With no mist in the preset the
     sum below is the haze exactly (haze + 0), and never above its ceiling. */
  let amount = haze;
  if (valleyMist) {
    const a = cameraPosition.y.sub(mistBase).div(mistHeight).max(0), b = positionWorld.y.sub(mistBase).div(mistHeight).max(0), d = b.sub(a);
    const mean = select(abs(d).greaterThan(1e-3), exp(a.negate()).sub(exp(b.negate())).div(d), exp(a.negate()).mul(float(1).sub(d.mul(0.5))));
    const mist = float(1).sub(exp(mistDensity.mul(positionWorld.sub(cameraPosition).length()).mul(mean).negate())).toVertexStage();
    amount = haze.add(mist.mul(float(1).sub(haze))).min(maximum);
  }
  /* ?hazewarm=0 is the before: one haze colour in every direction */
  const hazeColour = sunward
    ? mix(colour, glow, sunwardLobe(normalize(positionWorld.sub(cameraPosition)), sun).mul(glowStrength)).toVertexStage()
    : colour;
  /* the haze over the land's colour, as three's fog() lays it, the light's glaze first:
     with no glaze (every light but those the audit gave one, and ?lights=before) the colour is the land's own */
  const glazeTint = uniform(new Color(1, 1, 1)).setGroup(renderGroup), glazeAmount = uniform(0).setGroup(renderGroup);
  const node = vec4(mix(glazeColour(output.rgb, glazeTint, glazeAmount), hazeColour, amount), output.a);
  const mistState = { density: 0, height: 1, base: 0 };
  return {
    node,
    setPreset(preset) {
      // The same colour instance carries the style's restrained fog tint.
      settings.maximum = preset.hazeMax ?? 0.85;
      glow.value.setHex(preset.skySunGlow ?? 0);
      glowStrength.value = sunward ? hazeGlowStrength(preset) : 0;
      sun.value.set(...preset.dir).normalize();
      const mist = valleyMist ? valleyMistOf(preset) : { density: 0, height: 1 };
      mistDensity.value = mistState.density = mist.density;
      mistHeight.value = mistState.height = mist.height;
      glazeAmount.value = glazeOf(preset, glazeTint.value).amount;
    },
    /** the course's low ground, from valleyMistBase */
    setMistBase(base) { mistBase.value = mistState.base = Number.isFinite(base) ? base : 0; },
    snapshot: () => ({ density: fog.density, maximum: settings.maximum, colour: fog.color.getHex(),
      glow: glow.value.getHex(), glowStrength: glowStrength.value, valleyMist: valleyMist ? { ...mistState } : null,
      glaze: { tint: glazeTint.value.toArray(), amount: glazeAmount.value } }),
  };
}

/** The share of the sky's sun glow the haze takes toward the sun. */
export const hazeGlowStrength = preset => (preset.skySunGlowStrength ?? 0) * (preset.hazeGlow ?? 0);
