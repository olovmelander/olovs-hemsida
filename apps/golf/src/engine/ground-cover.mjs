/* The ground cover's own rules (main.js: the tussocks, the mown edge's clumps,
   the reeds, the bushes and the stones). docs/visual-ground-2026-09-26.md */
import { vec2, vec3, mix, normalize, faceDirection, normalWorldGeometry, cameraViewMatrix,
  transformNormalByViewMatrix } from 'three/tsl';
import { paintedSeason, paintedTurfStrength } from './painted-world-lighting.mjs';
import { SEASON_OCHRE } from './material.js';

const TAU = Math.PI * 2;

/* THE BLADES, as they were drawn: positions, and the normals they were given. */
/* a tussock: three splayed blades, wide at the base, leaning out, meeting at a tip */
export function tussockBlades() {
  const positions = [], normals = [];
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * TAU + 0.4, c = Math.cos(a), sn = Math.sin(a);
    positions.push(c * 0.14, 0, sn * 0.14, -sn * 0.12, 0, c * 0.12, c * 0.24, 0.30, sn * 0.24);
    for (let k = 0; k < 3; k++) normals.push(-sn, 0.55, c);
  }
  return { positions, normals };
}
/* a reed: three crossed blades, 2.1 m tall */
export function reedBlades() {
  const positions = [], normals = [];
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * TAU + 0.7, c2 = Math.cos(a), s2 = Math.sin(a);
    positions.push(c2 * 0.3, 0, s2 * 0.3, -c2 * 0.3, 0, -s2 * 0.3, c2 * 0.12, 2.1, s2 * 0.12);
    for (let q = 0; q < 3; q++) normals.push(-s2, 0.25, c2);
  }
  return { positions, normals };
}
/* the mown edge's clump: five narrow blades of the rough's own green */
export function clumpBlades() {
  const positions = [], normals = [];
  for (let b = 0; b < 5; b++) {
    const a = b / 5 * TAU + 0.3, c = Math.cos(a), sn = Math.sin(a);
    const r = 0.04, half = 0.03, lean = 0.07 + (b % 3) * 0.035, tall = 0.17 + ((b * 7) % 5) * 0.025;
    positions.push(c * r - sn * half, 0, sn * r + c * half, c * r + sn * half, 0, sn * r - c * half, c * (r + lean), tall, sn * (r + lean));
    for (let k = 0; k < 3; k++) normals.push(c * 0.45, 0.8, sn * 0.45);
  }
  return { positions, normals };
}

/* THE BLADE'S LIGHT. A blade is one triangle drawn from both sides, and three
   turns a back face's normal round -- its tilt toward the sky with it -- so a
   tussock, clump or reed seen from behind its front face was lit as ground
   facing down. The tussocks' and reeds' normals also lay behind their front
   faces, so the side seen from the front was lit from behind: on both faces
   the normal pointed away from the eye, and a blade went dark with the sun at
   the viewer's back. A blade is lit by the tilt it was given, always toward
   the sky, and its sideways facing turned to the side that is seen. The
   geometry's normals must lie on the front face's side (bladeNormalsFront). */
export function seenBladeNormal() {
  const n = normalWorldGeometry;
  const side = vec2(n.x, n.z).mul(faceDirection);
  /* normalNode is read in view space, and bypasses three's back-face turn */
  return transformNormalByViewMatrix(normalize(vec3(side.x, n.y.abs(), side.y)), cameraViewMatrix);
}

/* the same blade normals, turned to the front face's side: [x, y, z] -> [-x, y, -z] */
export const bladeNormalsFront = normals => normals.map((v, i) => (i % 3 === 1 ? v : -v));

/* THE COLOURS AS THEY WERE TUNED. The tussocks', bushes' and clumps' colours
   mix along a smooth channel of the ground's detail texture, and they were
   chosen by eye while that texture went through a 2D canvas (until 24
   September), whose premultiplied alpha cleared a third of its texels and
   crushed the rest: its blue channel averaged 0.303 where the texture holds
   0.471, its green 0.334 against 0.513 (measured over the whole texture,
   ground-cover.test.mjs). Read cleanly, every tussock went mustard. The mixes
   take this share of the channel, which puts their mean where it was tuned,
   now without the speckle. */
export const COVER_TUNED_SHARE = 0.65;

/* THE GRASS ON THE GRASS. What grows in the rough takes the finish's grass
   terms as the rough under it does (material.js paintedGround): the light's
   grass strength -- Dag and Sommar hold their ground at 0.85-0.87 -- and
   autumn's ochre, without which the mown edge's fringe stayed a green band
   along the ochre rough in Höst. */
export function grassCover(colour) {
  return colour.mul(mix(vec3(1), vec3(...SEASON_OCHRE), paintedSeason)).mul(paintedTurfStrength);
}

/* SEATED ON THE LOWEST GROUND UNDER IT. A stone or bush was set at its
   centre's height, and the big stones stand on the steepest ground (their
   odds climb with the slope), so the downhill side of a boulder two metres
   across hung in the air. The lowest of the centre and six points round the
   rim, less the sink it was given at its centre. */
export function seatHeight(heightAt, x, z, radius, centre = heightAt(x, z)) {
  let lowest = centre;
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * Math.PI * 2;
    lowest = Math.min(lowest, heightAt(x + Math.cos(a) * radius, z + Math.sin(a) * radius));
  }
  return lowest;
}
/* how far out the rim is sampled, per unit of the instance's scale: inside
   each shape's footprint (a stone's dodecahedron is 0.5 across the long
   way, a bush's icosahedron 0.62) */
export const SEAT_RIM = Object.freeze({ stone: 0.45, bush: 0.5 });

/* REEDS AT EVERY LAKE AND POND, EACH AT ITS OWN LEVEL. The reed scan took the
   first lake the pack lists and held every candidate to ITS level: reeds
   fringed that lake, and any other water whose shore lay at its height -- a
   river at its mouth, a ditch beside it -- and nothing else: Puttom's other
   three lakes, at 51-63 m where the first stands at 67, and every pond at
   another height had none. main.js keeps that rule and adds this one, so
   nothing that stood is lost: a reed also stands where the ground lies at the
   level of a lake or pond within `reach` metres of it -- the reach of the
   scan's own shore field (main.js SHORE: a 6 m grid, the cell on the shore and
   the next) -- from `below` under its level (0.22 m on a shore, 0.42 m in a
   silt flat's bed) to 0.2 m over it. Lakes, ponds and the surroundings' water
   count; streams, whose level runs with them, do not, nor the sea: an open
   shore has none. `waters` are water index records near the candidate ({ ring,
   level, stream, isSea }); `signedDistance(x, z, ring, cutoff)` is negative
   inside and exact up to the cutoff (ring-index.mjs ringSDIndexed). */
export const REED_LAKE_REACH = 15, REED_ABOVE_METRES = 0.2;
export function reedWaterAt(waters, x, z, h, below, signedDistance, { reach = REED_LAKE_REACH, excluded = () => false } = {}) {
  for (const q of waters) {
    if (q.stream || q.isSea || excluded(q) || !(h >= q.level - below && h <= q.level + REED_ABOVE_METRES)) continue;
    if (signedDistance(x, z, q.ring, reach) < reach) return true;
  }
  return false;
}
