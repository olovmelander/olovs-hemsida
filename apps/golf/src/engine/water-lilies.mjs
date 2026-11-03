/* WATER LILIES (3 November). A Swedish pond in summer has its näckrosor: rafts
   of round, notched pads in the sheltered shallows, a few white flowers open
   among them. The ponds and small lakes had none. Now they do, planned once
   from the course's own water outlines and the ground under the water:

   - a walk round each pond's shore (ponds and small lakes; never the sea or a
     big open lake, where the fetch and the brackish water keep them away);
   - patches where a slow noise along the shore rises, so a pond keeps two or
     three rafts rather than a green ring;
   - each pad 1.5-8 m out from the shore, where the water stands 0.25-2.2 m
     deep over the ground (no pad on a silt bank, none out in the deep);
   - one pad in seven with a flower.

   Two instanced draws for every pad and flower on the course: the pads a
   notched disc painted darker at its heart and lighter at its rim, waxy, in
   one of four greens (a few turning red-bronze); the flowers a cup of white
   petals round a yellow heart. Flat on the water at its level, drawn before
   it (opaque, order 0). They receive shadows and cast none. ?lilies=0 is the
   before. */
import * as THREE from 'three/webgpu';

export const WATER_LILIES = Object.freeze({
  /* the water that keeps lilies: ponds and small lakes, m² */
  area: Object.freeze([150, 300000]),
  /* the walk round the shore, metres a step; the patch noise's wavelength along it, metres, and its cut */
  step: 1.6, wavelength: 16, cut: 0.6,
  /* the raft's line out from the shore, metres (wandering slowly along it); how deep the water, metres */
  out: Object.freeze([2, 6.5]), depth: Object.freeze([0.25, 2.2]),
  /* pads tried round the raft's line at each step, and how far from it, metres */
  perStep: 8, spread: 1.5,
  /* a pad's radius, metres; one in this many has a flower */
  radius: Object.freeze([0.12, 0.24]), flowerEvery: 7,
  /* how far past the played ground a pond may lie, metres; how many pads a course and a pond */
  reach: 350, maxPads: 4200, maxPerPond: 1100,
  /* the pads' greens (linear, before the painted shading), the last a red-bronze */
  tones: Object.freeze([[0.11, 0.24, 0.07], [0.15, 0.3, 0.08], [0.09, 0.2, 0.08], [0.2, 0.14, 0.06]]),
  toneShares: Object.freeze([0.42, 0.32, 0.22, 0.04]),
  /* the water's level + this, so the pad lies on the sheet, never in it */
  lift: 0.015,
});

/** A small deterministic hash of three numbers, in [0, 1). */
export function lilyHash(a, b, c = 0) {
  let h = Math.imul((a * 73856093) | 0, 1) ^ Math.imul((b * 19349663) | 0, 1) ^ Math.imul((c * 83492791) | 0, 1);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** A smooth 1D value noise in [0, 1). */
function noise1(x, seed) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return lilyHash(i, seed, 11) * (1 - u) + lilyHash(i + 1, seed, 11) * u;
}
function inRing(x, z, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], zi = r[i][1], xj = r[j][0], zj = r[j][1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}

/**
 * Plans the lilies: `bodies` [{ id, ring, level }] (no sea, no streams),
 * `ground(x, z)` the ground's height, `focus` { x0, x1, z0, z1 } the played
 * ground. Returns [{ x, y, z, yaw, radius, tone, flower }].
 */
export function planWaterLilies(bodies, { ground = () => Infinity, focus = null } = {}) {
  const L = WATER_LILIES;
  const out = [];
  const box = focus ? { x0: focus.x0 - L.reach, x1: focus.x1 + L.reach, z0: focus.z0 - L.reach, z1: focus.z1 + L.reach } : null;
  let seed = 0;
  for (const body of bodies) {
    seed++;
    const ring = body.ring;
    if (!Array.isArray(ring) || ring.length < 3 || !Number.isFinite(body.level)) continue;
    const signed = ringArea(ring), area = Math.abs(signed);
    if (area < L.area[0] || area > L.area[1]) continue;
    if (box && !ring.some(([x, z]) => x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1)) continue;
    /* the side the water lies on: left of each edge when the ring winds one way, right the other */
    const inward = signed > 0 ? 1 : -1;
    let s = 0, pads = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length && pads < L.maxPerPond; j = i++) {
      const ax = ring[j][0], az = ring[j][1], bx = ring[i][0], bz = ring[i][1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-6) continue;
      const tx = (bx - ax) / len, tz = (bz - az) / len;
      /* the normal into the water: (-tz, tx) turned by the ring's winding */
      const nx = -tz * inward, nz = tx * inward;
      for (let d = (L.step - (s % L.step)) % L.step; d < len && pads < L.maxPerPond; d += L.step) {
        const along = s + d;
        if (noise1(along / L.wavelength, seed) < L.cut) continue;
        const k = Math.round(along / L.step);
        /* the raft's line, wandering slowly in and out along the shore; thinner toward the patch's ends */
        const line = L.out[0] + (L.out[1] - L.out[0]) * noise1(along / (L.wavelength * 0.7), seed + 101);
        const fill = Math.min(1, (noise1(along / L.wavelength, seed) - L.cut) / 0.12);
        for (let t = 0; t < L.perStep; t++) {
          const h1 = lilyHash(k, seed, t * 5 + 1), h2 = lilyHash(k, seed, t * 5 + 2), h3 = lilyHash(k, seed, t * 5 + 3);
          if (lilyHash(k, seed, t * 5 + 7) > fill) continue;
          /* a disc round the raft's line, crowded toward it */
          const rr = L.spread * Math.sqrt(h1) * (0.6 + 0.4 * h1), ra = h2 * Math.PI * 2;
          const off = line + rr * Math.sin(ra), side = rr * Math.cos(ra);
          const x = ax + tx * (d + side) + nx * off, z = az + tz * (d + side) + nz * off;
          if (box && (x < box.x0 || x > box.x1 || z < box.z0 || z > box.z1)) continue;
          const deep = body.level - ground(x, z);
          if (!(deep >= L.depth[0] && deep <= L.depth[1])) continue;
          if (!inRing(x, z, ring)) continue;
          const h4 = lilyHash(k, seed, t * 5 + 4);
          let tone = 0, acc = L.toneShares[0];
          while (tone < L.tones.length - 1 && h4 > acc) acc += L.toneShares[++tone];
          out.push({
            x, y: body.level + L.lift, z, yaw: h3 * Math.PI * 2,
            radius: L.radius[0] + (L.radius[1] - L.radius[0]) * lilyHash(k, seed, t * 5 + 5),
            tone, flower: lilyHash(k, seed, t * 5 + 6) * L.flowerEvery < 1,
          });
          pads++;
          if (out.length >= L.maxPads) return out;
        }
      }
      s += len;
    }
  }
  return out;
}

