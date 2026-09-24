import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { verifyChunkAsset } from '../../../../packages/course-v2/chunk-node.mjs';
import { createSyntheticAssetGraph } from '../../../../packages/course-v2/synthetic-fixture.mjs';
import { prepareTerrainRenderData } from '../../../../packages/course-v2/runtime/terrain-render-data.mjs';
import { installChunkWorker } from '../../../../packages/course-v2/runtime/chunk-worker.mjs';
import { compileTerrainAssets } from '../../../../packages/course-v2/terrain-compiler-node.mjs';
import {
  CourseV2TerrainRuntime,
  activeHoleTerrainTileIds,
  courseTerrainTileIds,
  worldToCanonicalCamera,
} from './v2-terrain-runtime.mjs';

function fixture() {
  const graph = createSyntheticAssetGraph();
  const entry = graph.root.courses.find(candidate => candidate.slug === 'synthetic-main');
  const course = JSON.parse(graph.resources.get(entry.manifest.url));
  const ground = JSON.parse(graph.resources.get(course.groundManifest.url));
  const decoded = new Map();
  for (const reference of [ground.shell, ...ground.tiles.map(tile => tile.layers.terrain)]) {
    const verified = verifyChunkAsset(reference, graph.resources.get(reference.url));
    decoded.set(reference.url, {
      ...verified,
      terrainRenderData: prepareTerrainRenderData(verified),
    });
  }
  const loader = {
    request: vi.fn(async reference => decoded.get(reference.url)),
    reprioritizeScope: vi.fn(),
    stats: () => ({ queued: 0, running: 0, jobs: 0 }),
  };
  return { course, ground, loader };
}

async function settle(predicate) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('runtime did not settle');
}

