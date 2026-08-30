import { canonicalJson } from '../canonical-json.mjs';
import { abortError } from './decode-web.mjs';

class StablePriorityQueue {
  constructor() {
    this.items = [];
  }

  push(job) {
    this.items.push(job);
    this.items.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence);
  }

  pop() {
    return this.items.shift();
  }

  remove(job) {
    const index = this.items.indexOf(job);
    if (index >= 0) this.items.splice(index, 1);
  }

  rescore(job) {
    this.remove(job);
    this.push(job);
  }

  get size() {
    return this.items.length;
  }
}

function identity(reference) {
  return canonicalJson({
    url: reference.url,
    bytes: reference.bytes,
    sha256: reference.sha256,
    decodedBytes: reference.decodedBytes,
    decodedSha256: reference.decodedSha256,
    kind: reference.kind,
  });
}

export class AssetRequestScheduler {
  constructor({ load, maxConcurrent = 3 } = {}) {
    if (typeof load !== 'function') throw new TypeError('load must be a function');
    if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 16) {
      throw new RangeError('maxConcurrent must be an integer from 1 to 16');
    }
    this.load = load;
    this.maxConcurrent = maxConcurrent;
    this.queue = new StablePriorityQueue();
    this.jobs = new Map();
    this.running = 0;
    this.sequence = 0;
    this.disposed = false;
  }

  request(reference, options = {}) {
    if (this.disposed) return Promise.reject(new Error('asset scheduler is disposed'));
    if (!reference?.url) return Promise.reject(new TypeError('reference.url is required'));
    if (!Number.isFinite(options.priority ?? 100)) return Promise.reject(new TypeError('priority must be finite'));
    if (options.signal?.aborted) return Promise.reject(abortError());
    const priority = options.priority ?? 100;
    const scope = options.scope ?? 'default';
    let job = this.jobs.get(reference.url);
    if (job && job.identity !== identity(reference)) {
      return Promise.reject(new Error(`conflicting asset identity for ${reference.url}`));
    }
    if (!job || job.controller.signal.aborted) {
      job = {
        reference,
        identity: identity(reference),
        priority,
        sequence: this.sequence++,
        state: 'queued',
        controller: new AbortController(),
        subscribers: new Set(),
      };
      this.jobs.set(reference.url, job);
      this.queue.push(job);
    }
    return new Promise((resolve, reject) => {
      const subscriber = { resolve, reject, priority, scope, signal: options.signal, abort: null };
      subscriber.abort = () => this.#cancelSubscriber(job, subscriber);
      job.subscribers.add(subscriber);
      options.signal?.addEventListener('abort', subscriber.abort, { once: true });
      this.#recomputePriority(job);
      this.#pump();
    });
  }

  cancelScope(scope) {
    let cancelled = 0;
    for (const job of [...this.jobs.values()]) {
      for (const subscriber of [...job.subscribers]) {
        if (subscriber.scope === scope) {
          this.#cancelSubscriber(job, subscriber);
          cancelled++;
        }
      }
    }
    return cancelled;
  }

  reprioritizeScope(scope, priority) {
    if (!Number.isFinite(priority)) throw new TypeError('priority must be finite');
    let changed = 0;
    for (const job of this.jobs.values()) {
      for (const subscriber of job.subscribers) {
        if (subscriber.scope === scope) {
          subscriber.priority = priority;
          changed++;
        }
      }
      this.#recomputePriority(job);
    }
    this.#pump();
    return changed;
  }

  #recomputePriority(job) {
    if (!job.subscribers.size) return;
    const priority = Math.min(...[...job.subscribers].map(subscriber => subscriber.priority));
    if (priority !== job.priority) {
      job.priority = priority;
      if (job.state === 'queued') this.queue.rescore(job);
    }
  }

  #cancelSubscriber(job, subscriber) {
    if (!job.subscribers.delete(subscriber)) return;
    subscriber.signal?.removeEventListener('abort', subscriber.abort);
    subscriber.reject(abortError());
    if (job.subscribers.size) {
      this.#recomputePriority(job);
      return;
    }
    if (job.state === 'queued') this.queue.remove(job);
    if (job.state === 'running') job.controller.abort(abortError());
    if (this.jobs.get(job.reference.url) === job) this.jobs.delete(job.reference.url);
  }

  #settle(job, method, value) {
    for (const subscriber of [...job.subscribers]) {
      job.subscribers.delete(subscriber);
      subscriber.signal?.removeEventListener('abort', subscriber.abort);
      subscriber[method](value);
    }
  }

  #pump() {
    while (!this.disposed && this.running < this.maxConcurrent && this.queue.size) {
      const job = this.queue.pop();
      if (!job.subscribers.size || job.controller.signal.aborted) continue;
      job.state = 'running';
      this.running++;
      Promise.resolve().then(() => this.load(job.reference, {
        signal: job.controller.signal,
        priority: job.priority,
      })).then(value => {
        job.state = 'settling';
        if (!job.controller.signal.aborted) this.#settle(job, 'resolve', value);
      }, error => {
        job.state = 'settling';
        const reason = job.controller.signal.aborted ? abortError() : error;
        this.#settle(job, 'reject', reason);
      }).finally(() => {
        this.running--;
        job.state = 'done';
        if (this.jobs.get(job.reference.url) === job) this.jobs.delete(job.reference.url);
        this.#pump();
      });
    }
  }

  stats() {
    return Object.freeze({ queued: this.queue.size, running: this.running, jobs: this.jobs.size });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const job of [...this.jobs.values()]) {
      for (const subscriber of [...job.subscribers]) this.#cancelSubscriber(job, subscriber);
    }
    this.jobs.clear();
    this.queue.items.length = 0;
  }
}

