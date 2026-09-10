import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createGroundClamp } from './camera-clamp.mjs';
import { createCameraBreathing } from './camera-breathing.mjs';
import { coastalCameraNear } from './coastal-camera-depth.mjs';
import { V2GraphTerrainAdapter } from './v2-graph-terrain.mjs';

/* Run the application's real frame orchestration, including its flight camera
   application, against Three cameras/OrbitControls and the actual graph adapter
   update. Only rendering, tree storage and unrelated UI work are replaced by
   observers. This catches a stale matrix or a second update even when the final
   settled view would look identical. No browser/GPU timing claim is made here. */
const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
function sourceFunction(name) {
  const start = main.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Missing application function: ${name}`);
  return main.slice(start, main.indexOf('\n}', start) + 2);
}
const frameSource = ['updateFrameVisibility', 'applyFlightCamera', 'frame'].map(sourceFunction).join('\n');
const settledSource = main.match(/settled: \(\) => ([^\n]+),/)[1];
const boxes = [
  new THREE.Box3(new THREE.Vector3(-1, 9, -1), new THREE.Vector3(1, 11, 1)),
  new THREE.Box3(new THREE.Vector3(49, 9, -1), new THREE.Vector3(51, 11, 1)),
];
const tiles = boxes.map(box => ({ bounds: {
  minEasting: box.min.x, maxEasting: box.max.x,
  minNorthing: -box.max.z, maxNorthing: -box.min.z,
  minHeightRH2000: box.min.y, maxHeightRH2000: box.max.y,
} }));

function fixture({ polish = true, graph = true, active = true, coordinateSystem = THREE.WebGLCoordinateSystem, reversedDepth = false } = {}) {
  let now = 0;
  const calls = [], observed = { terrain: [], trees: [], render: [] };
  const camera = new THREE.PerspectiveCamera(48, 4 / 3, 1, 500);
  camera.coordinateSystem = coordinateSystem;
  camera._reversedDepth = reversedDepth;
  camera.updateProjectionMatrix();
  camera.position.set(0, 10, 30);
  const controls = new OrbitControls(camera, null);
  controls.target.set(0, 10, 0);
  controls.enableDamping = true;
  controls.update();
  camera.updateMatrixWorld(true);
  const originalUpdate = controls.update.bind(controls);
  controls.update = (...args) => { calls.push('controls'); return originalUpdate(...args); };
  const snapshot = () => {
    const projection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(projection, camera.coordinateSystem, camera.reversedDepth);
    return { position: camera.position.toArray(), inverse: camera.matrixWorldInverse.toArray(),
      projection: camera.projectionMatrix.toArray(), visible: boxes.map(box => frustum.intersectsBox(box)), fov: camera.fov, near: camera.near };
  };
  const graphAdapter = {
    phase: 'ready', group: new THREE.Group(), projection: new THREE.Matrix4(),
    min: new THREE.Vector3(), max: new THREE.Vector3(), bridge: { toGrid: (x, z) => [x, z] },
    runtime: {
      ground: { frame: { origin: { easting: 0, northing: 0, heightRH2000: 0 } } },
      update(options) {
        calls.push('terrain');
        observed.terrain.push({ ...snapshot(), visible: tiles.map(options.visible), hole: options.activeHoleNumber, bufferHeight: options.viewportHeightPixels });
        return { selected: [] };
      },
    },
  };
  const clamp = createGroundClamp({ heightAt: () => 0 });
  const context = createContext({
    GRAPHICS_POLISH: polish, camera, controls, innerHeight: 900, hole: 1,
    coastalCameraNear, COASTAL_DEPTH_ENABLED: false, COASTAL_TERRAIN_CEILING: 58.06,
    performance: { now: () => now }, last: 0, acc: 0, frames: 0, fps: 0,
    BOOT_PERF: { doneAtMs: 1 }, document: { hidden: false },
    renderResolution: { detailHeight: () => 240, sample() {} },
    FRAME_NO: 0, TIER_FRAME: 0, FRAME_MS: new Float32Array(120), DET: false,
    /* Breathing is opt-in behind ?breath=1 in the player, so the frame loop
       reads BREATH. These tests are about how it behaves once enabled -- they
       turn it on and off through cameraMotionPreference, DET, camMode and the
       rest -- so the switch itself is held on here. Without it every one of
       these tests throws ReferenceError before it reaches its assertion. */
    BREATH: true,
    cameraBreathing: createCameraBreathing(), cameraMotionPreference: { matches: true },
    cameraInteracting: false, camMode: 'orbit',
    TREE_LOD: { clockDriven: false, fadeClock: 0, fadeS: 0.3, queue: [], qHead: 0 },
    treeFadeClock: { value: 0 }, treeFadeDuration: { value: 0 },
    renderer: { domElement: { height: 240 } },
    terrainV2: {
      kind: graph ? 'graph' : 'pilot', active,
      tick: () => { calls.push('tick'); },
      update: options => V2GraphTerrainAdapter.prototype.update.call(graphAdapter, options),
    },
    groundClamp: {
      step: (position, dt) => { calls.push('clamp'); return clamp.step(position, dt); },
      reset: () => { calls.push('clampReset'); clamp.reset(); },
    },
    camTween: { on: false, t: 0, dur: 0.1,
      from: camera.position.clone(), to: new THREE.Vector3(30, 10, 0),
      lookFrom: controls.target.clone(), lookTo: new THREE.Vector3(60, 10, 0) },
    flying: 0, tour: false, pins: [],
    tourFlight: { st: {}, fov: 30, pos: new THREE.Vector3(30, 10, 0), look: new THREE.Vector3(60, 10, 0), cardPending: false },
    flightStep: () => { calls.push('flight'); return { u: 0.1, done: false, ls: 0 }; },
    updateTourProgress() {},
    updateTreeTiers() {
      calls.push('trees');
      const reading = snapshot();
      const previous = observed.trees.at(-1);
      if (!previous || previous.visible.join() !== reading.visible.join()) context.TIER_FRAME = context.FRAME_NO;
      observed.trees.push(reading);
    },
    placeSun: () => { calls.push('sun'); }, shadowRest: () => { calls.push('shadow'); },
    skyMesh: null, skyDome: null, updateSky() {}, updateStrategy() {}, kikTagUpdate() {}, drawMini() {}, gridOn: false,
    captureRenderLocked: false,
    renderActivePipeline() {
      calls.push('render');
      /* The real renderer updates the camera immediately before drawing. */
      camera.updateMatrixWorld(true);
      observed.render.push(snapshot());
    },
  });
  runInContext(`${frameSource}\nthis.settled = () => ${settledSource};`, context);
  return { camera, controls, context, calls, observed, snapshot,
    step(milliseconds = 100) { now += milliseconds; context.frame(); } };
}

describe('application camera frame ordering', () => {
  it('samples resolution before visibility and keeps the geometry budget when the buffer grows', () => {
    const f = fixture();
    const samples = [];
    f.context.renderResolution.sample = (interval, now, eligible) => {
      samples.push({ interval, now, eligible });
      f.context.renderer.domElement.height = 360;
    };
    f.step(16);
    expect(samples).toEqual([{ interval: 16, now: 16, eligible: true }]);
    expect(f.observed.terrain[0].bufferHeight).toBe(240);
    f.context.BOOT_PERF.doneAtMs = 0;
    f.step(16);
    f.context.BOOT_PERF.doneAtMs = 1;
    f.context.document.hidden = true;
    f.step(16);
    f.context.document.hidden = false;
    f.context.captureRenderLocked = true;
    f.step(16);
    expect(samples.slice(1).every(s => !s.eligible)).toBe(true);
  });
  it('uses the coastal projection for both visibility and drawing, restoring near immediately on descent', () => {
    const f = fixture();
    f.context.COASTAL_DEPTH_ENABLED = true;
    f.camera.position.set(500, 180, -1400);
    f.controls.target.set(-500, 5, 300);
    f.step();
    expect(f.observed.render[0].near).toBeGreaterThan(7);
    expect(f.observed.terrain[0]).toMatchObject(f.observed.render[0]);
    expect(f.observed.trees[0]).toEqual(f.observed.render[0]);
    f.camera.position.set(0, 10, 30);
    f.controls.target.set(0, 10, 0);
    f.step();
    expect(f.observed.render[1].near).toBe(1);
    expect(f.observed.terrain[1]).toMatchObject(f.observed.render[1]);
  });
  it.each([
    ['WebGL2', THREE.WebGLCoordinateSystem, false],
    ['WebGL2 with reversed depth', THREE.WebGLCoordinateSystem, true],
    ['WebGPU with reversed depth', THREE.WebGPUCoordinateSystem, true],
  ])('uses the rendered tween pose for terrain and trees on %s', (_name, coordinateSystem, reversedDepth) => {
    const f = fixture({ coordinateSystem, reversedDepth });
    expect(f.snapshot().visible).toEqual([true, false]);
    f.context.camTween.on = true;
    f.step();
    expect(f.observed.trees[0].visible).toEqual([false, true]);
    expect(f.observed.trees[0]).toEqual(f.observed.render[0]);
    expect(f.observed.terrain[0]).toMatchObject(f.observed.render[0]);
    expect(f.observed.terrain[0]).toMatchObject({ hole: 1, bufferHeight: 240 });
    expect(f.calls).toEqual(['tick', 'controls', 'clamp', 'terrain', 'trees', 'sun', 'shadow', 'render']);
  });

  it('preserves the disabled ordering, with the old one-frame visibility delay measurable', () => {
    const f = fixture({ polish: false });
    f.context.camTween.on = true;
    f.step();
    expect(f.observed.trees[0].visible).toEqual([true, false]);
    expect(f.observed.terrain[0].visible).toEqual([true, false]);
    expect(f.observed.render[0].visible).toEqual([false, true]);
    expect(f.calls).toEqual(['tick', 'terrain', 'trees', 'controls', 'clamp', 'sun', 'shadow', 'render']);
    f.step();
    expect(f.observed.trees[1]).toEqual(f.observed.render[1]);
  });

  it.each([[false, true], [true, false]])('refreshes tree matrices without an active graph (graph=%s, active=%s)', (graph, active) => {
    const f = fixture({ graph, active });
    f.context.camTween.on = true;
    f.step();
    expect(f.observed.terrain).toHaveLength(0);
    expect(f.observed.trees[0].visible).toEqual([false, true]);
    expect(f.observed.trees[0]).toEqual(f.observed.render[0]);
  });

  it('includes OrbitControls damping and the existing ground lift in the visibility pose', () => {
    const f = fixture();
    f.camera.position.y = 0.2;
    f.controls.target.y = 0.2;
    f.controls.autoRotate = true;
    f.step();
    expect(f.observed.render[0].position[1]).toBeGreaterThanOrEqual(1.15);
    expect(f.observed.render[0].position[0]).not.toBe(0);
    expect(f.observed.trees[0]).toEqual(f.observed.render[0]);
    expect(f.observed.terrain[0]).toMatchObject(f.observed.render[0]);
  });

  it.each([['preview', true], ['legacy', false]])('visibly breathes around a stable navigation pose in the %s renderer', (_name, polish) => {
    const f = fixture({ polish });
    f.context.cameraMotionPreference.matches = false;
    const position = f.camera.position.toArray(), target = f.controls.target.toArray();
    const baseOrientation = f.camera.quaternion.clone(), projection = f.camera.projectionMatrix.toArray();
    const angles = [], horizontalPixels = [], verticalPixels = [];
    const landmark = f.controls.target.clone(), viewportHeight = 900;
    for (let i = 0; i < 300; i++) {
      f.step(40);
      angles.push(f.camera.quaternion.angleTo(baseOrientation));
      const projected = landmark.clone().project(f.camera);
      horizontalPixels.push(projected.x * viewportHeight * f.camera.aspect / 2);
      verticalPixels.push(projected.y * viewportHeight / 2);
      expect(f.camera.position.toArray()).toEqual(position);
      expect(f.controls.target.toArray()).toEqual(target);
      expect(f.camera.projectionMatrix.toArray()).toEqual(projection);
      if (polish) {
        expect(f.observed.terrain[i]).toMatchObject(f.observed.render[i]);
        expect(f.observed.trees[i]).toEqual(f.observed.render[i]);
      }
    }
    // Measure a fixed scene feature on screen, so a numerically nonzero but
    // imperceptible rotation cannot satisfy the idle-motion regression.
    const verticalTravel = Math.max(...verticalPixels) - Math.min(...verticalPixels);
    const horizontalTravel = Math.max(...horizontalPixels) - Math.min(...horizontalPixels);
    expect(verticalTravel).toBeGreaterThan(12);
    expect(verticalTravel).toBeLessThan(20);
    expect(horizontalTravel).toBeGreaterThan(4);
    expect(horizontalTravel).toBeLessThan(8);
    expect(Math.max(...angles)).toBeGreaterThan(0.004);
    expect(Math.max(...angles)).toBeLessThan(0.009);
    expect(f.observed.render[30].inverse).not.toEqual(f.observed.render[100].inverse);
    expect(f.camera.fov).toBe(48);
    expect(f.context.settled()).toBe(true);
  });

  it.each(['reduced motion', 'deterministic capture', 'overhead view', 'hidden tab', 'capture lock', 'flight'])(
    'removes an active breathing offset immediately for %s', mode => {
      const f = fixture();
      f.context.cameraMotionPreference.matches = false;
      const baseOrientation = f.camera.quaternion.clone();
      for (let i = 0; i < 20; i++) f.step();
      expect(f.camera.quaternion.angleTo(baseOrientation)).toBeGreaterThan(0.001);
      if (mode === 'reduced motion') f.context.cameraMotionPreference.matches = true;
      if (mode === 'deterministic capture') f.context.DET = true;
      if (mode === 'overhead view') f.context.camMode = 'top';
      if (mode === 'hidden tab') f.context.document.hidden = true;
      if (mode === 'capture lock') f.context.captureRenderLocked = true;
      if (mode === 'flight') f.context.flying = 0.01;
      for (let i = 0; i < 2; i++) {
        f.step();
        const expected = f.camera.clone();
        expected.lookAt(f.controls.target);
        expect(f.camera.quaternion.angleTo(expected.quaternion)).toBeLessThan(1e-7);
      }
      expect(f.observed.trees.at(-1)).toMatchObject(f.snapshot());
    },
  );

  it.each(['gesture', 'transition'])('fades breathing out during a %s and eases back into the idle gaze', mode => {
    const f = fixture(), idle = fixture();
    for (const view of [f, idle]) view.context.cameraMotionPreference.matches = false;
    const baseOrientation = f.camera.quaternion.clone();
    const amplitude = view => view.camera.quaternion.angleTo(baseOrientation);
    const stepBoth = () => { f.step(); idle.step(); };
    for (let i = 0; i < 30; i++) stepBoth();
    if (mode === 'gesture') f.context.cameraInteracting = true;
    else {
      f.context.camTween.on = true;
      f.context.camTween.dur = 100;
      f.context.camTween.to.copy(f.camera.position);
      f.context.camTween.lookTo.copy(f.controls.target);
    }
    stepBoth();
    expect(amplitude(f)).toBeGreaterThan(0);
    expect(amplitude(f)).toBeLessThan(amplitude(idle));
    for (let i = 0; i < 11; i++) stepBoth();
    expect(amplitude(f)).toBeLessThan(amplitude(idle) * 0.01);
    f.context.cameraInteracting = false;
    f.context.camTween.on = false;
    stepBoth();
    expect(amplitude(f)).toBeLessThan(amplitude(idle) * 0.2);
    for (let i = 0; i < 14; i++) stepBoth();
    expect(amplitude(f)).toBeGreaterThan(amplitude(idle) * 0.7);
    expect(f.camera.position.toArray()).toEqual(idle.camera.position.toArray());
    expect(f.controls.target.toArray()).toEqual(idle.controls.target.toArray());
  });

  it('uses the flight position, look direction, lens and current hole before visibility', () => {
    const f = fixture();
    f.context.flying = 0.01;
    f.context.hole = 7;
    f.step();
    expect(f.observed.render[0]).toMatchObject({ position: [30, 10, 0], fov: 30, visible: [false, true] });
    expect(f.observed.trees[0]).toEqual(f.observed.render[0]);
    expect(f.observed.terrain[0]).toMatchObject({ ...f.observed.render[0], hole: 7 });
    expect(f.calls).toEqual(['tick', 'flight', 'clampReset', 'terrain', 'trees', 'sun', 'shadow', 'render']);
  });

  it('keeps one visibility/timing update per frame, settled draw counts and identical resting poses', () => {
    const before = fixture({ polish: false }), after = fixture();
    for (const f of [before, after]) {
      f.step(16);
      expect(f.context.FRAME_NO).toBe(1);
      expect(f.context.TIER_FRAME).toBe(0);
      expect(f.context.settled()).toBe(false);
      f.step(16);
      expect(f.context.FRAME_NO).toBe(2);
      expect(f.context.TIER_FRAME).toBe(0);
      expect(f.context.settled()).toBe(true);
      expect(f.context.TREE_LOD.fadeClock).toBe(0.032);
      expect(f.context.FRAME_MS[0]).toBe(16);
      expect(f.context.FRAME_MS[1]).toBe(16);
      for (const action of ['tick', 'terrain', 'trees', 'controls', 'clamp', 'sun', 'shadow', 'render']) {
        expect(f.calls.filter(call => call === action)).toHaveLength(2);
      }
    }
    expect(after.observed.render).toEqual(before.observed.render);
    expect(after.observed.terrain).toEqual(before.observed.terrain);
    expect(after.observed.trees).toEqual(before.observed.trees);
  });

  it('respects deterministic and externally driven fade clocks without introducing extra renders', () => {
    for (const clockDriven of [false, true]) {
      const f = fixture();
      f.context.DET = true;
      f.context.TREE_LOD.clockDriven = clockDriven;
      f.context.TREE_LOD.fadeClock = 2;
      f.context.captureRenderLocked = true;
      f.step();
      expect(f.context.TREE_LOD.fadeClock).toBe(clockDriven ? 2 : 2 + 1 / 60);
      expect(f.context.treeFadeClock.value).toBe(f.context.TREE_LOD.fadeClock);
      expect(f.observed.trees).toHaveLength(1);
      expect(f.observed.render).toHaveLength(0);
    }
  });
});
