// Diagnostic CPU replay: real application functions, placement and frusta,
// with drawable attributes but no rendering. Never interpret this as FPS.
import { PAIR, FADE_EPOCH_S, drainAt, reversedFade } from '../apps/golf/src/engine/tree-fade.mjs';
import { reserveTreeTier, initialTreeTierCapacity } from '../apps/golf/src/engine/tree-tier-capacity.mjs';

export function treeFunctions(source) {
  const start = source.indexOf('function treeFadeWrite(');
  const end = source.indexOf("\nlap('tree tiers (Hero + Impostor, cells)'");
  if (start < 0 || end < start) throw new Error('tree replay source anchors missing');
  return source.slice(start, end);
}

export function captureTreeInput(lod, holes, heightAt, detailHeight) {
  const fields = ['cell', 'fadeS', 'cellMode', 'nominalHeight', 'heroPx', 'switchPx', 'impostorPx',
    'hysteresis', 'lodMode', 'zoneTiers', 'dwell', 'floors', 'floorReach', 'force'];
  return {
    config: Object.fromEntries(fields.map(k => [k, lod[k]])), detailHeight,
    cells: lod.cells.map(c => ({ x0: c.x0, x1: c.x1, z0: c.z0, z1: c.z1, y0: c.y0, y1: c.y1,
      min: c.box.min.toArray(), max: c.box.max.toArray(), lists: c.lists.map(l => Array.from(l)) })),
    tiers: lod.tiers.map(sp => sp && ({ n: sp.n, treeH: Array.from(sp.treeH), treeCY: Array.from(sp.treeCY), zone: Array.from(sp.zone) })),
    mats: lod.mats.map(a => Array.from(a)), imp: lod.imp.map(a => Array.from(a)), tint: lod.tint.map(a => Array.from(a)),
    holes: holes.map(h => h.line.map(([x, z]) => [x, heightAt(x, z), z])),
  };
}

// Pass the caller's pinned Three instance; tools have no Three dependency.
export function createTreeReplay(THREE) {
  function makeTier(n, index) {
    const capacity = index === 2 || index === 3 ? 0 : initialTreeTierCapacity(n);
    const geometry = crown => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('aFade', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2));
      if (crown) g.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
      return g;
    };
    const tier = { idx: index, count: 0, slots: new Int32Array(capacity), dirtyM: [], dirtyF: [] };
    if (index === 4) {
      tier.geo = geometry(true);
      tier.pos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      tier.par = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
      tier.geo.setAttribute('aImpostorPos', tier.pos); tier.geo.setAttribute('aImpostorParam', tier.par);
      tier.mesh = new THREE.Mesh(tier.geo);
    } else tier.parts = index === 1 ? [true, false].map(crown => new THREE.InstancedMesh(geometry(crown), undefined, capacity)) : [];
    const objects = tier.mesh ? [tier.mesh] : tier.parts;
    tier.fade = objects.map(o => o.geometry.getAttribute('aFade'));
    tier.tint = objects.map(o => o.geometry.getAttribute('aTint')).filter(Boolean);
    return tier;
  }

  function createReplay(input, source, coordinateSystem = THREE.WebGLCoordinateSystem, instrument = false) {
    const lod = { ...structuredClone(input.config), ready: true, frozen: false, resetPending: false,
      fadeClock: 0, queue: [], qHead: 0, stats: { moves: 0, switches: 0, reversals: 0, updates: 0 },
      cells: input.cells.map(c => ({ ...c, visible: false, lists: c.lists.map(l => Int32Array.from(l)),
        box: new THREE.Box3(new THREE.Vector3(...c.min), new THREE.Vector3(...c.max)) })),
      mats: input.mats.map(a => Float32Array.from(a)), imp: input.imp.map(a => Float32Array.from(a)), tint: input.tint.map(a => Float32Array.from(a)),
      tiers: input.tiers.map(sp => sp && ({ n: sp.n, zone: Uint8Array.from(sp.zone), treeH: Float32Array.from(sp.treeH), treeCY: Float32Array.from(sp.treeCY),
        tierOf: new Uint8Array(sp.n), where: new Int32Array(sp.n).fill(-1), pend: new Uint8Array(sp.n), pendN: new Uint8Array(sp.n),
        outTier: new Uint8Array(sp.n), whereOut: new Int32Array(sp.n).fill(-1), fadeT0: new Float32Array(sp.n), fadeCode: new Uint8Array(sp.n),
        t: [null, ...[1, 2, 3, 4].map(i => makeTier(sp.n, i))] })),
    };
    const camera = new THREE.PerspectiveCamera(48, 1000 / 700, 1, 14000);
    camera.coordinateSystem = coordinateSystem;
    camera._reversedDepth = coordinateSystem === THREE.WebGPUCoordinateSystem;
    camera.updateProjectionMatrix();
    const counters = { decisions: 0, sorts: 0, sortedSlots: 0, uploads: 0, uploadBytes: 0, fragmented: 0, fragmentedBytes: 0 };
    // Counters are enabled only for attribution/parity, never timed batches.
    if (instrument) {
      const inject = (before, after) => {
        if (!source.includes(before)) throw new Error(`tree counter anchor missing: ${before}`);
        source = source.replace(before, after);
      };
      inject('const k = L[i];\n        // Geographic', 'counters.decisions++; const k = L[i];\n        // Geographic');
      inject('dirty.sort((a, b) => a - b);', 'counters.sorts++; counters.sortedSlots += dirty.length; dirty.sort((a, b) => a - b);');
      inject('runs.push([start, end]);\n', 'runs.push([start, end]);\n  if (runs.length > 96) counters.fragmented++;\n');
      inject('a.needsUpdate = true;\n  }\n  dirty.length = 0;',
        'a.needsUpdate = true; for (const r of a.updateRanges) { counters.uploads++; counters.uploadBytes += r.count * a.array.BYTES_PER_ELEMENT; if (runs.length > 96) counters.fragmentedBytes += r.count * a.array.BYTES_PER_ELEMENT; }\n  }\n  dirty.length = 0;');
    }
    const factory = new Function('THREE', 'PAIR', 'FADE_EPOCH_S', 'drainAt', 'reversedFade', 'reserveTreeTier', 'TREE_LOD', 'camera', 'renderer', 'renderResolution', 'counters',
      `let FRAME_NO = 0, TIER_FRAME = 0, treeUploadsThisFrame = 0;\n${source}\nreturn { update: () => { FRAME_NO++; updateTreeTiers(); }, audit: treeTierAudit };`);
    const actual = factory(THREE, PAIR, FADE_EPOCH_S, drainAt, reversedFade, reserveTreeTier, lod, camera,
      { coordinateSystem }, { detailHeight: () => input.detailHeight }, counters);
    return { lod, camera, counters, ...actual };
  }

  function replayFrames(input, scenario, count = 360) {
    const points = input.holes.flat(), centre = new THREE.Vector3();
    for (const p of points) centre.add(new THREE.Vector3(...p)); centre.divideScalar(points.length);
    const first = input.holes[0], frames = [];
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      let position, target;
      if (scenario === 'rest') { position = [first[0][0], first[0][1] + 35, first[0][2]]; target = first[Math.min(1, first.length - 1)]; }
      else if (scenario === 'orbit') {
        const angle = t * Math.PI * 2;
        position = [centre.x + Math.cos(angle) * 800, centre.y + 350, centre.z + Math.sin(angle) * 800]; target = centre.toArray();
      } else {
        // Walk each real hole centreline, with deliberate cuts between holes.
        const at = t * (points.length - 1), k = Math.min(points.length - 2, Math.floor(at)), f = at - k;
        position = points[k].map((v, axis) => v + (points[k + 1][axis] - v) * f); position[1] += 35;
        target = points[k + 1];
      }
      frames.push({ position, target, time: i / 60 });
    }
    return frames;
  }
  return { createReplay, replayFrames, stepReplay, assertReplayEqual, treeFunctions };
}

