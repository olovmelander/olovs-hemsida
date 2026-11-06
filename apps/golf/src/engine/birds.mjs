/* BIRDS OVER THE COURSE (2 November, after serenity-blocks' Odyssey flights and
   the hinge-folded wings of its bird rig).

   Nothing moved in the course's sky but the clouds. Now a few loose flocks of
   gulls and crows wheel over it: one instanced draw with no instance data,
   every bird's place, heading and wingbeat reckoned in the vertex stage from
   its index and the clock. The flocks are WORLD-ANCHORED in cells round the
   eye (as the air's motes are), so a flight passes under them, and each bird
   rides a slow circle round its flock's centre, high enough to be sky and not
   course: `height` above the ground under the eye.

   The mesh is one bird: a body and two wings of two panels each, every vertex
   tagged with how far out along the wing it lies (`aWing`: 0 at the body, 1 at
   the wrist, 2 at the tip). A wingbeat lifts the wing about the shoulder and
   folds the outer panel about the wrist (the Odyssey rig's hinge, in miniature),
   in bouts of beats and glides; a far bird is drawn darker than the sky behind
   it, as a far bird must be to read. Held still under reduced motion and
   pinned under det=1; none in the storm, the mist or the blue hour. */
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, cameraPosition, cos, float, fract, hash, instanceIndex, mix, positionGeometry,
  sin, smoothstep, uniform, vec3, vec4, normalize, dot, saturate, floor,
} from 'three/tsl';

export const BIRDS = Object.freeze({
  /* flocks round the eye, birds a flock */
  flocks: 6, perFlock: 6,
  /* the flocks' cells: one flock to a cell this many metres across, wrapping round the eye */
  cell: 600,
  /* each bird's circle round its flock's centre, metres, and its height above the eye's ground */
  radius: Object.freeze([24, 60]), height: Object.freeze([30, 75]),
  /* a gull's span, metres, drawn half again larger so a bird at 300 m is a few pixels */
  span: 1.25, scale: 2,
  /* flight speed, m/s, and the beats: Hz, how many beats in a bout, how long a glide */
  speed: Object.freeze([7, 11]), beatHz: Object.freeze([2.6, 3.8]),
  /* each light's sky: 1 full, 0 none */
  presets: Object.freeze({
    golden: 1, noon: 0.85, summer: 1, dawn: 0.7, midnight: 0.8, host: 0.9, bluehour: 0, storm: 0, mist: 0,
    /* a clear winter day keeps a few flocks: crows and finches, not swallows */
    winter: 0.35,
  }),
});

/** How much of the flocks a light's sky holds, 0 to 1. */
export const birdsFor = presetName => BIRDS.presets[presetName] ?? 0;

/** One bird, nose along +x, span along z, wings tagged with their reach (aWing) and side (aSide). */
export function createBirdGeometry() {
  const half = BIRDS.span / 2;
  const P = [], W = [], S = [];
  const tri = (a, b, c, wa, wb, wc, side) => { P.push(...a, ...b, ...c); W.push(wa, wb, wc); S.push(side, side, side); };
  /* the body: a long diamond, top and bottom */
  const nose = [0.26, 0, 0], tail = [-0.24, 0, 0], l = [0, 0.03, 0.06], r = [0, 0.03, -0.06], keel = [0, -0.04, 0];
  tri(nose, l, r, 0, 0, 0, 0); tri(tail, r, l, 0, 0, 0, 0); tri(nose, keel, l, 0, 0, 0, 0); tri(nose, r, keel, 0, 0, 0, 0);
  tri(tail, l, keel, 0, 0, 0, 0); tri(tail, keel, r, 0, 0, 0, 0);
  for (const side of [1, -1]) {
    const z = v => v * side;
    /* inner panel shoulder to wrist, outer panel wrist to a swept tip */
    const s0 = [0.07, 0.02, z(0.05)], s1 = [-0.06, 0.02, z(0.05)];
    const w0 = [0.03, 0.02, z(half * 0.48)], w1 = [-0.10, 0.02, z(half * 0.46)];
    const tip = [-0.12, 0.02, z(half)];
    const a = side > 0 ? [s0, w0, w1, s1] : [s0, s1, w1, w0];
    tri(a[0], a[1], a[2], ...(side > 0 ? [0, 1, 1] : [0, 0, 1]), side);
    tri(a[0], a[2], a[3], ...(side > 0 ? [0, 1, 0] : [0, 1, 1]), side);
    tri(...(side > 0 ? [w0, tip, w1] : [w0, w1, tip]), 1, side > 0 ? 2 : 1, side > 0 ? 1 : 2, side);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(W, 1));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(S, 1));
  return g;
}

/**
 * @param {object} [options]
 * @param {boolean} [options.deterministic] det=1: the clock pinned
 */
