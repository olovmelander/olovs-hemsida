/* Out-of-view trees that shadow the view (main.js updateTreeTiers,
   docs/tree-shadows-zoom.md): the application's own tier update, replayed on
   a row of cells with the camera looking along +z and the sun low in +x, so
   shadows fall toward -x -- across the view from the cells on its right, and
   away from it from the cells on its left. */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { createTreeReplay } from '../../../../tools/tree-update-replay.mjs';

const { createReplay, stepReplay, treeFunctions } = createTreeReplay(THREE);
const source = treeFunctions(readFileSync(new URL('../main.js', import.meta.url), 'utf8'));

const XS = [-360, -240, -120, 0, 120, 240, 360];
const PER = 20;
/* placeSun's record of the shadow box: its half-size, its centre and the light's basis */
function sweep(R) {
  const d = new THREE.Vector3(0.9, 0.3, 0).normalize();
  const m = new THREE.Matrix4().lookAt(d, new THREE.Vector3(), THREE.Object3D.DEFAULT_UP);
  const r = new THREE.Vector3().setFromMatrixColumn(m, 0), u = new THREE.Vector3().setFromMatrixColumn(m, 1);
  return { R, cx: 0, cy: 0, cz: 0, dx: d.x, dy: d.y, dz: d.z, rx: r.x, ry: r.y, rz: r.z, ux: u.x, uy: u.y, uz: u.z };
}
/* zone 1 trees are Hero in view; zone 3 trees are impostors at every distance */
function fixture(shadowSweep, zone = 1) {
  const n = XS.length * PER, mats = [], imp = [], tint = [], cells = [];
  XS.forEach((x, c) => {
    const list = [];
    for (let j = 0; j < PER; j++) {
      const k = c * PER + j, px = x + j, pz = j / 2;
      list.push(k);
      mats.push(...new THREE.Matrix4().makeTranslation(px, 0, pz).elements);
      imp.push(px, 0, pz, 0, 1, 1); tint.push(1, 1, 1, 0.5);
    }
    cells.push({ x0: x, x1: x + 20, z0: 0, z1: 20, y0: 0, y1: 24, min: [x, 0, 0], max: [x + 20, 24, 20], lists: [list] });
  });
  return { config: { cell: 120, fadeS: 0.3, cellMode: false, nominalHeight: 12, heroPx: 64, switchPx: 24, impostorPx: 8,
    hysteresis: 0.1, lodMode: 'zone', zoneTiers: [1, 1, 4, 4], distantHeroPx: 0, dwell: 6, floors: [1, 1],
    floorReach: [500, 900], force: 0, shadowSweep },
    detailHeight: 900, cells, mats: [mats], imp: [imp], tint: [tint],
    tiers: [{ n, treeH: Array(n).fill(24), treeCY: Array(n).fill(12), zone: Array(n).fill(zone) }] };
}
const tiersOf = (replay, x) => {
  const c = XS.indexOf(x), sp = replay.lod.tiers[0];
  return [...new Set(Array.from(sp.tierOf.subarray(c * PER, (c + 1) * PER)))];
};
const fadesOf = (replay, x) => {
  const c = XS.indexOf(x), sp = replay.lod.tiers[0];
  return Array.from(sp.outTier.subarray(c * PER, (c + 1) * PER)).filter(Boolean).length;
};
let time = 0;
const look = (replay, target, settings) => {
  time += 1 / 60;
  stepReplay(replay, { position: [0, 20, -250], target, time, settings });
  expect(replay.audit().ok).toBe(true);
};

describe('trees out of view that shadow it', () => {
  for (const system of [THREE.WebGLCoordinateSystem, THREE.WebGPUCoordinateSystem]) {
    it(`keep their shadows as impostors, and only those (${system})`, () => {
      const replay = createReplay(fixture(sweep(400)), source, system);
      look(replay, [0, 10, 0]);
      for (const x of [-120, 0, 120]) expect(tiersOf(replay, x)).toEqual([1]);
      /* just right of the frame, its shadow reaches across the view */
      expect(tiersOf(replay, 240)).toEqual([4]);
      /* further right its shadow ends short of the view; on the left it falls away */
      for (const x of [-360, -240, 360]) expect(tiersOf(replay, x)).toEqual([0]);
      expect(replay.lod.stats.shadowCells).toBe(1);
    });

    it(`enter and leave the view at once, whatever was fading (${system})`, () => {
      const replay = createReplay(fixture(sweep(400)), source, system);
      look(replay, [0, 10, 0]);
      /* turned right: the shadowing cell is in view, its trees in their own tier this frame */
      look(replay, [240, 10, 0]);
      expect(tiersOf(replay, 240)).toEqual([1]);
      expect(fadesOf(replay, 240)).toBe(0);
      /* start a crossfade everywhere, then turn back while it runs */
      look(replay, [240, 10, 0], { force: 4 });
      expect(fadesOf(replay, 240)).toBe(PER);
      look(replay, [0, 10, 0], { force: 0 });
      expect(tiersOf(replay, 240)).toEqual([4]);
      expect(fadesOf(replay, 240)).toBe(0);
      /* the stale fade entries drain without touching it */
      for (let i = 0; i < 40; i++) look(replay, [0, 10, 0]);
      expect(tiersOf(replay, 240)).toEqual([4]);
      expect(replay.lod.queue.length).toBe(replay.lod.qHead);
    });
  }

  it('leave the trees still wanted as impostors in place when their cell comes into view', () => {
    /* the same turn with and without the sweep: without it the cell enters from nothing, with it from its shadow */
    const turn = shadowSweep => {
      const replay = createReplay(fixture(shadowSweep, 3), source);
      look(replay, [0, 10, 0]);
      const moves = replay.lod.stats.moves;
      look(replay, [240, 10, 0]);
      expect(tiersOf(replay, 240)).toEqual([4]);
      expect(fadesOf(replay, 240)).toBe(0);
      return replay.lod.stats.moves - moves;
    };
    /* every other cell does the same in both; entering from nothing appends
       each of its trees once, and entering from its shadow moves none of them */
    expect(turn(sweep(400))).toBe(turn(null) - PER);
  });

  it('draws only the view without the sweep, as before', () => {
    const replay = createReplay(fixture(null), source);
    look(replay, [0, 10, 0]);
    expect(tiersOf(replay, 240)).toEqual([0]);
    expect(replay.lod.stats.shadowCells).toBe(0);
  });

  it('keeps nothing whose shadow the map does not hold', () => {
    /* a 20 m box at the view's centre: the cell stands outside it, so its shadow is not in the map */
    const replay = createReplay(fixture(sweep(20)), source);
    look(replay, [0, 10, 0]);
    expect(tiersOf(replay, 240)).toEqual([0]);
  });
});
