/* THE GRASS ROUND THE BALL (docs/visual-near-grass-2026-09-26.md). Every low
   view -- the tee view, 1.7 m over the ground six metres behind the tee, and
   anywhere the camera is taken down to the ground -- looked at the turf as a
   painted sheet: within 24 m of a hole's line, where the tussocks keep off,
   nothing stood on it but the fringe of uncut grass at the rough's cut edge.
   This is a patch of grass blades that follows the camera, drawn in ONE
   instanced draw:
   - nested square rings round the eye, each twice as coarse as the one inside
     it; a blade belongs to the ring it falls in, and each ring but the last
     thins to a quarter toward its edge, where the next ring's density takes
     over, so no ring ends in a seam;
   - every blade anchored to the world (a hash of its ring and world cell), so
     the patch scrolls with the camera and no blade swims;
   - the ground's own exact class fields (ground-material-core.mjs) say what
     grows where and how tall, from the classes' cuts (CUT_HEIGHT_MM): short on
     a tee, a collar and a fairway, taller in the semi, tallest in the rough,
     the heath and the wetland; nothing on a green, sand, a path, hard ground,
     the forest floor, the shore or in water;
   - each blade takes the ground's colour at its root -- the class's cut-toned
     palette, or the ground tint where the tint paints the ground, with the
     ground's own light there (its clumps and grain, a hollow's damp, the baked
     relief) and the painted finish's terms -- darker at the root, lighter and
     warmer at the tip, and lit through at the tip against a low sun;
   - it fades out while still a few pixels tall, so it cannot shimmer, and it
     is never narrower than about a pixel;
   - it sways on the one wind (one-wind.mjs), and stands still under reduced
     motion.
   The ground under it is untouched: ?neargrass=0 is the before. */
import { BufferAttribute, DataTexture, DoubleSide, FloatType, InstancedBufferGeometry, Mesh, MeshStandardNodeMaterial,
  NearestFilter, RGBAFormat, Sphere, Vector2, Vector3 } from 'three/webgpu';
import { abs, cameraPosition, cameraViewMatrix, cos, faceDirection, float, floor, instanceIndex, ivec2, max, min, mix,
  normalize, positionGeometry, positionWorld, pow, saturate, select, sin, smoothstep, step, texture, textureLoad,
  transformNormalByViewMatrix, uint, uniform, varying, vec2, vec3, vec4 } from 'three/tsl';
import { SURFACE } from './surface.js';
import { swayOnWind, reedSwing } from './one-wind.mjs';
import { paintedGround, PAINTED_SHADING } from './material.js';
import { paintedWet } from './painted-world-lighting.mjs';
import { applyGroundRelief, classStyle, groundClassColour, groundTintColour, isGroundTintClass, GROUND_DETAIL } from './ground-material-core.mjs';

