/* THE GRASS GROWN ON THE GPU (3 November; owner request: a realistic, dense mat of rough
   grass reaching 50 m and more from the tee, without the triangle look or shimmer, as in
   EA Sports PGA Tour). WebGPU at high quality; the rings of near-grass.mjs stay exactly as
   they were for WebGL2, low quality and phones, and ?grass=rings is the before here.

   After Ghost of Tsushima's procedural grass (GDC 2021):
   - A COMPUTE PASS GROWS THE BLADES. Nested square rings round the eye, each twice as
     coarse as the one inside it and anchored to world cells, offer `blades` candidates a
     cell. Each is placed by a hash of its ring, cell and number, pulled into a Voronoi clump
     (its height, lean and tone the clump's), and kept only if it falls in its own ring,
     survives the ring's thinning toward its edge (to a quarter, the next ring's density,
     shrinking as it goes rather than popping), stands in the view frustum, on ground that
     grows grass (the near grass's own ground grid: no water, no shore) and on a class that
     grows it (the ground's exact class fields). Its colour is the ground's own at its root
     (the same functions and terms the ground and the rings take), and the survivors are
     appended with an atomic counter into storage buffers.
   - TWO INDIRECT DRAWS, no CPU work: the two inner rings as curved strips of `segments.near`
     segments, the outer rings of `segments.far`; the counter is each draw's instance count.
   - LOD: fewer but wider blades with distance (`widen` a ring), and the thinning before each
     ring's edge; seen edge-on a blade turns toward the eye; its normal is rounded across its
     width and leans toward the ground's with distance, and its gloss gives way, so far
     blades read as the sward and do not glitter.
   - The rough, semi, heath and wetland grow real blades out to `fadeMetres` (about 60 m);
     the mown classes grow short blades near the eye, laid along each hole's mowing, the
     passes alternate, so the stripes and the grain still read.
   - Sway on the one wind (one-wind.mjs), reckoned in the compute pass. */
import { BufferAttribute, BufferGeometry, DoubleSide, Group, IndirectStorageBufferAttribute, Matrix4, Mesh, MeshStandardNodeMaterial,
  Sphere, Vector2, Vector3 } from 'three/webgpu';
import { Fn, If, abs, atomicAdd, atomicLoad, atomicStore, cameraPosition, cameraViewMatrix, cos, faceDirection, float, floor,
  instanceIndex, instancedArray, ivec2, max, min, mix, normalize, positionGeometry, positionWorld, pow, saturate, select, sin,
  smoothstep, step, storage, texture, textureLoad, transformNormalByViewMatrix, uint, uniform, varying, vec2, vec3, vec4 } from 'three/tsl';
import { SURFACE } from './surface.js';
import { swayOnWind, reedSwing, windSheenAt } from './one-wind.mjs';
import { paintedGround, PAINTED_SHADING } from './material.js';
import { paintedWet } from './painted-world-lighting.mjs';
import { applyGroundRelief, classStyle, groundClassColour, groundTintColour, isGroundTintClass, GROUND_DETAIL } from './ground-material-core.mjs';
import { tourGradeOf } from './turf-look.mjs';
import { NEAR_GRASS, NEAR_GRASS_TOUR, createNearGrassClip } from './near-grass.mjs';

