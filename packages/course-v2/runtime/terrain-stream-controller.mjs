import { abortError } from './decode-web.mjs';
import { ResourceLeasePool } from './resource-pool.mjs';

function callback(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function`);
  return value;
}

function positiveInteger(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${label} must be an integer from 1 to ${maximum}`);
  }
  return value;
}

function isAbort(error) {
  return error?.name === 'AbortError';
}

/**
 * Connects a TerrainTileManager plan to the verified scheduler and a bounded
 * decoded/GPU resource pool. The controller itself has no Three.js dependency.
 */
export class TerrainStreamController {
  constructor({
    manager,
    loader,
    createResource,
    disposeResource = () => {},
    onChange = () => {},
    maximumCachedResources = 32,
    /* A tile the plan stops wanting is kept resident this long before it is
       released. A camera that swings across a refinement threshold, or turns
       a tile out of the frustum and back, wants the same tile again within
       the second; released, it must be leased and uploaded again and its
       coarse parent stands in for the frames between -- the terrain seen to
       flip to another terrain for a split second. Kept, it is drawn at once. */
    releaseGraceMilliseconds = 1_500,
    /* how many unwanted tiles may wait out their grace at once; beyond it the
       longest-unwanted go first, so memory stays bounded whatever the camera does */
    maximumRetainedTiles = 48,
    retryBaseMilliseconds = 1_000,
    retryMaximumMilliseconds = 30_000,
    clock = () => Date.now(),
    scope = 'terrain-v2',
  } = {}) {
    if (!manager?.plan) throw new TypeError('manager must implement plan');
    if (!loader?.request) throw new TypeError('loader must implement request');
    this.manager = manager;
    this.loader = loader;
    this.createResource = callback(createResource, 'createResource');
    this.onChange = callback(onChange, 'onChange');
    this.clock = callback(clock, 'clock');
    positiveInteger(maximumCachedResources, 'maximumCachedResources', 512);
    if (!Number.isInteger(releaseGraceMilliseconds) || releaseGraceMilliseconds < 0 || releaseGraceMilliseconds > 60_000) {
      throw new RangeError('releaseGraceMilliseconds must be an integer from 0 to 60000');
    }
    positiveInteger(maximumRetainedTiles, 'maximumRetainedTiles', 4096);
    this.releaseGraceMilliseconds = releaseGraceMilliseconds;
    this.maximumRetainedTiles = maximumRetainedTiles;
    positiveInteger(retryBaseMilliseconds, 'retryBaseMilliseconds', 60_000);
    positiveInteger(retryMaximumMilliseconds, 'retryMaximumMilliseconds', 10 * 60_000);
    if (retryMaximumMilliseconds < retryBaseMilliseconds) {
      throw new RangeError('retryMaximumMilliseconds must be at least retryBaseMilliseconds');
    }
    if (typeof scope !== 'string' || !scope) throw new TypeError('scope must be a non-empty string');
    this.scope = scope;
    this.retryBaseMilliseconds = retryBaseMilliseconds;
    this.retryMaximumMilliseconds = retryMaximumMilliseconds;
    this.pool = new ResourceLeasePool({
      maxEntries: maximumCachedResources,
      dispose: disposeResource,
    });
    this.entries = new Map();
    this.failures = new Map();
    this.lastOptions = null;
    this.lastPlan = null;
    this.disposed = false;
  }

  update(options) {
    if (this.disposed) throw new Error('terrain stream controller is disposed');
    this.lastOptions = { ...options };
    return this.#reconcile();
  }