export const NEAR_GRASS = Object.freeze({
  /* a blade's length on each class, metres, from its height of cut (CUT_HEIGHT_MM):
     a mown blade stands a little over its cut, the rough's leaves well over theirs */
  bladeMetres: Object.freeze({
    [SURFACE.TEE]: 0.024, [SURFACE.FRINGE]: 0.024, [SURFACE.FAIRWAY]: 0.028, [SURFACE.SEMI]: 0.05,
    [SURFACE.ROUGH]: 0.085, [SURFACE.HEATH]: 0.06, [SURFACE.WETLAND]: 0.09,
  }),
  /* blades stand taller where the ground's own clumps are dense (its clump field,
     ground-material-core.mjs: the near tap less the far one), shorter where thin */
  clumpLength: 1.8, clumpRange: Object.freeze([0.35, 1.7]),
  /* the rings round the eye: the innermost cell, cells a side, rings, and blades a cell */
  quality: Object.freeze({
    hi: Object.freeze({ cell: 0.16, cells: 64, rings: 4, blades: 4 }),
    lo: Object.freeze({ cell: 0.24, cells: 40, rings: 3, blades: 3 }),
  }),
  /* a ring thins from all its blades to a quarter over this share of its half-width */
  thin: Object.freeze([0.55, 0.95]),
  /* a blade has faded out at this many times its length from the eye (standing upright
     there, three and a half pixels tall in a 48-degree view 1080 pixels high), and is
     whole at 0.6 of that; never past 0.95 of the last ring */
  fadeLengths: 330, fadeFrom: 0.6,
  /* a blade's width against its length, and never under this share of a pixel */
  widthShare: 0.34, minPixels: 0.9,
  /* how far its tip leans off the vertical: 0.15 to 0.6 of its length */
  lean: Object.freeze([0.15, 0.45]),
  /* the root's tone and the tip's, against the ground's colour, and the tip's
     warmth (a painter's lit tip: yellower, never bluer); each blade its own tone */
  rootTone: 0.8, tipTone: 1.28, tipWarm: Object.freeze([1.1, 1.06, 0.84]), toneSpread: 0.2,
  /* how far a blade's light leans toward its facing: a little, so a low sun never
     turns the blades facing away from it black against the lit ground */
  normalLean: 0.12,
  /* how much of the sun comes through a blade toward the eye, at its tip */
  through: 0.5,
  /* the ground's heights and water round the eye: a grid of this many metres a texel */
  clipMetres: 1,
  /* how much of the grid's weight at a root must say grass: from none to all of the blade */
  growsFrom: Object.freeze([0.75, 0.95]),
  /* hidden from this far over the ground: every blade has faded by then */
  hideAboveMetres: 40,
});

/** The rings for a quality: each ring's cell, its first instance, and how far it reaches from its centre. */
export function nearGrassLayout(quality = 'hi') {
  const q = NEAR_GRASS.quality[quality];
  if (!q) throw new TypeError(`unknown near-grass quality: ${quality}`);
  const perRing = q.cells * q.cells;
  const rings = Array.from({ length: q.rings }, (_, k) => {
    const cell = q.cell * 2 ** k;
    return Object.freeze({ cell, first: k * perRing, half: cell * q.cells / 2 });
  });
  const reach = rings[rings.length - 1].half * 0.95;
  /* the ground grid covers the last ring and a margin to move in before it must scroll */
  const clipTexels = 2 * Math.ceil((reach + 8) / NEAR_GRASS.clipMetres);
  return Object.freeze({ quality, cells: q.cells, blades: q.blades, rings: Object.freeze(rings), perRing,
    instances: perRing * q.rings, bladesTotal: perRing * q.rings * q.blades, reach, clipTexels });
}

/** How much of a ring's density a blade keeps, at `t` of its half-width (Chebyshev) from the eye. */
export function nearGrassKeep(t, last = false) {
  if (last) return 1;
  const [a, b] = NEAR_GRASS.thin, x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return 1 - 0.75 * x * x * (3 - 2 * x);
}

/** A blade of `length` metres at `distance` metres from the eye: its share of its length (the fade). */
export function nearGrassFade(length, distance, reach) {
  const end = Math.min(length * NEAR_GRASS.fadeLengths, reach), start = end * NEAR_GRASS.fadeFrom;
  const x = Math.min(1, Math.max(0, (distance - start) / (end - start)));
  return 1 - x * x * (3 - 2 * x);
}

/* THE GROUND ROUND THE EYE. A grid of heights and of where grass may grow
   (not water), one texel a metre, addressed toroidally: world point (i, j)
   lives at texel (i mod W, j mod W), so as the eye moves only the rows and
   columns it moves into are read. The reads are paced, `budget` a frame.
   The grid knows which points it surely holds: all of its window once a pass
   is done, and while one is under way, what the last full window shares with
   the new one (a slot is only rewritten with a point outside the old window).
   The grass is drawn only while every point a blade can stand on is held (`ready`). */
