import { describe, expect, it } from 'vitest';
import { HANDOFF_MAX_AGE_MS, declinedCourses, takeGpsHandoff, writeGpsHandoff } from './gps-handoff.js';

const memory = () => {
  const data = new Map();
  return { getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k), data };
};

describe('GPS handoff across a course switch', () => {
  it('carries GPS mode to exactly the course it names, once, while fresh', () => {
    const store = memory();
    writeGpsHandoff({ from: 'angso', to: 'puttom', hole: 12 }, { now: 1000, store });
    expect(takeGpsHandoff('upsala', { now: 2000, store })).toBeNull();
    expect(store.data.size).toBe(0);                /* read once, whoever reads it */

    writeGpsHandoff({ from: 'angso', to: 'puttom', hole: 12 }, { now: 1000, store });
    expect(takeGpsHandoff('puttom', { now: 2000, store })).toMatchObject({ from: 'angso', to: 'puttom', hole: 12 });
    expect(takeGpsHandoff('puttom', { now: 2500, store })).toBeNull();

    writeGpsHandoff({ to: 'puttom' }, { now: 1000, store });
    expect(takeGpsHandoff('puttom', { now: 1000 + HANDOFF_MAX_AGE_MS, store })).toBeNull();
  });

  it('treats a return to the course GPS left as a choice, for the rest of the tab', () => {
    const store = memory();
    writeGpsHandoff({ from: 'veckefjarden', to: 'veckefjarden-korthalsbanan' }, { now: 0, store });
    expect(takeGpsHandoff('veckefjarden-korthalsbanan', { now: 10, store })).not.toBeNull();
    expect(declinedCourses('veckefjarden', { store })).toEqual([]);
    /* back to the eighteen, with no handoff: the player chose it */
    expect(takeGpsHandoff('veckefjarden', { now: 60000, store })).toBeNull();
    expect(declinedCourses('veckefjarden', { store })).toEqual(['veckefjarden-korthalsbanan']);
    expect(declinedCourses('veckefjarden-korthalsbanan', { store })).toEqual([]);
  });

  it('degrades to "no handoff" without storage', () => {
    const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
    writeGpsHandoff({ to: 'puttom' }, { store: broken });
    expect(takeGpsHandoff('puttom', { store: broken })).toBeNull();
    expect(declinedCourses('puttom', { store: broken })).toEqual([]);
    expect(takeGpsHandoff('puttom', { store: null })).toBeNull();
  });
});