export function stepReplay(replay, frame) {
  replay.camera.position.fromArray(frame.position); replay.camera.lookAt(...frame.target); replay.camera.updateMatrixWorld(true);
  replay.lod.fadeClock = frame.time;
  if (frame.settings) Object.assign(replay.lod, structuredClone(frame.settings));
  replay.update();
}

function sameArray(a, b, label) {
  if (a.length !== b.length) throw new Error(`${label}: array length differs`);
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) throw new Error(`${label}[${i}]: ${a[i]} != ${b[i]}`);
}

function sameAttribute(a, b, label) {
  sameArray(a.array, b.array, label);
  if (a.version !== b.version || JSON.stringify(a.updateRanges) !== JSON.stringify(b.updateRanges)) throw new Error(`${label}: upload request differs`);
}

// Compare every CPU input to tree drawing, including inactive slots, every
// frame. Also require identical slot ownership, dwell state and fade queues.
export function assertReplayEqual(a, b) {
  const x = a.lod, y = b.lod;
  for (let s = 0; s < x.tiers.length; s++) {
    const p = x.tiers[s], q = y.tiers[s]; if (!p) continue;
    for (const key of ['tierOf', 'where', 'pend', 'pendN', 'outTier', 'whereOut', 'fadeT0', 'fadeCode']) sameArray(p[key], q[key], `${s}.${key}`);
    for (let i = 1; i <= 4; i++) {
      const u = p.t[i], v = q.t[i];
      if (u.count !== v.count) throw new Error('tier count differs');
      sameArray(u.slots, v.slots, 'slots'); sameArray(u.dirtyM, v.dirtyM, 'dirtyM'); sameArray(u.dirtyF, v.dirtyF, 'dirtyF');
      const objects = u.mesh ? [u.mesh] : u.parts, other = v.mesh ? [v.mesh] : v.parts;
      for (let j = 0; j < objects.length; j++) {
        const o = objects[j], r = other[j];
        if (o.count !== r.count || o.visible !== r.visible || o.geometry.instanceCount !== r.geometry.instanceCount) throw new Error('draw state differs');
        if (o.instanceMatrix) sameAttribute(o.instanceMatrix, r.instanceMatrix, 'matrix');
        for (const key of Object.keys(o.geometry.attributes)) sameAttribute(o.geometry.attributes[key], r.geometry.attributes[key], key);
      }
    }
  }
  for (let i = 0; i < x.cells.length; i++) if (x.cells[i].visible !== y.cells[i].visible) throw new Error('cell visibility differs');
  if (x.qHead !== y.qHead || JSON.stringify(x.queue) !== JSON.stringify(y.queue)) throw new Error('fade queue differs');
  for (const k of ['moves', 'switches', 'reversals', 'updates', 'cellsVisible', 'fading', 'tier0', 'tier1', 'tier2', 'tier3'])
    if (x.stats[k] !== y.stats[k]) throw new Error(`stats.${k} differs`);
}
