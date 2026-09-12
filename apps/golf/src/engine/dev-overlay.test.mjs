import { describe, expect, it } from 'vitest';
import {
  DEV_OVERLAY_STORAGE_KEY,
  persistDevOverlay,
  readDevOverlay,
  terrainBadgeVisible,
} from './dev-overlay.mjs';

function storage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
    get size() { return map.size; },
  };
}

const throwingStorage = {
  getItem() { throw new Error('site data blocked'); },
  setItem() { throw new Error('site data blocked'); },
  removeItem() { throw new Error('site data blocked'); },
};

describe('terrain badge visibility', () => {
  it('hides the ready and loading badge until a developer asks for it', () => {
    for (const state of ['ready', 'loading']) {
      expect(terrainBadgeVisible({ requested: true, state, devOverlay: false })).toBe(false);
      expect(terrainBadgeVisible({ requested: true, state, devOverlay: true })).toBe(true);
    }
  });

  /* The load-bearing one: a screenshot of the fallback badge is the only report
     a failed v2 ground sends, so no switch may suppress it. */
  it('always shows the fallback badge, whatever the developer switch says', () => {
    expect(terrainBadgeVisible({ requested: true, state: 'fallback', devOverlay: false })).toBe(true);
    expect(terrainBadgeVisible({ requested: true, state: 'fallback', devOverlay: true })).toBe(true);
  });

  it('shows nothing on a course that never requested v2 terrain', () => {
    expect(terrainBadgeVisible({ requested: false, state: 'fallback', devOverlay: true })).toBe(false);
    expect(terrainBadgeVisible({ requested: false, state: 'ready', devOverlay: true })).toBe(false);
  });

  it('defaults every argument to hidden rather than throwing', () => {
    expect(terrainBadgeVisible()).toBe(false);
    expect(terrainBadgeVisible({})).toBe(false);
  });
});

describe('reading the developer switch', () => {
  it('is off with no parameter and no stored preference', () => {
    expect(readDevOverlay({ search: '?bana=veckefjarden', storage: storage() }))
      .toEqual({ on: false, source: 'default' });
  });

  it('takes a stored preference so a reload on a phone keeps it', () => {
    expect(readDevOverlay({ search: '', storage: storage({ [DEV_OVERLAY_STORAGE_KEY]: '1' }) }))
      .toEqual({ on: true, source: 'storage' });
  });

  it('lets the URL win in both directions', () => {
    const stored = storage({ [DEV_OVERLAY_STORAGE_KEY]: '1' });
    expect(readDevOverlay({ search: '?dev=0', storage: stored }).on).toBe(false);
    expect(readDevOverlay({ search: '?dev=1', storage: storage() }).on).toBe(true);
    expect(readDevOverlay({ search: '?dev=0', storage: stored }).source).toBe('url');
  });

  it('ignores a value that is neither 1 nor 0', () => {
    expect(readDevOverlay({ search: '?dev=yes', storage: storage() }).on).toBe(false);
    expect(readDevOverlay({ search: '?dev=yes', storage: storage({ [DEV_OVERLAY_STORAGE_KEY]: '1' }) }).on)
      .toBe(true);
  });

  it('survives a storage that throws, which is a private window', () => {
    expect(readDevOverlay({ search: '', storage: throwingStorage })).toEqual({ on: false, source: 'default' });
    expect(persistDevOverlay(true, throwingStorage)).toBe(false);
  });
});

describe('persisting the developer switch', () => {
  it('writes when on and clears the key when off', () => {
    const store = storage();
    expect(persistDevOverlay(true, store)).toBe(true);
    expect(store.getItem(DEV_OVERLAY_STORAGE_KEY)).toBe('1');
    expect(persistDevOverlay(false, store)).toBe(true);
    expect(store.getItem(DEV_OVERLAY_STORAGE_KEY)).toBe(null);
    expect(store.size).toBe(0);
  });

  it('reports false rather than throwing with no storage at all', () => {
    expect(persistDevOverlay(true, null)).toBe(false);
  });
});
