import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { TerrainTileBatchSet } from './v2-terrain-batch.mjs';

// Execute the actual application shadow policy with real terrain buffers. The
// simulated renderer consumes needsUpdate; no GPU/FPS claim follows from this.
const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const start = main.indexOf('function shadowRest(');
const shadowSource = main.slice(start, main.indexOf('\n}', start) + 2);
const stateSource = main.match(/^const SHADOW_REST_STATE = .*;$/m)[0];

function tile() {
  return { tileId: 'l0/0/0', width: 3, height: 3, decodedSha256: 'fixture',
    layout: 'rgba8x2-height-parent-octnormal-v1', textureData: new Uint8Array(3 * 3 * 8),
    worldOriginX: 0.1, worldOriginZ: -0.2, heightOffsetWorld: 0.3,
    sampleSpacingMetres: 1, heightScaleMetres: 0.01,
    geometricErrorMetres: 1, maximumMorphDeltaMetres: 2 };
}

function fixture({ polish = true, duration = 240, pilot = false, cache = true } = {}) {
  const layer = new TerrainTileBatchSet({ maximumTiles: 2, morphDurationMilliseconds: duration });
  const resource = tile(); layer.sync([resource], { now: 0 });
  const context = {
    THREE, GRAPHICS_POLISH: polish, SHADOW_REST: cache,
    sun: { position: new THREE.Vector3(1, 2, 3), target: { position: new THREE.Vector3() }, shadow: { needsUpdate: false } },
    terrainV2: pilot ? { batch: layer } : { runtime: { layer } },
    treeUploadsThisFrame: 0, TREE_LOD: { queue: [], qHead: 0 }, flying: 0,
  };
  runInNewContext(`${stateSource}\n${shadowSource}\nthis.state = SHADOW_REST_STATE;`, context);
  return { layer, resource, context,
    step(now, { tick = true } = {}) {
      if (tick) layer.tick(now);
      context.shadowRest(now);
      const result = { refresh: context.sun.shadow.needsUpdate, why: context.state.why,
        revision: context.state.terrainRevision, renders: context.state.renders };
      context.sun.shadow.needsUpdate = false;
      return result;
    },
  };
}

describe('application terrain shadow cache', () => {
  it.each([false, true])('refreshes the final terrain shape after a slow frame (pilot=%s)', pilot => {
    const f = fixture({ pilot });
    expect(f.step(0).refresh).toBe(true);
    expect(f.step(120).refresh).toBe(true);
    const final = f.step(1000);
    expect(f.layer.inventory()[0].morph).toBe(0);
    expect(final).toMatchObject({ refresh: true, why: 'terrain', revision: f.layer.renderRevision });
    expect(f.step(1016)).toMatchObject({ refresh: true, why: 'settled' });
    expect(f.step(1032).refresh).toBe(false);
    f.layer.dispose();
  });

  it('demonstrates the disabled timer window missing that final shape', () => {
    const f = fixture({ polish: false });
    f.step(0); f.step(120);
    expect(f.step(1000).refresh).toBe(false);
    expect(f.layer.inventory()[0].morph).toBe(0);
    f.layer.dispose();
  });

  it('sees a frontier sync after tick and before the shadow decision', () => {
    const f = fixture({ duration: 0 }); f.step(0); f.step(1);
    f.layer.tick(16);
    const replacement = { ...f.resource, decodedSha256: 'new-payload', textureData: f.resource.textureData.slice() };
    replacement.textureData[0] = 7;
    f.layer.sync([replacement], { now: 16 });
    expect(f.step(16, { tick: false })).toMatchObject({ refresh: true, why: 'terrain' });
    expect(f.step(32)).toMatchObject({ refresh: true, why: 'settled' });
    expect(f.step(40).refresh).toBe(false);
    f.layer.sync([], { now: 48 });
    expect(f.step(48)).toMatchObject({ refresh: true, why: 'terrain' });
    f.layer.dispose();
  });

  it('notices a replacement layer even when its revision number matches', () => {
    const f = fixture({ duration: 0 }); f.step(0);
    const replacement = new TerrainTileBatchSet({ maximumTiles: 2, morphDurationMilliseconds: 0 });
    replacement.sync([f.resource], { now: 0 });
    expect(replacement.renderRevision).toBe(f.layer.renderRevision);
    f.context.terrainV2.runtime.layer = replacement;
    expect(f.step(16)).toMatchObject({ refresh: true, why: 'terrain' });
    f.context.terrainV2.runtime = null;
    expect(f.step(32)).toMatchObject({ refresh: true, why: 'terrain' });
    f.layer.dispose(); replacement.dispose();
  });

  it('keeps settled shadows cached until the existing 60-frame fallback', () => {
    const f = fixture({ duration: 0 }); f.step(-16); f.step(0);
    for (let frame = 1; frame < 60; frame++) expect(f.step(frame * 16).refresh).toBe(false);
    expect(f.step(960)).toMatchObject({ refresh: true, why: 'tick' });
    expect(f.step(976).refresh).toBe(false);
    f.layer.dispose();
  });

  it.each(['sun', 'trees', 'fade', 'flight'])('retains %s invalidation and coalesces terrain changes into the same refresh', reason => {
    const f = fixture(); f.step(0);
    if (reason === 'sun') f.context.sun.position.x++;
    if (reason === 'trees') f.context.treeUploadsThisFrame = 1;
    if (reason === 'fade') f.context.TREE_LOD.queue.push({});
    if (reason === 'flight') f.context.flying = 0.5;
    expect(f.step(1000).refresh).toBe(true);
    expect(f.context.state.terrainRevision).toBe(f.layer.renderRevision);
    expect(f.context.state.renders).toBe(2);
    expect(f.context.treeUploadsThisFrame).toBe(0);
    f.context.flying = 0; f.context.TREE_LOD.queue.length = 0;
    expect(f.step(1016)).toMatchObject({ refresh: true, why: 'settled' });
    expect(f.step(1020).refresh).toBe(false);
    // A change without a simultaneous terrain revision must still refresh.
    if (reason === 'sun') f.context.sun.target.position.x++;
    if (reason === 'trees') f.context.treeUploadsThisFrame = 1;
    if (reason === 'fade') f.context.TREE_LOD.queue.push({});
    if (reason === 'flight') f.context.flying = 0.5;
    expect(f.step(1032)).toMatchObject({ refresh: true, why: reason === 'fade' ? 'trees' : reason });
    f.layer.dispose();
  });

  it('leaves a requested final refresh pending if a capture pauses rendering', () => {
    const f = fixture(); f.step(0);
    f.layer.tick(1000); f.context.shadowRest(1000);
    expect(f.context.sun.shadow.needsUpdate).toBe(true);
    f.layer.tick(1016); f.context.shadowRest(1016);
    expect(f.context.sun.shadow.needsUpdate).toBe(true);
    expect(f.context.state.renders).toBe(2);
    expect(f.context.state.settlePending).toBe(true);
    // The actual renderer consumes needsUpdate after drawing. Only then can
    // the single follow-up be issued; later idle frames stay cached.
    f.context.sun.shadow.needsUpdate = false;
    expect(f.step(1032)).toMatchObject({ refresh: true, why: 'settled' });
    expect(f.step(1048).refresh).toBe(false);
    f.layer.dispose();
  });

  it('leaves explicit every-frame shadow mode in control', () => {
    const f = fixture({ cache: false });
    expect(f.step(0).refresh).toBe(false);
    expect(f.step(1000).refresh).toBe(false);
    expect(f.context.state.renders).toBe(0);
    f.layer.dispose();
  });
});
