/* Octahedral impostors for the distant trees -- docs/tree-lod-plan.md, phase 2.
 *
 * A tree past the last mesh tier is two triangles: a billboard that samples
 * pictures of the same template the mesh tiers draw, rendered at boot from
 * the vertices of a hemi-octahedron (views from the horizon up; the camera
 * never looks up at a crown from below). At run time the view vector in the
 * tree's own frame is mapped onto that octahedron, the three frames around
 * it are blended, and the result is LIT, not baked: the atlas holds albedo
 * and alpha in one texture and the tree-local normal plus a crown mask in
 * the other, so the impostor takes the sun, the sky, the fog and the season
 * from the same material model as the meshes. That is Ryan Brucks's
 * technique (Fortnite, and the UE plugin), written here in TSL for the
 * WebGPU renderer rather than imported.
 *
 * The mapping functions exist twice on purpose: once in plain JS, which
 * places the bake cameras and is what the unit test exercises, and once in
 * TSL for the shader. They must agree, and the test says so. */
import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, uv, attribute, varying, texture, cameraPosition, uniform,
  normalize, cross, abs, floor, fract, select, dot, pow, saturate, sin, cos,
  transformNormalToView, positionWorld,
} from 'three/tsl';

/** The harness's debug switch for materials built with `debug: true`:
 *  0 view-space normal, 1 dot(normal, view) in world, 2 the same in the
 *  tree's frame (before the yaw), 3 albedo as baked, 4 the crown mask,
 *  5 the frame weights. Unlit and unfogged; the dot terms are banded
 *  (red < 0, yellow < 0.3, green) because the output is still tone-mapped. */
export const impostorDebugMode = uniform(0);

/* Two facts about render targets that decide the atlas layout, both read
   out of three.js 0.185 rather than assumed:
   - the WebGL backend places a viewport from the BOTTOM of the target and
     the WebGPU backend from the TOP, so a frame put in place by
     `renderTarget.viewport` lands in a different row on each backend;
   - both backends sample a render-target texture with v = 0 at the TOP of
     the rendered image (WebGL flips v for render-target textures in
     TextureNode.setupUV; WebGPU stores row 0 at the top).
   So a frame is placed by the PROJECTION -- an NDC scale-and-offset, which
   both backends agree on (y up) -- and it is read back with v flipped. */

/** Where frame (i, j) of an N x N atlas sits in NDC: the offset matrix that
 *  maps the tree's own clip space into that cell. j counts from the bottom. */
export function frameNdcOffset(i, j, framesPerSide) {
  const s = 1 / framesPerSide;
  return { scale: s, x: -1 + (2 * i + 1) * s, y: -1 + (2 * j + 1) * s };
}

/** The atlas uv a point (u, v) of frame (i, j) is sampled at, with u, v in
 *  [0, 1] across the frame and v = 1 the TOP of the tree. `size` is the
 *  atlas edge in texels; the sample is inset a texel from the frame edge. */
export function frameUv(i, j, u, v, framesPerSide, size) {
  const cell = 1 / framesPerSide, inset = 1 / size, span = cell - inset * 2;
  return [i * cell + inset + u * span, (framesPerSide - 1 - j) * cell + inset + (1 - v) * span];
}

/* ------------------------------------------------------------ the mapping */

/** A unit direction with y >= 0 -> [0,1]^2 on the hemi-octahedron. */
export function hemiOctahedralEncode(x, y, z) {
  const l1 = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
  const px = x / l1, pz = z / l1;
  return [(px + pz) * 0.5 + 0.5, (pz - px) * 0.5 + 0.5];
}

