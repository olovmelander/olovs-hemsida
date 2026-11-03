/* MIST ON THE LAKES (3 November). A Swedish lake at dawn breathes: thin sheets
   of mist lie on the water and drift with the air, thickest out over the
   middle and thinning to nothing at the bank. Now they do, on the lakes and
   ponds near the course, in the lights that have them (`presets`: dawn most,
   the mist light, the blue hour and the midnight sun, a little in autumn and
   at golden hour; none at noon, on the summer day or in the storm).

   The lakes' own water sheets are merged into one geometry (their outlines and
   their distance from the shore, `aShore`, as the water draws them), drawn as
   three thin layers a little above the water: three transparent draws for the
   whole course, after the water (order 7), writing no depth. Each layer's
   wisps come from the ground's detail texture at two scales, drifting with
   the one air at its own rate, so the layers slide over each other. A layer
   fades in from the bank, out near the eye (no plane edge at the lens), and
   takes the haze's colour, warmed toward the sun's side. Held still under
   reduced motion, pinned under det=1. ?lakemist=0 is the before. */
import * as THREE from 'three/webgpu';
import {
  attribute, cameraPosition, dot, float, normalize, pow, positionWorld, saturate, smoothstep, texture, uniform, vec2, vec3, vec4,
} from 'three/tsl';

export const LAKE_MIST = Object.freeze({
  /* the layers: height over the water, metres, and their share of the mist */
  layers: Object.freeze([Object.freeze([0.3, 1]), Object.freeze([0.85, 0.72]), Object.freeze([1.6, 0.42])]),
  /* a layer's most opacity */
  opacity: 0.17,
  /* in from the bank over these metres of water */
  bank: Object.freeze([1, 14]),
  /* faded out within this many metres of the eye */
  near: Object.freeze([6, 30]),
  /* the wisps: the detail texture's two scales (per metre), the cut, and each layer's drift against the air */
  scales: Object.freeze([0.011, 0.031]), cut: Object.freeze([0.44, 0.78]), drift: Object.freeze([0.35, 0.55, 0.8]),
  /* how far past the played ground a lake's mist is drawn, metres */
  reach: 700,
  /* toward the sun the mist takes this much of the sun's colour */
  sunGlow: 0.45,
  presets: Object.freeze({ dawn: 1, mist: 0.85, bluehour: 0.55, midnight: 0.5, host: 0.3, golden: 0.18 }),
});

export const lakeMistFor = presetName => LAKE_MIST.presets[presetName] ?? 0;
const wrap = (x, period) => x - Math.floor(x / period) * period;

/**
 * The lakes' sheets merged: `sheets` [{ geometry (position, aShore), y }]; `focus`
 * { x0, x1, z0, z1 } the played ground. Returns a BufferGeometry or null.
 */