/** A notched pad of unit radius, flat in x-z, painted darker at its heart and lighter at its rim. */
export function lilyPadGeometry(segments = 14, notch = 0.42) {
  const pos = [0, 0, 0], col = [0.72, 0.72, 0.72], idx = [];
  for (let i = 0; i <= segments; i++) {
    const a = notch / 2 + (i / segments) * (Math.PI * 2 - notch);
    /* the rim lifts a hair, so the pad reads as a pad and not a decal */
    pos.push(Math.cos(a), 0.02, Math.sin(a));
    col.push(1.12, 1.12, 1.12);
    if (i > 0) idx.push(0, i + 1, i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

/** A flower: a cup of eight white petals round a yellow heart, about 0.1 m across. */
export function lilyFlowerGeometry() {
  const pos = [], col = [], idx = [];
  const white = [0.92, 0.92, 0.88], blush = [0.78, 0.8, 0.74], yellow = [0.95, 0.68, 0.12];
  const petals = 8;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2, w = Math.PI / petals * 0.9;
    const tip = [Math.cos(a) * 0.055, 0.045, Math.sin(a) * 0.055];
    const l = [Math.cos(a - w) * 0.02, 0.01, Math.sin(a - w) * 0.02], r = [Math.cos(a + w) * 0.02, 0.01, Math.sin(a + w) * 0.02];
    const b = pos.length / 3;
    pos.push(...l, ...tip, ...r);
    col.push(...blush, ...white, ...blush);
    idx.push(b, b + 2, b + 1);
  }
  /* the heart: a low yellow pyramid */
  const b = pos.length / 3;
  pos.push(0, 0.03, 0);
  col.push(...yellow);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    pos.push(Math.cos(a) * 0.018, 0.012, Math.sin(a) * 0.018);
    col.push(...yellow);
    idx.push(b, b + 1 + ((i + 1) % 6), b + 1 + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** The lilies on the course: two instanced meshes in a group. */
export function createWaterLilies(plan) {
  const L = WATER_LILIES;
  const group = new THREE.Group();
  group.name = 'water-lilies';
  const padGeometry = lilyPadGeometry(), flowerGeometry = lilyFlowerGeometry();
  const padMaterial = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.42, metalness: 0 });
  padMaterial.name = 'WaterLilyPad';
  const flowerMaterial = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, side: THREE.DoubleSide });
  flowerMaterial.name = 'WaterLilyFlower';
  const flowers = plan.filter(p => p.flower);
  const pads = new THREE.InstancedMesh(padGeometry, padMaterial, Math.max(1, plan.length));
  const blooms = new THREE.InstancedMesh(flowerGeometry, flowerMaterial, Math.max(1, flowers.length));
  pads.count = plan.length; blooms.count = flowers.length;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const at = new THREE.Vector3(), size = new THREE.Vector3(), colour = new THREE.Color();
  plan.forEach((p, i) => {
    q.setFromAxisAngle(up, p.yaw);
    pads.setMatrixAt(i, m.compose(at.set(p.x, p.y, p.z), q, size.set(p.radius, 1, p.radius)));
    pads.setColorAt(i, colour.setRGB(...L.tones[p.tone]));
  });
  flowers.forEach((p, i) => {
    q.setFromAxisAngle(up, p.yaw * 3);
    /* on the pad, a little off its heart */
    const ox = Math.cos(p.yaw) * p.radius * 0.3, oz = Math.sin(p.yaw) * p.radius * 0.3;
    blooms.setMatrixAt(i, m.compose(at.set(p.x + ox, p.y + 0.004, p.z + oz), q, size.setScalar(0.9 + p.radius * 1.5)));
  });
  for (const mesh of [pads, blooms]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.userData.tag = 'lilies';
    mesh.computeBoundingSphere();
    mesh.visible = mesh.count > 0;
    group.add(mesh);
  }
  pads.name = 'water-lily-pads'; blooms.name = 'water-lily-flowers';
  return {
    group, count: plan.length, flowers: flowers.length,
    dispose() {
      padGeometry.dispose(); flowerGeometry.dispose(); padMaterial.dispose(); flowerMaterial.dispose();
      pads.dispose(); blooms.dispose(); group.removeFromParent();
    },
  };
}
