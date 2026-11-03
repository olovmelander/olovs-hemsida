/* MEADOW FLOWERS IN THE ROUGH (3 November, after serenity-blocks' Odyssey
   meadow life). The grass round the ball grew blades in every low view, but
   the rough of a Swedish course in summer is a meadow: drifts of oxeye daisies,
   buttercups, harebells, red clover and wood cranesbill among the long grass.
   Now they stand there, in one instanced draw round the eye:

   - a grid of cells round the eye (0.5 m), each anchored to the world by a hash
     of its cell, so the flowers scroll with the camera and none swims;
   - only on the rough, read from the ground's own exact class fields as the
     grass round the ball reads them (no flower on a fairway, semi, tee, green,
     sand, path, forest floor or hard ground), and only where its ground grid
     says grass may grow (no water, no shore);
   - in drifts: a value noise on a 6 m lattice, hashed per cell, so a stretch of
     rough keeps a few flowery patches and plain grass between; each drift is
     mostly one species, with some of the others mixed in;
   - each flower a stem and an open head of six petals round its heart, painted
     in its species' colours, lit as the grass is, swaying on the one wind;
   - faded out by 28 m (the head shrinks to nothing, so it cannot shimmer), and
     hidden with the grass above 40 m.

   Each light's share of them in MEADOW_FLOWERS.presets (autumn keeps a few).
   Held still under reduced motion with the grass's sway. ?flowers=0 is the
   before. */
import { BufferAttribute, DoubleSide, InstancedBufferGeometry, Mesh, MeshStandardNodeMaterial, Sphere, Vector2, Vector3 } from 'three/webgpu';
import {
  cameraPosition, cos, float, floor, instanceIndex, ivec2, max, mix, positionGeometry, saturate, select, sin, smoothstep,
  step, texture, textureLoad, uint, uniform, varying, vec2, vec3,
} from 'three/tsl';
import { swayOnWind, reedSwing } from './one-wind.mjs';

export const MEADOW_FLOWERS = Object.freeze({
  /* the grid round the eye: a cell, metres, and cells a side */
  cell: 0.5, cells: Object.freeze({ hi: 112, lo: 72 }),
  /* the share of cells in full drift that hold a flower */
  density: 0.9,
  /* the drifts: a noise on a lattice this many metres across, from none at cut[0] to full at cut[1] */
  lattice: 6, cut: Object.freeze([0.45, 0.7]),
  /* a stem's height and a head's radius, metres: a painter's flowers, a little larger than life */
  stem: Object.freeze([0.2, 0.42]), head: Object.freeze([0.045, 0.075]),
  /* whole to fade[0] metres from the eye, gone by fade[1] */
  fade: Object.freeze([17, 28]),
  /* the stem's green, a little darker than the rough's paint */
  stemColour: Object.freeze([0.08, 0.17, 0.04]),
  /* the species: petals, heart (linear), and how often a drift is of it */
  species: Object.freeze([
    Object.freeze({ name: 'prästkrage', petals: [0.86, 0.86, 0.8], heart: [0.9, 0.6, 0.06], share: 0.3 }),
    Object.freeze({ name: 'smörblomma', petals: [0.95, 0.66, 0.04], heart: [0.8, 0.5, 0.03], share: 0.26 }),
    Object.freeze({ name: 'blåklocka', petals: [0.2, 0.22, 0.75], heart: [0.3, 0.3, 0.6], share: 0.16 }),
    Object.freeze({ name: 'rödklöver', petals: [0.7, 0.14, 0.3], heart: [0.55, 0.1, 0.22], share: 0.14 }),
    Object.freeze({ name: 'midsommarblomster', petals: [0.5, 0.18, 0.55], heart: [0.4, 0.15, 0.4], share: 0.14 }),
  ]),
  /* a flower takes another species than its drift's this often */
  mixed: 0.22,
  /* each light's share: autumn keeps a few late ones; the storm's flowers stand, bowed */
  presets: Object.freeze({ host: 0.22 }),
  hideAboveMetres: 40,
});

export const meadowFlowersFor = presetName => MEADOW_FLOWERS.presets[presetName] ?? 1;

