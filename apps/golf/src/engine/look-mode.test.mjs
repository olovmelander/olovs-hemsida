import { describe, it, expect } from 'vitest';
import { readLookMode, persistLookMode, LOOK_STORAGE_KEY } from './look-mode.mjs';

function mockStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, val) => map.set(key, String(val)),
    removeItem: key => map.delete(key),
    clear: () => map.clear(),
  };
}

describe('readLookMode', () => {
  it('defaults to Ghibli mode when no URL query or storage exists', () => {
    const res = readLookMode({ search: '', storage: mockStorage() });
    expect(res).toEqual({ ghibli: true, source: 'default' });
  });

  it('respects URL query ghibli=1', () => {
    const res = readLookMode({ search: '?ghibli=1', storage: mockStorage({ [LOOK_STORAGE_KEY]: '0' }) });
    expect(res).toEqual({ ghibli: true, source: 'url' });
  });

  it('respects URL query ghibli=0 to force realistic mode', () => {
    const res = readLookMode({ search: '?ghibli=0', storage: mockStorage({ [LOOK_STORAGE_KEY]: '1' }) });
    expect(res).toEqual({ ghibli: false, source: 'url' });
  });

  it('respects alternate falsy URL flags like ?ghibli=off or ?ghibli=false', () => {
    expect(readLookMode({ search: '?ghibli=off' })).toEqual({ ghibli: false, source: 'url' });
    expect(readLookMode({ search: '?ghibli=false' })).toEqual({ ghibli: false, source: 'url' });
  });

  it('respects ?look=real and ?look=ghibli aliases', () => {
    expect(readLookMode({ search: '?look=real' })).toEqual({ ghibli: false, source: 'url' });
    expect(readLookMode({ search: '?look=ghibli' })).toEqual({ ghibli: true, source: 'url' });
  });

  it('falls back to stored preference when URL parameter is absent', () => {
    const storeReal = mockStorage({ [LOOK_STORAGE_KEY]: '0' });
    expect(readLookMode({ search: '?bana=puttom', storage: storeReal })).toEqual({ ghibli: false, source: 'storage' });

    const storeGhibli = mockStorage({ [LOOK_STORAGE_KEY]: '1' });
    expect(readLookMode({ search: '?bana=puttom', storage: storeGhibli })).toEqual({ ghibli: true, source: 'storage' });
  });

  it('handles faulty storage gracefully and returns standard default', () => {
    const brokenStorage = {
      getItem() { throw new Error('QuotaExceeded / SecurityError'); },
      setItem() { throw new Error('Blocked'); },
    };
    expect(readLookMode({ search: '', storage: brokenStorage })).toEqual({ ghibli: true, source: 'default' });
  });
});

describe('persistLookMode', () => {
  it('saves look preference to storage', () => {
    const storage = mockStorage();
    expect(persistLookMode(true, storage)).toBe(true);
    expect(storage.getItem(LOOK_STORAGE_KEY)).toBe('1');

    expect(persistLookMode(false, storage)).toBe(true);
    expect(storage.getItem(LOOK_STORAGE_KEY)).toBe('0');
  });

  it('returns false when storage is unavailable', () => {
    expect(persistLookMode(true, null)).toBe(false);
  });
});