describe('isolated v2 terrain runtime', () => {
  it('prepares shared-source heights after carving exactly once, with real transferable ownership', async () => {
    const { ground, course, loader } = fixture();
    const messages = new Set();
    let workerListener, terminated = false;
    const scope = {
      addEventListener: (_, listener) => { workerListener = listener; },
      removeEventListener: () => {},
      postMessage: (message, transfer) => {
        const reply = structuredClone(message, { transfer });
        queueMicrotask(() => { for (const listener of messages) listener({ data: reply }); });
      },
    };
    const uninstall = installChunkWorker(scope);
    const worker = {
      addEventListener: (type, listener) => { if (type === 'message') messages.add(listener); },
      removeEventListener: (type, listener) => { if (type === 'message') messages.delete(listener); },
      postMessage: (message, transfer = []) => {
        const request = structuredClone(message, { transfer });
        queueMicrotask(() => workerListener({ data: request }));
      },
      terminate: () => { terminated = true; uninstall(); },
    };
    const carved = new Map();
    const transformDecoded = vi.fn(({ tileId, decoded }) => {
      new DataView(decoded.payload.buffer, decoded.payload.byteOffset).setUint16(8, 0, true);
      carved.set(tileId, { payload: decoded.payload, expected: prepareTerrainRenderData(decoded) });
      return { ...decoded, terrainRenderData: null };
    });
    const chunkSource = { load: async reference => {
      const decoded = await loader.request(reference);
      return { ...decoded, payload: Uint8Array.from(decoded.payload), terrainRenderData: null };
    } };
    const runtime = new CourseV2TerrainRuntime({ ground, course, scene: new THREE.Scene(), backend: 'webgl2',
      baseUrl: 'https://example.test/', chunkSource, workerFactory: () => worker, transformDecoded, prepareInWorker: true });
    runtime.update({ camera: { position: { x: 64, y: 50, z: 192 }, fov: 48 },
      viewportHeightPixels: 720, activeHoleNumber: 1, visible: () => true });
    await settle(() => runtime.snapshot().stream.readyTileIds.length === 3);
    expect(transformDecoded).toHaveBeenCalledTimes(3);
    for (const [id, { payload, expected }] of carved) {
      expect(payload.byteLength).toBeGreaterThan(0);
      expect(runtime.resources.get(id).payload).toBe(payload);
      expect(runtime.resources.get(id).textureData).toEqual(expected.textureData);
      expect(runtime.resources.get(id).maximumNormalEncodingErrorDegrees).toBe(expected.maximumNormalEncodingErrorDegrees);
    }
    runtime.dispose();
    expect(terminated).toBe(true);
  });
  it.each(['webgpu', 'webgl2'])('reduces refinable parents and preserves native meshes/sampling on %s', async backend => {
    const base = fixture();
    const heights = Float64Array.from({ length: 17 * 17 }, (_, i) =>
      35 + (i % 17) ** 2 * 0.01 + Math.floor(i / 17) ** 2 * 0.02);
    const compiled = compileTerrainAssets({ groundId: 'quality-ground', courseSlugs: ['quality-course'],
      heights, width: 17, height: 17, originEasting: 650000, originNorthing: 6640256, tileSegments: 8 });
    const ground = { groundId: 'quality-ground', frame: base.ground.frame, shell: compiled.shell, tiles: compiled.tiles };
    const course = { slug: 'quality-course', groundId: ground.groundId, holes: [{ number: 1, tileIds: ['l0/0/0'] }] };
    const loader = { request: vi.fn(async ref => verifyChunkAsset(ref, compiled.resources.get(ref.url))), reprioritizeScope: vi.fn() };
    const runtime = new CourseV2TerrainRuntime({ ground, course, scene: new THREE.Scene(), backend,
      mobile: true, renderStride: 2, assetLoader: loader, clock: () => 0 });
    const camera = { position: { x: 8, y: 100000, z: 8 }, fov: 48 };
    runtime.update({ camera, viewportHeightPixels: 720, visible: () => true });
    await settle(() => runtime.snapshot().stream.readyTileIds.includes('l1/0/0'));
    const root = runtime.resources.get('l1/0/0');
    expect(root.width).toBe(5);
    expect(root.sourceResource.width).toBe(9);
    expect(root.maximumReductionErrorMetres).toBeGreaterThan(0);
    expect(runtime.manager.renderErrors.get(root.tileId)).toBe(root.geometricErrorMetres);
    expect(runtime.snapshot().renderer.renderedTiles).toBe(1);
    runtime.update({ camera, viewportHeightPixels: 720, activeHoleNumber: 1, visible: () => true });
    await settle(() => runtime.snapshot().renderer.renderedTiles === 4);
    const native = runtime.resources.get('l0/0/0');
    expect(native.width).toBe(9);
    expect(native.renderStride).toBe(1);
    expect(native.parentRenderStride).toBe(2);
    expect(native.maximumReductionErrorMetres).toBe(0);
    expect(runtime.heightAt(native.worldOriginX + 3, native.worldOriginZ + 3).height)
      .toBeCloseTo(heights[3 * 17 + 3] - ground.frame.origin.heightRH2000, 6);
    expect(runtime.snapshot().renderer.drawCalls).toBe(1);
    expect(runtime.snapshot().renderer.batches.find(b => b.renderedTiles).width).toBe(9);
    runtime.dispose();
  });
  it('waits for a slower parent before exposing children, without duplicate loads', async () => {
    const base = fixture();
    const compiled = compileTerrainAssets({ groundId: 'quality-ground', courseSlugs: ['quality-course'],
      heights: new Float64Array(17 * 17).fill(35), width: 17, height: 17,
      originEasting: 650000, originNorthing: 6640256, tileSegments: 8 });
    const ground = { groundId: 'quality-ground', frame: base.ground.frame, shell: compiled.shell, tiles: compiled.tiles };
    const course = { slug: 'quality-course', groundId: ground.groundId, holes: [{ number: 1, tileIds: ['l0/0/0'] }] };
    let releaseParent;
    const parentGate = new Promise(resolve => { releaseParent = resolve; });
    const loader = { request: vi.fn(async ref => {
      const decoded = verifyChunkAsset(ref, compiled.resources.get(ref.url));
      if (decoded.header.id === 'l1/0/0') await parentGate;
      return decoded;
    }), reprioritizeScope: vi.fn() };
    const runtime = new CourseV2TerrainRuntime({ ground, course, scene: new THREE.Scene(), backend: 'webgl2',
      renderStride: 2, assetLoader: loader, clock: () => 0 });
    runtime.update({ camera: { position: { x: 8, y: 1000, z: 8 }, fov: 48 },
      viewportHeightPixels: 720, activeHoleNumber: 1, visible: () => true });
    await settle(() => loader.request.mock.calls.length === 6);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(runtime.snapshot().stream.readyTileIds).toEqual(['shell']);
    releaseParent();
    await settle(() => runtime.snapshot().renderer.renderedTiles === 4);
    expect(loader.request).toHaveBeenCalledTimes(6);
    expect(runtime.snapshot().stream.failedTileIds).toEqual([]);
    runtime.dispose();
  });

  it('maps Banvy world axes to EPSG:5845 and resolves active-hole tiles', () => {
    const { course, ground } = fixture();
    expect(worldToCanonicalCamera({ x: 12, y: 3, z: 40 }, ground.frame)).toEqual({
      easting: 650012,
      northing: 6640216,
      heightRH2000: 23,
    });
    expect(activeHoleTerrainTileIds(course, 1)).toEqual(['l0/0/0']);
    expect(activeHoleTerrainTileIds(course, 99)).toEqual([]);
  });

  it('holds every hole to the course target and the ground off it to its own', () => {
    const { course, ground, loader } = fixture();
    expect(courseTerrainTileIds({ holes: [{ tileIds: ['l0/1/0', 'l0/0/0'] }, { tileIds: ['l0/0/0'] }, {}] }))
      .toEqual(['l0/0/0', 'l0/1/0']);
    expect(courseTerrainTileIds(null)).toEqual([]);
    const profile = { targetErrorPixels: 1, outsideCourseTargetErrorPixels: 3, maximumSelectedTiles: 128 };
    const runtime = new CourseV2TerrainRuntime({ ground, course, scene: new THREE.Scene(), backend: 'webgl2',
      profile, assetLoader: loader, clock: () => 0 });
    runtime.update({ camera: { position: { x: 64, y: 50, z: 192 }, fov: 48 },
      viewportHeightPixels: 720, activeHoleNumber: 1, visible: () => true });
    expect(runtime.lastUpdate).toMatchObject({ targetErrorPixels: 1, outsideCourseTargetErrorPixels: 3 });
    expect([...runtime.lastUpdate.courseTileIds]).toEqual(courseTerrainTileIds(course));
    runtime.dispose();
    const uniform = new CourseV2TerrainRuntime({ ground, course, scene: new THREE.Scene(), backend: 'webgl2',
      profile: { targetErrorPixels: 1, maximumSelectedTiles: 128 }, assetLoader: loader, clock: () => 0 });
    uniform.update({ camera: { position: { x: 64, y: 50, z: 192 }, fov: 48 },
      viewportHeightPixels: 720, activeHoleNumber: 1, visible: () => true });
    expect(uniform.lastUpdate.outsideCourseTargetErrorPixels).toBe(1);
    uniform.dispose();
    expect(() => new CourseV2TerrainRuntime({ ground, course, scene: new THREE.Scene(), backend: 'webgl2',
      profile: { ...profile, outsideCourseTargetErrorPixels: 0.5 }, assetLoader: loader }))
      .toThrow(/at least targetErrorPixels/);
  });

  it('streams shell to regular tiles, batches one draw and exposes the same CPU height', async () => {
    const { course, ground, loader } = fixture();
    const scene = new THREE.Scene();
    let now = 0;
    const invalidated = vi.fn();
    const runtime = new CourseV2TerrainRuntime({
      ground,
      course,
      scene,
      backend: 'webgl2',
      mobile: true,
      assetLoader: loader,
      clock: () => now,
      onInvalidate: invalidated,
    });
    const camera = new THREE.PerspectiveCamera(48, 1, 1, 2000);
    camera.position.set(64, 50, 192);
    camera.lookAt(64, 0, 192);
    runtime.update({
      camera,
      viewportHeightPixels: 720,
      activeHoleNumber: 1,
      visible: () => true,
    });
    await settle(() => runtime.snapshot().stream.readyTileIds.length === 3);
    const snapshot = runtime.snapshot();
    expect(snapshot.profile).toEqual({ targetErrorPixels: 2.5, maximumSelectedTiles: 16 });
    expect(snapshot.stream.coverageComplete ?? snapshot.stream.plan.coverageComplete).toBe(true);
    expect(snapshot.renderer).toMatchObject({
      renderedTiles: 2,
      drawCalls: 1,
    });
    expect(loader.request).toHaveBeenCalledTimes(3);
    expect(invalidated).toHaveBeenCalled();
    expect(runtime.heightAt(64, 192)).toEqual({
      height: 0.5,
      tileId: 'l0/0/0',
      sampleSpacingMetres: 64,
    });
    now = 300;
    expect(runtime.tick().morphing).toBe(false);
    runtime.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it.each([[true, 8], [false, 128]])('with the desktop budget, a mobile=%s native runtime reserves %i terrain layers', async (mobile, layers) => {
    const { course, ground, loader } = fixture();
    const runtime = new CourseV2TerrainRuntime({ ground, course, scene: new THREE.Scene(), backend: 'webgl2', mobile,
      profile: { targetErrorPixels: 1, maximumSelectedTiles: 128 }, assetLoader: loader, clock: () => 0 });
    const camera = new THREE.PerspectiveCamera(48, 1, 1, 2000);
    camera.position.set(64, 50, 192);
    camera.lookAt(64, 0, 192);
    runtime.update({ camera, viewportHeightPixels: 720, activeHoleNumber: 1, visible: () => true });
    await settle(() => runtime.snapshot().renderer.renderedTiles === 2);
    const { renderStride, profile, renderer } = runtime.snapshot();
    expect(renderStride).toBe(1);
    expect(profile.maximumSelectedTiles).toBe(128);
    const regular = renderer.batches.filter(batch => batch.capacity > 1);
    expect(regular).toHaveLength(1);
    expect(regular[0].capacity).toBe(layers);
    expect(regular[0].textureCapacityBytes).toBe(layers * regular[0].width * regular[0].height * 8);
    runtime.dispose();
  });
});