/** The inverse: [0,1]^2 -> a unit direction on the upper hemisphere. */
export function hemiOctahedralDecode(u, v) {
  const tx = u * 2 - 1, ty = v * 2 - 1;
  const x = (tx - ty) * 0.5, z = (tx + ty) * 0.5;
  const y = Math.max(0, 1 - Math.abs(x) - Math.abs(z));
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

/**
 * The three frames of an N x N grid that surround a point of the mapping,
 * and their barycentric weights (sum to one). The grid samples the unit
 * square at i / (N - 1); a query falls in one of the two triangles of its
 * cell.
 */
export function frameBlend(u, v, framesPerSide) {
  const n = framesPerSide - 1;
  const gx = Math.min(n - 1e-9, Math.max(0, u * n)), gy = Math.min(n - 1e-9, Math.max(0, v * n));
  const i0 = Math.floor(gx), j0 = Math.floor(gy);
  const fx = gx - i0, fy = gy - j0;
  if (fx + fy <= 1) {
    return { frames: [[i0, j0], [i0 + 1, j0], [i0, j0 + 1]], weights: [1 - fx - fy, fx, fy] };
  }
  return { frames: [[i0 + 1, j0 + 1], [i0 + 1, j0], [i0, j0 + 1]], weights: [fx + fy - 1, 1 - fy, 1 - fx] };
}

/** The camera basis for a view direction: right and up, with the pole handled. */
export function viewBasis(dx, dy, dz) {
  /* looking straight down the up vector is undefined; north stands in */
  const polar = dy > 0.999;
  const ux = 0, uy = polar ? 0 : 1, uz = polar ? -1 : 0;
  /* right = up x view, up' = view x right */
  let rx = uy * dz - uz * dy, ry = uz * dx - ux * dz, rz = ux * dy - uy * dx;
  const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
  const vx = dy * rz - dz * ry, vy = dz * rx - dx * rz, vz = dx * ry - dy * rx;
  return { right: [rx, ry, rz], up: [vx, vy, vz] };
}

/* ------------------------------------------------------------------ bake */

/**
 * Render one species' templates into two atlases. `crown` and `trunk` are
 * the geometries the mesh tiers draw (the crown carries the vertex colour
 * the mesh material multiplies in); `crownBase` is NOT baked -- the crown
 * pixels hold the vertex colour alone, so the season tint and the birch
 * leaf colour are applied at draw time through the crown mask.
 *
 * Returns the atlases, the frame geometry, and the extent the frames were
 * framed with: a square of half-size `radius` centred `centreY` above the
 * base, which is exactly the quad the impostor draws.
 */
export function bakeImpostorAtlas(renderer, { crown, trunk, trunkColor, framesPerSide = 8, frameSize = 96 } = {}) {
  if (!renderer || !crown || !trunk) throw new TypeError('bakeImpostorAtlas needs the renderer and both template geometries');
  crown.computeBoundingBox(); trunk.computeBoundingBox();
  const box = new THREE.Box3().union(crown.boundingBox).union(trunk.boundingBox);
  const height = box.max.y, radiusXZ = Math.max(Math.abs(box.min.x), box.max.x, Math.abs(box.min.z), box.max.z);
  const centreY = height * 0.5;
  /* a square that holds the tree from any direction on the hemisphere */
  const radius = Math.hypot(height * 0.5, radiusXZ) * 1.02;
  const size = framesPerSide * frameSize;

  const target = kind => {
    /* mipmapped: an impostor is drawn at a fifth of its baked size and
       more, and an unfiltered atlas under an alpha test is a tree full of
       holes; the clear texels are black at zero coverage, so the mip chain
       is premultiplied by construction and the draw divides it back out */
    const rt = new THREE.RenderTarget(size, size, {
      depthBuffer: true, stencilBuffer: false, format: THREE.RGBAFormat,
      type: THREE.HalfFloatType, samples: 0, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    });
    rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    rt.texture.name = `impostor-${kind}`;
    return rt;
  };
  const albedoTarget = target('albedo'), normalTarget = target('normal');

  const scene = new THREE.Scene();
  const crownAlbedo = new THREE.MeshBasicNodeMaterial();
  crownAlbedo.colorNode = attribute('color', 'vec3');
  const trunkAlbedo = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(trunkColor) });
  /* the normal in the tree's frame, and the crown mask in alpha. The mesh
     tiers are flat shaded, so the picture carries FACE normals from the
     screen-space derivatives, not the smoothed vertex normals the geometry
     holds -- the tree is at the origin unturned, so world space is its own
     frame. (three's WGSL builder emits -dpdy, so the cross product has the
     same sign on both backends.) */
  const faceNormal = positionWorld.dFdx().cross(positionWorld.dFdy()).normalize().mul(0.5).add(0.5);
  const crownNormal = new THREE.MeshBasicNodeMaterial();
  crownNormal.colorNode = faceNormal;
  crownNormal.opacityNode = float(1);
  const trunkNormal = new THREE.MeshBasicNodeMaterial();
  trunkNormal.colorNode = faceNormal;
  trunkNormal.opacityNode = float(0);
  /* an opaque NodeMaterial under NormalBlending writes alpha 1 whatever its
     opacity node says (NodeMaterial.setupDiffuseColor), which is what made
     every trunk a crown in the mask; NoBlending writes the four channels
     as computed, and nothing here needs to blend */
  for (const m of [crownAlbedo, trunkAlbedo, crownNormal, trunkNormal]) m.blending = THREE.NoBlending;
  const crownMesh = new THREE.Mesh(crown, crownAlbedo), trunkMesh = new THREE.Mesh(trunk, trunkAlbedo);
  crownMesh.frustumCulled = trunkMesh.frustumCulled = false;
  scene.add(crownMesh, trunkMesh);

  const camera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.1, radius * 4);
  /* the renderer rewrites a camera's projection the first time it sees a
     coordinate system or depth convention it did not expect; declare both
     up front so the per-frame projection below is the one that renders */
  camera.coordinateSystem = renderer.coordinateSystem;
  if (renderer.reversedDepthBuffer === true) camera._reversedDepth = true;
  const ndcOffset = new THREE.Matrix4();
  const previous = {
    target: renderer.getRenderTarget(), autoClear: renderer.autoClear,
    clearColor: renderer.getClearColor(new THREE.Color()), clearAlpha: renderer.getClearAlpha(),
    toneMapping: renderer.toneMapping,
  };
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NoToneMapping;
  const passes = [
    { rt: albedoTarget, crownMat: crownAlbedo, trunkMat: trunkAlbedo },
    { rt: normalTarget, crownMat: crownNormal, trunkMat: trunkNormal },
  ];
  for (const pass of passes) {
    crownMesh.material = pass.crownMat; trunkMesh.material = pass.trunkMat;
    renderer.setRenderTarget(pass.rt);
    renderer.autoClear = true;
    renderer.clear();
    renderer.autoClear = false;
    for (let j = 0; j < framesPerSide; j++) {
      for (let i = 0; i < framesPerSide; i++) {
        const [dx, dy, dz] = hemiOctahedralDecode(i / (framesPerSide - 1), j / (framesPerSide - 1));
        const { up } = viewBasis(dx, dy, dz);
        camera.position.set(dx * radius * 2, centreY + dy * radius * 2, dz * radius * 2);
        camera.up.set(up[0], up[1], up[2]);
        camera.lookAt(0, centreY, 0);
        camera.updateMatrixWorld(true);
        /* the whole target is the viewport; this frame's cell of it is
           chosen in clip space, where both backends agree which way is up.
           Nothing spills into a neighbour: `radius` holds the tree from
           every direction, so no vertex leaves the cell */
        const o = frameNdcOffset(i, j, framesPerSide);
        camera.updateProjectionMatrix();
        ndcOffset.makeScale(o.scale, o.scale, 1).setPosition(o.x, o.y, 0);
        camera.projectionMatrix.premultiply(ndcOffset);
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        renderer.render(scene, camera);
      }
    }
  }
  renderer.setRenderTarget(previous.target);
  renderer.autoClear = previous.autoClear;
  renderer.setClearColor(previous.clearColor, previous.clearAlpha);
  renderer.toneMapping = previous.toneMapping;
  crownAlbedo.dispose(); trunkAlbedo.dispose(); crownNormal.dispose(); trunkNormal.dispose();

  return Object.freeze({
    albedo: albedoTarget.texture, normal: normalTarget.texture,
    targets: [albedoTarget, normalTarget],
    framesPerSide, frameSize, size, radius, centreY, height,
  });
}

