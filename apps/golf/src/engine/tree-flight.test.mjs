import { readFileSync } from 'node:fs';
import { createContext, runInContext, runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';

/* Exercise the actual application update, not a second tier-selection
   implementation. Replace uploads with counters; keep real camera/frustum. */
const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const start = main.indexOf('function updateTreeTiers()');
const update = main.slice(start, main.indexOf('\n}', start) + 2);
const defaultTiers = main.match(/zoneTiers: (LOWQ[^\n]+),/)[1];
const defaultMode = main.match(/const LODMODE = ([^\n]+);/)[1];

describe('trees during a rapid camera flight', () => {
  for (const low of [false, true]) for (const coordinateSystem of [THREE.WebGLCoordinateSystem, THREE.WebGPUCoordinateSystem]) {
    it(`retains geographic tiers through exits/reentries (${low ? 'low' : 'high'}, ${coordinateSystem})`, () => {
      const zoneTiers = runInNewContext(defaultTiers, { LOWQ: low });
      const lodMode = runInNewContext(defaultMode, { URLSearchParams, location: { search: '' } });
      expect(lodMode).toBe('zone');
      const zone = new Uint8Array([1, 2, 3, 0]), tierOf = new Uint8Array(4);
      const imp = new Float32Array(24);
      const cells = Array.from({ length: 4 }, (_, i) => {
        const x = (i - 1.5) * 220;
        imp[i * 6] = x;
        return { x0: x - 20, x1: x + 20, z0: -20, z1: 20, y0: 0, y1: 30,
          visible: false, lists: [[i], [], []], box: new THREE.Box3(new THREE.Vector3(x - 20, 0, -20), new THREE.Vector3(x + 20, 30, 20)) };
      });
      const sp = { zone, tierOf, treeH: new Float32Array(4).fill(24), treeCY: new Float32Array(4).fill(12),
        pend: new Uint8Array(4), pendN: new Uint8Array(4),
        t: [null, ...Array.from({ length: 4 }, () => ({ count: 0, dirtyM: [], dirtyF: [], parts: [], fade: [] }))] };
      const lod = { ready: true, frozen: false, cells, tiers: [sp, null, null], imp: [imp],
        heroPx: 64, switchPx: 24, impostorPx: 8, hysteresis: 0.1, force: 0, resetPending: false,
        cellMode: false, floors: [1, 2], floorReach: [500, 900], lodMode, zoneTiers, dwell: 6,
        queue: [], qHead: 0, stats: { updates: 0 } };
      const camera = new THREE.PerspectiveCamera(48, 4 / 3, 1, 5000);
      camera.coordinateSystem = coordinateSystem;
      camera._reversedDepth = coordinateSystem === THREE.WebGPUCoordinateSystem;
      camera.updateProjectionMatrix();
      const moves = [];
      const context = createContext({ TREE_LOD: lod, camera, renderer: { coordinateSystem }, performance,
        TREE_PROJ: new THREE.Matrix4(), TREE_FRUSTUM: new THREE.Frustum(),
        renderResolution: { detailHeight: () => low ? 450 : 900 },
        rebaseFadeClock() {}, drainTreeFades: () => false, flushRanges() {},
        TIER_FRAME: 0, FRAME_NO: 0, treeUploadsThisFrame: 0,
        treeTierMove(s, k, from, to) {
          moves.push({ k, from, to }); tierOf[k] = to;
          if (from) sp.t[from].count--; if (to) sp.t[to].count++;
        },
      });
      runInContext(update, context);
      for (let frame = 0; frame < 180; frame++) {
        const phase = frame / 179;
        const x = Math.sin(phase * Math.PI * 8) * 1700;
        camera.position.set(x, 35 + 1100 * Math.sin(phase * Math.PI) ** 2, 80 + phase * 300);
        camera.lookAt(x, 12, 0); camera.updateMatrixWorld(true);
        context.FRAME_NO++; context.updateTreeTiers();
        for (let k = 0; k < 4; k++) if (tierOf[k]) expect(tierOf[k]).toBe(zoneTiers[k]);
      }
      expect(moves.filter(m => m.from && m.to)).toEqual([]);
      expect(moves.filter(m => m.to === 0).length).toBeGreaterThan(4);
      for (let k = 0; k < 4; k++) expect(moves.filter(m => m.k === k && m.to > 0).length).toBeGreaterThan(1);
    });
  }
});
