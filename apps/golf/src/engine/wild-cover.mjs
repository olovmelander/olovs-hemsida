/* THE WILD COVER (docs/visual-wild-cover-2026-09-26.md). Where the mower never
   goes the ground carried tussocks, bushes and stones, and nothing else:
   - the woods' floor was bare paint. Under every stand near the course (the
     trees within 300 m of a hole's line) grow blueberry scrub and ferns, as a
     Swedish wood's floor does: scrub under the pines and spruce, ferns more
     under the birch and alder; in Höst the scrub turns red and the ferns rust;
   - the rough flowered with nothing. Beside a share of the rough's tussocks,
     and along the mown edge's fringe, stand clumps of summer flowers -- ox-eye
     daisies, buttercups, harebells, clover, bedstraw -- in drifts of one kind
     each, as a meadow grows them; in Höst they are gone.
   Every plant is derived from a planting that already stands -- the trees,
   the tussocks, the fringe -- by a hash of where it stands, so the prepared
   scatter's records are untouched. Each kind is one instanced draw; each
   shrinks away before it could shimmer. ?forestfloor=0 and ?wildflowers=0
   are the befores. */
import { Color, Float32BufferAttribute, BufferGeometry, DoubleSide, Group, InstancedBufferAttribute, InstancedMesh,
  Matrix4, MeshStandardNodeMaterial, Quaternion, Vector3 } from 'three/webgpu';
import { attribute, cameraPosition, cameraViewMatrix, cameraWorldMatrix, color, float, mix, normalize,
  positionLocal, positionWorld, pow, saturate, smoothstep, texture, transformNormalByViewMatrix, varying, vec3 } from 'three/tsl';
import { paintedSeason } from './painted-world-lighting.mjs';
import { COVER_TUNED_SHARE, grassCover, seenBladeNormal } from './ground-cover.mjs';
import { swayOnWind, reedSwing } from './one-wind.mjs';

const TAU = Math.PI * 2;

export const WILD_COVER = Object.freeze({
  forest: Object.freeze({
    /* candidates under each tree: within 90 m of a hole's line (zone A), within 300 m (zone B) */
    perTree: Object.freeze([4, 1.6]),
    /* from near the trunk out to the crown's edge, as a share of its radius */
    ring: Object.freeze([0.2, 0.95]),
    /* the forest floor, as the ground cover cedes it to the trees (main.js coverCell) */
    forestAbove: 0.55,
    /* what grows under each species: [scrub, fern] shares; the rest is bare needles and litter */
    mix: Object.freeze({
      spruce: Object.freeze([0.5, 0.12]), pine: Object.freeze([0.72, 0.08]), birch: Object.freeze([0.38, 0.42]),
      alder: Object.freeze([0.28, 0.52]), oak: Object.freeze([0.42, 0.3]),
    }),
    /* a plant's scale, smallest to largest */
    scrubScale: Object.freeze([0.95, 1.75]), fernScale: Object.freeze([0.85, 1.45]),
  }),
  flowers: Object.freeze({
    /* a clump beside a tussock, at most, in the thick of a drift; along the fringe, at most */
    perTuft: 0.7, perEdge: 0.16,
    /* at most this many clumps round a tussock, each further one at this share of the last's odds */
    patch: 4, further: 0.72,
    /* the drifts: a flower grows where this noise, 38 m across, is past its first number, and thickly past its second */
    drift: Object.freeze([0.3, 0.62]), driftMetres: 38,
    /* each drift one kind, 55 m across */
    kindMetres: 55,
    /* from its tussock or clump, metres */
    beside: Object.freeze([0.35, 2.6]),
    scale: Object.freeze([0.8, 1.25]),
  }),
  /* the summer flowers' kinds: a head's colour, and its share of the drifts */
  kinds: Object.freeze([
    Object.freeze({ name: 'daisy', head: 0xf3efe0, eye: 0xeabc30, share: 0.3 }),       // prästkrage
    Object.freeze({ name: 'buttercup', head: 0xf0c928, eye: 0xf7e070, share: 0.24 }),  // smörblomma
    Object.freeze({ name: 'harebell', head: 0x8a86d8, eye: 0x625cb0, share: 0.16 }),   // blåklocka
    Object.freeze({ name: 'clover', head: 0xc45a86, eye: 0x93345e, share: 0.16 }),     // rödklöver
    Object.freeze({ name: 'bedstraw', head: 0xe6d66a, eye: 0xf1e59a, share: 0.14 }),   // gulmåra
  ]),
  /* each kind's plants drawn in square tiles of this many metres: the eye's frustum
     culls a tile, and a tile past the kind's fade is not drawn at all */
  tileMetres: Object.freeze({ scrub: 256, fern: 256, flowers: 128 }),
  /* shrunk away between these distances from the eye, metres: before a plant is a pixel or two */
  fade: Object.freeze({ scrub: Object.freeze([220, 320]), fern: Object.freeze([140, 220]), flowers: Object.freeze([38, 66]) }),
  /* summer and Höst: the scrub's and the ferns' colours, root (or shade) to tip (or light) */
  colours: Object.freeze({
    scrub: Object.freeze({ summer: Object.freeze([0x3d6c2c, 0x6f9d3c]), autumn: Object.freeze([0x8c2b1b, 0xc8522d]) }),
    fern: Object.freeze({ summer: Object.freeze([0x4a7d28, 0x9cc24c]), autumn: Object.freeze([0x8a4a1c, 0xd08a3c]) }),
    stem: 0x4f6e2c,
  }),
});