  #residentIds() {
    return new Set([...this.entries]
      .filter(([, entry]) => entry.state === 'ready')
      .map(([tileId]) => tileId));
  }

  #notify() {
    try { this.onChange(this.snapshot()); }
    catch { /* observers must not corrupt streaming state */ }
  }

  #reconcile() {
    if (this.disposed || !this.lastOptions) return this.lastPlan;
    const plan = this.manager.plan({
      ...this.lastOptions,
      residentTileIds: this.#residentIds(),
    });
    this.lastPlan = plan;
    const keep = new Set([
      'shell',
      ...plan.desiredTileIds,
      ...(plan.retainTileIds || []),
      ...plan.renderTileIds,
      ...plan.requests.map(request => request.tileId),
    ]);

    const now = this.clock();
    /* A ready tile the plan no longer wants waits out a grace before it is
       released, and stays resident meanwhile -- the plan sees it as resident
       and never asks for it again, so a camera that wants it back within the
       grace gets it at once instead of its coarse parent for the frames a
       fresh lease and upload take. Loading tiles nobody wants are aborted as
       before. Beyond maximumRetainedTiles the longest-unwanted go first. */
    const waiting = [];
    for (const [tileId, entry] of [...this.entries]) {
      if (keep.has(tileId)) { entry.unwantedSince = undefined; continue; }
      if (entry.state === 'loading') { entry.controller.abort(abortError()); this.entries.delete(tileId); continue; }
      if (entry.unwantedSince === undefined) entry.unwantedSince = now;
      if (now - entry.unwantedSince >= this.releaseGraceMilliseconds) { entry.lease.release(); this.entries.delete(tileId); continue; }
      waiting.push([tileId, entry]);
    }
    if (waiting.length > this.maximumRetainedTiles) {
      waiting.sort((a, b) => a[1].unwantedSince - b[1].unwantedSince);
      for (const [tileId, entry] of waiting.slice(0, waiting.length - this.maximumRetainedTiles)) {
        entry.lease.release();
        this.entries.delete(tileId);
      }
    }

    for (const request of plan.requests) {
      const entry = this.entries.get(request.tileId);
      if (entry) {
        if (entry.state === 'loading' && entry.priority !== request.priority) {
          entry.priority = request.priority;
          this.loader.reprioritizeScope?.(entry.scope, request.priority);
        }
        continue;
      }
      const failure = this.failures.get(request.tileId);
      if (failure && now < failure.retryAt) continue;
      this.#start(request);
    }
    this.#notify();
    return plan;
  }

  #start(request) {
    const controller = new AbortController();
    const entry = {
      state: 'loading',
      controller,
      priority: request.priority,
      reference: request.reference,
      scope: `${this.scope}:${request.tileId}`,
      lease: null,
    };
    this.entries.set(request.tileId, entry);
    entry.promise = this.pool.acquire(request.reference.url, async () => {
      const decoded = await this.loader.request(request.reference, {
        priority: request.priority,
        scope: entry.scope,
        signal: controller.signal,
      });
      if (controller.signal.aborted) throw abortError();
      return this.createResource({
        tileId: request.tileId,
        reference: request.reference,
        decoded,
        signal: controller.signal,
      });
    }).then(lease => {
      if (this.disposed || controller.signal.aborted || this.entries.get(request.tileId) !== entry) {
        lease.release();
        if (this.disposed) this.pool.evictUnused();
        return;
      }
      entry.state = 'ready';
      entry.lease = lease;
      this.failures.delete(request.tileId);
      this.#reconcile();
    }, error => {
      if (this.entries.get(request.tileId) === entry) this.entries.delete(request.tileId);
      if (!this.disposed && !isAbort(error)) {
        const attempts = (this.failures.get(request.tileId)?.attempts || 0) + 1;
        const delay = Math.min(this.retryMaximumMilliseconds,
          this.retryBaseMilliseconds * 2 ** Math.min(20, attempts - 1));
        this.failures.set(request.tileId, Object.freeze({ error, attempts, retryAt: this.clock() + delay }));
      }
      if (!this.disposed) {
        this.#reconcile();
      }
    });
  }

  renderResources() {
    if (!this.lastPlan) return Object.freeze([]);
    return Object.freeze(this.lastPlan.renderTileIds.flatMap(tileId => {
      const entry = this.entries.get(tileId);
      return entry?.state === 'ready'
        ? [Object.freeze({ tileId, value: entry.lease.value })]
        : [];
    }));
  }

  snapshot() {
    const readyTileIds = [];
    const loadingTileIds = [];
    for (const [tileId, entry] of this.entries) {
      (entry.state === 'ready' ? readyTileIds : loadingTileIds).push(tileId);
    }
    readyTileIds.sort();
    loadingTileIds.sort();
    return Object.freeze({
      plan: this.lastPlan,
      readyTileIds: Object.freeze(readyTileIds),
      loadingTileIds: Object.freeze(loadingTileIds),
      failedTileIds: Object.freeze([...this.failures.keys()].sort()),
      renderResources: this.renderResources(),
      pool: this.pool.stats(),
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values()) {
      if (entry.state === 'loading') entry.controller.abort(abortError());
      if (entry.state === 'ready') entry.lease.release();
    }
    this.entries.clear();
    this.failures.clear();
    this.pool.evictUnused();
    this.manager.resetHysteresis?.();
  }
}