export function createNearGrassClip({ texels, metres = NEAR_GRASS.clipMetres, groundAt, budget = 600, scrollMetres = 4 }) {
  const W = texels;
  const data = new Float32Array(W * W * 4);
  const tex = new DataTexture(data, W, W, RGBAFormat, FloatType);
  tex.minFilter = tex.magFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.needsUpdate = true;
  /* which world point each texel holds (none yet) */
  const heldI = new Int32Array(W * W).fill(-0x7fffffff), heldJ = new Int32Array(W * W).fill(-0x7fffffff);
  let centreI = null, centreJ = null, pending = W * W, cursor = 0, reads = 0, lastMs = 0, lastReads = 0, lastHeight = 0;
  /* the points surely held, inclusive world indices, or null */
  let held = null;
  const mod = (a, n) => ((a % n) + n) % n;
  const windowAt = () => ({ i0: centreI - W / 2, i1: centreI - W / 2 + W - 1, j0: centreJ - W / 2, j1: centreJ - W / 2 + W - 1 });
  function update(x, z, { force = false } = {}) {
    const ci = Math.round(x / metres), cj = Math.round(z / metres);
    if (centreI === null || force || Math.max(Math.abs(ci - centreI), Math.abs(cj - centreJ)) * metres >= scrollMetres) {
      centreI = ci; centreJ = cj; pending = W * W; cursor = 0;
      if (held) {
        const w = windowAt();
        held = { i0: Math.max(held.i0, w.i0), i1: Math.min(held.i1, w.i1), j0: Math.max(held.j0, w.j0), j1: Math.min(held.j1, w.j1) };
        if (held.i0 > held.i1 || held.j0 > held.j1) held = null;
      }
    }
    lastReads = 0;
    if (!pending) return false;
    const started = performance.now();
    let done = 0;
    const { i0, j0 } = windowAt();
    /* one pass over the slots from the cursor: each slot's own point in the window */
    while (pending && done < budget) {
      const slot = cursor;
      cursor = (cursor + 1) % (W * W);
      pending--;
      const a = slot % W, b = (slot - a) / W;
      const i = i0 + mod(a - i0, W), j = j0 + mod(b - j0, W);
      if (heldI[slot] === i && heldJ[slot] === j) continue;
      const g = groundAt(i * metres, j * metres);
      const known = !!g && Number.isFinite(g.h);
      /* ground it cannot read grows nothing, and stands at the last height it could */
      if (known) lastHeight = g.h;
      data[slot * 4] = lastHeight;
      data[slot * 4 + 1] = known && g.grass ? 1 : 0;
      heldI[slot] = i; heldJ[slot] = j;
      done++;
    }
    if (!pending) held = windowAt();
    if (done) tex.needsUpdate = true;
    reads += done; lastReads = done;
    lastMs = performance.now() - started;
    return done > 0;
  }
  /* whether every point within `reach` metres of (x, z), and the next one out, is held */
  function ready(x, z, reach) {
    if (!held) return false;
    const lo = v => Math.floor((v - reach) / metres), hi = v => Math.floor((v + reach) / metres) + 1;
    return lo(x) >= held.i0 && hi(x) <= held.i1 && lo(z) >= held.j0 && hi(z) <= held.j1;
  }
  return {
    texture: tex, texels: W, metres,
    update, ready,
    get complete() { return pending === 0 && centreI !== null; },
    stats: () => ({ texels: W, metres, pending, reads, lastReads, lastMs: +lastMs.toFixed(2),
      centre: centreI === null ? null : [centreI * metres, centreJ * metres], held: held && { ...held } }),
  };
}

/* the PCG hash (pcg-random.org): three's own `hash`, kept in unsigned integers */
const pcg = v => {
  const state = v.mul(uint(747796405)).add(uint(2891336453));
  const word = state.shiftRight(state.shiftRight(uint(28)).add(uint(4))).bitXor(state).mul(uint(277803737));
  return word.shiftRight(uint(22)).bitXor(word);
};
const unit = h => h.toFloat().mul(1 / 2 ** 32);
/* world cells are offset to positive integers before they are hashed: a cell index
   is exact in a float to 2^24, and 2^20 cells either side is 167 km at 0.16 m */
