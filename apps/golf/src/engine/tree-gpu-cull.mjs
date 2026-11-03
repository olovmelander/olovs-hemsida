/* THE TREES CULLED ON THE GPU (3 November; ?treecull=gpu, WebGPU at high quality, opt-in until it
   is measured). The tiers (main.js TREE_LOD) decide which trees each tier draws, per 128 m cell on
   the CPU, so a cell half in view draws every tree in it -- the ones behind the eye and off to the
   sides as well. Here, before each frame, a compute pass per hero tier tests every drawn tree's
   bounding sphere against the camera's frustum and appends the survivors, with their crossfade and
   tint, into a copy of the tier that two indirect draws (crown and trunk, one count) draw in the
   colour pass, with no CPU work.

   The shadows must not lose a tree that stands out of view but casts into it (docs/tree-shadows-
   zoom.md), so the tier's own meshes keep drawing the whole tier into the sun's shadow map, on a
   layer only the shadow camera sees; the copies cast nothing. The tier's buffers are storage
   buffers (three's StorageInstancedBufferAttribute: a vertex buffer for the shadow pass, a storage
   buffer for the pass), uploaded by their dirty ranges as before. A tier that grows its capacity
   (tree-tier-capacity.mjs) swaps its buffers; its copy is rebuilt on the next frame.

   The CPU's tier logic -- crossfades, dwell, the distant hero's 24 px -- is untouched; this only
   draws less of what it chose. */
import { BufferGeometry, Frustum, IndirectStorageBufferAttribute, InstancedMesh, Matrix4, StorageInstancedBufferAttribute, Vector4 } from 'three/webgpu';
import { Fn, If, atomicAdd, atomicLoad, atomicStore, instanceIndex, storage, uint, uniform, uniformArray, vec2, vec4 } from 'three/tsl';

/** The layer the tiers' own meshes move to: drawn only by the sun's shadow camera. */
export const TREE_SHADOW_LAYER = 3;

/** A storage-capable instance attribute (vertex buffer and storage buffer both). */
export function storageInstanceAttribute(capacity, itemSize) {
  return new StorageInstancedBufferAttribute(new Float32Array(capacity * itemSize), itemSize);
}

