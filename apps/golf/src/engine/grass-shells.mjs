/* THE GRASS MAT, IN SHELLS (3 November, owner request: "can't we make it a mat of
   dense grass? some material or technique"). Shell texturing, as games draw
   dense short grass and fur: the ground round the eye drawn again as `layers`
   thin shells, one above the other up to the grass's height, each keeping only
   the pixels where a blade of the mat still stands that high. Together they
   are a carpet of tens of thousands of blades with real depth, for a handful
   of draws and no blade geometry.

   The mat is modelled and baked in Blender through the MCP
   (tools/blender-props/grass_mat.py): a tileable metre of several thousand
   curved blades seen straight down, its colour in RGB and the top blade's
   height in A. A leaning blade's height rises along it, so the shells cut it
   as a leaning blade.

   - One instanced draw: a grid of world-anchored vertices round the eye (it
     moves in whole cells, so no vertex swims), one instance per shell. Each
     vertex stands on the grass round the ball's ground grid, as its blades do.
   - On the rough (the ground no class claims), the heath and the wetland,
     from the ground's exact class fields; lowered toward the cut so the mat
     meets the mown edge; nothing where the grid says no grass grows.
   - The mat's colour, divided by its mean blade colour, on the ground's own
     colour at the vertex (its tint, the tour grade, the relief and the painted
     finish): a dry blade stays straw. The deeper shells darker, as dense grass
     shades its own base.
   - Cut through the MSAA samples; the shells sink to the ground and stop with
     distance, where the ground's own grain takes over; they sway on the one
     wind, the top shells most.
   High quality only. ?grassmat=0 is the before. */
import { BufferAttribute, DoubleSide, InstancedBufferGeometry, Mesh, MeshStandardNodeMaterial, Sphere, Vector2, Vector3 } from 'three/webgpu';
import {
  cameraPosition, cameraViewMatrix, float, floor, instanceIndex, ivec2, max, mix, normalize, positionGeometry, positionWorld,
  select, smoothstep, step, texture, textureLoad, transformNormalByViewMatrix, uniform, varying, vec2, vec3,
} from 'three/tsl';
import { SURFACE } from './surface.js';
import { swayOnWind, reedSwing } from './one-wind.mjs';
import { applyGroundRelief, classStyle, groundTintColour } from './ground-material-core.mjs';
import { tourGradeOf } from './turf-look.mjs';
import { paintedGround } from './material.js';
import { coverOpaqueBackdrop, centredCoverageCut } from './msaa-coverage.mjs';

export const GRASS_MAT_ASSET = Object.freeze({
  url: 'models/props/grass-mat-a4f47fc478b6a8eb347ffe4c77bf6bed64bda4d45b91eec43cb4ba1fe28f342f.png',
  sha256: 'a4f47fc478b6a8eb347ffe4c77bf6bed64bda4d45b91eec43cb4ba1fe28f342f',
  bytes: 3127913,
  /* the mat's mean blade colour, linear (its record) */
  meanLinear: Object.freeze([0.18229, 0.27746, 0.06361]),
});

export const GRASS_SHELLS = Object.freeze({
  /* shells, and the grid round the eye: its cell and cells a side */
  layers: 12, cell: 0.5, cells: 130,
  /* the mat's height on each class, metres */
  height: Object.freeze({ [SURFACE.HEATH]: 0.06, [SURFACE.WETLAND]: 0.07 }),
  rough: 0.075,
  /* metres of ground the mat's one tile covers, and its turn off the world's axes */
  tile: 0.85,
  /* lowered from the cut's edge: none within edge[0] metres, all of it by edge[1] */
  edge: Object.freeze([0.15, 1.6]),
  /* how dark the bottom shell is against the top (the shells average about the ground's tone) */
  base: 0.9, top: 1.22,
  /* the mat's fine detail blurred by this many mip levels, so blades under a pixel cannot shimmer,
     and its whole detail given way to the ground's own colour between these distances, metres */
  blur: 0.75, settle: Object.freeze([9, 28]),
  /* the shells sink to the ground between these distances, metres */
  fade: Object.freeze([22, 32]),
  hideAboveMetres: 40,
});

