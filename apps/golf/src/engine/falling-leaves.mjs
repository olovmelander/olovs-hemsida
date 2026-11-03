/* FALLING LEAVES IN AUTUMN (3 November). Höst turned the crowns to gold and
   copper and laid ochre on the rough, but nothing came down out of them. Now a
   few hundred leaves fall through a box of air round the eye: each tumbles as
   it falls, swings on its own pendulum, drifts downwind on the one air, and
   comes round to the top of the box again (wrapped, so nothing pops). One
   instanced draw with no instance data, as the air's motes and the
   butterflies are; each leaf an oval card in one of the autumn ramp's colours,
   lit on the side the sun sees and darker turned away.

   Faded by its size on screen (no blot at the lens), toward the box's edge and
   as the eye climbs past 12-30 m; in Höst only (FALLING_LEAVES.presets); held
   still under reduced motion and pinned under det=1. ?leaves=0 is the before. */
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, cos, dot, float, fract, hash, instanceIndex,
  max, mix, normalize, positionGeometry, saturate, screenSize, sin, smoothstep, uniform, varying, vec2, vec3, vec4,
} from 'three/tsl';

export const FALLING_LEAVES = Object.freeze({
  count: Object.freeze({ hi: 420, lo: 160 }),
  /* the box round the eye, metres (x, y, z): from the ground under the eye up */
  box: Object.freeze([34, 9, 34]),
  /* a leaf's half-length, metres, drawn at 1.3 */
  size: 0.035, scale: 1.3,
  /* falling speed, m/s, and the share of the air's speed it drifts at */
  fall: Object.freeze([0.55, 1.1]), drift: 0.7,
  fadePixels: Object.freeze([18, 30]),
  hideAbove: Object.freeze([12, 30]),
  /* the birch's gold, the maple's orange, the oak's copper and crimson, a brown */
  colours: Object.freeze([[1.0, 0.74, 0.18], [0.95, 0.46, 0.1], [0.72, 0.2, 0.12], [0.55, 0.36, 0.16]]),
  presets: Object.freeze({ host: 1 }),
});

export const fallingLeavesFor = presetName => FALLING_LEAVES.presets[presetName] ?? 0;

/** x wrapped into [0, period). */
const wrap = (x, period) => x - Math.floor(x / period) * period;

