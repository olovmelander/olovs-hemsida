/* THE AIR'S MOTES (ported from serenity-blocks' Odyssey air motes,
   src/rendering/odyssey/composition/odyssey-air-motes.js).

   The course's air was empty: nothing between the eye and a treeline 200 m
   away, so a still view had no depth cue nearer than the turf and no motion
   but the clouds and the flags. Now pollen and a seed's down drift through a
   box of air round the eye. Against a low sun they light up, the way dust
   does in a sunbeam; with the sun behind they are faint specks.

   One mesh of camera-facing quads with NO instance data: each mote's place
   follows from its index and the air in the vertex stage. The motes are
   WORLD-ANCHORED: the box wraps round the eye (horizontally centred on it,
   vertically standing on the ground under it), and the motes do not ride
   with the camera, so a flight streams through them with real parallax.
   They ride the one air (one-wind.mjs): carried downwind at its own speed,
   pollen with it and down at 0.6 of it, each drift wrapped to the box so a
   wrap never pops, and they hold still under reduced motion as the plants
   do; under det=1 their clock and drift are pinned.

   Additive light, premultiplied with the target's alpha left alone, sized to
   at least a pixel and a half so a far mote neither shimmers away nor glares,
   faded near the lens (no big quads in front of the camera, the fill-rate
   trap), toward the box's edge (no wrap pops), and out as the eye climbs
   above 20-45 m, as the grass round the ball does. Each light sets how much
   of each kind is in its air (none in the storm and the mist). A kind at 0
   draws nothing: its quads collapse off screen in the vertex stage, and with
   both at 0 the mesh is hidden. */
import * as THREE from 'three/webgpu';
import {
  Fn, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp, dot, exp, float, fract, hash,
  instanceIndex, max, mix, normalize, pow, positionGeometry, saturate, screenSize, sin, smoothstep, uniform, varying, vec3, vec4,
} from 'three/tsl';

export const AIR_MOTES = Object.freeze({
  /* how many motes each quality draws */
  count: Object.freeze({ hi: 900, lo: 360 }),
  /* the box of air round the eye, metres (x, y, z): the near air, where a speck is more than a pixel */
  box: Object.freeze([40, 16, 40]),
  /* motes fade in from `near` and out by `far`, metres from the eye */
  near: 1.6, far: 30,
  /* radius in metres: a pollen speck, a seed's down */
  size: Object.freeze([0.02, 0.065]),
  minPixels: 1.5,
  /* the share of the air's speed each kind drifts at */
  drift: Object.freeze([1, 0.6]),
  /* faded out as the eye climbs this many metres above the ground under it */
  hideAbove: Object.freeze([20, 45]),
  /* toward the sun a mote takes up to 1 + gain of its light, in a lobe this tight */
  backlight: Object.freeze({ power: 8, gain: 1.8, base: 0.35 }),
  /* each light's air: [pollen, down], 0 to 1 */
  presets: Object.freeze({
    golden: [0.9, 0.6], noon: [0.45, 0.3], summer: [0.8, 0.7], dawn: [0.5, 0.3], midnight: [0.7, 0.5],
    bluehour: [0.12, 0.08], storm: [0, 0], mist: [0, 0], host: [0.2, 0.55],
  }),
});

/** How much of each kind a light's air holds: [pollen, down]. An unknown light holds none. */
export function airMotesFor(presetName) {
  const kinds = AIR_MOTES.presets[presetName];
  return kinds ? [...kinds] : [0, 0];
}

/** x wrapped into [0, period): the drift a mote box can wrap without a pop. */
export const wrapToBox = (x, period) => x - Math.floor(x / period) * period;

/**
 * @param {object} [options]
 * @param {'hi'|'lo'} [options.quality]
 * @param {boolean} [options.deterministic] det=1: the clock and the drift are pinned
 */