/* A 32-bit integer hash to [0, 1): the same on every engine */
export function hash(a, b, c = 0) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x632be5ab, 0x165667b1) ^ Math.imul((c | 0) + 0x5bd1e995, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/* smooth value noise on a unit grid */
export function valueNoise(x, z, seed = 0) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(i, j, seed), b = hash(i + 1, j, seed), c = hash(i, j + 1, seed), d = hash(i + 1, j + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/* where a planting stands, as whole centimetres for the hash */
const cm = v => Math.round(v * 100);

/**
 * The forest floor under the near trees: `{ scrub, fern }`, each [x, y, z, scale, yaw, seed] per plant.
 * - `trees`: [x, z, species name, crown radius (m), zone (1 or 2)] per tree;
 * - `classify(x, z)`: the ground's classes there (main.js classify);
 * - `heightAt(x, z)`, `wetAt(x, z, h)`: the visible ground, and whether water lies there.
 */
export function plantForestFloor({ trees, classify, heightAt, wetAt = () => false, lowQuality = false }) {
  const F = WILD_COVER.forest, scrub = [], fern = [];
  let candidates = 0;
  for (let t = 0; t < trees.length; t += 5) {
    const tx = trees[t], tz = trees[t + 1], species = trees[t + 2], crown = trees[t + 3], zone = trees[t + 4];
    if (zone !== 1 && zone !== 2) continue;
    const qi = cm(tx), qj = cm(tz);
    const share = F.mix[species] ?? F.mix.pine;
    const expected = F.perTree[zone - 1];
    const count = Math.floor(expected) + (hash(qi, qj, 91) < expected % 1 ? 1 : 0);
    for (let a = 0; a < count; a++) {
      if (lowQuality && hash(qi, qj, 101 + a) < 0.5) continue;
      candidates++;
      const angle = hash(qi, qj, 11 + a) * TAU;
      const reach = crown * (F.ring[0] + (F.ring[1] - F.ring[0]) * Math.sqrt(hash(qi, qj, 21 + a)));
      const x = tx + Math.cos(angle) * reach, z = tz + Math.sin(angle) * reach;
      const pick = hash(qi, qj, 31 + a);
      if (pick >= share[0] + share[1]) continue;
      const c = classify(x, z);
      if (!(c.forest > F.forestAbove) || c.path > 0.1 || c.fair > 0.03 || c.green > 0.02 || c.tee > 0.02 || c.sand > 0.05 || c.wet > 0.3) continue;
      const h = heightAt(x, z);
      if (!Number.isFinite(h) || wetAt(x, z, h)) continue;
      const seed = hash(qi, qj, 41 + a), yaw = hash(qi, qj, 51 + a) * TAU;
      if (pick < share[0]) scrub.push(x, h, z, F.scrubScale[0] + seed * (F.scrubScale[1] - F.scrubScale[0]), yaw, seed);
      else fern.push(x, h, z, F.fernScale[0] + seed * (F.fernScale[1] - F.fernScale[0]), yaw, seed);
    }
  }
  return { scrub, fern, candidates };
}

/** Which kind of flower grows at a place: its drift's. */
export function flowerKindAt(x, z) {
  const W = WILD_COVER.flowers, kinds = WILD_COVER.kinds;
  let pick = valueNoise(x / W.kindMetres, z / W.kindMetres, 7);
  /* the noise gathers about its middle: spread it back over the shares by rank */
  pick = Math.min(0.999, Math.max(0, (pick - 0.2) / 0.6));
  let at = 0;
  for (let k = 0; k < kinds.length; k++) { at += kinds[k].share; if (pick < at) return k; }
  return kinds.length - 1;
}
/** How thick the flowers stand at a place, 0 to 1: the drifts. */
export function flowerDriftAt(x, z) {
  const W = WILD_COVER.flowers, n = valueNoise(x / W.driftMetres, z / W.driftMetres, 3);
  const t = Math.min(1, Math.max(0, (n - W.drift[0]) / (W.drift[1] - W.drift[0])));
  return t * t * (3 - 2 * t);
}

/**
 * The summer flowers beside the tussocks (`tufts`) and the fringe's clumps (`edge`),
 * both [x, y, z, scale, yaw] per planting: [x, y, z, scale, yaw, seed, kind] per clump.
 * A clump stands only where a tussock could: off the mown ground, the paths and the
 * woods by `classify`, and out of the water by `wetAt`, as the ground cover's lattice.
 */
export function plantFlowers({ tufts = [], edge = [], heightAt, classify = null, wetAt = () => false, lowQuality = false }) {
  const W = WILD_COVER.flowers, out = [];
  const from = (list, odds, salt) => {
    for (let k = 0; k < list.length; k += 5) {
      const px = list[k], pz = list[k + 2], qi = cm(px), qj = cm(pz);
      if (lowQuality && hash(qi, qj, salt + 9) < 0.5) continue;
      const drift = flowerDriftAt(px, pz);
      /* a patch round it: its first clump at the drift's odds, and each further one at a share of the last's */
      for (let n = 0; n < W.patch; n++) {
        if (hash(qi, qj, salt + 20 * n) >= odds * drift * W.further ** n) break;
        const angle = hash(qi, qj, salt + 1 + 20 * n) * TAU;
        const off = W.beside[0] + (W.beside[1] - W.beside[0]) * Math.sqrt(hash(qi, qj, salt + 2 + 20 * n));
        const x = px + Math.cos(angle) * off, z = pz + Math.sin(angle) * off;
        if (classify) {
          const c = classify(x, z);
          if (c.fair > 0.03 || c.green > 0.02 || c.tee > 0.02 || c.sand > 0.05 || c.path > 0.1 || c.forest > WILD_COVER.forest.forestAbove) continue;
        }
        const h = heightAt ? heightAt(x, z) : list[k + 1];
        if (!Number.isFinite(h) || wetAt(x, z, h)) continue;
        const seed = hash(qi, qj, salt + 3 + 20 * n);
        out.push(x, h, z, W.scale[0] + seed * (W.scale[1] - W.scale[0]), hash(qi, qj, salt + 4 + 20 * n) * TAU, seed, flowerKindAt(x, z));
      }
    }
  };
  from(tufts, W.perTuft, 300);
  from(edge, W.perEdge, 400);
  return out;
}

/* THE SHAPES. Positions in metres at scale 1; `aWhere` carries each vertex's
   role: x its share of the plant's height (for the wind and the colour ramp),
   y 1 on a flower's head, and on a head zw its corner facing the eye. */
/* blueberry scrub: a low dome of eighteen small leaves, half a metre across, each
   pointing out and up from the dome's heart, as a dwarf shrub's twigs do */
export function scrubGeometry() {
  const positions = [], normals = [], where = [];
  for (let k = 0; k < 18; k++) {
    const a = k / 18 * TAU * 3.1 + hash(k, 1) * 0.9, c = Math.cos(a), s = Math.sin(a);
    /* rings from the dome's top down to its rim */
    const ring = (k % 3) / 2, r = 0.04 + 0.19 * ring, y = 0.24 - 0.15 * ring;
    const len = 0.09 + 0.05 * hash(k, 2), half = 0.05 + 0.02 * hash(k, 3);
    const bx = c * r, bz = s * r, by = Math.max(0.02, y - 0.06);
    const tip = [bx + c * len, y + 0.03 + 0.04 * (1 - ring), bz + s * len];
    positions.push(bx - s * half, by, bz + c * half, bx + s * half, by, bz - c * half, ...tip);
    /* its normal on the front face's side, tipped up to the sky (seenBladeNormal) */
    for (let q = 0; q < 3; q++) normals.push(c * 0.45, 0.8, s * 0.45);
    where.push(by / 0.3, 0, 0, 0, by / 0.3, 0, 0, 0, tip[1] / 0.3, 0, 0, 0);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  g.setAttribute('aWhere', new Float32BufferAttribute(where, 4));
  return g;
}
/* a fern: six fronds arching out from the crown and drooping at the tip, 0.6 m across */
export function fernGeometry() {
  const positions = [], where = [];
  for (let f = 0; f < 6; f++) {
    const a = f / 6 * TAU + 0.35 * (f % 2), c = Math.cos(a), s = Math.sin(a);
    const lift = 0.36 + 0.06 * (f % 3), reach = 0.52 + 0.08 * ((f * 5) % 3);
    const P = (along, up, side) => [c * along - s * side, up, s * along + c * side];
    const base = [P(0, 0, 0.018), P(0, 0, -0.018)];
    const mid = [P(reach * 0.45, lift, 0.075), P(reach * 0.45, lift, -0.075)];
    const tip = P(reach, lift * 0.72, 0);
    const tri = (...v) => v.forEach(([p, h]) => { positions.push(...p); where.push(h, 0, 0, 0); });
    tri([base[0], 0], [base[1], 0], [mid[0], 1]);
    tri([base[1], 0], [mid[1], 1], [mid[0], 1]);
    tri([mid[0], 1], [mid[1], 1], [tip, 0.8]);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  /* the fronds' own faces, turned up to the sky: a frond is lit as the leaf it is, from above */
  const nrm = g.getAttribute('normal');
  for (let i = 0; i < nrm.count; i++) if (nrm.getY(i) < 0) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
  g.setAttribute('aWhere', new Float32BufferAttribute(where, 4));
  return g;
}
/* a clump of flowers: seven stems and their heads, a hand or two across; a head is a
   diamond that turns to face the eye, so it reads from every side and from above */
export function flowerClumpGeometry() {
  const positions = [], normals = [], where = [];
  for (let f = 0; f < 7; f++) {
    const a = f / 7 * TAU + 0.9 * hash(f, 3), r = 0.05 + 0.13 * hash(f, 5);
    const x = Math.cos(a) * r, z = Math.sin(a) * r, tall = 0.24 + 0.16 * hash(f, 7);
    const lean = 0.03 + 0.05 * hash(f, 11), lx = x + Math.cos(a) * lean, lz = z + Math.sin(a) * lean;
    /* the stem: a thin blade from the ground to the head, its normal on its front face */
    const w = 0.009, sx = -Math.sin(a) * w, sz = Math.cos(a) * w;
    positions.push(x - sx, 0, z - sz, x + sx, 0, z + sz, lx, tall, lz);
    for (let k = 0; k < 3; k++) normals.push(Math.cos(a) * 0.4, 0.8, Math.sin(a) * 0.4);
    where.push(0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0);
    /* the head: two triangles about the stem's top, their corners set out toward the eye in the shader */
    const size = 0.034 + 0.012 * hash(f, 13);
    for (const [cx, cy] of [[-1, 0], [0, -1], [1, 0], [-1, 0], [1, 0], [0, 1]]) {
      positions.push(lx, tall, lz);
      normals.push(0, 1, 0);
      where.push(1, 1, cx * size, cy * size);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  g.setAttribute('aWhere', new Float32BufferAttribute(where, 4));
  return g;
}

/* THE DRAW. One instanced mesh a tile: [x, y, z, scale, yaw, seed(, kind)] per plant
   (`stride`), each instance's root and seed carried for the shader (`aRoot`), and a
   flower's petals and eye (`aHead`, `aEye`). */
function instanced(template, material, list, stride, { flowers = false } = {}) {
  const n = list.length / stride;
  const geometry = template.clone();
  const mesh = new InstancedMesh(geometry, material, n);
  const m4 = new Matrix4(), q = new Quaternion(), v = new Vector3(), s = new Vector3(), up = new Vector3(0, 1, 0);
  const root = new Float32Array(n * 4), petals = flowers ? new Float32Array(n * 3) : null, eyes = flowers ? new Float32Array(n * 3) : null;
  /* the kinds' colours in the working (linear) space, as color() gives them */
  const heads = WILD_COVER.kinds.map(k => new Color().setHex(k.head)), eyeColours = WILD_COVER.kinds.map(k => new Color().setHex(k.eye));
  for (let k = 0; k < n; k++) {
    const o = k * stride, sc = list[o + 3];
    v.set(list[o], list[o + 1], list[o + 2]);
    s.set(sc, sc * (0.85 + 0.3 * list[o + 5]), sc);
    q.setFromAxisAngle(up, list[o + 4]);
    mesh.setMatrixAt(k, m4.compose(v, q, s));
    root.set([list[o], list[o + 1], list[o + 2], list[o + 5]], k * 4);
    if (flowers) {
      const head = heads[list[o + 6]], eye = eyeColours[list[o + 6]];
      petals.set([head.r, head.g, head.b], k * 3);
      eyes.set([eye.r, eye.g, eye.b], k * 3);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  geometry.setAttribute('aRoot', new InstancedBufferAttribute(root, 4));
  if (flowers) {
    geometry.setAttribute('aHead', new InstancedBufferAttribute(petals, 3));
    geometry.setAttribute('aEye', new InstancedBufferAttribute(eyes, 3));
  }
  /* culled by the eye's frustum as a tile: its plants' sphere, a metre wider for the wind and the heads */
  mesh.computeBoundingSphere();
  mesh.boundingSphere.radius += 1;
  mesh.frustumCulled = true;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * A kind's plants in tiles: `{ group, tiles, update(camera) }`. Each tile is one instanced
 * draw; `update` leaves out every tile whose nearest plant is past `reach` from the eye,
 * and a summer kind's every tile in Höst (its shader has shrunk them all to nothing).
 */
function tiled(template, material, list, stride, { tile, reach, name, flowers = false, summerOnly = false }) {
  const buckets = new Map();
  for (let o = 0; o < list.length; o += stride) {
    const key = `${Math.floor(list[o] / tile)},${Math.floor(list[o + 2] / tile)}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = []));
    for (let q = 0; q < stride; q++) b.push(list[o + q]);
  }
  const group = new Group();
  group.name = name;
  const tiles = [...buckets.values()].map(b => {
    const mesh = instanced(template, material, b, stride, { flowers });
    mesh.name = `${name}-tile`;
    mesh.userData.tag = 'wild-cover';
    group.add(mesh);
    return mesh;
  });
  const update = camera => {
    let drawn = 0;
    const gone = summerOnly && paintedSeason.value >= 1;
    for (const mesh of tiles) {
      const sphere = mesh.boundingSphere;
      mesh.visible = !gone && sphere.center.distanceTo(camera.position) - sphere.radius < reach;
      if (mesh.visible) drawn++;
    }
    return drawn;
  };
  return { group, tiles, update, count: list.length / stride };
}

/* shrunk to its root between the kind's two distances from the eye, and gone in Höst where `summerOnly` */
function shrinkNode(fade, summerOnly = false) {
  const root = attribute('aRoot', 'vec4');
  const far = root.xyz.distance(cameraPosition);
  /* each plant its own share of the band, so they thin out rather than vanish together */
  const band = fade[1] - fade[0];
  const start = root.w.mul(band * 0.6).add(fade[0]);
  let keep = float(1).sub(smoothstep(start, start.add(band * 0.4), far));
  if (summerOnly) keep = keep.mul(float(1).sub(paintedSeason));
  return { root, keep };
}
/* the sun through a leaf toward the eye, as the tussocks take it */
function throughLight({ uSun, sunThrough, sunlit }) {
  const V = normalize(cameraPosition.sub(positionWorld));
  return pow(saturate(V.dot(uSun.negate())), 2.4).mul(0.55).mul(sunThrough).mul(sunlit ?? 1);
}

/**
 * The forest floor's two kinds: `{ scrub, fern }`, each `{ group, tiles, update(camera), count }`
 * (null if none grow).
 * `DETAIL` is the ground's detail texture; `uSun`, `sunThrough`, `sunlit` the sun's
 * direction, its share through a leaf and the clouds' share of it.
 */
export function createForestFloor({ scrub, fern, DETAIL, uSun, sunThrough = float(1), sunlit = null }) {
  const C = WILD_COVER.colours, out = { scrub: null, fern: null }, T = WILD_COVER.tileMetres, F = WILD_COVER.fade;
  if (scrub.length) {
    const mat = new MeshStandardNodeMaterial({ side: DoubleSide, roughness: 0.92, metalness: 0 });
    const { root, keep } = shrinkNode(WILD_COVER.fade.scrub);
    const where = attribute('aWhere', 'vec4');
    mat.positionNode = mix(root.xyz, positionLocal, keep);
    mat.normalNode = seenBladeNormal();
    /* darker in the dome's heart, lighter at its outer leaves; each shrub its own shade */
    const tone = texture(DETAIL, positionWorld.xz.mul(0.021)).g.mul(COVER_TUNED_SHARE).mul(0.4).add(where.x.mul(0.5)).add(root.w.mul(0.25));
    const summer = mix(color(C.scrub.summer[0]), color(C.scrub.summer[1]), saturate(tone));
    const autumn = mix(color(C.scrub.autumn[0]), color(C.scrub.autumn[1]), saturate(tone));
    mat.colorNode = mix(summer, autumn, paintedSeason);
    out.scrub = tiled(scrubGeometry(), mat, scrub, 6, { tile: T.scrub, reach: F.scrub[1], name: 'forest-floor-scrub' });
  }
  if (fern.length) {
    const mat = new MeshStandardNodeMaterial({ side: DoubleSide, roughness: 0.9, metalness: 0 });
    const { root, keep } = shrinkNode(WILD_COVER.fade.fern);
    const where = attribute('aWhere', 'vec4');
    /* the fronds lift and fall on the one wind, the tips most */
    const sway = swayOnWind({ p: root.xz, weight: where.x.mul(0.16), rate: 1.7, scale: 2.5, swing: reedSwing, lean: 0.05 });
    mat.positionNode = mix(root.xyz, positionLocal.add(sway), keep);
    mat.normalNode = seenBladeNormal();
    const tone = texture(DETAIL, positionWorld.xz.mul(0.03)).b.mul(COVER_TUNED_SHARE).mul(0.5).add(where.x.mul(0.6));
    const summer = mix(color(C.fern.summer[0]), color(C.fern.summer[1]), saturate(tone));
    const autumn = mix(color(C.fern.autumn[0]), color(C.fern.autumn[1]), saturate(tone));
    mat.colorNode = mix(summer, autumn, paintedSeason).mul(float(1).add(throughLight({ uSun, sunThrough, sunlit }).mul(where.x).mul(0.5)));
    out.fern = tiled(fernGeometry(), mat, fern, 6, { tile: T.fern, reach: F.fern[1], name: 'forest-floor-ferns' });
  }
  return out;
}

/** The summer flowers: `{ group, tiles, update(camera), count }`, or null if none grow. */
export function createWildFlowers({ flowers, uSun, sunThrough = float(1), sunlit = null }) {
  if (!flowers.length) return null;
  const mat = new MeshStandardNodeMaterial({ side: DoubleSide, roughness: 0.8, metalness: 0 });
  const { root, keep } = shrinkNode(WILD_COVER.fade.flowers, true);
  const where = attribute('aWhere', 'vec4');
  /* a head's corners set out along the eye's own right and up, so it faces the eye */
  const right = cameraWorldMatrix.element(0).xyz, upward = cameraWorldMatrix.element(1).xyz;
  const scale = root.w.mul(0.45).add(0.8);
  const corner = right.mul(where.z).add(upward.mul(where.w)).mul(scale);
  const sway = swayOnWind({ p: root.xz, weight: where.x.mul(0.09), rate: 2.2, scale: 2, swing: reedSwing, lean: 0.06 });
  mat.positionNode = mix(root.xyz, positionLocal.add(corner).add(sway), keep);
  /* a stem is lit as a blade; a head faces the sky */
  mat.normalNode = mix(seenBladeNormal(), transformNormalByViewMatrix(vec3(0, 1, 0), cameraViewMatrix), where.y);
  /* where on its head a fragment lies: 0 at the heart, 1 at a petal's tip; the eye within 0.3 */
  const onHead = varying(where.zw.div(where.zw.length().max(1e-6)), 'wildHeadAt');
  const eye = float(1).sub(smoothstep(0.26, 0.4, onHead.length()));
  const head = mix(attribute('aHead', 'vec3'), attribute('aEye', 'vec3'), eye).mul(root.w.mul(0.16).add(0.92));
  const stem = grassCover(color(WILD_COVER.colours.stem));
  mat.colorNode = mix(stem, head, where.y).mul(float(1).add(throughLight({ uSun, sunThrough, sunlit }).mul(where.x).mul(0.3)));
  return tiled(flowerClumpGeometry(), mat, flowers, 7, { tile: WILD_COVER.tileMetres.flowers, reach: WILD_COVER.fade.flowers[1], name: 'wild-flowers',
    flowers: true, summerOnly: true });
}