/* --------------------------------------------------------------- material */

/**
 * The impostor material: a lit billboard. Instances come from an
 * InstancedBufferGeometry carrying `aImpostorPos` (x, y, z of the base) and
 * `aImpostorParam` (yaw, scaleXZ, scaleY, 0). The quad's own `uv` runs 0..1.
 */
export function createImpostorMaterial(atlas, { crownBase, sunDirection, roughness = 0.92, debug = null } = {}) {
  const material = new THREE.MeshStandardNodeMaterial({ roughness, metalness: 0, flatShading: false });
  const n = atlas.framesPerSide;
  const cell = 1 / n;
  /* inset the sample by a texel so a frame never bleeds into its neighbour */
  const inset = 1 / atlas.size;

  /* --- vertex: the billboard, and which frames to blend --- */
  const base = attribute('aImpostorPos', 'vec3');
  const param = attribute('aImpostorParam', 'vec4');
  const yaw = param.x, scaleXZ = param.y, scaleY = param.z;
  const centre = base.add(vec3(0, float(atlas.centreY).mul(scaleY), 0));   /* a number times a node is NaN in JS, and NaN in the shader */
  const view = normalize(cameraPosition.sub(centre));
  const polar = view.y.greaterThan(0.999);
  const upRef = select(polar, vec3(0, 0, -1), vec3(0, 1, 0));
  const right = normalize(cross(upRef, view));
  const up = cross(view, right);
  const q = uv().sub(0.5);
  const halfW = float(atlas.radius).mul(scaleXZ), halfH = float(atlas.radius).mul(scaleY);
  const world = centre.add(right.mul(q.x.mul(halfW).mul(2))).add(up.mul(q.y.mul(halfH).mul(2)));

  /* the view vector in the tree's frame: the instance is the template turned
     by yaw about y, so turn the view back by -yaw */
  const c = cos(yaw), s = sin(yaw);
  const local = vec3(view.x.mul(c).sub(view.z.mul(s)), view.y, view.x.mul(s).add(view.z.mul(c)));
  const l1 = abs(local.x).add(abs(local.y)).add(abs(local.z)).max(1e-6);
  const px = local.x.div(l1), pz = local.z.div(l1);
  const ou = px.add(pz).mul(0.5).add(0.5), ov = pz.sub(px).mul(0.5).add(0.5);
  const grid = vec2(ou, ov).mul(n - 1).clamp(0, n - 1 - 1e-4);
  const i0 = floor(grid), f = fract(grid);
  const lower = f.x.add(f.y).lessThanEqual(1);
  const fA = select(lower, i0, i0.add(1));
  const fB = vec2(i0.x.add(1), i0.y);
  const fC = vec2(i0.x, i0.y.add(1));
  const wA = select(lower, float(1).sub(f.x).sub(f.y), f.x.add(f.y).sub(1));
  const wB = select(lower, f.x, float(1).sub(f.y));
  const wC = select(lower, f.y, float(1).sub(f.x));

  const vFrameA = varying(fA), vFrameB = varying(fB), vFrameC = varying(fC);
  const vWeights = varying(vec3(wA, wB, wC));
  const vYaw = varying(yaw);
  const vLocal = varying(local);
  material.positionNode = world;

  /* --- fragment: blend the three frames, light the result --- */
  /* the TSL twin of frameUv(): frame rows count from the bottom of the
     atlas, texture v from the top, and the tree's top is at v = 0 of its
     frame (the unit test holds the two to each other) */
  const span = cell - inset * 2;
  const atlasUv = frame => vec2(
    frame.x.mul(cell).add(uv().x.mul(span)).add(inset),
    float(n - 1).sub(frame.y).mul(cell).add(float(1).sub(uv().y).mul(span)).add(inset));
  const sample = (tex, frame) => texture(tex, atlasUv(frame));
  const albedoA = sample(atlas.albedo, vFrameA), albedoB = sample(atlas.albedo, vFrameB), albedoC = sample(atlas.albedo, vFrameC);
  const normalA = sample(atlas.normal, vFrameA), normalB = sample(atlas.normal, vFrameB), normalC = sample(atlas.normal, vFrameC);
  const w = vWeights;
  const albedo = albedoA.mul(w.x).add(albedoB.mul(w.y)).add(albedoC.mul(w.z));
  const nrm = normalA.mul(w.x).add(normalB.mul(w.y)).add(normalC.mul(w.z));
  const coverage = albedo.a;
  /* premultiplied by coverage in the blend; divide it back out */
  const colourLocal = albedo.rgb.div(coverage.max(1e-4));
  const crownMask = nrm.a.div(coverage.max(1e-4)).clamp(0, 1);
  const nLocalRaw = nrm.rgb.div(coverage.max(1e-4)).mul(2).sub(1);
  /* the blend of three frames' facet normals (and the mip chain under
     them) is SHORT where the facets disagreed: the sideways components of
     a crown cancel and what is left leans up. Renormalising that points
     the whole crown at the sky, 40% too bright against a low sun; its
     length is the share of the facets that agreed, an occlusion term */
  const nLen = nLocalRaw.length().clamp(0.05, 1);
  const nLocal = nLocalRaw.div(nLen);
  /* tree frame -> world: turn by +yaw about y */
  const cy = cos(vYaw), sy = sin(vYaw);
  const nWorld = normalize(vec3(nLocal.x.mul(cy).add(nLocal.z.mul(sy)), nLocal.y, nLocal.z.mul(cy).sub(nLocal.x.mul(sy))));
  /* with `debug`, modes 10+ of impostorDebugMode ablate the LIT material
     one term at a time: 10 no back-light, 11 the normal facing the camera,
     12 the normal straight up, 13 the normal negated */
  const m = impostorDebugMode;
  const bent = k => normalize(nWorld.mul(1 - k).add(view.mul(k)));
  const nLit = !debug ? nWorld : select(m.lessThan(10.5), nWorld, select(m.lessThan(11.5), view, select(m.lessThan(12.5), vec3(0, 1, 0),
    select(m.lessThan(13.5), nWorld.negate(), select(m.lessThan(15.5), nWorld, select(m.lessThan(16.5), bent(0.4), select(m.lessThan(17.5), bent(0.6), bent(0.8))))))));
  material.normalNode = transformNormalToView(nLit);
  material.alphaTestNode = float(0.5);
  material.opacityNode = coverage;
  /* the crown takes the species' base colour (the birch its season), the
     trunk keeps the colour it was baked with; and the same back-lit glow
     the mesh crowns carry against a low sun */
  const V = normalize(cameraPosition.sub(positionWorld));
  const backLit = pow(saturate(dot(V, sunDirection.negate())), 2.6).mul(0.55).add(1);
  const back = !debug ? backLit : select(m.greaterThan(9.5).and(m.lessThan(10.5)), float(1), backLit);
  /* 14: the colour scaled by the normal's length; 15: the length as ambient occlusion */
  const lenScale = !debug ? float(1) : select(m.greaterThan(13.5).and(m.lessThan(14.5)), nLen, float(1));
  if (debug) material.aoNode = select(m.greaterThan(14.5).and(m.lessThan(15.5)), nLen, float(1));
  const crownColour = colourLocal.mul(crownBase).mul(back);
  material.colorNode = crownColour.mul(crownMask).add(colourLocal.mul(float(1).sub(crownMask))).mul(lenScale);
  if (debug && debug !== 'lit') {
    /* the harness's view of one term at a time (impostorDebugMode), on
       the same billboard with the same cut, and nothing between the value
       and the pixel but the output transfer function */
    const unlit = new THREE.MeshBasicNodeMaterial();
    unlit.positionNode = world;
    unlit.alphaTestNode = float(0.5);
    unlit.opacityNode = coverage;
    unlit.fog = false;
    unlit.toneMapped = false;
    /* the frame is tone-mapped and sRGB-encoded whatever a material says,
       so a dot product is shown in bands a reader can count: red facing
       away, yellow grazing (0..0.3), green facing (> 0.3) */
    const grey = v => select(v.lessThan(0), vec3(1, 0, 0), select(v.lessThan(0.3), vec3(1, 1, 0), vec3(0, 1, 0)));
    unlit.colorNode = select(m.lessThan(0.5), transformNormalToView(nWorld).mul(0.5).add(0.5),
      select(m.lessThan(1.5), grey(dot(nWorld, view)),
      select(m.lessThan(2.5), grey(dot(nLocal, normalize(vLocal))),
      select(m.lessThan(3.5), colourLocal,
      select(m.lessThan(4.5), vec3(crownMask), vec3(w))))));
    return unlit;
  }
  return material;
}

/** One quad, instanced: the geometry every impostor batch shares the shape of. */
export function createImpostorGeometry(capacity) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const pos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const par = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  pos.setUsage(THREE.DynamicDrawUsage); par.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aImpostorPos', pos);
  geometry.setAttribute('aImpostorParam', par);
  geometry.instanceCount = 0;
  /* the instances are placed in world space by the material; the geometry's
     own box is meaningless, so it is never used for culling */
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return geometry;
}
