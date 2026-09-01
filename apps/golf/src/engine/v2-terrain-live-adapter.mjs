import {
  assertV2LegacyCutoutContract,
  planV2LegacyCutout,
} from './v2-legacy-cutout.mjs';

function callback(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function errorText(error) {
  return String(error?.message || error).slice(0, 300);
}

function finiteHeightSample(sample) {
  if (Number.isFinite(sample)) return sample;
  return Number.isFinite(sample?.height) ? sample : Number.NaN;
}

function finiteHeightValue(sample) {
  const finiteSample = finiteHeightSample(sample);
  return Number.isFinite(finiteSample) ? finiteSample : finiteSample?.height ?? Number.NaN;
}

async function defaultBatchFactory(options) {
  const { TerrainTileBatchSet } = await import('./v2-terrain-batch.mjs');
  return new TerrainTileBatchSet(options);
}

function assertBatch(batch) {
  if (!batch?.group || typeof batch.sync !== 'function' ||
      typeof batch.stats !== 'function' || typeof batch.tick !== 'function' ||
      typeof batch.dispose !== 'function') {
    throw new TypeError('v2 terrain batch must implement group/sync/stats/tick/dispose');
  }
  return batch;
}

function assertFixedFrontier({ source, courseSlug, expectedCourseSlug, expectedTileCount, renderResources }) {
  const surfaceAtlas = source.surfaceAtlas;
  const terrainTileIds = renderResources.map(resource => resource.tileId).sort();
  const surfaceTileIds = [...(surfaceAtlas?.data?.tileIds || [])].sort();
  const surfaceSamples = surfaceAtlas?.data?.bounds?.w * surfaceAtlas?.data?.bounds?.h;
  const classifiedSamples = surfaceAtlas?.data?.classCounts
    ? Array.from(surfaceAtlas.data.classCounts).reduce((sum, count) => sum + count, 0)
    : -1;

  if (courseSlug !== expectedCourseSlug ||
      source.descriptor?.tiles?.length !== expectedTileCount ||
      source.surfaceDescriptor?.tiles?.length !== expectedTileCount ||
      renderResources.length !== expectedTileCount ||
      new Set(terrainTileIds).size !== expectedTileCount ||
      renderResources.some(resource => resource.noDataCount !== 0) ||
      surfaceTileIds.length !== expectedTileCount ||
      surfaceTileIds.some((tileId, index) => tileId !== terrainTileIds[index]) ||
      surfaceAtlas?.data?.noDataCount !== 0 ||
      !Number.isSafeInteger(surfaceSamples) || classifiedSamples !== surfaceSamples ||
      !surfaceAtlas?.contains(source.bounds?.x0, source.bounds?.z0) ||
      !surfaceAtlas?.contains(source.bounds?.x1, source.bounds?.z1)) {
    throw new Error(
      `v2 fixed-frontier preflight requires ${expectedTileCount} complete matching terrain/surface tiles`,
    );
  }
  return Object.freeze({ surfaceAtlas, terrainTileIds: Object.freeze(terrainTileIds) });
}

/**
 * Fail-closed live boundary for a complete, retained v2 terrain frontier.
 *
 * The source may influence construction heights only after its material batch
 * has passed a real backend preflight. It may influence visible-ground heights
 * only after the guarded legacy cut and scene installation have also succeeded.
 * This is the same narrow height/tick/snapshot boundary that the manifest-driven
 * streaming runtime must implement once real course/ground graphs are published.
 */
export class V2TerrainLiveAdapter {
  constructor({
    source,
    courseSlug,
    expectedCourseSlug,
    expectedTileCount,
    cutoutContract,
    batchFactory = defaultBatchFactory,
  } = {}) {
    if (!source || typeof source !== 'object') throw new TypeError('v2 terrain source is required');
    if (typeof courseSlug !== 'string' || !courseSlug) throw new TypeError('courseSlug is required');
    if (typeof expectedCourseSlug !== 'string' || !expectedCourseSlug) {
      throw new TypeError('expectedCourseSlug is required');
    }
    positiveInteger(expectedTileCount, 'expectedTileCount');
    if (!cutoutContract || typeof cutoutContract !== 'object') {
      throw new TypeError('reviewed cutoutContract is required');
    }
    this.source = source;
    this.courseSlug = courseSlug;
    this.expectedCourseSlug = expectedCourseSlug;
    this.expectedTileCount = expectedTileCount;
    this.cutoutContract = cutoutContract;
    this.batchFactory = callback(batchFactory, 'batchFactory');
    this.phase = source.ready ? 'pending' : 'fallback';
    this.batch = null;
    this.prepared = null;
    this.sourceDisposed = false;
    this.renderer = Object.freeze({ status: this.phase });
  }

  get requested() { return this.source.requested === true; }
  get sourceReady() { return this.source.ready === true; }
  get active() { return this.phase === 'ready'; }
  get preflightReady() { return this.phase === 'prepared' || this.phase === 'ready'; }
  get group() { return this.batch?.group || null; }
  get preparation() { return this.prepared; }
  get rendererState() { return this.renderer; }

  constructionHeightAt(worldX, worldZ) {
    if (!this.preflightReady) return Number.NaN;
    return finiteHeightValue(this.source.heightAt?.(worldX, worldZ));
  }

  heightAt(worldX, worldZ) {
    if (!this.active) return Number.NaN;
    return finiteHeightSample(this.source.heightAt?.(worldX, worldZ));
  }

  async prepare({
    coreGrid,
    renderStride = 1,
    decorateMaterial,
    preflight,
  } = {}) {
    if (!this.sourceReady) {
      return Object.freeze({ ok: false, status: this.phase, error: null });
    }
    if (this.phase !== 'pending') {
      throw new Error(`v2 terrain adapter cannot prepare from ${this.phase}`);
    }
    positiveInteger(renderStride, 'renderStride');
    callback(preflight, 'preflight');

    try {
      const renderResources = this.source.renderResources(renderStride);
      assertFixedFrontier({
        source: this.source,
        courseSlug: this.courseSlug,
        expectedCourseSlug: this.expectedCourseSlug,
        expectedTileCount: this.expectedTileCount,
        renderResources,
      });
      const createdBatch = await this.batchFactory({
        maximumTiles: this.expectedTileCount,
        morphDurationMilliseconds: 0,
        decorateMaterial,
      });
      try {
        this.batch = assertBatch(createdBatch);
      } catch (error) {
        try { createdBatch?.dispose?.(); } catch {}
        throw error;
      }
      const syncState = this.batch.sync(renderResources);
      const batchStats = this.batch.stats();
      if (syncState.renderedTiles !== this.expectedTileCount ||
          batchStats.renderedTiles !== this.expectedTileCount ||
          batchStats.residentLayers !== this.expectedTileCount ||
          batchStats.drawCalls !== 1 || batchStats.batches?.length !== 1) {
        throw new Error('v2 fixed-frontier preflight did not produce one complete draw');
      }
      await preflight(this.batch);

      const guardCells = this.cutoutContract.guardCells;
      const expectedGuardMetres = this.cutoutContract.guardMetres;
      if (!Number.isSafeInteger(guardCells) || guardCells < 0 || !Number.isFinite(expectedGuardMetres)) {
        throw new Error('v2 legacy CORE cutout has no reviewed guard contract');
      }
      /* The v2 footprint is a rotated rectangle in the legacy world, and the
         legacy CORE builder can only omit an axis-aligned one -- so the cutout
         is planned on the INSCRIBED legacy rectangle. Anything wider would
         punch a hole the rotated v2 mesh does not reach. */
      if (!Number.isFinite(this.source.legacyBounds?.x0)) {
        throw new Error('v2 terrain source has no bridged legacy bounds to cut against');
      }
      const plan = planV2LegacyCutout({
        enabled: true,
        preflightStatus: 'ready',
        grid: coreGrid,
        previewBounds: this.source.legacyBounds,
        guardCells,
      });
      if (plan.guardMetres !== expectedGuardMetres) {
        throw new Error('v2 legacy CORE cutout differs from the reviewed guard');
      }
      assertV2LegacyCutoutContract({
        grid: coreGrid,
        plan,
        contract: this.cutoutContract,
      });
      this.prepared = Object.freeze({
        plan,
        renderStride,
        renderResources: Object.freeze([...renderResources]),
        batchStats,
      });
      this.phase = 'prepared';
      this.renderer = Object.freeze({ status: 'prepared' });
      return Object.freeze({ ok: true, status: this.phase, prepared: this.prepared });
    } catch (error) {
      this.fail(error);
      return Object.freeze({ ok: false, status: this.phase, error: this.renderer.error });
    }
  }

  activate({ legacyBuild, cut } = {}) {
    if (this.phase !== 'prepared' || !this.prepared || !this.batch) {
      throw new Error(`v2 terrain adapter cannot activate from ${this.phase}`);
    }
    const plan = this.prepared.plan;
    if (legacyBuild?.nx !== plan.nx || legacyBuild.nz !== plan.nz ||
        legacyBuild.skippedBasePoints !== plan.skippedBasePoints ||
        legacyBuild.totalBasePoints !== plan.totalBasePoints ||
        legacyBuild.emittedBasePoints !== legacyBuild.totalBasePoints - legacyBuild.skippedBasePoints) {
      throw new Error('legacy CORE builder did not apply the reviewed omission plan exactly');
    }
    if (!Number.isSafeInteger(cut?.removedTriangles) || cut.removedTriangles < 1) {
      throw new Error('guarded legacy CORE did not overlap the v2 frontier');
    }
    const meshResolutionMetres = this.prepared.renderResources[0]?.sampleSpacingMetres;
    if (!Number.isFinite(meshResolutionMetres) || meshResolutionMetres <= 0) {
      throw new Error('v2 terrain frontier has no finite mesh resolution');
    }

    this.phase = 'ready';
    this.renderer = Object.freeze({
      status: 'ready',
      renderStride: this.prepared.renderStride,
      meshResolutionMetres,
      skippedBasePoints: legacyBuild.skippedBasePoints,
      emittedBasePoints: legacyBuild.emittedBasePoints,
      totalBasePoints: legacyBuild.totalBasePoints,
      coreGrid: Object.freeze({
        dx: this.cutoutContract.expectedCoreGrid.dx,
        x0: this.cutoutContract.expectedCoreGrid.x0,
        x1: this.cutoutContract.expectedCoreGrid.x1,
        z0: this.cutoutContract.expectedCoreGrid.z0,
        z1: this.cutoutContract.expectedCoreGrid.z1,
        nx: legacyBuild.nx,
        nz: legacyBuild.nz,
      }),
      guardMetres: this.prepared.plan.guardMetres,
      fallbackRebuilt: false,
      ...cut,
      ...this.prepared.batchStats,
    });
    return this.renderer;
  }

  tick(now) {
    if (!this.batch || this.phase === 'failed' || this.phase === 'disposed') {
      return Object.freeze({ morphing: false });
    }
    return this.batch.tick(now);
  }

  fail(error) {
    if (this.phase === 'disposed') return this.renderer;
    this.phase = 'failed';
    try { this.batch?.dispose(); } catch {}
    this.batch = null;
    this.prepared = null;
    this.#disposeSource();
    this.renderer = Object.freeze({
      status: 'failed',
      fallbackRebuilt: false,
      error: errorText(error),
    });
    return this.renderer;
  }

  confirmFallbackRebuilt() {
    if (this.phase !== 'failed') {
      throw new Error(`v2 terrain adapter cannot confirm fallback from ${this.phase}`);
    }
    this.renderer = Object.freeze({ ...this.renderer, fallbackRebuilt: true });
    return this.renderer;
  }

  snapshot() {
    return Object.freeze({
      kind: 'fixed-frontier',
      phase: this.phase,
      requested: this.requested,
      sourceReady: this.sourceReady,
      preflightReady: this.preflightReady,
      active: this.active,
      renderer: this.renderer,
    });
  }

  dispose() {
    if (this.phase === 'disposed') return;
    try { this.batch?.dispose(); } catch {}
    this.batch = null;
    this.prepared = null;
    this.#disposeSource();
    this.phase = 'disposed';
    this.renderer = Object.freeze({ status: 'disposed' });
  }

  #disposeSource() {
    if (this.sourceDisposed) return;
    this.sourceDisposed = true;
    try { this.source.surfaceAtlas?.dispose?.(); } catch {}
  }
}
