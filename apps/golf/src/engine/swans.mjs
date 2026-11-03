/* SWANS ON THE LAKES (3 November). The ponds and lakes lay flat and empty; on a
   Swedish course there is nearly always a pair of mute swans on the water. Now
   there are: a painted swan from tools/blender-props/swan.py (2,400 triangles),
   and on each lake of open water near the course one pair or more, sometimes
   with this year's grey cygnet behind them, gliding a slow loop well inside the
   shore.

   The loops are planned once from the course's own water outlines: the lake's
   deepest open point (furthest from every shore, by the signed distance), a
   loop that keeps `inset` metres off the shore at its nearest and stays over
   water the ground lies under (so no swan crosses an island or a silt bank).
   Each swan's place on its loop is closed-form in the clock, so they never
   collide and never wander out. Two instanced draws for every swan on the
   course, their matrices written on the CPU each frame (a few dozen at most);
   no shadows, since the sun's map is redrawn on demand and a moving caster
   would leave its shadow behind. A faint lit ripple ring round each, stronger
   at the breast, sets it in the water (drawn after the water, order 7). Held still under reduced motion, pinned under
   det=1. ?swans=0 is the before. */
import * as THREE from 'three/webgpu';
import { float, mix, smoothstep, uv, vec2, vec3 } from 'three/tsl';

export const SWANS = Object.freeze({
  /* the open water a lake needs before it keeps swans, m², and the pairs it keeps */
  minArea: 5000, areaPerPair: 60000, maxPairs: 2, maxTotal: 16,
  /* metres off the shore at the loop's nearest; the loop's radius */
  inset: 8, radius: Object.freeze([3.5, 16]),
  /* the loop's other axis, as a share of its radius, and its slow wander */
  squash: 0.62, wander: 0.22,
  /* gliding speed, m/s; the gap between birds of a family, metres along the loop */
  speed: 0.3, gap: 2.6,
  /* the share of pairs with a cygnet, its size and its grey-brown */
  cygnet: 0.45, cygnetScale: 0.72,
  /* the bob on the water, metres, and its rate (rad/s); how far the body sits down into it */
  bob: 0.012, bobRate: 1.4, sink: 0.03,
  /* the ripple ring round each swan: its size (across, along), metres, and its strongest share */
  ripple: Object.freeze([1.35, 1.95]), rippleAlpha: 0.26,
  /* the lake must lie at least this deep under the loop, metres */
  depth: 0.3,
  /* how far past the played ground a lake's loop may lie, metres */
  reach: 450,
  /* the plan's grid: cells across a lake, and the cell's least and greatest size */
  grid: 28, cell: Object.freeze([2.5, 40]),
});

/** A small deterministic hash of a string or number, in [0, 1). */
export function swanHash(key, salt = 0) {
  let h = 2166136261 ^ salt;
  const s = String(key);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function inRing(x, z, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], zi = r[i][1], xj = r[j][0], zj = r[j][1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function segmentDistance(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}
/** How far inside the ring (x, z) lies, metres (negative outside). */
export function shoreDepth(x, z, ring) {
  let m = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    m = Math.min(m, segmentDistance(x, z, ring[j][0], ring[j][1], ring[i][0], ring[i][1]));
  return inRing(x, z, ring) ? m : -m;
}
export function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a) / 2;
}

/** A loop's point and heading at distance `s` along it: { x, z, dx, dz } (dx, dz a unit vector). */
export function loopAt(loop, s) {
  const S = SWANS;
  const w = s / loop.radius, a = loop.dir * w + loop.phase;
  /* an ellipse turned to the loop's own angle, wandering slowly about its centre */
  const lx = loop.radius * (Math.cos(a) + S.wander * Math.cos(0.37 * a + 1.3));
  const lz = loop.radius * (S.squash * Math.sin(a) + S.wander * Math.sin(0.29 * a + 0.4));
  const tx = loop.radius * loop.dir * (-Math.sin(a) - S.wander * 0.37 * Math.sin(0.37 * a + 1.3));
  const tz = loop.radius * loop.dir * (S.squash * Math.cos(a) + S.wander * 0.29 * Math.cos(0.29 * a + 0.4));
  const c = Math.cos(loop.angle), sn = Math.sin(loop.angle);
  const len = Math.hypot(tx, tz) || 1;
  return {
    x: loop.x + lx * c - lz * sn, z: loop.z + lx * sn + lz * c,
    dx: (tx * c - tz * sn) / len, dz: (tx * sn + tz * c) / len,
  };
}