export function createFallingLeaves({ quality = 'hi', deterministic = false } = {}) {
  const F = FALLING_LEAVES;
  const count = F.count[quality] ?? F.count.hi;
  const plane = new THREE.PlaneGeometry(2, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = plane.index;
  geometry.setAttribute('position', plane.getAttribute('position'));
  geometry.setAttribute('uv', plane.getAttribute('uv'));
  geometry.instanceCount = count;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

  const uTime = uniform(deterministic ? 5.5 : 0);
  const uDrift = uniform(new THREE.Vector2(0, 0));
  const uBase = uniform(0), uShow = uniform(0), uAmount = uniform(0);
  const uSun = uniform(new THREE.Vector3(0, 1, 0)), uSunColour = uniform(new THREE.Color(1, 0.95, 0.85));
  const uvAttr = attribute('uv', 'vec2');
  const vTone = varying(vec4(0), 'leafTone');

  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  material.name = 'FallingLeaves';
  material.fog = true;
  material.vertexNode = Fn(() => {
    const i = instanceIndex.toFloat();
    const h1 = hash(i.add(2.5)), h2 = hash(i.add(41.5)), h3 = hash(i.add(97.5)), h4 = hash(i.add(213.5)), h5 = hash(i.add(509.5));
    const box = vec3(...F.box);
    const t = uTime;
    /* falling, wrapped through the box's height; a pendulum's swing across it */
    const speed = mix(float(F.fall[0]), float(F.fall[1]), h2);
    const swing = vec3(sin(t.mul(mix(0.9, 1.6, h3)).add(h1.mul(30))), 0, cos(t.mul(mix(0.7, 1.3, h4)).add(h2.mul(30)))).mul(0.6);
    const home = vec3(h1, h3, h5).mul(box);
    const q = vec3(home.x.add(uDrift.x), home.y.sub(t.mul(speed)), home.z.add(uDrift.y)).add(swing);
    const relXZ = fract(q.xz.sub(cameraPosition.xz).div(box.xz).add(0.5)).sub(0.5).mul(box.xz);
    const y = fract(q.y.div(box.y)).mul(box.y).add(uBase);
    const centre = vec3(cameraPosition.x.add(relXZ.x), y, cameraPosition.z.add(relXZ.y)).toVar();
    /* the tumble: the card turns about two axes at its own rates */
    const a = t.mul(mix(1.5, 3.2, h4)).add(h5.mul(6.28)), b = t.mul(mix(0.8, 2.1, h1)).add(h3.mul(6.28));
    const u = vec3(cos(a), sin(a).mul(0.6), sin(a).mul(0.8));
    const v = normalize(vec3(sin(b).negate(), cos(b), sin(b).mul(0.3)).sub(u.mul(dot(u, vec3(sin(b).negate(), cos(b), sin(b).mul(0.3))))));
    const size = float(F.size * F.scale).mul(mix(0.8, 1.25, h3));
    const local = u.mul(positionGeometry.x).add(v.mul(positionGeometry.y)).mul(size);
    /* its size on screen, the box's edge, the eye's height, this light's share */
    const view = cameraViewMatrix.mul(vec4(centre, 1));
    const depth = max(view.z.negate(), 0.01);
    const pixels = size.mul(cameraProjectionMatrix.element(1).y).mul(screenSize.y).mul(0.5).div(depth);
    const edge = max(relXZ.x.abs().div(F.box[0] / 2), relXZ.y.abs().div(F.box[2] / 2));
    const kept = h2.lessThan(uAmount).select(float(1), float(0));
    const fade = float(1).sub(smoothstep(F.fadePixels[0], F.fadePixels[1], pixels))
      .mul(float(1).sub(smoothstep(0.82, 1, edge))).mul(uShow).mul(kept)
      /* in at the box's top and out at the ground, so the wrap never pops */
      .mul(smoothstep(0, 0.35, y.sub(uBase))).mul(float(1).sub(smoothstep(F.box[1] * 0.8, F.box[1], y.sub(uBase))));
    /* colour: one of four, lit on the side the sun sees */
    const pick = h4.mul(4).floor().clamp(0, 3);
    const c01 = mix(vec3(...F.colours[0]), vec3(...F.colours[1]), pick.equal(1).select(float(1), float(0)));
    const c23 = mix(vec3(...F.colours[2]), vec3(...F.colours[3]), pick.equal(3).select(float(1), float(0)));
    const colour = mix(c01, c23, pick.greaterThan(1.5).select(float(1), float(0)));
    const n = normalize(u.cross(v));
    const lit = saturate(dot(n, uSun).abs()).mul(0.6).add(0.4);
    vTone.assign(vec4(colour.mul(uSunColour).mul(lit), 1));
    return fade.greaterThan(0.02).select(cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(centre.add(local), 1)), vec4(0, 0, -2, 1));
  })();
  /* an oval leaf with a darker midrib */
  const leaf = Fn(() => {
    const p = uvAttr.sub(0.5).mul(vec2(2, 2));
    return float(1).sub(smoothstep(0.82, 1.0, p.mul(vec2(1, 1.25)).length()));
  })();
  material.colorNode = vec4(vTone.rgb.mul(mix(float(0.7), float(1), smoothstep(0.02, 0.09, uvAttr.y.sub(0.5).abs()))), 1);
  material.opacityNode = leaf;
  material.alphaTest = 0.5;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'falling-leaves';
  mesh.frustumCulled = false;
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.visible = false;
  let amount = 0;
  const drift = [0, 0];
  return {
    mesh, count,
    setPreset(presetName, { sunDirection, sunColour } = {}) {
      amount = fallingLeavesFor(presetName);
      uAmount.value = amount;
      if (sunDirection) uSun.value.set(...sunDirection).normalize();
      if (sunColour !== undefined) {
        uSunColour.value.set(sunColour);
        const peak = Math.max(uSunColour.value.r, uSunColour.value.g, uSunColour.value.b, 1e-3);
        uSunColour.value.multiplyScalar(1 / peak);
      }
    },
    update({ dt, air, camera, groundY, still = false }) {
      const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
      if (!deterministic && !still && step > 0) {
        uTime.value += step;
        drift[0] = wrap(drift[0] + (air?.x ?? 0) * F.drift * step, F.box[0]);
        drift[1] = wrap(drift[1] + (air?.z ?? 0) * F.drift * step, F.box[2]);
        uDrift.value.set(drift[0], drift[1]);
      }
      const ground = Number.isFinite(groundY) ? groundY : camera.position.y - 1.7;
      uBase.value = ground;
      const show = 1 - THREE.MathUtils.smoothstep(camera.position.y - ground, F.hideAbove[0], F.hideAbove[1]);
      uShow.value = show;
      mesh.visible = show > 0.01 && amount > 0.01;
    },
    snapshot: () => ({ count, amount, visible: mesh.visible, time: uTime.value }),
    dispose() { geometry.dispose(); plane.dispose(); material.dispose(); mesh.removeFromParent(); },
  };
}
