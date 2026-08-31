import * as THREE from 'three/webgpu';
import { CourseV2TerrainRuntime } from './v2-terrain-runtime.mjs';
import {
  compareStreamHeights,
  summarizeStreamProbe,
} from './v2-stream-probe.mjs';

/* Kept in its own dynamic chunk so the streaming runtime, its Worker and the
   asset loader stay out of every path that does not ask for a measurement. */

/* Long enough for hardware to settle, short enough that a starved run reports
   a timeout instead of parking. Note what a longer deadline does NOT buy: on
   a software rasteriser a single update()/sync() — which uploads a texture
   array of 257x257 layers — can itself block for minutes, so the probe cannot
   complete there at any deadline. It still reports what it reached, and that
   partial picture is what caught a decode Worker that never started. */
const DEFAULT_DEADLINE_MILLISECONDS = 60_000;

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

/* Every wait is raced against a timer. A deadline checked only BETWEEN frames
   bounds nothing: one frame that takes minutes under a software rasteriser —
   or a throttled tab where rAF stops entirely — leaves the loop parked inside
   an await that never resolves. Measured: a 180 s probe still running after
   21 minutes. The timer is what makes the deadline real. */
function nextFrame(budgetMilliseconds) {
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const timer = setTimeout(finish, Math.max(16, Math.min(budgetMilliseconds, 2000)));
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => { clearTimeout(timer); finish(); });
    }
  });
}

/**
 * Drive the manifest-driven runtime against a resolved graph into a detached
 * scene, wait for its shell and the active hole's tiles, then measure it
 * against the pilot sampler and dispose everything. The visible course is
 * never touched: nothing here is added to the live scene, and every failure
 * becomes a recorded result rather than a thrown boot error.
 */
export async function runV2StreamProbe({
  graph,
  camera,
  backend,
  mobile = false,
  baseUrl,
  activeHoleNumber,
  viewportHeightPixels,
  pilotHeightAt,
  pilotBounds,
  deadlineMilliseconds = DEFAULT_DEADLINE_MILLISECONDS,
  /* heightAt() rebuilds a stream snapshot per call — correct for the
     occasional query it is designed for, real work when a probe asks 256
     times. Kept deliberately: parity must exercise the production interface,
     not a private shortcut around it. */
  paritySamples = 16,
} = {}) {
  const started = now();
  let runtime = null;
  const scene = new THREE.Scene();
  try {
    if (!graph?.ground || !graph?.course) throw new TypeError('a resolved v2 graph is required');
    if (!camera?.position) throw new TypeError('a camera is required');
    runtime = new CourseV2TerrainRuntime({
      ground: graph.ground,
      course: graph.course,
      scene,
      backend,
      mobile,
      baseUrl,
    });

    let shellVisibleMilliseconds = null;
    let activeHoleRefinedMilliseconds = null;
    let settledBeforeDeadline = false;
    const activeTileIds = new Set(
      graph.course.holes.find(hole => hole.number === activeHoleNumber)?.tileIds || [],
    );
    while (now() - started < deadlineMilliseconds) {
      runtime.update({ camera, viewportHeightPixels, activeHoleNumber });
      runtime.tick();
      const snapshot = runtime.snapshot();
      const ready = new Set(snapshot.stream.readyTileIds);
      if (shellVisibleMilliseconds === null && ready.size > 0) {
        shellVisibleMilliseconds = now() - started;
      }
      if (activeHoleRefinedMilliseconds === null && activeTileIds.size > 0 &&
          [...activeTileIds].every(tileId => ready.has(tileId))) {
        activeHoleRefinedMilliseconds = now() - started;
      }
      const settled = snapshot.stream.loadingTileIds.length === 0 && ready.size > 0;
      if (settled && (activeHoleRefinedMilliseconds !== null || activeTileIds.size === 0)) {
        settledBeforeDeadline = true;
        break;
      }
      await nextFrame(deadlineMilliseconds - (now() - started));
    }

    const snapshot = runtime.snapshot();
    const parityStarted = now();
    const parity = compareStreamHeights({
      bounds: pilotBounds,
      streamHeightAt: (x, z) => runtime.heightAt(x, z),
      pilotHeightAt,
      samples: paritySamples,
    });
    return summarizeStreamProbe({
      timings: {
        shellVisibleMilliseconds,
        activeHoleRefinedMilliseconds,
        deadlineMilliseconds,
        settledBeforeDeadline,
        parityMilliseconds: now() - parityStarted,
        elapsedMilliseconds: now() - started,
      },
      snapshot,
      parity,
    });
  } catch (error) {
    return Object.freeze({
      kind: 'v2-stream-probe',
      performanceEvidence: false,
      correctnessPassed: false,
      error: String(error?.message || error).slice(0, 300),
      elapsedMilliseconds: +(now() - started).toFixed(1),
    });
  } finally {
    try { runtime?.dispose(); } catch { /* a probe must not outlive its own failure */ }
    scene.clear();
  }
}