/**
 * Plans the swans: `bodies` [{ id, ring, level }] (lakes and ponds; no sea, no
 * streams), `ground(x, z)` the ground's height, `focus` { x0, x1, z0, z1 } the
 * played ground. Returns [{ loop: { x, z, level, radius, angle, phase, dir }, lag, scale, cygnet }].
 */
export function planSwans(bodies, { ground = () => -Infinity, focus = null } = {}) {
  const S = SWANS;
  const out = [];
  const box = focus ? { x0: focus.x0 - S.reach, x1: focus.x1 + S.reach, z0: focus.z0 - S.reach, z1: focus.z1 + S.reach } : null;
  /* the lakes nearest the played ground first, so the course's own ponds keep theirs */
  const away = body => {
    if (!focus || !Array.isArray(body.ring)) return 0;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of body.ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    return Math.hypot(Math.max(0, focus.x0 - x1, x0 - focus.x1), Math.max(0, focus.z0 - z1, z0 - focus.z1));
  };
  const ordered = bodies.map((body, i) => ({ body, i, d: away(body) })).sort((a, b) => a.d - b.d || a.i - b.i).map(e => e.body);
  for (const body of ordered) {
    const ring = body.ring;
    if (!Array.isArray(ring) || ring.length < 3 || !Number.isFinite(body.level)) continue;
    const area = ringArea(ring);
    if (area < S.minArea) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    if (box) { x0 = Math.max(x0, box.x0); x1 = Math.min(x1, box.x1); z0 = Math.max(z0, box.z0); z1 = Math.min(z1, box.z1); }
    if (!(x1 > x0 && z1 > z0)) continue;
    const cell = Math.min(S.cell[1], Math.max(S.cell[0], Math.max(x1 - x0, z1 - z0) / S.grid));
    /* every open cell's room: how far its centre lies from the nearest shore */
    const cells = [];
    for (let x = x0 + cell / 2; x < x1; x += cell)
      for (let z = z0 + cell / 2; z < z1; z += cell) {
        const room = shoreDepth(x, z, ring) - S.inset;
        if (room >= S.radius[0] * (1 + S.wander)) cells.push({ x, z, room });
      }
    cells.sort((a, b) => b.room - a.room);
    const pairs = Math.min(S.maxPairs, 1 + Math.floor(area / S.areaPerPair));
    const homes = [];
    for (const c of cells) {
      if (homes.length >= pairs) break;
      const radius = Math.min(S.radius[1], c.room / (1 + S.wander));
      if (homes.some(h => Math.hypot(h.x - c.x, h.z - c.z) < (h.radius + radius) * (1 + S.wander) + 6)) continue;
      const key = `${body.id ?? ''}:${Math.round(c.x)}:${Math.round(c.z)}`;
      const loop = {
        x: c.x, z: c.z, level: body.level, radius,
        angle: swanHash(key, 1) * Math.PI, phase: swanHash(key, 2) * Math.PI * 2, dir: swanHash(key, 3) < 0.5 ? 1 : -1,
      };
      /* the whole disc the loop can reach over open water: no island, no silt bank
         under it (the shore is already `inset` off, by the cell's room) */
      const reach = radius * (1 + S.wander);
      let dry = ground(c.x, c.z) > body.level - S.depth;
      for (let ringNo = 1; ringNo <= 3 && !dry; ringNo++)
        for (let k = 0; k < 8 * ringNo && !dry; k++) {
          const r = reach * ringNo / 3, a = (k + 0.5 * ringNo) / (8 * ringNo) * Math.PI * 2;
          if (ground(c.x + r * Math.cos(a), c.z + r * Math.sin(a)) > body.level - S.depth) dry = true;
        }
      if (dry) continue;
      homes.push(loop);
    }
    for (const loop of homes) {
      const key = `${loop.x}:${loop.z}`;
      out.push({ loop, lag: 0, scale: 1, cygnet: false });
      out.push({ loop, lag: S.gap * (0.85 + 0.3 * swanHash(key, 4)), scale: 0.96, cygnet: false });
      if (swanHash(key, 5) < S.cygnet) out.push({ loop, lag: S.gap * 2.1, scale: S.cygnetScale, cygnet: true });
    }
    if (out.length >= S.maxTotal) break;
  }
  return out.slice(0, S.maxTotal);
}

