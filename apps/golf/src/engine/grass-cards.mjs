/* GRASS CARDS IN THE ROUGH (3 November, owner request: "make the grass turf
   denser and more impressive, can we use something from the Blender MCP? I
   don't like the triangle-shaped grass"). The Blender MCP renders four clumps
   of curved, tapered blades (tools/blender-props/grass_cards.py) into one
   strip: a dense rough, a wispy fescue with some straw, a short dense sward and
   a green-and-dry mix, each 1 m wide and 0.5 m tall. Here they stand in the
   rough round the eye, in one instanced draw of crossed cards, the way a tour
   game thickens its rough:

   - a grid of world cells round the eye, anchored to the world as the blades
     round the ball are, so the cards scroll with the camera and never swim;
   - only where no class claims the ground (the rough), and the heath and the
     wetland, from the ground's exact class fields, and only where the grass
     round the ball's ground grid says grass grows (no water, no shore);
   - short beside the cut and full height a few metres out (a first cut, then
     the rough), none within a stride of the cut's edge;
   - each card's blades on the ground's own colour at its root (the tint, the
     tour grade, the relief and the painted finish, as the ground takes them):
     the texture's colour divided by its mean blade colour, so a dry blade stays
     straw beside the green ones;
   - cut through the MSAA samples (msaa-coverage.mjs), its alpha held up in the
     far mips so a far card keeps its blades; swaying on the one wind from the
     root; shrunk away with distance (no pop) and near the lens.
   ?grasscards=0 is the before. */
import { DoubleSide, InstancedBufferGeometry, BufferAttribute, Mesh, MeshStandardNodeMaterial, Sphere, Vector2, Vector3 } from 'three/webgpu';
import {
  cameraViewMatrix, cameraPosition, cos, dFdx, dFdy, float, floor, instanceIndex, ivec2, log2, max, mix, select,
  normalize, positionGeometry, sin, smoothstep, step, texture, textureLoad, transformNormalByViewMatrix, uint, uniform, varying, vec2, vec3,
} from 'three/tsl';
import { SURFACE } from './surface.js';
import { swayOnWind, reedSwing } from './one-wind.mjs';
import { applyGroundRelief, classStyle, groundTintColour } from './ground-material-core.mjs';
import { tourGradeOf } from './turf-look.mjs';
import { paintedGround } from './material.js';
import { coverOpaqueBackdrop, centredCoverageCut } from './msaa-coverage.mjs';

export const GRASS_CARDS_ASSET = Object.freeze({
  url: 'models/props/grass-cards-9e350113d553072c4903e662814865197616ed73b787d0df5756974541776398.png',
  sha256: '9e350113d553072c4903e662814865197616ed73b787d0df5756974541776398',
  bytes: 666316,
  tiles: 4,
  /* the strip's mean blade colour, linear (its record) */
  meanLinear: Object.freeze([0.1892, 0.27392, 0.06373]),
});

export const GRASS_CARDS = Object.freeze({
  quality: Object.freeze({
    hi: Object.freeze({ cell: 0.55, cells: 100, fade: Object.freeze([17, 26]) }),
    lo: Object.freeze({ cell: 0.6, cells: 56, fade: Object.freeze([10, 15.5]) }),
  }),
  /* the share of rough cells with a card, and the cards' size against the texture's 1 x 0.5 m */
  density: 0.85, size: Object.freeze([0.7, 1.15]),
  /* beside the cut: none within edge[0] metres, a first cut's height `short` to full by edge[1] */
  edge: Object.freeze([0.8, 7]), short: 0.4,
  /* shrunk away within this many metres of the lens */
  near: Object.freeze([0.5, 1.4]),
  /* how much the alpha is held up per mip level past the first, so a far card keeps its blades */
  mipHold: 0.3,
  /* the tiles' share: rough, fescue, short, mixed */
  tileShare: Object.freeze([0.38, 0.17, 0.25, 0.2]),
  hideAboveMetres: 40,
});