export function createBirds({ deterministic = false } = {}) {
  const B = BIRDS;
  const count = B.flocks * B.perFlock;
  const template = createBirdGeometry();
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', template.getAttribute('position'));
  geometry.setAttribute('aWing', template.getAttribute('aWing'));
  geometry.setAttribute('aSide', template.getAttribute('aSide'));
  geometry.instanceCount = count;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

  const uTime = uniform(deterministic ? 41.5 : 0);
  const uGround = uniform(0);
  const uShow = uniform(0);
  const uSun = uniform(new THREE.Vector3(0, 1, 0));
  const uSky = uniform(new THREE.Color(0.6, 0.7, 0.85));
  const uSunColour = uniform(new THREE.Color(1, 0.95, 0.85));

  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  material.name = 'Birds';
  const wing = attribute('aWing', 'float'), side = attribute('aSide', 'float');
  material.positionNode = Fn(() => {
    const i = instanceIndex.toFloat();
    const flock = floor(i.div(B.perFlock));
    const h1 = hash(i.add(11.5)), h2 = hash(i.add(97.5)), h3 = hash(i.add(301.5));
    const f1 = hash(flock.add(5.5)), f2 = hash(flock.add(71.5)), f3 = hash(flock.add(233.5));
    /* the flock's centre: a point in its cell, the cell the one round the eye */
    const cell = float(B.cell);
    const home = vec3(f1.sub(0.5).mul(cell), 0, f2.sub(0.5).mul(cell));
    const rel = fract(home.xz.sub(cameraPosition.xz).div(cell).add(0.5)).sub(0.5).mul(cell);
    const centre = vec3(cameraPosition.x.add(rel.x), uGround.add(mix(float(B.height[0]), float(B.height[1]), f3)), cameraPosition.z.add(rel.y));
    /* the bird's circle: radius, speed and sense from the flock, a place in it and a little of its own */
    const radius = mix(float(B.radius[0]), float(B.radius[1]), f1.mul(0.6).add(h1.mul(0.4)));
    const speed = mix(float(B.speed[0]), float(B.speed[1]), h2);
    const sense = f2.greaterThan(0.5).select(float(1), float(-1));
    const theta = uTime.mul(speed).div(radius).mul(sense).add(h3.mul(1.9)).add(f3.mul(6.283));
    const bob = sin(uTime.mul(0.35).add(h1.mul(20))).mul(4).add(h2.sub(0.5).mul(10));
    const at = centre.add(vec3(cos(theta).mul(radius), bob, sin(theta).mul(radius)));
    /* heading along the circle, banked into the turn */
    const heading = vec3(sin(theta).negate(), 0, cos(theta)).mul(sense);
    const across = vec3(heading.z.negate(), 0, heading.x);
    const bank = float(0.35).mul(sense);
    const up = normalize(vec3(0, 1, 0).add(across.mul(bank)));
    /* the beat: bouts of four to seven beats, then a glide with the wings a little up */
    const hz = mix(float(B.beatHz[0]), float(B.beatHz[1]), h1);
    const cycle = uTime.mul(hz).add(h3.mul(17));
    const bout = smoothstep(0.15, 0.3, sin(uTime.mul(0.45).add(h2.mul(40))).mul(0.5).add(0.5));
    const flap = sin(cycle.mul(6.283)).mul(bout).mul(0.75).add(float(0.12).mul(oneMinusOf(bout)));
    /* the wing turns about the shoulder (all of it) and folds at the wrist (the tip) */
    const p = positionGeometry;
    const reach = p.z.abs();
    const lift = flap.mul(wing.min(1)).mul(reach).mul(0.9);
    const fold = flap.negate().mul(0.45).mul(wing.sub(1).max(0)).mul(reach.sub(B.span * 0.24).max(0));
    const local = vec3(p.x, p.y.add(lift).add(fold), p.z).mul(B.scale);
    const world = at.add(heading.mul(local.x)).add(up.mul(local.y)).add(across.mul(local.z));
    /* a light with fewer birds keeps that share of them; the rest collapse far
       under the ground, so nothing rasterises */
    return h2.lessThan(uShow).select(world, vec3(0, -1e6, 0));
  })();
  /* a bird is a dark shape: a little of the sun's colour on it, never brighter than the sky behind it */
  const lit = saturate(dot(vec3(0, 1, 0), uSun)).mul(0.35).add(0.18);
  material.colorNode = Fn(() => {
    const body = vec3(0.16, 0.16, 0.17).mul(uSunColour).mul(lit.add(0.25));
    const sky = uSky.mul(0.55);
    return vec4(mix(sky, body, float(0.85)).min(uSky.mul(0.8)), 1);
  })();
  material.fog = true;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'birds';
  mesh.frustumCulled = false;
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.visible = false;
  let amount = 0;
  return {
    mesh, count,
    uniforms: { uTime, uGround, uShow, uSun, uSky, uSunColour },
    setPreset(presetName, { sunDirection, sunColour, sky } = {}) {
      amount = birdsFor(presetName);
      if (sunDirection) uSun.value.set(...sunDirection).normalize();
      if (sunColour !== undefined) uSunColour.value.set(sunColour);
      if (sky !== undefined) uSky.value.set(sky);
    },
    update({ dt, groundY, still = false }) {
      const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
      if (!deterministic && !still) uTime.value += step;
      if (Number.isFinite(groundY)) uGround.value = groundY;
      uShow.value = amount;
      mesh.visible = amount > 0.01;
    },
    snapshot: () => ({ count, amount, visible: mesh.visible, time: uTime.value }),
    dispose() { geometry.dispose(); template.dispose(); material.dispose(); mesh.removeFromParent(); },
  };
}

function oneMinusOf(node) { return float(1).sub(node); }