/**
 * The swans on the course: `parts` { body, trim } from loadPaintedProp, `swans`
 * from planSwans. `white` and `cygnet` are the bodies' linear colours.
 */
export function createSwans(parts, swans, { deterministic = false, white = new THREE.Color(0.86, 0.86, 0.83), cygnet = new THREE.Color(0.3, 0.26, 0.22) } = {}) {
  const S = SWANS;
  const group = new THREE.Group();
  group.name = 'swans';
  const meshes = [];
  for (const [key, tinted, roughness] of [['body', true, 0.85], ['trim', false, 0.5]]) {
    const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness, metalness: 0 });
    material.name = `Swan-${key}`;
    const mesh = new THREE.InstancedMesh(parts[key], material, swans.length);
    if (tinted) swans.forEach((swan, i) => mesh.setColorAt(i, swan.cygnet ? cygnet : white));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = false; mesh.receiveShadow = true;
    /* the loops are fixed but the swans move round them; a few dozen are cheaper drawn than culled */
    mesh.frustumCulled = false;
    mesh.name = `swans-${key}`; mesh.userData.tag = 'swans';
    group.add(mesh);
    meshes.push(mesh);
  }
  /* the ripple: one flat card a swan, a soft ring on it, brighter at the breast */
  const card = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const rippleMaterial = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0, transparent: true, depthWrite: false });
  rippleMaterial.name = 'Swan-ripple';
  rippleMaterial.colorNode = vec3(0.92, 0.95, 1);
  {
    /* uv's v runs from the tail (1) to the bill (0) on the turned card */
    const p = uv().sub(0.5).mul(2);
    const r = p.length();
    const ring = smoothstep(0.5, 0.78, r).mul(float(1).sub(smoothstep(0.8, 1, r)));
    const breast = mix(float(0.35), float(1), smoothstep(0.6, -0.7, p.y));
    rippleMaterial.opacityNode = ring.mul(breast).mul(S.rippleAlpha).add(float(1).sub(smoothstep(0.35, 0.6, vec2(p.x, p.y.mul(0.8)).length())).mul(0.06));
  }
  const ripples = new THREE.InstancedMesh(card, rippleMaterial, swans.length);
  ripples.castShadow = false; ripples.receiveShadow = true;
  ripples.frustumCulled = false;
  ripples.renderOrder = 7;
  ripples.name = 'swans-ripple'; ripples.userData.tag = 'swans';
  group.add(ripples);
  const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const at = new THREE.Vector3(), size = new THREE.Vector3();
  let time = deterministic ? 140 : 0;
  const place = () => {
    swans.forEach((swan, i) => {
      const loop = swan.loop;
      const p = loopAt(loop, time * S.speed - swan.lag);
      const bob = S.bob * Math.sin(time * S.bobRate + loop.phase * 3 + swan.lag);
      /* the model's bill runs along +z: turn +z onto the heading */
      q.setFromAxisAngle(up, Math.atan2(p.dx, p.dz));
      at.set(p.x, loop.level - S.sink + bob, p.z);
      size.setScalar(swan.scale);
      matrix.compose(at, q, size);
      for (const mesh of meshes) mesh.setMatrixAt(i, matrix);
      at.set(p.x, loop.level + 0.012, p.z);
      size.set(S.ripple[0] * swan.scale, 1, S.ripple[1] * swan.scale);
      ripples.setMatrixAt(i, matrix.compose(at, q, size));
    });
    for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
    ripples.instanceMatrix.needsUpdate = true;
  };
  place();
  return {
    group, count: swans.length,
    update({ dt, still = false }) {
      if (deterministic || still || !(dt > 0)) return;
      time += Math.min(dt, 0.1);
      place();
    },
    snapshot: () => ({ count: swans.length, cygnets: swans.filter(s => s.cygnet).length, time }),
    dispose() {
      for (const mesh of meshes) { mesh.material.dispose(); mesh.dispose(); }
      card.dispose(); rippleMaterial.dispose(); ripples.dispose();
      group.removeFromParent();
    },
  };
}
