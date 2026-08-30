export class ResourceLeasePool {
  constructor({ maxEntries = 64, dispose = () => {} } = {}) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new RangeError('maxEntries must be a positive integer');
    if (typeof dispose !== 'function') throw new TypeError('dispose must be a function');
    this.maxEntries = maxEntries;
    this.disposeValue = dispose;
    this.entries = new Map();
    this.clock = 0;
  }

  async acquire(key, create) {
    if (typeof create !== 'function') throw new TypeError('create must be a function');
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        key,
        refs: 0,
        value: undefined,
        lastUsed: ++this.clock,
        promise: null,
      };
      entry.promise = Promise.resolve().then(create).then(value => {
        entry.value = value;
        return value;
      }, error => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
        throw error;
      });
      this.entries.set(key, entry);
    }
    entry.refs++;
    entry.lastUsed = ++this.clock;
    let value;
    try {
      value = await entry.promise;
    } catch (error) {
      entry.refs--;
      throw error;
    }
    let released = false;
    return Object.freeze({
      key,
      value,
      release: () => {
        if (released) return false;
        released = true;
        entry.refs--;
        entry.lastUsed = ++this.clock;
        this.trim();
        return true;
      },
    });
  }

  trim() {
    if (this.entries.size <= this.maxEntries) return 0;
    const candidates = [...this.entries.values()]
      .filter(entry => entry.refs === 0 && entry.value !== undefined)
      .sort((left, right) => left.lastUsed - right.lastUsed);
    let removed = 0;
    while (this.entries.size > this.maxEntries && candidates.length) {
      const entry = candidates.shift();
      if (this.entries.get(entry.key) !== entry) continue;
      this.entries.delete(entry.key);
      this.disposeValue(entry.value, entry.key);
      removed++;
    }
    return removed;
  }

  evictUnused() {
    const candidates = [...this.entries.values()]
      .filter(entry => entry.refs === 0 && entry.value !== undefined)
      .sort((left, right) => left.lastUsed - right.lastUsed);
    for (const entry of candidates) {
      this.entries.delete(entry.key);
      this.disposeValue(entry.value, entry.key);
    }
    return candidates.length;
  }

  stats() {
    let referenced = 0;
    let loading = 0;
    for (const entry of this.entries.values()) {
      if (entry.refs > 0) referenced++;
      if (entry.value === undefined) loading++;
    }
    return Object.freeze({ entries: this.entries.size, referenced, loading });
  }
}