const hex = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
  .map(b => b.toString(16).padStart(2, '0')).join('');

/** The mat's texture, verified against its record. */
export async function loadGrassMat({ baseUrl = '/', fetchImpl = fetch, THREE } = {}) {
  const A = GRASS_MAT_ASSET;
  const res = await fetchImpl(baseUrl + A.url);
  if (!res.ok) throw new Error(`grass mat: HTTP ${res.status}`);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength !== A.bytes) throw new Error(`grass mat: ${bytes.byteLength} bytes, the record says ${A.bytes}`);
  if (await hex(bytes) !== A.sha256) throw new Error('grass mat: sha256 does not match the record');
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const map = new THREE.Texture(bitmap);
  map.name = 'grass-mat';
  map.colorSpace = THREE.SRGBColorSpace;
  map.flipY = false;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 4;
  map.needsUpdate = true;
  return map;
}

/** The grid template: (cells + 1)^2 vertices, position carrying the cell indices (u, v). */
export function grassShellTemplate(cells = GRASS_SHELLS.cells) {
  const side = cells + 1, positions = new Float32Array(side * side * 3), index = [];
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) positions.set([i, 0, j], (j * side + i) * 3);
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    const a = j * side + i;
    index.push(a, a + side, a + 1, a + 1, a + side, a + side + 1);
  }
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(side * side * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geometry.setIndex(index);
  return geometry;
}

/**
 * The mat round the eye: `{ mesh, update(camera, grassShown), stats() }`.
 * - `map`: the mat (loadGrassMat); `atlas`: the exact class fields; `clip`: the grass's ground grid;
 * - `tint`, `C`, `SHADE`, `DETAIL`, `uSun`: the ground's colour terms.
 */