export function createAirMotes({ quality = 'hi', deterministic = false } = {}) {
  const A = AIR_MOTES;
  const count = A.count[quality] ?? A.count.hi;
  const plane = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = plane.index;
  geometry.setAttribute('position', plane.getAttribute('position'));
  geometry.instanceCount = count;

  const uTime = uniform(deterministic ? 3.25 : 0);
  const uKinds = uniform(new THREE.Vector2(0, 0));
  /* each kind's drift, metres, wrapped to the box: pollen (x, z) and down (x, z) */
  const uDrift = uniform(new THREE.Vector4(0, 0, 0, 0));
  const uBase = uniform(0);            // the box's floor: the ground under the eye, or lower when the eye is high
  const uShow = uniform(1);            // faded out as the eye climbs
  const uSun = uniform(new THREE.Vector3(0, 1, 0));
  const uSunColour = uniform(new THREE.Color(1, 0.96, 0.88));

  const material = new THREE.MeshBasicNodeMaterial();
  material.name = 'AirMotes';
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.premultipliedAlpha = true;
  material.fog = false;
  const vGlow = varying(vec4(0), 'airMoteGlow');
  const box = vec3(...A.box);
  material.vertexNode = Fn(() => {
    const i = instanceIndex.toFloat();
    const h1 = hash(i.add(0.5)).toVar(), h2 = hash(i.add(1337.5)).toVar(), h3 = hash(i.add(2741.5)).toVar();
    const h4 = hash(i.add(4099.5)).toVar(), h5 = hash(i.add(5813.5)).toVar();
    /* two in three are pollen, one in three down */
    const isDown = smoothstep(0.66, 0.67, h5);
    const strength = mix(uKinds.x, uKinds.y, isDown).mul(uShow).toVar();

    /* a world-anchored lattice of homes, carried downwind by the air, wobbling and bobbing */
    const t = uTime;
    const drift = mix(vec3(uDrift.x, 0, uDrift.y), vec3(uDrift.z, 0, uDrift.w), isDown);
    const wobble = vec3(sin(t.mul(mix(0.35, 0.9, h2)).add(h1.mul(40))), 0, sin(t.mul(mix(0.3, 0.8, h3)).add(h4.mul(50))))
      .mul(mix(0.4, 1.4, isDown));
    const bob = sin(t.mul(mix(0.5, 1.1, h3)).add(h2.mul(30))).mul(mix(0.2, 0.7, isDown));
    const q = vec3(h1, h2, h3).mul(box).add(drift).add(wobble).add(vec3(0, bob, 0));
    /* horizontally round the eye; vertically from the box's floor up */
    const relXZ = fract(q.xz.sub(cameraPosition.xz).div(box.xz).add(0.5)).sub(0.5).mul(box.xz);
    const y = fract(q.y.sub(uBase).div(box.y)).mul(box.y).add(uBase);
    const centre = vec3(cameraPosition.x.add(relXZ.x), y, cameraPosition.z.add(relXZ.y)).toVar();
    const rel = centre.sub(cameraPosition);
    const toEye = rel.length();
    const edge = max(relXZ.x.abs().div(A.box[0] / 2), relXZ.y.abs().div(A.box[2] / 2));
    const fade = smoothstep(A.near, A.near * 2.2, toEye)
      .mul(float(1).sub(smoothstep(A.far * 0.65, A.far, toEye)))
      .mul(float(1).sub(smoothstep(0.82, 1, edge)))
      .mul(strength).toVar();

    /* on screen at least a pixel and a half wide; its light spread thinner when drawn wider than it is */
    const view = cameraViewMatrix.mul(vec4(centre, 1));
    const depth = max(view.z.negate(), 0.01);
    const pixelAngle = float(2).div(cameraProjectionMatrix.element(1).y.mul(max(screenSize.y, 1)));
    const size = mix(float(A.size[0]), float(A.size[1]), isDown).mul(mix(0.7, 1.3, h2));
    const drawn = max(size, depth.mul(pixelAngle).mul(A.minPixels));
    const cover = size.div(drawn);
    const lifted = view.add(vec4(positionGeometry.xy.mul(drawn.mul(2)), 0, 0));

    /* light: a warm speck that flickers as it turns, or a white tuft; toward the sun, a sunbeam's glow */
    const toward = pow(saturate(dot(normalize(rel), uSun).mul(0.5).add(0.5)), A.backlight.power);
    const lit = toward.mul(A.backlight.gain).add(A.backlight.base);
    const turn = sin(t.mul(mix(3, 8, h3)).add(h2.mul(60))).mul(0.3).add(0.7);
    const tone = mix(vec3(1, 0.86, 0.55).mul(turn).mul(0.5), vec3(1, 0.99, 0.96).mul(0.75), isDown);
    const glow = tone.mul(uSunColour).mul(lit).mul(fade).mul(cover.mul(cover).mul(0.7).add(0.3)).mul(0.55);
    vGlow.assign(vec4(glow, isDown));
    return fade.greaterThan(0.002).select(cameraProjectionMatrix.mul(lifted), vec4(0, 0, -2, 1));
  })();
  material.colorNode = vec4(0, 0, 0, 1);
  material.outputNode = Fn(() => {
    const corner = positionGeometry.xy.mul(2);
    const r2 = dot(corner, corner);
    const speck = exp(r2.mul(-3.4));
    const tuft = exp(r2.mul(-2)).mul(0.7).add(exp(r2.mul(-8)).mul(0.5));
    return vec4(vGlow.xyz.mul(mix(speck, tuft, clamp(vGlow.w, 0, 1))), 0);
  })();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'air-motes';
  mesh.frustumCulled = false;
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.visible = false;
  const drift = [0, 0, 0, 0];
  let kinds = [0, 0];

  return {
    mesh,
    uniforms: { uTime, uKinds, uDrift, uBase, uShow, uSun, uSunColour },
    /** A light's air, its sun's direction (toward the sun) and colour. */
    setPreset(presetName, { sunDirection, sunColour } = {}) {
      kinds = airMotesFor(presetName);
      uKinds.value.set(kinds[0], kinds[1]);
      if (sunDirection) uSun.value.set(...sunDirection).normalize();
      if (sunColour !== undefined) {
        uSunColour.value.set(sunColour);
        const peak = Math.max(uSunColour.value.r, uSunColour.value.g, uSunColour.value.b, 1e-3);
        uSunColour.value.multiplyScalar(1 / peak);
      }
    },
    /**
     * Once a frame: `air` is the one air (velocity air.x, air.z in m/s), `groundY` the
     * ground under the eye; `still` is reduced motion.
     */
    update({ dt, air, camera, groundY, still = false }) {
      const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
      if (!deterministic && !still && step > 0) {
        uTime.value += step;
        const vx = air?.x ?? 0, vz = air?.z ?? 0;
        for (let k = 0; k < 2; k++) {
          drift[2 * k] = wrapToBox(drift[2 * k] + vx * A.drift[k] * step, A.box[0]);
          drift[2 * k + 1] = wrapToBox(drift[2 * k + 1] + vz * A.drift[k] * step, A.box[2]);
        }
        uDrift.value.set(...drift);
      }
      const eyeY = camera.position.y;
      const ground = Number.isFinite(groundY) ? groundY : eyeY - 1.7;
      uBase.value = Math.max(ground, eyeY - A.box[1] / 2);
      const above = eyeY - ground;
      const show = 1 - THREE.MathUtils.smoothstep(above, A.hideAbove[0], A.hideAbove[1]);
      uShow.value = show;
      mesh.visible = show > 0.002 && kinds[0] + kinds[1] > 0.002;
    },
    snapshot: () => ({ count, kinds: [...kinds], visible: mesh.visible, drift: [...drift], time: uTime.value }),
    dispose() {
      geometry.dispose(); plane.dispose(); material.dispose(); mesh.removeFromParent();
    },
  };
}