export function mergeLakeSheets(sheets, focus = null) {
  const L = LAKE_MIST;
  const pos = [], shore = [], index = [];
  for (const { geometry, y = 0 } of sheets) {
    const p = geometry.getAttribute('position'), s = geometry.getAttribute('aShore');
    if (!p || !s) continue;
    if (focus) {
      geometry.computeBoundingBox();
      const b = geometry.boundingBox;
      if (b.max.x < focus.x0 - L.reach || b.min.x > focus.x1 + L.reach || b.max.z < focus.z0 - L.reach || b.min.z > focus.z1 + L.reach) continue;
    }
    const base = pos.length / 3;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i) + y, p.getZ(i)); shore.push(s.getX(i)); }
    if (geometry.index) for (let i = 0; i < geometry.index.count; i++) index.push(base + geometry.index.getX(i));
    else for (let i = 0; i < p.count; i++) index.push(base + i);
  }
  if (!index.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aShore', new THREE.Float32BufferAttribute(shore, 1));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

/** The mist: `{ group, setPreset(name, { haze, sun, sunDirection }), update({ dt, air, still }), stats() }`. */
export function createLakeMist({ geometry, detail, deterministic = false }) {
  const L = LAKE_MIST;
  const group = new THREE.Group();
  group.name = 'lake-mist';
  const uAmount = uniform(0);
  const uHaze = uniform(new THREE.Color(0.8, 0.82, 0.85));
  const uSun = uniform(new THREE.Color(1, 0.85, 0.7));
  const uSunDir = uniform(new THREE.Vector3(0, 1, 0));
  const drifts = L.layers.map(() => uniform(new THREE.Vector2(deterministic ? 37 : 0, deterministic ? 11 : 0)));
  const shore = attribute('aShore', 'float');
  const meshes = L.layers.map(([height, share], k) => {
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    material.name = `LakeMist${k}`;
    material.fog = true;
    const p = positionWorld.xz.add(drifts[k]);
    /* two scales of the detail texture, turned against each other per layer, make the wisps */
    const a = texture(detail, p.mul(L.scales[0]).add(vec2(0.13 * k, 0.41 * k))).b;
    const b = texture(detail, vec2(p.y, p.x.negate()).mul(L.scales[1]).add(vec2(0.7 * k, 0.2))).g;
    const wisps = smoothstep(L.cut[0], L.cut[1], a.mul(0.65).add(b.mul(0.35)));
    const bank = smoothstep(L.bank[0], L.bank[1], shore);
    const eye = positionWorld.distance(cameraPosition);
    const near = smoothstep(L.near[0], L.near[1], eye);
    const alpha = wisps.mul(bank).mul(near).mul(uAmount).mul(L.opacity * share);
    /* the haze's colour, warmed toward the sun as the eye looks into it */
    const view = normalize(positionWorld.sub(cameraPosition));
    const glow = pow(saturate(dot(view, uSunDir)), 5).mul(L.sunGlow);
    const colour = vec3(uHaze).mul(float(1).sub(glow)).add(vec3(uSun).mul(glow));
    material.colorNode = vec4(colour, 1);
    material.opacityNode = alpha;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = height;
    mesh.renderOrder = 7;
    mesh.castShadow = mesh.receiveShadow = false;
    mesh.name = `lake-mist-${k}`;
    mesh.userData.tag = 'lakemist';
    group.add(mesh);
    return mesh;
  });
  group.visible = false;
  let amount = 0;
  const drift = L.layers.map(() => [deterministic ? 37 : 0, deterministic ? 11 : 0]);
  return {
    group,
    setPreset(presetName, { haze, sun, sunDirection } = {}) {
      amount = lakeMistFor(presetName);
      uAmount.value = amount;
      if (haze !== undefined) uHaze.value.set(haze).lerp(new THREE.Color(1, 1, 1), 0.25);
      if (sun !== undefined) {
        uSun.value.set(sun);
        const peak = Math.max(uSun.value.r, uSun.value.g, uSun.value.b, 1e-3);
        uSun.value.multiplyScalar(1 / peak);
      }
      if (sunDirection) uSunDir.value.set(...sunDirection).normalize();
      group.visible = amount > 0.01;
    },
    update({ dt, air, still = false }) {
      if (deterministic || still || !(dt > 0) || !group.visible) return;
      const step = Math.min(dt, 0.1), ax = air?.x ?? 0, az = air?.z ?? 0;
      L.drift.forEach((rate, k) => {
        /* wrapped far out (100 km, half a day of drift), so it never jumps in play and stays exact in a float */
        drift[k][0] = wrap(drift[k][0] - ax * rate * step, 1e5);
        drift[k][1] = wrap(drift[k][1] - az * rate * step, 1e5);
        drifts[k].value.set(drift[k][0], drift[k][1]);
      });
    },
    stats: () => ({ amount, visible: group.visible, vertices: geometry.getAttribute('position').count }),
    dispose() { geometry.dispose(); for (const m of meshes) m.material.dispose(); group.removeFromParent(); },
  };
}