export const GPU_GRASS = Object.freeze({
  /* the rings: the innermost cell (metres), cells a side, rings, and candidate blades a cell */
  cell: 0.1, cells: 100, rings: 5, blades: 16,
  /* the rings drawn as the near draw; the rest are the far draw */
  nearRings: 2,
  /* the strips' segments, near and far */
  segments: Object.freeze({ near: 4, far: 2 }),
  /* how many blades each draw holds at most */
  capacity: Object.freeze({ near: 300000, far: 300000 }),
  /* a ring thins to a quarter over this share of its half-width, the dying blades shrinking over `shrink` of a draw */
  thin: Object.freeze([0.6, 0.96]), shrink: 0.12,
  /* each ring's blades this much wider than the ring's inside it: fewer but wider with distance */
  widen: 1.55,
  /* a blade is whole to `fadeFrom` of its class's fade distance and gone by it, metres */
  fadeMetres: Object.freeze({ [SURFACE.ROUGH]: 62, [SURFACE.SEMI]: 40, [SURFACE.HEATH]: 55, [SURFACE.WETLAND]: 60,
    [SURFACE.FAIRWAY]: 7.5, [SURFACE.TEE]: 7, [SURFACE.FRINGE]: 7, [SURFACE.GREEN]: 6 }),
  fadeFrom: 0.5,
  /* a blade is never narrower than this many pixels: sub-pixel far blades flickered (1080p against a 4K render
     scaled down); the rings' 0.9 */
  minPixels: 1.3,
  /* the mown classes' blades, metres, laid along the mowing (lean 0.55-0.8 of their length) */
  mownMetres: Object.freeze({ [SURFACE.FAIRWAY]: 0.026, [SURFACE.TEE]: 0.022, [SURFACE.FRINGE]: 0.02, [SURFACE.GREEN]: 0.011 }),
  mownLean: Object.freeze([0.35, 0.55]),
  /* the share of the candidates the mown turf keeps: dense laid blades a pixel wide flickered under the
     temporal AA's jitter (frame-to-frame difference over the tee, reduced motion) */
  mownKeep: 0.34,
  /* a mown blade's root and tip tones against the ground's colour (the wild grass's 0.42 and 1.22) */
  mownRoot: 0.9, mownTip: 1.1,
  /* the mowing's passes, metres a pass (ground-material-core.mjs MOW_BAND_METRES) */
  passMetres: Object.freeze({ fairway: 3.2, green: 1.1, tee: 1.1 }),
  /* the far blades' normal leans to the ground's and their gloss goes, between these distances */
  calm: Object.freeze([12, 45]),
  /* hidden from this far over the ground: every blade has faded by then */
  hideAboveMetres: 70,
});

/** The rings for the GPU grass: each ring's cell, half-width and first candidate. */
export function gpuGrassLayout(G = GPU_GRASS) {
  const perRing = G.cells * G.cells * G.blades;
  const rings = Array.from({ length: G.rings }, (_, k) => Object.freeze({ cell: G.cell * 2 ** k, half: G.cell * 2 ** k * G.cells / 2, first: k * perRing }));
  const reach = rings.at(-1).half * 0.95;
  const clipTexels = 2 * Math.ceil((reach + 8) / NEAR_GRASS.clipMetres);
  return Object.freeze({ rings: Object.freeze(rings), perRing, candidates: perRing * G.rings, reach, clipTexels });
}

/* the PCG hash, as near-grass.mjs's */
const pcg = v => {
  const state = v.mul(uint(747796405)).add(uint(2891336453));
  const word = state.shiftRight(state.shiftRight(uint(28)).add(uint(4))).bitXor(state).mul(uint(277803737));
  return word.shiftRight(uint(22)).bitXor(word);
};
const unit = h => h.toFloat().mul(1 / 2 ** 32);
const OFFSET = 2 ** 20;

/**
 * `{ mesh, clip, layout, update(camera, viewportHeight), prime(camera, viewportHeight), settled, stats() }`, the near
 * grass's interface. As createNearGrass, with `renderer` (the compute's) and `fields` (the exact atlas's mowing
 * fields: { texF, lateralStepMetres }) for the mown blades.
 */