const OFFSET = 2 ** 20;

/**
 * The grass round the eye: `{ mesh, update(camera, viewportHeight), stats() }`.
 * - `atlas`: the exact class fields ({ bounds, texSdf, channels }), as the ground's own;
 * - `tint`: the ground tint (ground-material-core.mjs groundTintColour), or null;
 * - `C`, `SHADE`, `cutTone`: the ground's palette, its shading table and its cut tone;
 * - `uSun`, `sunThrough`, `sunlit`: the sun's direction, how much comes through a
 *   blade (main.js uSunThrough) and the clouds' share of it per vertex (or null);
 * - `groundAt(x, z)`: the visible ground's height there and whether grass may grow
 *   ({ h, grass }); `quality`: 'hi' or 'lo';
 * - `ground`: which of the ground's own terms it draws (main.js's switches), so a
 *   blade takes the colour the ground has at its root: `relief` (?groundrelief),
 *   `wear` (?groundwear: the damp), `grain` (?turfgrain: the grain and the shared
 *   blotches) and `gloss` (?surfacegloss).
 */
export function createNearGrass({ atlas, tint = null, DETAIL = null, C, SHADE, cutTone = 1, uSun, sunThrough = float(1), sunlit = null,
  groundAt, quality = 'hi', budget, ground = {} } = {}) {
  const terms = { relief: true, wear: true, grain: true, gloss: true, ...ground };
  if (!atlas?.texSdf?.length || !atlas.channels?.length || !atlas.bounds) throw new TypeError('the near grass needs the exact class fields');
  if (typeof groundAt !== 'function') throw new TypeError('the near grass needs the visible ground');
  const layout = nearGrassLayout(quality);
  const K = layout.blades, n = layout.cells, R = layout.rings.length;
  const clip = createNearGrassClip({ texels: layout.clipTexels, groundAt, ...(budget ? { budget } : {}) });

  /* each ring's centre cell, snapped to its own cell size (world cell indices) */
  const centres = layout.rings.map(() => uniform(new Vector2(0, 0)));
  /* the width of one pixel per metre of distance, for the blades' minimum width */
  const pixelPerMetre = uniform(0.001);

  /* THE TEMPLATE: K blades of three corners; position carries (blade, corner) */
  const geometry = new InstancedBufferGeometry();
  const corners = new Float32Array(K * 3 * 3);
  for (let b = 0; b < K; b++) for (let c = 0; c < 3; c++) corners.set([b, c, 0], (b * 3 + c) * 3);
  geometry.setAttribute('position', new BufferAttribute(corners, 3));
  /* up, as the ground under it: the finish's sun band reads the geometry's normal */
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(K * 3 * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geometry.instanceCount = layout.instances;
  geometry.boundingSphere = new Sphere(new Vector3(), 1e7);

  /* WHICH RING, WHICH CELL, in integers: a float divided by a count that is not a power of
     two can land a hair under a whole number on a GPU that divides by a reciprocal */
  const ringIndex = instanceIndex.div(uint(layout.perRing));
  const local = instanceIndex.sub(ringIndex.mul(uint(layout.perRing)));
  const ringOf = ringIndex.toFloat();
  const cu = local.mod(uint(n)).toFloat(), cv = local.div(uint(n)).toFloat();
  const pick = values => values.slice(1).reduce((acc, value, k) => select(ringOf.equal(float(k + 1)), value, acc), values[0]);
  const cellSize = pick(layout.rings.map(r => float(r.cell)));
  const centre = pick(centres);
  const cellI = centre.x.sub(n / 2).add(cu), cellJ = centre.y.sub(n / 2).add(cv);

  /* THE BLADE'S OWN NUMBERS, from its ring, its world cell and its place in the clump */
  const bladeIndex = positionGeometry.x, corner = positionGeometry.y;
  const seed = pcg(pcg(uint(cellI.add(OFFSET)).add(pcg(uint(cellJ.add(OFFSET))))).add(uint(ringOf.mul(7919).add(bladeIndex.mul(104729)))));
  const r1 = unit(pcg(seed)), r2 = unit(pcg(seed.add(uint(1)))), r3 = unit(pcg(seed.add(uint(2))));
  const r4 = unit(pcg(seed.add(uint(3)))), r5 = unit(pcg(seed.add(uint(4)))), r6 = unit(pcg(seed.add(uint(5)))), r7 = unit(pcg(seed.add(uint(6))));
  const root = vec2(cellI.add(r1), cellJ.add(r2)).mul(cellSize);

  /* A BLADE BELONGS TO THE RING IT FALLS IN: not inside the next ring in (that ring
     covers it), and thinned toward its own ring's edge */
  let inner = float(0);
  for (let k = 1; k < R; k++) {
    const inside = layout.rings[k - 1], c = centres[k - 1];
    const lo = c.sub(n / 2).mul(inside.cell), hi = c.add(n / 2).mul(inside.cell);
    const within = step(lo.x, root.x).mul(step(root.x, hi.x)).mul(step(lo.y, root.y)).mul(step(root.y, hi.y));
    inner = select(ringOf.equal(float(k)), within, inner);
  }
  const eye = vec2(cameraPosition.x, cameraPosition.z);
  const half = pick(layout.rings.map(r => float(r.half)));
  const t = max(abs(root.x.sub(eye.x)), abs(root.y.sub(eye.y))).div(half);
  const keep = select(ringOf.equal(float(R - 1)), float(1), oneMinusThin(t));
  const alive = oneMinusNode(inner).mul(step(r3, keep));

  /* THE GROUND UNDER IT: the height and the water from the grid round the eye */
  const W = clip.texels;
  /* a whole number of texels, wrapped into the grid: the quotient's floor can be one off (as
     above), and the texel it named out of the grid -- a two-metre strip with no grass every
     W metres -- so the remainder, exact in whole numbers, is brought back into range */
  const wrap = a => {
    const r = a.sub(floor(a.div(W)).mul(W));
    return select(r.greaterThanEqual(W), r.sub(W), select(r.lessThan(0), r.add(W), r));
  };
  const cf = root.div(clip.metres), c0 = floor(cf), fr = cf.sub(c0);
  const at = (di, dj) => textureLoad(clip.texture, ivec2(wrap(c0.x.add(di)), wrap(c0.y.add(dj))));
  const g00 = at(0, 0), g10 = at(1, 0), g01 = at(0, 1), g11 = at(1, 1);
  const under = mix(mix(g00, g10, fr.x), mix(g01, g11, fr.x), fr.y);
  /* grass where all but a quarter of the grid's weight says so: across an edge of the grid the
     blades stop within a quarter metre of the last point that grows (and shorten into it) */
  const groundY = under.x, grassHere = smoothstep(NEAR_GRASS.growsFrom[0], NEAR_GRASS.growsFrom[1], under.y);

  /* WHAT GROWS THERE: the classes' exact fields at the root, a crisp cut */
  const b = atlas.bounds;
  const uvAtlas = vec2(root.x.sub(b.x0).div(b.x1 - b.x0), root.y.sub(b.z0).div(b.z1 - b.z0));
  const inBounds = step(0, uvAtlas.x).mul(step(uvAtlas.x, 1)).mul(step(0, uvAtlas.y)).mul(step(uvAtlas.y, 1));
  const swizzle = ['r', 'g', 'b', 'a'];
  /* every read here is in the vertex stage: the finest level, said outright (a vertex has no
     footprint to choose one by, and a backend left to choose may not take the finest) */
  const samples = atlas.texSdf.map(tex => texture(tex, uvAtlas).level(0));
  const weightsRaw = atlas.channels.map((_, i) => smoothstep(-0.03, 0.03, samples[i >> 2][swizzle[i & 3]].mul(8).sub(4)));
  const sum = weightsRaw.reduce((acc, w) => acc.add(w), float(0));
  const norm = float(1).div(max(sum, float(1)));
  const weights = weightsRaw.map(w => w.mul(norm));
  const roughWeight = saturate(float(1).sub(sum));
  const lengthOf = sid => NEAR_GRASS.bladeMetres[sid] ?? 0;
  /* the ground's detail at the root, from its shared taps (ground-material-core.mjs):
     the clumps (the near tap less the far one) and the finish's three blotches */
  const [tc, ts] = GROUND_DETAIL.NEAR_TAP_TURN;
  const flat = vec4(0.5);
  const nearTap = DETAIL ? texture(DETAIL, vec2(root.x.mul(tc).sub(root.y.mul(ts)), root.x.mul(ts).add(root.y.mul(tc))).mul(0.09)).level(0) : flat;
  const farTap = DETAIL ? texture(DETAIL, root.mul(0.031).add(vec2(0.37, 0.61))).level(0) : flat;
  const clump = nearTap.g.sub(farTap.g);
  /* the finish's blotches: the shared taps, or (?turfgrain=0) the finish's own three */
  const tapAt = scale => (DETAIL ? texture(DETAIL, root.mul(scale)).level(0) : flat);
  const blotchTaps = vec3(tapAt(0.012).b, terms.grain ? farTap.g : tapAt(0.038).g, terms.grain ? nearTap.r : tapAt(0.11).r);
  /* the classes' lengths and colours as the ground lays them */
  const display = PAINTED_SHADING.toneExponent;
  const lift = cutTone * PAINTED_SHADING.cutLift;
  const tintAtRoot = groundTintColour(tint, root, classStyle(C, SHADE, SURFACE.ROUGH).colour);
  const roughTint = tintAtRoot.rgb;
  const shadeOf = sid => classStyle(C, SHADE, sid).shade;
  let bladeLength = roughWeight.mul(lengthOf(SURFACE.ROUGH));
  let colour = roughTint.mul(roughWeight);
  let seasonal = roughWeight;
  let bump = roughWeight.mul(shadeOf(SURFACE.ROUGH)[1]), gloss = roughWeight.mul(shadeOf(SURFACE.ROUGH)[2]);
  atlas.channels.forEach((sid, i) => {
    bladeLength = bladeLength.add(weights[i].mul(lengthOf(sid)));
    const own = groundClassColour(C, SHADE, sid, { lift, toneExponent: display, hardGround: true });
    colour = colour.add((own ? vec3(...own) : roughTint).mul(weights[i]));
    if (isGroundTintClass(sid)) seasonal = seasonal.add(weights[i]);
    bump = bump.add(weights[i].mul(shadeOf(sid)[1]));
    gloss = gloss.add(weights[i].mul(shadeOf(sid)[2]));
  });
  /* the ground's own light at the root, in the ground's order: the rough's clumps,
     the mown turf's grain, the damp of a sheltered hollow in the storm and the
     mist, and the baked relief (the tint's alpha) */
  colour = colour.mul(float(1).add(clump.mul(GROUND_DETAIL.ROUGH_CLUMP_AMPLITUDE * display * cutTone).mul(seasonal)));
  if (terms.grain) colour = colour.mul(float(1).add(clump.mul(GROUND_DETAIL.TURF_GRAIN * display * cutTone).mul(bump).mul(float(1).sub(seasonal))));
  if (terms.wear) {
    const shelter = tintAtRoot.a.mul(255).sub(128).div(127).clamp(-1, 1).negate().max(0);
    const damp = smoothstep(GROUND_DETAIL.DAMP_SHELTER[0], GROUND_DETAIL.DAMP_SHELTER[1], shelter).mul(paintedWet)
      .mul(float(0.75).add(clump.mul(1.2)).clamp(0, 1)).mul(cutTone);
    colour = colour.mul(float(1).sub(damp.mul(GROUND_DETAIL.DAMP_SHADE * display))).mul(vec3(1).add(vec3(...GROUND_DETAIL.DAMP_COOL).mul(damp)));
  }
  if (terms.relief) colour = applyGroundRelief(colour, tintAtRoot.a, seasonal);

  /* THE FADE: whole near the eye, gone while a few pixels tall, and never past the last ring */
  const distance = positionWorldOf(root, groundY).distance(cameraPosition);
  const fadeEnd = min(bladeLength.mul(NEAR_GRASS.fadeLengths), float(layout.reach));
  const fade = float(1).sub(smoothstep(fadeEnd.mul(NEAR_GRASS.fadeFrom), fadeEnd, distance));
  /* taller where the ground's clumps are dense */
  const dense = clump.mul(NEAR_GRASS.clumpLength).add(1).clamp(...NEAR_GRASS.clumpRange);
  const length = bladeLength.mul(r4.mul(0.7).add(0.65)).mul(dense).mul(fade).mul(alive).mul(inBounds).mul(grassHere);

  /* THE BLADE: a base across its facing, a tip leaning off the vertical, and the wind */
  const yaw = r5.mul(Math.PI * 2);
  const across = vec2(cos(yaw), sin(yaw)), facing = vec2(sin(yaw).negate(), cos(yaw));
  const lean = r6.mul(NEAR_GRASS.lean[1]).add(NEAR_GRASS.lean[0]);
  const width = max(length.mul(NEAR_GRASS.widthShare), distance.mul(pixelPerMetre).mul(NEAR_GRASS.minPixels)).mul(step(1e-4, length));
  const isTip = step(1.5, corner), side = corner.mul(2).sub(1).mul(oneMinusNode(isTip));
  const base = vec3(root.x, groundY.sub(0.004), root.y).add(vec3(across.x, 0, across.y).mul(width.mul(0.5)).mul(side));
  const sway = swayOnWind({ p: root, weight: length.mul(0.9), rate: 2.6, scale: 3, swing: reedSwing, lean: 0.1 });
  const tip = vec3(root.x, groundY.add(length.mul(float(1).sub(lean.mul(lean).mul(0.5)))), root.y)
    .add(vec3(facing.x, 0, facing.y).mul(length.mul(lean))).add(sway);
  const position = mix(base, tip, isTip);

  const material = new MeshStandardNodeMaterial({ side: DoubleSide, metalness: 0 });
  material.positionNode = position;
  /* the root's colour, its seasonal share, the blade's facing and its tone, carried from the vertex */
  const rootColour = varying(colour, 'nearGrassColour');
  const seasonalShare = varying(seasonal, 'nearGrassSeasonal');
  const faceXZ = varying(facing, 'nearGrassFacing');
  const tone = varying(r7, 'nearGrassTone');
  const up = varying(isTip, 'nearGrassUp');
  const rootXZ = varying(root, 'nearGrassRoot');
  /* the finish's blotches and gloss at the root: the ground's (constant along the blade) */
  const blotches = varying(blotchTaps, 'nearGrassBlotches');
  const glossAtRoot = varying(gloss, 'nearGrassGloss');
  /* lit like the ground under it, leaning a little toward its facing, on the side that is seen */
  const lean2 = faceXZ.mul(NEAR_GRASS.normalLean).mul(faceDirection);
  material.normalNode = transformNormalByViewMatrix(normalize(vec3(lean2.x, 1, lean2.y)), cameraViewMatrix);
  const V = normalize(cameraPosition.sub(positionWorld));
  const through = pow(saturate(V.dot(uSun.negate())), 2.4).mul(NEAR_GRASS.through).mul(sunThrough).mul(sunlit ?? 1).mul(up);
  const shaded = rootColour.mul(mix(float(NEAR_GRASS.rootTone), float(NEAR_GRASS.tipTone), up))
    .mul(mix(vec3(1), vec3(...NEAR_GRASS.tipWarm), up))
    .mul(tone.sub(0.5).mul(NEAR_GRASS.toneSpread).add(1)).mul(through.add(1));
  /* the painted finish as the ground under it takes it: its sun band, its blotches
     (mown turf more of the broad one), the light's grass strength, autumn's ochre,
     and the class's gloss */
  const finish = paintedGround({ base: shaded, wp: rootXZ, DETAIL: null, uSun, turf: float(1), seasonal: seasonalShare,
    taps: { a: blotches.x, b: blotches.y, c: blotches.z },
    broadLift: terms.grain ? float(1).sub(seasonalShare).mul(GROUND_DETAIL.TURF_BROAD_LIFT) : null,
    gloss: terms.gloss ? glossAtRoot : null });
  material.colorNode = finish.colorNode;
  material.roughnessNode = finish.roughnessNode;

  const mesh = new Mesh(geometry, material);
  mesh.name = 'near-grass';
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.visible = false;
  mesh.userData.nearGrass = { quality, instances: layout.instances, blades: layout.bladesTotal, rings: R };

  let altitude = null, updates = 0, primeMs = null;
  function update(camera, viewportHeight = 1080) {
    const x = camera.position.x, z = camera.position.z;
    const g = groundAt(x, z);
    altitude = g && Number.isFinite(g.h) ? camera.position.y - g.h : Infinity;
    if (!(altitude <= NEAR_GRASS.hideAboveMetres)) { mesh.visible = false; return; }
    layout.rings.forEach((ring, k) => centres[k].value.set(Math.floor(x / ring.cell), Math.floor(z / ring.cell)));
    const fov = (camera.fov ?? 50) * Math.PI / 180;
    pixelPerMetre.value = 2 * Math.tan(fov / 2) / Math.max(1, viewportHeight);
    clip.update(x, z);
    /* drawn once every point a blade can stand on is held: past the reach every blade has faded */
    mesh.visible = clip.ready(x, z, layout.reach);
    updates++;
  }
  return {
    mesh, layout, clip,
    update,
    /* fill the whole grid now (at boot, before the opening view is compiled): whether it is drawn */
    prime(camera, viewportHeight) {
      const started = performance.now();
      clip.update(camera.position.x, camera.position.z, { force: true });
      while (!clip.complete) clip.update(camera.position.x, camera.position.z);
      primeMs = performance.now() - started;
      update(camera, viewportHeight);
      return mesh.visible;
    },
    /* nothing left to read: hidden over the ground, or every texel it reaches in */
    get settled() { return !(altitude !== null && altitude <= NEAR_GRASS.hideAboveMetres) || clip.complete; },
    stats: () => ({ quality, instances: layout.instances, blades: layout.bladesTotal, rings: R, cell: layout.rings[0].cell,
      reach: +layout.reach.toFixed(2), visible: mesh.visible, altitude: altitude === null || !Number.isFinite(altitude) ? null : +altitude.toFixed(2),
      updates, primeMs: primeMs === null ? null : +primeMs.toFixed(1), clip: clip.stats() }),
  };
}

/* 1 - x, as a node */
function oneMinusNode(x) { return float(1).sub(x); }
/* a ring's keep, 1 to 0.25 over its thinning band (nearGrassKeep), as a node */
function oneMinusThin(t) {
  const [a, b] = NEAR_GRASS.thin;
  return float(1).sub(smoothstep(a, b, t).mul(0.75));
}
/* a root on the ground, as a world position */
function positionWorldOf(root, y) { return vec3(root.x, y, root.y); }