export function createTreeGpuCull({ renderer, scene, sun, margin = 1.15 }) {
  const planes = uniformArray(Array.from({ length: 6 }, () => new Vector4()), 'vec4');
  const frustum = new Frustum(), viewProjection = new Matrix4();
  const entries = [];
  let dispatches = 0, rebuilds = 0;

  /* a tier's copy: its compacted buffers, its two indirect draws and the three passes that fill them */
  function build(entry) {
    const [crown, trunk] = entry.parts;
    const capacity = crown.instanceMatrix.count;
    const matrix = storageInstanceAttribute(capacity, 16), fade = storageInstanceAttribute(capacity, 2);
    const srcTint = crown.geometry.getAttribute('aTint');
    const tint = srcTint ? storageInstanceAttribute(capacity, 4) : null;
    const indexCount = g => (g.index ? g.index.count : g.getAttribute('position').count);
    const args = new IndirectStorageBufferAttribute(new Uint32Array([indexCount(crown.geometry), 0, 0, 0, 0, indexCount(trunk.geometry), 0, 0, 0, 0]), 1);
    const a = storage(args, 'uint', 10).toAtomic();
    const count = uniform(0, 'uint');
    const srcM = storage(crown.instanceMatrix, 'mat4', capacity), dstM = storage(matrix, 'mat4', capacity);
    const srcF = storage(crown.geometry.getAttribute('aFade'), 'vec2', capacity), dstF = storage(fade, 'vec2', capacity);
    const srcT = srcTint ? storage(srcTint, 'vec4', capacity) : null, dstT = tint ? storage(tint, 'vec4', capacity) : null;
    const { centreY, halfHeight, radius } = entry.bounds;
    const reset = Fn(() => { atomicStore(a.element(1), uint(0)); atomicStore(a.element(6), uint(0)); })().compute(1);
    const cull = Fn(() => {
      const i = instanceIndex;
      If(i.lessThan(count), () => {
        const m = srcM.element(i).toVar();
        const sx = m.mul(vec4(1, 0, 0, 0)).xyz.length(), sy = m.mul(vec4(0, 1, 0, 0)).xyz.length();
        const centre = m.mul(vec4(0, centreY, 0, 1)).xyz;
        /* a sphere round the template's cylinder (its crown's radius, its half height), and a margin for the sway */
        const r = vec2(sx.mul(radius), sy.mul(halfHeight)).length().mul(margin);
        let inside = null;
        for (let k = 0; k < 6; k++) {
          const p = planes.element(k);
          const ok = p.xyz.dot(centre).add(p.w).greaterThan(r.negate());
          inside = inside ? inside.and(ok) : ok;
        }
        If(inside, () => {
          const at = uint(0).toVar();
          at.assign(atomicAdd(a.element(1), uint(1)));
          dstM.element(at).assign(m);
          dstF.element(at).assign(srcF.element(i));
          if (dstT) dstT.element(at).assign(srcT.element(i));
        });
      });
    })().compute(capacity, [64]);
    const finish = Fn(() => { atomicStore(a.element(6), atomicLoad(a.element(1))); })().compute(1);

    /* the copies: the tier's own geometry and materials, the compacted instances, indirect draws */
    const copyOf = (src, offset) => {
      const g = new BufferGeometry();
      for (const [name, attr] of Object.entries(src.geometry.attributes)) if (!attr.isInstancedBufferAttribute) g.setAttribute(name, attr);
      if (src.geometry.index) g.setIndex(src.geometry.index);
      g.setAttribute('aFade', fade);
      if (src === crown && tint) g.setAttribute('aTint', tint);
      g.boundingSphere = src.geometry.boundingSphere;
      g.setIndirect(args, offset * 4);
      const im = new InstancedMesh(g, src.material, capacity);
      im.instanceMatrix = matrix;
      im.count = capacity;
      im.frustumCulled = false;
      im.castShadow = false;
      im.receiveShadow = src.receiveShadow;
      im.renderOrder = src.renderOrder;
      im.name = `${src.name}-gpu-culled`;
      im.userData.tag = 'trees';
      im.raycast = () => {};
      scene.add(im);
      return im;
    };
    if (entry.copies) for (const c of entry.copies) { scene.remove(c); c.geometry.dispose(); c.dispose(); }
    entry.copies = [copyOf(crown, 0), copyOf(trunk, 5)];
    Object.assign(entry, { capacity, srcMatrix: crown.instanceMatrix, count, passes: [reset, cull, finish], args });
    rebuilds++;
  }

  return {
    /** A hero tier: { parts: [crownMesh, trunkMesh] } with storage buffers, and its template's bounds in local metres. */
    register(tier, bounds) {
      const entry = { tier, parts: tier.parts, bounds, copies: null };
      for (const im of entry.parts) {
        im.layers.set(TREE_SHADOW_LAYER);
        if (!im.instanceMatrix.isStorageInstancedBufferAttribute) throw new TypeError('a GPU-culled tier needs storage instance buffers');
      }
      sun.shadow.camera.layers.enable(TREE_SHADOW_LAYER);
      build(entry);
      entries.push(entry);
    },
    /** Before each frame: the frustum, and each tier's pass over its drawn trees. */
    update(camera) {
      camera.updateMatrixWorld();
      viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(viewProjection, renderer.coordinateSystem, camera.reversedDepth ?? false);
      frustum.planes.forEach((p, k) => planes.array[k].set(p.normal.x, p.normal.y, p.normal.z, p.constant));
      for (const e of entries) {
        const [crown] = e.parts;
        /* a tier that grew swapped its buffers: its copy follows */
        if (crown.instanceMatrix !== e.srcMatrix) build(e);
        const n = crown.count;
        for (const c of e.copies) c.visible = crown.visible && n > 0;
        if (!(crown.visible && n > 0)) continue;
        e.count.value = n;
        for (const pass of e.passes) renderer.compute(pass);
        dispatches++;
      }
    },
    /** The copies' drawn counts, read back (a harness's view). */
    async counts() {
      const out = [];
      for (const e of entries) out.push({ name: e.parts[0].name, drawn: e.parts[0].count, kept: new Uint32Array(await renderer.getArrayBufferAsync(e.args))[1] });
      return out;
    },
    stats: () => ({ tiers: entries.length, dispatches, rebuilds }),
  };
}