/** The template: a stem (corners 0-2) and a head of six petals round a heart (3, then 4-9). */
export function meadowFlowerTemplate() {
  const corners = new Float32Array(10 * 3);
  for (let c = 0; c < 10; c++) corners[c * 3] = c;
  const index = [0, 1, 2];
  for (let i = 0; i < 6; i++) index.push(3, 4 + ((i + 1) % 6), 4 + i);
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(corners, 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(10 * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geometry.setIndex(index);
  return geometry;
}

/* the PCG hash, as the grass round the ball keeps it, in unsigned integers */
const pcg = v => {
  const state = v.mul(uint(747796405)).add(uint(2891336453));
  const word = state.shiftRight(state.shiftRight(uint(28)).add(uint(4))).bitXor(state).mul(uint(277803737));
  return word.shiftRight(uint(22)).bitXor(word);
};
const unit = h => h.toFloat().mul(1 / 2 ** 32);
const OFFSET = 2 ** 20;
const cellHash = (i, j, salt) => unit(pcg(pcg(pcg(uint(i.add(OFFSET))).add(uint(j.add(OFFSET)))).add(uint(salt * 7919))));

/**
 * The flowers round the eye: `{ mesh, update(camera, grassShown), setPreset(name), stats() }`.
 * - `atlas`: the exact class fields ({ bounds, texSdf, channels }), as the grass's;
 * - `clip`: the grass round the ball's ground grid (near-grass.mjs createNearGrassClip);
 * - `quality`: 'hi' or 'lo'.
 */
export function createMeadowFlowers({ atlas, clip, quality = 'hi' } = {}) {
  const F = MEADOW_FLOWERS;
  if (!atlas?.texSdf?.length || !atlas.channels?.length || !atlas.bounds) throw new TypeError('the flowers need the exact class fields');
  if (!clip?.texture) throw new TypeError('the flowers need the grass round the ball\'s ground grid');
  const n = F.cells[quality] ?? F.cells.hi;
  const geometry = meadowFlowerTemplate();
  geometry.instanceCount = n * n;
  geometry.boundingSphere = new Sphere(new Vector3(), 1e7);

  const centre = uniform(new Vector2(0, 0));
  const uAmount = uniform(1);
  const pixelPerMetre = uniform(0.001);

  const cu = instanceIndex.mod(uint(n)).toFloat(), cv = instanceIndex.div(uint(n)).toFloat();
  const cellI = centre.x.sub(n / 2).add(cu), cellJ = centre.y.sub(n / 2).add(cv);
  const h1 = cellHash(cellI, cellJ, 11), h2 = cellHash(cellI, cellJ, 23), h3 = cellHash(cellI, cellJ, 37);
  const h4 = cellHash(cellI, cellJ, 41), h5 = cellHash(cellI, cellJ, 53), h6 = cellHash(cellI, cellJ, 67);
  const root = vec2(cellI.add(h1.mul(0.8).add(0.1)), cellJ.add(h2.mul(0.8).add(0.1))).mul(F.cell);

  /* the drifts: a smooth value noise on the lattice */
  const lp = root.div(F.lattice), l0 = floor(lp), lf = lp.sub(l0);
  const s = lf.mul(lf).mul(lf.mul(-2).add(3));
  const corner = (di, dj, salt) => cellHash(l0.x.add(di), l0.y.add(dj), salt);
  const drift = mix(mix(corner(0, 0, 101), corner(1, 0, 101), s.x), mix(corner(0, 1, 101), corner(1, 1, 101), s.x), s.y);
  const full = smoothstep(F.cut[0], F.cut[1], drift);
  /* the drift's species: its nearest lattice point's, and now and then another */
  const nearest = vec2(l0.x.add(step(0.5, lf.x)), l0.y.add(step(0.5, lf.y)));
  const driftPick = cellHash(nearest.x, nearest.y, 211);
  const pick = select(h5.lessThan(F.mixed), h6, driftPick);
  let petals = vec3(...F.species[F.species.length - 1].petals), heart = vec3(...F.species[F.species.length - 1].heart);
  let acc = 1;
  for (let k = F.species.length - 2; k >= 0; k--) {
    acc -= F.species[k + 1].share;
    const below = pick.lessThan(acc);
    petals = select(below, vec3(...F.species[k].petals), petals);
    heart = select(below, vec3(...F.species[k].heart), heart);
  }

  /* the ground under it, from the grass's grid (wrapped as the grass wraps it) */
  const W = clip.texels;
  const wrap = a => {
    const r = a.sub(floor(a.div(W)).mul(W));
    return select(r.greaterThanEqual(W), r.sub(W), select(r.lessThan(0), r.add(W), r));
  };
  const cf = root.div(clip.metres), c0 = floor(cf), fr = cf.sub(c0);
  const at = (di, dj) => textureLoad(clip.texture, ivec2(wrap(c0.x.add(di)), wrap(c0.y.add(dj))));
  const under = mix(mix(at(0, 0), at(1, 0), fr.x), mix(at(0, 1), at(1, 1), fr.x), fr.y);
  const groundY = under.x, grassHere = smoothstep(0.85, 0.98, under.y);

  /* the rough: where no class's exact field claims the ground */
  const b = atlas.bounds;
  const uvAtlas = vec2(root.x.sub(b.x0).div(b.x1 - b.x0), root.y.sub(b.z0).div(b.z1 - b.z0));
  const inBounds = step(0, uvAtlas.x).mul(step(uvAtlas.x, 1)).mul(step(0, uvAtlas.y)).mul(step(uvAtlas.y, 1));
  const swizzle = ['r', 'g', 'b', 'a'];
  const samples = atlas.texSdf.map(tex => texture(tex, uvAtlas).level(0));
  const claimed = atlas.channels.map((_, i) => smoothstep(-0.03, 0.03, samples[i >> 2][swizzle[i & 3]].mul(8).sub(4)))
    .reduce((sum, w) => sum.add(w), float(0));
  const rough = smoothstep(0.85, 1, saturate(float(1).sub(claimed)));

  const distance = vec3(root.x, groundY, root.y).distance(cameraPosition);
  const fade = float(1).sub(smoothstep(F.fade[0], F.fade[1], distance));
  const alive = step(h3, full.mul(F.density).mul(uAmount)).mul(rough).mul(grassHere).mul(inBounds);
  const grow = fade.mul(alive);
  const stemHeight = mix(float(F.stem[0]), float(F.stem[1]), h4).mul(grow);
  const headRadius = mix(float(F.head[0]), float(F.head[1]), h6).mul(grow);

  /* THE FLOWER: a stem from the ground to its head, the head open to the sky, tilted a little */
  const c = positionGeometry.x;
  const isStemBase = step(c, 1.5), isHead = step(2.5, c);
  const yaw = h2.mul(Math.PI * 2);
  const across = vec3(cos(yaw), 0, sin(yaw));
  const stemWidth = max(float(0.004), distance.mul(pixelPerMetre).mul(0.8)).mul(step(1e-4, stemHeight));
  const sway = swayOnWind({ p: root, weight: stemHeight.mul(2.2), rate: 2.6, scale: 3, swing: reedSwing, lean: 0.1 });
  const top = vec3(root.x, groundY.add(stemHeight), root.y).add(sway);
  const base = vec3(root.x, groundY.sub(0.004), root.y).add(across.mul(stemWidth.mul(0.5)).mul(c.mul(2).sub(1)));
  /* the rim: six petals round the heart, cupped a little, the head tilted toward its yaw */
  const petal = c.sub(4);
  const a = petal.mul(Math.PI / 3).add(yaw);
  /* the side of the head toward its yaw lifts, the far side dips: a head turned a little to the light */
  const lift = cos(a).mul(sin(yaw)).add(sin(a).mul(cos(yaw))).mul(0.35).add(0.28);
  const rim = vec3(cos(a), lift, sin(a)).mul(headRadius);
  const headPoint = select(c.lessThan(3.5), vec3(0, headRadius.mul(0.12), 0), rim);
  const position = select(isHead.greaterThan(0.5), top.add(headPoint), select(isStemBase.greaterThan(0.5), base, top));

  const material = new MeshStandardNodeMaterial({ side: DoubleSide, metalness: 0, roughness: 0.75 });
  material.name = 'MeadowFlowers';
  material.positionNode = position;
  /* the heart at the head's centre, the petals round it, the stem's green below */
  const colour = select(isHead.greaterThan(0.5), select(c.lessThan(3.5), heart, petals), vec3(...F.stemColour));
  material.colorNode = varying(colour, 'meadowFlowerColour');

  const mesh = new Mesh(geometry, material);
  mesh.name = 'meadow-flowers';
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.visible = false;
  let amount = 1;
  return {
    mesh, cells: n * n,
    setPreset(presetName) { amount = meadowFlowersFor(presetName); uAmount.value = amount; },
    update(camera, grassShown, viewportHeight = 1080) {
      centre.value.set(Math.floor(camera.position.x / F.cell), Math.floor(camera.position.z / F.cell));
      const fov = (camera.fov ?? 50) * Math.PI / 180;
      pixelPerMetre.value = 2 * Math.tan(fov / 2) / Math.max(1, viewportHeight);
      mesh.visible = !!grassShown && amount > 0.01;
    },
    stats: () => ({ cells: n * n, amount, visible: mesh.visible }),
    dispose() { geometry.dispose(); material.dispose(); mesh.removeFromParent(); },
  };
}