export function createGpuGrass({ renderer, atlas, fields = null, tint = null, DETAIL = null, C, SHADE, cutTone = 1, uSun,
  sunThrough = float(1), sunlit = null, groundAt, ground = {}, params = GPU_GRASS, mown = true } = {}) {
  const G = params;
  const terms = { relief: true, wear: true, grain: true, gloss: true, ...ground };
  if (!renderer) throw new TypeError('the GPU grass needs the renderer');
  if (!atlas?.texSdf?.length || !atlas.channels?.length || !atlas.bounds) throw new TypeError('the GPU grass needs the exact class fields');
  if (typeof groundAt !== 'function') throw new TypeError('the GPU grass needs the visible ground');
  const layout = gpuGrassLayout(G);
  const R = layout.rings.length, n = G.cells, K = G.blades;
  const clip = createNearGrassClip({ texels: layout.clipTexels, groundAt });
  const centres = layout.rings.map(() => uniform(new Vector2(0, 0)));
  const pixelPerMetre = uniform(0.001);
  const viewProjection = uniform(new Matrix4());
  /* the eye, for the compute pass: a dispatch has no camera of its own (three's cameraPosition is a render's) */
  const uEye = uniform(new Vector3());
  const capNear = G.capacity.near, capFar = G.capacity.far, cap = capNear + capFar;

  /* the blades: A (root x, ground y, root z, length), B (lean direction x, z, lean, width),
     C (colour rgb, tone), D (the finish's three blotches, the laid sheen), E (sway x, z, seasonal, gloss);
     the near draw's in [0, capNear), the far draw's after them */
  const A = instancedArray(cap, 'vec4'), B = instancedArray(cap, 'vec4'), Cb = instancedArray(cap, 'vec4'),
    D = instancedArray(cap, 'vec4'), E = instancedArray(cap, 'vec4');
  /* the two draws' indexed-indirect arguments: index count, instance count, first index, base vertex, first instance */
  const strip = s => 6 * (s - 1) + 3;
  const drawArgs = new IndirectStorageBufferAttribute(new Uint32Array([strip(G.segments.near), 0, 0, 0, 0, strip(G.segments.far), 0, 0, 0, 0]), 1);
  const args = storage(drawArgs, 'uint', 10).toAtomic();

  const reset = Fn(() => {
    atomicStore(args.element(0), uint(strip(G.segments.near)));
    atomicStore(args.element(1), uint(0));
    atomicStore(args.element(5), uint(strip(G.segments.far)));
    atomicStore(args.element(6), uint(0));
  })().compute(1);
  const finish = Fn(() => {
    atomicStore(args.element(1), min(atomicLoad(args.element(1)), uint(capNear)));
    atomicStore(args.element(6), min(atomicLoad(args.element(6)), uint(capFar)));
  })().compute(1);

  const generate = Fn(() => {
    const id = instanceIndex;
    const ringIndex = id.div(uint(layout.perRing));
    const inRing = id.sub(ringIndex.mul(uint(layout.perRing)));
    const cellIndex = inRing.div(uint(K)), bladeIndex = inRing.sub(cellIndex.mul(uint(K)));
    const ringOf = ringIndex.toFloat();
    const cu = cellIndex.mod(uint(n)).toFloat(), cv = cellIndex.div(uint(n)).toFloat();
    const pick = values => values.slice(1).reduce((acc, value, k) => select(ringOf.equal(float(k + 1)), value, acc), values[0]);
    const cellSize = pick(layout.rings.map(r => float(r.cell)));
    const centre = pick(centres);
    const cellI = centre.x.sub(n / 2).add(cu), cellJ = centre.y.sub(n / 2).add(cv);
    const seed = pcg(pcg(uint(cellI.add(OFFSET)).add(pcg(uint(cellJ.add(OFFSET))))).add(uint(ringOf.mul(7919).add(bladeIndex.toFloat().mul(104729)))));
    const r = k => unit(pcg(seed.add(uint(k))));
    const scattered = vec2(cellI.add(unit(pcg(seed))), cellJ.add(r(1))).mul(cellSize);
    /* the blade's clump: the nearest of the jittered centres round it */
    const T = NEAR_GRASS_TOUR;
    const cc = floor(scattered.div(T.clump));
    let best = float(1e9), clumpCentre = null, clumpKey = null;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ci = cc.x.add(di), cj = cc.y.add(dj);
      const key = pcg(pcg(uint(ci.add(OFFSET))).add(uint(cj.add(OFFSET))));
      const at = vec2(ci.add(unit(pcg(key.add(uint(11))))), cj.add(unit(pcg(key.add(uint(12)))))).mul(T.clump);
      const d = at.sub(scattered).length();
      const nearer = d.lessThan(best);
      best = select(nearer, d, best);
      clumpCentre = clumpCentre ? select(nearer, at, clumpCentre) : at;
      clumpKey = clumpKey ? select(nearer, key, clumpKey) : key;
    }
    const clumpHash = k => unit(pcg(clumpKey.add(uint(k))));
    const root = mix(scattered, clumpCentre, clumpHash(13).mul(T.pull)).toVar();

    /* its own ring: not inside the next ring in, and thinned (shrinking) toward its edge */
    let inner = float(0);
    for (let k = 1; k < R; k++) {
      const inside = layout.rings[k - 1], c = centres[k - 1];
      const lo = c.sub(n / 2).mul(inside.cell), hi = c.add(n / 2).mul(inside.cell);
      const within = step(lo.x, root.x).mul(step(root.x, hi.x)).mul(step(lo.y, root.y)).mul(step(root.y, hi.y));
      inner = select(ringOf.equal(float(k)), within, inner);
    }
    const eye = vec2(uEye.x, uEye.z);
    const half = pick(layout.rings.map(r2 => float(r2.half)));
    const t = max(abs(root.x.sub(eye.x)), abs(root.y.sub(eye.y))).div(half);
    const keep = select(ringOf.equal(float(R - 1)), float(1), float(1).sub(smoothstep(G.thin[0], G.thin[1], t).mul(0.75)));
    const life = saturate(keep.sub(r(3)).div(G.shrink)).mul(float(1).sub(inner));
    If(life.greaterThan(0), () => {
      /* the ground under it, from the grid round the eye */
      const W = clip.texels;
      const wrap = a => { const q = a.sub(floor(a.div(W)).mul(W)); return select(q.greaterThanEqual(W), q.sub(W), select(q.lessThan(0), q.add(W), q)); };
      const cf = root.div(clip.metres), c0 = floor(cf), fr = cf.sub(c0);
      const at = (di, dj) => textureLoad(clip.texture, ivec2(wrap(c0.x.add(di)), wrap(c0.y.add(dj))));
      const under = mix(mix(at(0, 0), at(1, 0), fr.x), mix(at(0, 1), at(1, 1), fr.x), fr.y);
      const groundY = under.x, grassHere = smoothstep(NEAR_GRASS.growsFrom[0], NEAR_GRASS.growsFrom[1], under.y);
      /* in the view: the root a little up, with a margin for the blade's own size near the eye */
      const p = viewProjection.mul(vec4(root.x, groundY.add(0.05), root.y, 1));
      const margin = float(0.06).add(float(0.35).div(p.w.max(0.1)));
      const inView = p.w.greaterThan(0.05).and(abs(p.x).lessThan(p.w.mul(margin.add(1)))).and(abs(p.y).lessThan(p.w.mul(margin.add(1.1))));
      If(inView.and(grassHere.greaterThan(0)), () => {
        /* what grows there: the classes' exact fields at the root */
        const b = atlas.bounds;
        const uvAtlas = vec2(root.x.sub(b.x0).div(b.x1 - b.x0), root.y.sub(b.z0).div(b.z1 - b.z0));
        const inBounds = step(0, uvAtlas.x).mul(step(uvAtlas.x, 1)).mul(step(0, uvAtlas.y)).mul(step(uvAtlas.y, 1));
        const swz = ['r', 'g', 'b', 'a'];
        const samples = atlas.texSdf.map(tex => texture(tex, uvAtlas).level(0));
        const weightsRaw = atlas.channels.map((_, i) => smoothstep(-0.03, 0.03, samples[i >> 2][swz[i & 3]].mul(8).sub(4)));
        const sum = weightsRaw.reduce((acc, w) => acc.add(w), float(0));
        const norm = float(1).div(max(sum, float(1)));
        const weights = weightsRaw.map(w => w.mul(norm));
        const roughWeight = saturate(float(1).sub(sum));
        const wildLength = sid => T.bladeMetres[sid] ?? 0;
        /* `mown` false (?grassmown=0): the mown turf grows no blades */
        const mownLength = sid => (mown ? G.mownMetres[sid] ?? 0 : 0);
        const fadeOf = sid => G.fadeMetres[sid] ?? 0;
        let wildLen = roughWeight.mul(wildLength(SURFACE.ROUGH)), mownLen = float(0), fadeEnd = roughWeight.mul(fadeOf(SURFACE.ROUGH));
        let mownShare = float(0);
        atlas.channels.forEach((sid, i) => {
          wildLen = wildLen.add(weights[i].mul(wildLength(sid)));
          mownLen = mownLen.add(weights[i].mul(mownLength(sid)));
          fadeEnd = fadeEnd.add(weights[i].mul(fadeOf(sid)));
          if (G.mownMetres[sid]) mownShare = mownShare.add(weights[i]);
        });
        const distance = vec3(root.x, groundY, root.y).distance(uEye);
        const fade = float(1).sub(smoothstep(fadeEnd.mul(G.fadeFrom), fadeEnd, distance));
        const nearTapXY = (() => { const [tc, ts] = GROUND_DETAIL.NEAR_TAP_TURN; return vec2(root.x.mul(tc).sub(root.y.mul(ts)), root.x.mul(ts).add(root.y.mul(tc))).mul(0.09); })();
        const flat = vec4(0.5);
        const nearTap = DETAIL ? texture(DETAIL, nearTapXY).level(0) : flat;
        const farTap = DETAIL ? texture(DETAIL, root.mul(0.031).add(vec2(0.37, 0.61))).level(0) : flat;
        const clump = nearTap.g.sub(farTap.g);
        const dense = clump.mul(NEAR_GRASS.clumpLength).add(1).clamp(...T.dense);
        const clumpTall = mix(float(T.clumpHeight[0]), float(T.clumpHeight[1]), clumpHash(16));
        const bladeLength = wildLen.add(mownLen);
        const mownThin = mix(float(1), step(r(10), float(G.mownKeep)), saturate(mownShare.mul(2)));
        const length = bladeLength.mul(r(4).mul(0.7).add(0.65)).mul(dense).mul(clumpTall).mul(fade).mul(life).mul(inBounds).mul(grassHere).mul(mownThin).toVar();
        If(length.greaterThan(0.002), () => {
          /* THE COLOUR AT ITS ROOT, as near-grass.mjs reckons it: the classes' cut-toned palette or the ground tint,
             the tour grade, the ground's clumps, grain, damp and relief, and each clump and blade its own */
          const tapAt = scale => (DETAIL ? texture(DETAIL, root.mul(scale)).level(0) : flat);
          const blotchTaps = vec3(tapAt(0.012).b, terms.grain ? farTap.g : tapAt(0.038).g, terms.grain ? nearTap.r : tapAt(0.11).r);
          const display = PAINTED_SHADING.toneExponent;
          const lift = cutTone * PAINTED_SHADING.cutLift;
          const tintAtRoot = groundTintColour(tint, root, classStyle(C, SHADE, SURFACE.ROUGH).colour);
          const roughTint = tintAtRoot.rgb;
          const shadeOf = sid => classStyle(C, SHADE, sid).shade;
          const graded = (sid, c) => (tourGradeOf(sid) ? c.mul(vec3(...tourGradeOf(sid))) : c);
          let colour = graded(SURFACE.ROUGH, roughTint).mul(roughWeight);
          let seasonal = roughWeight;
          let bump = roughWeight.mul(shadeOf(SURFACE.ROUGH)[1]), gloss = roughWeight.mul(shadeOf(SURFACE.ROUGH)[2]);
          atlas.channels.forEach((sid, i) => {
            const own = groundClassColour(C, SHADE, sid, { lift, toneExponent: display, hardGround: true });
            colour = colour.add(graded(sid, own ? vec3(...own) : roughTint).mul(weights[i]));
            if (isGroundTintClass(sid)) seasonal = seasonal.add(weights[i]);
            bump = bump.add(weights[i].mul(shadeOf(sid)[1]));
            gloss = gloss.add(weights[i].mul(shadeOf(sid)[2]));
          });
          colour = colour.mul(float(1).add(clump.mul(GROUND_DETAIL.ROUGH_CLUMP_AMPLITUDE * display * cutTone).mul(seasonal)));
          if (terms.grain) colour = colour.mul(float(1).add(clump.mul(GROUND_DETAIL.TURF_GRAIN * display * cutTone).mul(bump).mul(float(1).sub(seasonal))));
          if (terms.wear) {
            const shelter = tintAtRoot.a.mul(255).sub(128).div(127).clamp(-1, 1).negate().max(0);
            const damp = smoothstep(GROUND_DETAIL.DAMP_SHELTER[0], GROUND_DETAIL.DAMP_SHELTER[1], shelter).mul(paintedWet)
              .mul(float(0.75).add(clump.mul(1.2)).clamp(0, 1)).mul(cutTone);
            colour = colour.mul(float(1).sub(damp.mul(GROUND_DETAIL.DAMP_SHADE * display))).mul(vec3(1).add(vec3(...GROUND_DETAIL.DAMP_COOL).mul(damp)));
          }
          if (terms.relief) colour = applyGroundRelief(colour, tintAtRoot.a, seasonal);
          const dry = step(clumpHash(14), float(T.dry)).mul(seasonal);
          colour = colour.mul(mix(vec3(1), vec3(...T.dryTint), dry)).mul(clumpHash(15).sub(0.5).mul(T.tone * 2).add(1));
          const own = r(7), dead = step(r(8), float(T.deadShare)).mul(seasonal);
          colour = colour.mul(mix(vec3(...T.hueCool), vec3(...T.hueWarm), own)).mul(mix(vec3(1), vec3(...T.dead), dead));

          /* ITS LEAN: the wild grass toward its clump's lean; the mown turf laid along the mowing, the passes alternating */
          const ownYaw = r(5).mul(Math.PI * 2), clumpYaw = clumpHash(17).mul(Math.PI * 2);
          const wildDir = normalize(mix(vec2(sin(ownYaw).negate(), cos(ownYaw)), vec2(sin(clumpYaw).negate(), cos(clumpYaw)), T.align));
          let leanDir = wildDir;
          if (fields?.texF) {
            const f = texture(fields.texF, uvAtlas).level(0);
            const raw = vec2(f.b, f.a).mul(255).sub(127.5).div(127);
            const dirLen = raw.length();
            const dir = select(dirLen.greaterThan(0.2), raw.div(dirLen.max(1e-3)), vec2(1, 0));
            const lateral = f.r.mul(255).sub(128).mul(fields.lateralStepMetres);
            const across = root.y.mul(dir.x).sub(root.x.mul(dir.y)), along = root.dot(dir);
            const greenCoordinate = across.mul(0.8192).sub(along.mul(0.5736));
            const green = atlas.channels.reduce((acc, sid, i) => (sid === SURFACE.GREEN ? acc.add(weights[i]) : acc), float(0));
            const tee = atlas.channels.reduce((acc, sid, i) => (sid === SURFACE.TEE ? acc.add(weights[i]) : acc), float(0));
            const passSign = c => select(sin(c).greaterThanEqual(0), float(1), float(-1));
            const sign = mix(mix(passSign(lateral.mul(Math.PI / G.passMetres.fairway)), passSign(across.mul(Math.PI / G.passMetres.tee)), tee),
              passSign(greenCoordinate.mul(Math.PI / G.passMetres.green)), green);
            const greenBearing = dir.mul(0.8192).add(vec2(dir.y.negate(), dir.x).mul(0.5736));
            const laid = normalize(mix(dir, greenBearing, green).mul(sign).add(wildDir.mul(0.25)));
            leanDir = normalize(mix(wildDir, laid, mownShare));
          }
          const wildLean = mix(float(T.lean[0]), float(T.lean[1]), r(6).mul(r(6).mul(0.5).add(r(4).mul(0.5))));
          const lean = mix(wildLean, mix(float(G.mownLean[0]), float(G.mownLean[1]), r(6)), mownShare);
          const ringWide = pick(layout.rings.map((_, k) => float(G.widen ** k)));
          const width = max(length.mul(T.widthShare).mul(ringWide), distance.mul(pixelPerMetre).mul(G.minPixels));
          const sway = swayOnWind({ p: root, weight: length.mul(0.9), rate: 2.6, scale: 3, swing: reedSwing, lean: 0.1 });
          /* the far blades lose their gloss, as their normals lean to the ground's (in the draw) */
          const calm = smoothstep(G.calm[0], G.calm[1], distance);
          const glossOut = terms.gloss ? gloss.mul(float(1).sub(calm)) : float(0);

          /* APPEND it to its draw */
          const isNear = ringIndex.lessThan(uint(G.nearRings));
          const slot = uint(0).toVar();
          If(isNear, () => { slot.assign(atomicAdd(args.element(1), uint(1))); }).Else(() => { slot.assign(atomicAdd(args.element(6), uint(1))); });
          const room = select(isNear, slot.lessThan(uint(capNear)), slot.lessThan(uint(capFar)));
          If(room, () => {
            const at = select(isNear, slot, slot.add(uint(capNear)));
            A.element(at).assign(vec4(root.x, groundY, root.y, length));
            B.element(at).assign(vec4(leanDir.x, leanDir.y, lean, width));
            /* the tone, and (its whole part) whether the blade is mown turf: no output is spare for a flag */
            Cb.element(at).assign(vec4(colour, r(9).mul(0.98).add(step(0.5, mownShare).mul(2))));
            D.element(at).assign(vec4(blotchTaps, windSheenAt(root)));
            E.element(at).assign(vec4(sway.x, sway.z, seasonal, glossOut));
          });
        });
      });
    });
  })().compute(layout.candidates, [256]);

  /* THE DRAWS: one strip of SEG segments a blade, its blades read from the buffers by instance */
  function drawOf(SEG, offset, name) {
    const perBlade = 2 * SEG + 1;
    const corners = new Float32Array(perBlade * 3), index = [];
    for (let l = 0; l < SEG; l++) {
      corners.set([l, -1, 0], 2 * l * 3); corners.set([l, 1, 0], (2 * l + 1) * 3);
      if (l < SEG - 1) { const a = 2 * l; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    corners.set([SEG, 0, 0], 2 * SEG * 3);
    index.push(2 * SEG - 2, 2 * SEG - 1, 2 * SEG);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(corners, 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(perBlade * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    geometry.setIndex(index);
    geometry.setIndirect(drawArgs, offset * 4);
    geometry.boundingSphere = new Sphere(new Vector3(), 1e7);

    const at = offset === 0 ? instanceIndex : instanceIndex.add(uint(capNear));
    const a = A.element(at), bb = B.element(at), cc = Cb.element(at), dd = D.element(at), ee = E.element(at);
    const root = vec2(a.x, a.z), groundY = a.y, length = a.w;
    const facing = vec2(bb.x, bb.y), lean = bb.z, width = bb.w;
    const level = positionGeometry.x, sideOf = positionGeometry.y;
    const eye = vec2(cameraPosition.x, cameraPosition.z);
    let across = vec2(facing.y, facing.x.negate());
    const toEye = normalize(eye.sub(root).add(vec2(1e-4, 0)));
    const square = vec2(toEye.y.negate(), toEye.x);
    const edgeOn = abs(across.dot(toEye));
    across = normalize(mix(across, square.mul(across.dot(square).greaterThanEqual(0).select(float(1), float(-1))), edgeOn.mul(NEAR_GRASS_TOUR.faceEye)));
    /* the blade as a quadratic Bezier: from the root straight up, then over toward its lean (rise and lay as t^2) */
    const along = level.div(SEG);
    const rise = length.mul(along).mul(float(1).sub(lean.mul(lean).mul(0.5).mul(along).mul(along)));
    const out = length.mul(lean).mul(along).mul(along);
    const taper = float(1).sub(along).mul(float(1).add(along.mul(float(1).sub(along)).mul(NEAR_GRASS_TOUR.belly * 4))).mul(0.5);
    const position = vec3(root.x, groundY.sub(float(0.004).mul(float(1).sub(along))).add(rise), root.y)
      .add(vec3(facing.x, 0, facing.y).mul(out))
      .add(vec3(across.x, 0, across.y).mul(width.mul(taper).mul(sideOf)))
      .add(vec3(ee.x, 0, ee.y).mul(along.mul(along)));

    const material = new MeshStandardNodeMaterial({ side: DoubleSide, metalness: 0 });
    material.positionNode = position;
    /* the varyings, packed as the rings pack theirs (16 outputs is WebGPU's limit) */
    const rootColour = varying(vec4(cc.rgb, ee.z), 'gpuGrassColour');
    const acrossSide = varying(vec4(across, sideOf, along), 'gpuGrassFacing');
    const rootTone = varying(vec4(root, cc.w, ee.w), 'gpuGrassRoot');
    const blotches = varying(dd, 'gpuGrassBlotches');
    const faceXZ = vec2(acrossSide.y.negate(), acrossSide.x);
    const up = acrossSide.w, mown = step(1.5, rootTone.z), tone = rootTone.z.sub(mown.mul(2)), seasonalShare = rootColour.w;
    const lean2 = faceXZ.mul(NEAR_GRASS.normalLean).mul(faceDirection);
    const rounded = vec2(acrossSide.x, acrossSide.y).mul(acrossSide.z.mul(NEAR_GRASS_TOUR.round));
    /* far off the blade's normal leans to the ground's: the sward, not glinting blades */
    const calm = smoothstep(G.calm[0], G.calm[1], positionWorld.distance(cameraPosition));
    const bladeNormal = normalize(vec3(lean2.x.add(rounded.x), 1, lean2.y.add(rounded.y)));
    material.normalNode = transformNormalByViewMatrix(normalize(mix(bladeNormal, vec3(0, 1, 0), calm)), cameraViewMatrix);
    const V = normalize(cameraPosition.sub(positionWorld));
    const through = pow(saturate(V.dot(uSun.negate())), 2.4).mul(NEAR_GRASS.through).mul(sunThrough).mul(sunlit ?? 1).mul(up);
    /* a mown blade is short and laid: its root no darker than the turf it stands in, or it reads as a speck */
    const baseTone = mix(float(NEAR_GRASS_TOUR.root), float(G.mownRoot), mown);
    const shaded = rootColour.rgb.mul(mix(baseTone, mix(float(NEAR_GRASS_TOUR.tip), float(G.mownTip), mown), up.sqrt()))
      .mul(mix(vec3(1), vec3(...NEAR_GRASS.tipWarm), up))
      .mul(tone.sub(0.5).mul(NEAR_GRASS.toneSpread).add(1)).mul(through.add(1))
      .mul(float(1).sub(abs(acrossSide.z).mul(NEAR_GRASS_TOUR.edgeShade)));
    const finished = paintedGround({ base: shaded, wp: vec2(rootTone.x, rootTone.y), DETAIL: null, uSun, turf: float(1), seasonal: seasonalShare,
      taps: { a: blotches.x, b: blotches.y, c: blotches.z }, laid: blotches.w,
      broadLift: terms.grain ? float(1).sub(seasonalShare).mul(GROUND_DETAIL.TURF_BROAD_LIFT) : null,
      gloss: terms.gloss ? rootTone.w : null });
    material.colorNode = finished.colorNode;
    material.roughnessNode = finished.roughnessNode;
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    return mesh;
  }
  const group = new Group();
  group.name = 'gpu-grass';
  group.add(drawOf(G.segments.near, 0, 'gpu-grass-near'), drawOf(G.segments.far, 5, 'gpu-grass-far'));
  group.visible = false;
  group.userData.gpuGrass = { candidates: layout.candidates, rings: R, capacity: G.capacity };

  let altitude = null, updates = 0, primeMs = null, dispatches = 0;
  function update(camera, viewportHeight = 1080) {
    const x = camera.position.x, z = camera.position.z;
    const g = groundAt(x, z);
    altitude = g && Number.isFinite(g.h) ? camera.position.y - g.h : Infinity;
    if (!(altitude <= G.hideAboveMetres)) { group.visible = false; return; }
    layout.rings.forEach((ring, k) => centres[k].value.set(Math.floor(x / ring.cell), Math.floor(z / ring.cell)));
    const fov = (camera.fov ?? 50) * Math.PI / 180;
    pixelPerMetre.value = 2 * Math.tan(fov / 2) / Math.max(1, viewportHeight);
    camera.updateMatrixWorld();
    uEye.value.copy(camera.position);
    viewProjection.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    clip.update(x, z);
    group.visible = clip.ready(x, z, layout.reach);
    if (group.visible) {
      /* grown afresh each frame, before the frame is drawn */
      renderer.compute(reset); renderer.compute(generate); renderer.compute(finish);
      dispatches++;
    }
    updates++;
  }
  return {
    mesh: group, layout, clip,
    update,
    prime(camera, viewportHeight) {
      const started = performance.now();
      clip.update(camera.position.x, camera.position.z, { force: true });
      while (!clip.complete) clip.update(camera.position.x, camera.position.z);
      primeMs = performance.now() - started;
      update(camera, viewportHeight);
      return group.visible;
    },
    get settled() { return !(altitude !== null && altitude <= G.hideAboveMetres) || clip.complete; },
    /** The two draws' blade counts, read back from the GPU (a harness's view). */
    async counts() {
      const raw = new Uint32Array(await renderer.getArrayBufferAsync(drawArgs));
      return { near: raw[1], far: raw[6] };
    },
    stats: () => ({ kind: 'gpu', candidates: layout.candidates, rings: R, reach: +layout.reach.toFixed(2), visible: group.visible,
      altitude: altitude === null || !Number.isFinite(altitude) ? null : +altitude.toFixed(2), updates, dispatches,
      primeMs: primeMs === null ? null : +primeMs.toFixed(1), clip: clip.stats() }),
  };
}
