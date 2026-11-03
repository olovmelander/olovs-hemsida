/* RAIN IN THE STORM (3 November, after serenity-blocks' Grainfields rain curtains).
   Oväder had its heavy deck, its wet course and its gale in the visible air, but
   nothing fell. Now rain does, through a box of air round the eye: streaks a
   little longer than a drop's travel in a frame, each a thin billboard turned
   about its fall to face the eye, slanted downwind by the storm's own air, and
   wrapped through the box (horizontally round the eye, vertically from the
   ground up) so nothing pops. One instanced draw with no instance data; faint
   additive light in the overcast sky's colour, at least a pixel wide and its
   light spread thinner when drawn wider than it is, faded near the lens, far off
   and at the box's edge. An overlay after the sky (render order 3), as the air's
   motes are. The storm only; a frozen curtain under reduced motion; pinned under
   det=1. ?rain=0 is the before. */
import * as THREE from 'three/webgpu';
import {
  Fn, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, cross, float, fract, hash, instanceIndex, max, mix,
  normalize, positionGeometry, screenSize, smoothstep, uniform, varying, vec3, vec4,
} from 'three/tsl';

export const RAIN = Object.freeze({
  count: Object.freeze({ hi: 2400, lo: 900 }),
  /* the box round the eye, metres (x, y, z) */
  box: Object.freeze([44, 26, 44]),
  /* a streak's length and width, metres; its fall, m/s; how much the wind slants it */
  length: 0.75, width: 0.009, fall: Object.freeze([8, 10.5]), slant: 0.05,
  near: 1.2, far: 38,
  /* the streaks' light: this share of the sky's colour, at most */
  light: 0.32,
  hideAbove: Object.freeze([40, 90]),
  presets: Object.freeze({ storm: 1 }),
});

export const rainFor = presetName => RAIN.presets[presetName] ?? 0;
const wrap = (x, period) => x - Math.floor(x / period) * period;

export function createRain({ quality = 'hi', deterministic = false } = {}) {
  const R = RAIN;
  const count = R.count[quality] ?? R.count.hi;
  const plane = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = plane.index;
  geometry.setAttribute('position', plane.getAttribute('position'));
  geometry.instanceCount = count;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

  const uTime = uniform(deterministic ? 2.75 : 0);
  const uWind = uniform(new THREE.Vector2(0, 0));
  const uDrift = uniform(new THREE.Vector2(0, 0));
  const uBase = uniform(0), uShow = uniform(0), uAmount = uniform(0);
  const uSky = uniform(new THREE.Color(0.7, 0.72, 0.75));
  const vLight = varying(vec4(0), 'rainLight');

  const material = new THREE.MeshBasicNodeMaterial();
  material.name = 'Rain';
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.premultipliedAlpha = true;
  material.fog = false;
  material.vertexNode = Fn(() => {
    const i = instanceIndex.toFloat();
    const h1 = hash(i.add(7.5)), h2 = hash(i.add(83.5)), h3 = hash(i.add(191.5)), h4 = hash(i.add(331.5));
    const box = vec3(...R.box);
    const speed = mix(float(R.fall[0]), float(R.fall[1]), h4);
    const home = vec3(h1, h2, h3).mul(box);
    const q = vec3(home.x.add(uDrift.x), home.y.sub(uTime.mul(speed)), home.z.add(uDrift.y));
    const relXZ = fract(q.xz.sub(cameraPosition.xz).div(box.xz).add(0.5)).sub(0.5).mul(box.xz);
    const y = fract(q.y.div(box.y)).mul(box.y).add(uBase);
    const centre = vec3(cameraPosition.x.add(relXZ.x), y, cameraPosition.z.add(relXZ.y)).toVar();
    /* the fall, slanted downwind; the streak turned about it to face the eye */
    const dir = normalize(vec3(uWind.x.mul(R.slant), speed.negate().div(R.fall[1]), uWind.y.mul(R.slant)));
    const toEye = cameraPosition.sub(centre);
    const side = normalize(cross(dir, toEye).add(vec3(1e-5, 0, 0)));
    const view = cameraViewMatrix.mul(vec4(centre, 1));
    const depth = max(view.z.negate(), 0.01);
    const pixelAngle = float(2).div(cameraProjectionMatrix.element(1).y.mul(max(screenSize.y, 1)));
    const drawn = max(float(R.width), depth.mul(pixelAngle));
    const cover = float(R.width).div(drawn);
    const world = centre.add(side.mul(positionGeometry.x.mul(drawn))).add(dir.mul(positionGeometry.y.mul(R.length)));
    const distance = toEye.length();
    const edge = max(relXZ.x.abs().div(R.box[0] / 2), relXZ.y.abs().div(R.box[2] / 2));
    const fade = smoothstep(R.near, R.near * 2.5, distance).mul(float(1).sub(smoothstep(R.far * 0.6, R.far, distance)))
      .mul(float(1).sub(smoothstep(0.85, 1, edge))).mul(smoothstep(0, 1, y.sub(uBase)))
      .mul(float(1).sub(smoothstep(R.box[1] * 0.85, R.box[1], y.sub(uBase))))
      .mul(uShow).mul(h2.lessThan(uAmount).select(float(1), float(0)));
    vLight.assign(vec4(uSky.mul(R.light).mul(fade).mul(cover.mul(0.8).add(0.2)), positionGeometry.y.add(0.5)));
    return fade.greaterThan(0.002).select(cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1)), vec4(0, 0, -2, 1));
  })();
  material.colorNode = vec4(0, 0, 0, 1);
  /* brightest at the streak's head, thinning up its tail */
  material.outputNode = vec4(vLight.rgb.mul(vLight.w.mul(0.8).add(0.2)), 0);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'rain';
  mesh.frustumCulled = false;
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.visible = false;
  let amount = 0;
  const drift = [0, 0];
  return {
    mesh, count,
    setPreset(presetName, { sky } = {}) {
      amount = rainFor(presetName);
      uAmount.value = amount;
      if (sky !== undefined) uSky.value.set(sky);
    },
    update({ dt, air, camera, groundY, still = false }) {
      const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
      const wx = air?.x ?? 0, wz = air?.z ?? 0;
      uWind.value.set(wx, wz);
      if (!deterministic && !still && step > 0) {
        uTime.value += step;
        drift[0] = wrap(drift[0] + wx * step, R.box[0]);
        drift[1] = wrap(drift[1] + wz * step, R.box[2]);
        uDrift.value.set(drift[0], drift[1]);
      }
      const ground = Number.isFinite(groundY) ? groundY : camera.position.y - 1.7;
      uBase.value = ground;
      const show = 1 - THREE.MathUtils.smoothstep(camera.position.y - ground, R.hideAbove[0], R.hideAbove[1]);
      uShow.value = show;
      mesh.visible = show > 0.01 && amount > 0.01;
    },
    snapshot: () => ({ count, amount, visible: mesh.visible, time: uTime.value }),
    dispose() { geometry.dispose(); plane.dispose(); material.dispose(); mesh.removeFromParent(); },
  };
}
