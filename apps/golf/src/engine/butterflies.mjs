/* BUTTERFLIES ROUND THE EYE (2 November, after serenity-blocks' Odyssey meadow life,
   src/rendering/odyssey/composition/odyssey-meadow-life.js).

   The air's motes are pollen and down; nothing in a summer meadow's air beat its
   wings. Now a few butterflies weave over the turf round the eye in the low
   views: a brimstone's yellow, a cabbage white, a common blue, a small
   tortoiseshell's orange. One instanced draw with no instance data, as the
   motes are: each one's home in a world-anchored lattice round the eye (a
   flight streams past them), its path a slow meander round that home a metre
   or two over the ground, its two wings hinged at the body and beating in
   quick bouts with short glides.

   Each is faded by its size on screen (no blot near the lens), toward the
   box's edge, and as the eye climbs past 6-14 m; drawn half again life size so
   a meadow's few read from a tee. Opaque wings cut to their shape; held still
   under reduced motion and pinned under det=1; each light's share in
   BUTTERFLIES.presets (none in the storm, the mist or the blue hour). */
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, cos, dot, float, fract, hash, instanceIndex,
  max, mix, normalize, positionGeometry, saturate, screenSize, sin, smoothstep, uniform, varying, vec2, vec3, vec4,
} from 'three/tsl';

export const BUTTERFLIES = Object.freeze({
  count: Object.freeze({ hi: 28, lo: 12 }),
  /* the box round the eye, metres (x, z), and the band they fly in over the ground under it */
  box: Object.freeze([26, 26]), height: Object.freeze([0.5, 1.9]),
  /* a wing's length (half the span), metres, drawn at 1.5 */
  wing: 0.028, scale: 1.5,
  /* faded out by their radius on screen, pixels */
  fadePixels: Object.freeze([22, 36]),
  /* faded out as the eye climbs this far over the ground under it */
  hideAbove: Object.freeze([6, 14]),
  beatHz: Object.freeze([9, 13]),
  /* brimstone, cabbage white, common blue, small tortoiseshell: upper side, linear-ish */
  colours: Object.freeze([[1.0, 0.86, 0.22], [0.96, 0.95, 0.9], [0.42, 0.62, 1.0], [0.98, 0.5, 0.16]]),
  presets: Object.freeze({ golden: 0.8, noon: 1, summer: 1, dawn: 0.5, midnight: 0.6, host: 0.25, bluehour: 0, storm: 0, mist: 0 }),
});

export const butterfliesFor = presetName => BUTTERFLIES.presets[presetName] ?? 0;

/** Two wings, each a quad hinged at x = 0 (aSide -1 left, +1 right), uv over the wing. */
export function createButterflyGeometry() {
  const P = [], S = [], U = [];
  for (const side of [-1, 1]) {
    const quad = [[0, -0.6], [1, -0.6], [1, 0.6], [0, 0.6]];
    const order = side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const k of order) {
      const [x, y] = quad[k];
      P.push(x * side, 0, y);
      S.push(side);
      U.push(x, y);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(S, 1));
  g.setAttribute('aWingUv', new THREE.Float32BufferAttribute(U, 2));
  return g;
}