/** The card template: two quads crossed at right angles; position carries (quad, u, v). */
export function grassCardTemplate() {
  const corners = new Float32Array(8 * 3), index = [];
  for (let q = 0; q < 2; q++) {
    for (let k = 0; k < 4; k++) corners.set([q, k & 1, k >> 1], (q * 4 + k) * 3);
    const a = q * 4;
    index.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(corners, 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(8 * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geometry.setIndex(index);
  return geometry;
}

const hex = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
  .map(b => b.toString(16).padStart(2, '0')).join('');

/** The card strip's texture, verified against its record (bytes, sha256). */
export async function loadGrassCards({ baseUrl = '/', fetchImpl = fetch, THREE } = {}) {
  const A = GRASS_CARDS_ASSET;
  const res = await fetchImpl(baseUrl + A.url);
  if (!res.ok) throw new Error(`grass cards: HTTP ${res.status}`);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength !== A.bytes) throw new Error(`grass cards: ${bytes.byteLength} bytes, the record says ${A.bytes}`);
  if (await hex(bytes) !== A.sha256) throw new Error('grass cards: sha256 does not match the record');
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const map = new THREE.Texture(bitmap);
  map.name = 'grass-cards';
  map.colorSpace = THREE.SRGBColorSpace;
  map.flipY = false;
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 8;
  map.needsUpdate = true;
  return map;
}

/* the PCG hash, as the grass round the ball keeps it */
const pcg = v => {
  const state = v.mul(uint(747796405)).add(uint(2891336453));
  const word = state.shiftRight(state.shiftRight(uint(28)).add(uint(4))).bitXor(state).mul(uint(277803737));
  return word.shiftRight(uint(22)).bitXor(word);
};
const unit = h => h.toFloat().mul(1 / 2 ** 32);
const OFFSET = 2 ** 20;
const cellHash = (i, j, salt) => unit(pcg(pcg(pcg(uint(i.add(OFFSET))).add(uint(j.add(OFFSET)))).add(uint(salt * 7919))));

/**
 * The cards round the eye: `{ mesh, update(camera, grassShown), stats() }`.
 * - `map`: the strip (loadGrassCards); `atlas`: the exact class fields; `clip`: the grass's ground grid;
 * - `tint`, `C`, `SHADE`, `DETAIL`, `uSun`: the ground's colour terms, as the blades round the ball take them.
 */
export function createGrassCards({ map, atlas, clip, tint = null, C, SHADE, DETAIL, uSun, tourGrade = true, quality = 'hi', relief = true }) {
  const G = GRASS_CARDS;
  const Q = G.quality[quality] ?? G.quality.hi;
  const n = Q.cells;
  if (!atlas?.texSdf?.length || !atlas.channels?.length || !atlas.bounds) throw new TypeError('the grass cards need the exact class fields');
  if (!clip?.texture) throw new TypeError('the grass cards need the grass round the ball\'s ground grid');
  const geometry = grassCardTemplate();
  geometry.instanceCount = n * n;
  geometry.boundingSphere = new Sphere(new Vector3(), 1e7);
  const centre = uniform(new Vector2(0, 0));

  const cu = instanceIndex.mod(uint(n)).toFloat(), cv = instanceIndex.div(uint(n)).toFloat();
  const cellI = centre.x.sub(n / 2).add(cu), cellJ = centre.y.sub(n / 2).add(cv);
  const h1 = cellHash(cellI, cellJ, 3), h2 = cellHash(cellI, cellJ, 5), h3 = cellHash(cellI, cellJ, 7);
  const h4 = cellHash(cellI, cellJ, 11), h5 = cellHash(cellI, cellJ, 13);
  const root = vec2(cellI.add(h1), cellJ.add(h2)).mul(Q.cell);

  /* the ground under it, from the grass's grid */
  const W = clip.texels;
  const wrap = a => {
    const r = a.sub(floor(a.div(W)).mul(W));
    return select(r.greaterThanEqual(W), r.sub(W), select(r.lessThan(0), r.add(W), r));
  };
  const cf = root.div(clip.metres), c0 = floor(cf), fr = cf.sub(c0);
  const at = (di, dj) => textureLoad(clip.texture, ivec2(wrap(c0.x.add(di)), wrap(c0.y.add(dj))));
  const under = mix(mix(at(0, 0), at(1, 0), fr.x), mix(at(0, 1), at(1, 1), fr.x), fr.y);
  const groundY = under.x, grassHere = smoothstep(0.85, 0.98, under.y);

  /* the rough: no class claims the ground (heath and wetland count as rough); the nearest cut */
  const b = atlas.bounds;
  const uvAtlas = vec2(root.x.sub(b.x0).div(b.x1 - b.x0), root.y.sub(b.z0).div(b.z1 - b.z0));
  const inBounds = step(0, uvAtlas.x).mul(step(uvAtlas.x, 1)).mul(step(0, uvAtlas.y)).mul(step(uvAtlas.y, 1));
  const swizzle = ['r', 'g', 'b', 'a'];
  const samples = atlas.texSdf.map(tex => texture(tex, uvAtlas).level(0));
  const wild = new Set([SURFACE.HEATH, SURFACE.WETLAND]);
  let claimed = float(0), nearestCut = float(-8);
  atlas.channels.forEach((sid, i) => {
    const sdf = samples[i >> 2][swizzle[i & 3]].mul(8).sub(4);
    if (wild.has(sid)) return;
    claimed = claimed.add(smoothstep(-0.03, 0.03, sdf));
    nearestCut = max(nearestCut, sdf);
  });
  const rough = smoothstep(0.85, 1, float(1).sub(claimed).clamp(0, 1));
  const fromCut = nearestCut.negate();
  const beside = smoothstep(G.edge[0], G.edge[0] + 0.8, fromCut);
  const grown = mix(float(G.short), float(1), smoothstep(G.edge[0], G.edge[1], fromCut));

  /* how near the eye: shrunk away far off and at the lens */
  const distance = vec3(root.x, groundY, root.y).distance(cameraPosition);
  const fade = smoothstep(G.near[0], G.near[1], distance).mul(float(1).sub(smoothstep(Q.fade[0], Q.fade[1], distance)));
  const alive = step(h3, float(G.density)).mul(rough).mul(beside).mul(grassHere).mul(inBounds);
  const scale = mix(float(G.size[0]), float(G.size[1]), h4).mul(grown).mul(fade).mul(alive);

  /* which tile: by the tiles' shares */
  let tile = float(G.tileShare.length - 1), acc = 0;
  for (let k = G.tileShare.length - 2; k >= 0; k--) {
    acc = G.tileShare.slice(0, k + 1).reduce((s, v) => s + v, 0);
    tile = select(h5.lessThan(acc), float(k), tile);
  }

  /* THE CARD: two quads crossed, turned to the cell's own yaw, standing on the ground */
  const quad = instanceQuad(), u = cornerU(), v = cornerV();
  const yaw = h1.add(h2).mul(Math.PI).add(quad.mul(Math.PI / 2));
  const across = vec3(cos(yaw), 0, sin(yaw));
  const sway = swayOnWind({ p: root, weight: scale.mul(0.4), rate: 2.2, scale: 3, swing: reedSwing, lean: 0.1 });
  const position = vec3(root.x, groundY.sub(0.02), root.y)
    .add(across.mul(u.sub(0.5).mul(scale)))
    .add(vec3(0, v.mul(scale.mul(0.5)), 0))
    .add(sway.mul(v.mul(v)));

  /* the colour at its root: the ground's, as the blades round the ball take it */
  const fallback = classStyle(C, SHADE, SURFACE.ROUGH).colour;
  const tintAtRoot = groundTintColour(tint, root, fallback);
  let ground = tintAtRoot.rgb;
  if (tourGrade && tourGradeOf(SURFACE.ROUGH)) ground = ground.mul(vec3(...tourGradeOf(SURFACE.ROUGH)));
  if (relief) ground = applyGroundRelief(ground, tintAtRoot.a, float(1));

  const material = new MeshStandardNodeMaterial({ side: DoubleSide, metalness: 0, roughness: 0.92 });
  material.name = 'GrassCards';
  material.positionNode = position;
  const groundColour = varying(ground, 'grassCardGround');
  const uvCard = varying(vec2(tile.add(u).div(GRASS_CARDS_ASSET.tiles), float(1).sub(v)), 'grassCardUv');
  const rootXZ = varying(root, 'grassCardRoot');
  const texel = texture(map, uvCard);
  /* held up in the far mips: the blades' alpha thins as they average, so lift it by the level */
  const texelsPerPixel = max(dFdx(uvCard.mul(vec2(2048, 256))).length(), dFdy(uvCard.mul(vec2(2048, 256))).length());
  const lod = log2(texelsPerPixel.max(1));
  const alpha = texel.a.mul(float(1).add(lod.mul(G.mipHold)));
  const mean = vec3(...GRASS_CARDS_ASSET.meanLinear);
  const base = texel.rgb.div(mean).mul(groundColour);
  const finish = paintedGround({ base, wp: rootXZ, DETAIL, uSun, turf: float(1), seasonal: float(1) });
  material.colorNode = finish.colorNode;
  material.roughnessNode = finish.roughnessNode;
  /* lit like the ground it stands on */
  material.normalNode = transformNormalByViewMatrix(normalize(vec3(0, 1, 0)), cameraViewMatrix);
  material.opacityNode = alpha;
  material.alphaTest = 0.5;
  coverOpaqueBackdrop(material);
  material.alphaTestNode = centredCoverageCut(alpha, 0.5);

  const mesh = new Mesh(geometry, material);
  mesh.name = 'grass-cards';
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.visible = false;
  return {
    mesh, cells: n * n,
    update(camera, grassShown) {
      centre.value.set(Math.floor(camera.position.x / Q.cell), Math.floor(camera.position.z / Q.cell));
      mesh.visible = !!grassShown;
    },
    stats: () => ({ cells: n * n, cell: Q.cell, visible: mesh.visible }),
    dispose() { geometry.dispose(); material.dispose(); mesh.removeFromParent(); },
  };
}

/* the template's corners, as nodes: which quad, and where across and up it */
function instanceQuad() { return positionGeometry.x; }
function cornerU() { return positionGeometry.y; }
function cornerV() { return positionGeometry.z; }