export function createGrassShells({ map, atlas, clip, tint = null, C, SHADE, DETAIL, uSun, tourGrade = true, relief = true }) {
  const S = GRASS_SHELLS;
  if (!atlas?.texSdf?.length || !atlas.channels?.length || !atlas.bounds) throw new TypeError('the grass mat needs the exact class fields');
  if (!clip?.texture) throw new TypeError('the grass mat needs the grass round the ball\'s ground grid');
  const geometry = grassShellTemplate(S.cells);
  geometry.instanceCount = S.layers;
  geometry.boundingSphere = new Sphere(new Vector3(), 1e7);
  const origin = uniform(new Vector2(0, 0));

  /* the vertex on the ground, world-anchored */
  const wp = origin.add(vec2(positionGeometry.x, positionGeometry.z)).mul(S.cell);
  const W = clip.texels;
  const wrap = a => {
    const r = a.sub(floor(a.div(W)).mul(W));
    return select(r.greaterThanEqual(W), r.sub(W), select(r.lessThan(0), r.add(W), r));
  };
  const cf = wp.div(clip.metres), c0 = floor(cf), fr = cf.sub(c0);
  const at = (di, dj) => textureLoad(clip.texture, ivec2(wrap(c0.x.add(di)), wrap(c0.y.add(dj))));
  const under = mix(mix(at(0, 0), at(1, 0), fr.x), mix(at(0, 1), at(1, 1), fr.x), fr.y);
  const groundY = under.x, grassHere = smoothstep(0.85, 0.98, under.y);

  /* how tall the mat stands here: the rough's, the heath's or the wetland's; lowered toward the cut */
  const b = atlas.bounds;
  const uvAtlas = vec2(wp.x.sub(b.x0).div(b.x1 - b.x0), wp.y.sub(b.z0).div(b.z1 - b.z0));
  const inBounds = step(0, uvAtlas.x).mul(step(uvAtlas.x, 1)).mul(step(0, uvAtlas.y)).mul(step(uvAtlas.y, 1));
  const swizzle = ['r', 'g', 'b', 'a'];
  const samples = atlas.texSdf.map(tex => texture(tex, uvAtlas).level(0));
  let claimed = float(0), nearestCut = float(-8), wildHeight = float(0);
  atlas.channels.forEach((sid, i) => {
    const sdf = samples[i >> 2][swizzle[i & 3]].mul(8).sub(4);
    const weight = smoothstep(-0.03, 0.03, sdf);
    if (S.height[sid]) { wildHeight = wildHeight.add(weight.mul(S.height[sid])); return; }
    claimed = claimed.add(weight);
    nearestCut = max(nearestCut, sdf);
  });
  const roughShare = float(1).sub(claimed).clamp(0, 1);
  const byCut = smoothstep(S.edge[0], S.edge[1], nearestCut.negate());
  const distance = vec3(wp.x, groundY, wp.y).distance(cameraPosition);
  const near = float(1).sub(smoothstep(S.fade[0], S.fade[1], distance));
  const height = roughShare.mul(S.rough).add(wildHeight).mul(byCut).mul(grassHere).mul(inBounds).mul(near);

  /* the shell: its share of the height, the top shells swaying most */
  const layer = instanceIndex.toFloat().add(1).div(S.layers);
  const sway = swayOnWind({ p: wp, weight: height.mul(4), rate: 2.4, scale: 3, swing: reedSwing, lean: 0.1 });
  const position = vec3(wp.x, groundY.add(0.003).add(height.mul(layer)), wp.y).add(sway.mul(layer.mul(layer)));

  /* the ground's colour at the vertex, as the blades round the ball take it */
  const tintAtRoot = groundTintColour(tint, wp, classStyle(C, SHADE, SURFACE.ROUGH).colour);
  let ground = tintAtRoot.rgb;
  if (tourGrade && tourGradeOf(SURFACE.ROUGH)) ground = ground.mul(vec3(...tourGradeOf(SURFACE.ROUGH)));
  if (relief) ground = applyGroundRelief(ground, tintAtRoot.a, float(1));

  const material = new MeshStandardNodeMaterial({ side: DoubleSide, metalness: 0, roughness: 0.92 });
  material.name = 'GrassShells';
  material.positionNode = position;
  const groundColour = varying(ground, 'grassShellGround');
  const shell = varying(vec2(layer, height), 'grassShellLayer');
  /* the mat on the world, turned off its axes so its repeat lines up with nothing */
  const p = positionWorld.xz;
  const uvMat = vec2(p.x.mul(0.8).sub(p.y.mul(0.6)), p.x.mul(0.6).add(p.y.mul(0.8))).div(S.tile);
  const texel = texture(map, uvMat).bias(S.blur);
  /* a blade stands at this shell where its height passes the shell's share; none where the mat is gone */
  /* and fade in from nothing as the mat's height grows from 2 to 12 mm, so it has no edge where it ends */
  const stands = texel.a.sub(shell.x).add(0.5).mul(smoothstep(0.002, 0.012, shell.y));
  const mean = vec3(...GRASS_MAT_ASSET.meanLinear);
  const shade = mix(float(S.base), float(S.top), shell.x);
  /* the mat's detail gives way to the ground's own colour with distance, so where the shells end
     the ground beyond them is the same colour */
  const seen = positionWorld.distance(cameraPosition);
  const detail = float(1).sub(smoothstep(S.settle[0], S.settle[1], seen));
  const base = mix(vec3(1), texel.rgb.div(mean).mul(shade), detail).mul(groundColour);
  const finish = paintedGround({ base, wp: p, DETAIL, uSun, turf: float(1), seasonal: float(1) });
  material.colorNode = finish.colorNode;
  material.roughnessNode = finish.roughnessNode;
  material.normalNode = transformNormalByViewMatrix(normalize(vec3(0, 1, 0)), cameraViewMatrix);
  material.opacityNode = stands;
  material.alphaTest = 0.5;
  coverOpaqueBackdrop(material);
  material.alphaTestNode = centredCoverageCut(stands, 0.5);

  const mesh = new Mesh(geometry, material);
  mesh.name = 'grass-shells';
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.visible = false;
  return {
    mesh, layers: S.layers,
    update(camera, grassShown) {
      origin.value.set(Math.floor(camera.position.x / S.cell) - S.cells / 2, Math.floor(camera.position.z / S.cell) - S.cells / 2);
      mesh.visible = !!grassShown;
    },
    stats: () => ({ layers: S.layers, cells: S.cells, cell: S.cell, visible: mesh.visible }),
    dispose() { geometry.dispose(); material.dispose(); mesh.removeFromParent(); },
  };
}