export function createButterflies({ quality = 'hi', deterministic = false } = {}) {
  const B = BUTTERFLIES;
  const count = B.count[quality] ?? B.count.hi;
  const template = createButterflyGeometry();
  const geometry = new THREE.InstancedBufferGeometry();
  for (const name of ['position', 'aSide', 'aWingUv']) geometry.setAttribute(name, template.getAttribute(name));
  geometry.instanceCount = count;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

  const uTime = uniform(deterministic ? 7.25 : 0);
  const uGround = uniform(0), uShow = uniform(0), uAmount = uniform(0);
  const uSun = uniform(new THREE.Vector3(0, 1, 0)), uSunColour = uniform(new THREE.Color(1, 0.96, 0.9));
  const side = attribute('aSide', 'float'), wingUv = attribute('aWingUv', 'vec2');
  const vTone = varying(vec4(0), 'butterflyTone');

  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  material.name = 'Butterflies';
  material.fog = true;
  material.vertexNode = Fn(() => {
    const i = instanceIndex.toFloat();
    const h1 = hash(i.add(3.5)), h2 = hash(i.add(61.5)), h3 = hash(i.add(173.5)), h4 = hash(i.add(419.5)), h5 = hash(i.add(877.5));
    const box = vec2(...B.box);
    /* home in a world-anchored lattice round the eye; a meander round it */
    const t = uTime;
    const wander = vec2(sin(t.mul(mix(0.25, 0.5, h2)).add(h3.mul(30))).mul(2.2).add(sin(t.mul(0.9).add(h4.mul(20))).mul(0.5)),
      cos(t.mul(mix(0.2, 0.45, h3)).add(h1.mul(30))).mul(2.2).add(cos(t.mul(1.1).add(h5.mul(20))).mul(0.5)));
    const home = vec2(h1, h2).mul(box).add(wander);
    const rel = fract(home.sub(cameraPosition.xz).div(box).add(0.5)).sub(0.5).mul(box);
    const lift = mix(float(B.height[0]), float(B.height[1]), h4).add(sin(t.mul(mix(1.4, 2.2, h5)).add(h2.mul(40))).mul(0.25));
    const centre = vec3(cameraPosition.x.add(rel.x), uGround.add(lift), cameraPosition.z.add(rel.y)).toVar();
    /* heading: along its meander */
    const vx = cos(t.mul(mix(0.25, 0.5, h2)).add(h3.mul(30))), vz = sin(t.mul(mix(0.2, 0.45, h3)).add(h1.mul(30))).negate();
    const fwd = normalize(vec3(vx, 0.15, vz).add(vec3(0.001, 0, 0)));
    const right = normalize(vec3(fwd.z.negate(), 0, fwd.x));
    const upv = vec3(0, 1, 0);
    /* the beat: quick bouts, short glides with the wings half up */
    const beat = sin(t.mul(mix(B.beatHz[0], B.beatHz[1], h1)).mul(6.283).add(h5.mul(6)));
    const bout = smoothstep(-0.2, 0.3, sin(t.mul(0.8).add(h3.mul(17))));
    const angle = mix(float(0.55), beat.mul(0.95).add(0.25), bout);
    /* the wing turns about the body's axis: out along `right`, up by its angle */
    const p = positionGeometry, reach = p.x.abs();
    const wingDir = right.mul(side).mul(cos(angle)).add(upv.mul(sin(angle)));
    const size = float(B.wing * B.scale);
    const local = wingDir.mul(reach).add(fwd.mul(p.z)).mul(size);
    /* its radius on screen; faded past fadePixels, at the box's edge, with height */
    const view = cameraViewMatrix.mul(vec4(centre, 1));
    const depth = max(view.z.negate(), 0.01);
    const pixels = size.mul(cameraProjectionMatrix.element(1).y).mul(screenSize.y).mul(0.5).div(depth);
    const edge = max(rel.x.abs().div(B.box[0] / 2), rel.y.abs().div(B.box[1] / 2));
    const kept = h5.lessThan(uAmount);
    const fade = float(1).sub(smoothstep(B.fadePixels[0], B.fadePixels[1], pixels))
      .mul(float(1).sub(smoothstep(0.8, 1, edge))).mul(uShow).mul(kept.select(float(1), float(0)));
    /* colour: one of four, lit by the sun on its upper side */
    const pick = floor4(h2.mul(4));
    const colour = mix(mix(vec3(...B.colours[0]), vec3(...B.colours[1]), pick.equal(1).select(float(1), float(0))),
      mix(vec3(...B.colours[2]), vec3(...B.colours[3]), pick.equal(3).select(float(1), float(0))), pick.greaterThan(1.5).select(float(1), float(0)));
    const normal = normalize(wingDir.cross(fwd).mul(side));
    const lit = saturate(dot(normal, uSun)).abs().mul(0.55).add(0.45);
    vTone.assign(vec4(colour.mul(uSunColour).mul(lit), 1));
    return fade.greaterThan(0.02).select(cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(centre.add(local), 1)), vec4(0, 0, -2, 1));
  })();
  /* a wing's shape: a rounded forewing and hindwing, a dark edge */
  const shape = Fn(() => {
    const u = wingUv;
    const fore = u.sub(vec2(0.55, -0.18)).mul(vec2(1.05, 1.6)).length();
    const hind = u.sub(vec2(0.45, 0.32)).mul(vec2(1.3, 1.7)).length();
    return float(1).sub(smoothstep(0.42, 0.5, fore.min(hind)));
  })();
  /* darker at the body, as a wing's root is */
  material.colorNode = vec4(vTone.rgb.mul(mix(float(0.55), float(1), smoothstep(0.0, 0.3, wingUv.x))), 1);
  material.opacityNode = shape;
  material.alphaTest = 0.5;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'butterflies';
  mesh.frustumCulled = false;
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.visible = false;
  let amount = 0;
  return {
    mesh, count,
    setPreset(presetName, { sunDirection, sunColour } = {}) {
      amount = butterfliesFor(presetName);
      uAmount.value = amount;
      if (sunDirection) uSun.value.set(...sunDirection).normalize();
      if (sunColour !== undefined) {
        uSunColour.value.set(sunColour);
        const peak = Math.max(uSunColour.value.r, uSunColour.value.g, uSunColour.value.b, 1e-3);
        uSunColour.value.multiplyScalar(1 / peak);
      }
    },
    update({ dt, camera, groundY, still = false }) {
      const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
      if (!deterministic && !still) uTime.value += step;
      const ground = Number.isFinite(groundY) ? groundY : camera.position.y - 1.7;
      uGround.value = ground;
      const show = 1 - THREE.MathUtils.smoothstep(camera.position.y - ground, B.hideAbove[0], B.hideAbove[1]);
      uShow.value = show;
      mesh.visible = show > 0.01 && amount > 0.01;
    },
    snapshot: () => ({ count, amount, visible: mesh.visible, time: uTime.value }),
    dispose() { geometry.dispose(); template.dispose(); material.dispose(); mesh.removeFromParent(); },
  };
}

/* floor of a node in 0..4, as a float: four colours */
function floor4(x) { return x.floor().clamp(0, 3); }
