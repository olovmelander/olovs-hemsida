import { describe, expect, it } from 'vitest';
import { CAMERA_CYCLE, CHORD_MS, SHORTCUT_ROWS, createShortcutKeys, nextInCycle } from './keyboard-shortcuts.mjs';

/* A manual clock: timers fire only when the test advances it. */
function harness(holes) {
  const actions = [];
  let now = 0, timers = [];
  const keys = createShortcutKeys({ holes, onAction: a => actions.push(a),
    setTimer: (fn, ms) => { const t = { at: now + ms, fn }; timers.push(t); return t; },
    clearTimer: t => { timers = timers.filter(x => x !== t); } });
  const advance = ms => {
    now += ms;
    for (const t of timers.filter(x => x.at <= now)) { timers = timers.filter(x => x !== t); t.fn(); }
  };
  const holesOf = () => actions.filter(a => a.type === 'hole').map(a => a.hole);
  return { keys, actions, advance, holesOf, type: s => [...s].forEach(k => keys.press(k)) };
}

describe('typing a hole number', () => {
  it('answers 2-9 at once and waits for a second digit only after a 1 on an 18-hole course', () => {
    const h = harness(18);
    h.keys.press('7');
    expect(h.holesOf()).toEqual([7]);
    h.keys.press('1');
    expect(h.holesOf()).toEqual([7]);
    expect(h.keys.pending).toBe('1');
    h.advance(CHORD_MS);
    expect(h.holesOf()).toEqual([7, 1]);
  });

  it('reaches every hole 1-18, 0 alone is hole 10, and digits past the course restart the number', () => {
    for (let n = 1; n <= 18; n++) {
      const h = harness(18);
      h.type(String(n));
      h.advance(CHORD_MS);
      expect(h.holesOf()).toEqual([n]);
    }
    const zero = harness(18);
    zero.keys.press('0');
    expect(zero.holesOf()).toEqual([10]);
    const past = harness(18);
    past.type('19');
    expect(past.holesOf()).toEqual([1, 9]);
  });

  it('never waits on a nine-hole course and ignores holes it does not have', () => {
    const h = harness(9);
    h.type('1');
    expect(h.holesOf()).toEqual([1]);
    expect(h.keys.press('0')).toBe(false);
    h.type('9');
    expect(h.holesOf()).toEqual([1, 9]);
    const six = harness(6);
    expect(six.keys.press('8')).toBe(false);
    expect(six.holesOf()).toEqual([]);
  });

  it('applies a pending number before any other shortcut, in the order typed', () => {
    const h = harness(18);
    h.type('1');
    h.keys.press('c');
    expect(h.actions).toEqual([{ type: 'hole', hole: 1 }, { type: 'camera' }]);
  });

  it('forgets a pending number on reset and commits it on flush', () => {
    const h = harness(18);
    h.type('1');
    h.keys.reset();
    h.advance(CHORD_MS * 2);
    expect(h.holesOf()).toEqual([]);
    h.type('1');
    h.keys.flush();
    expect(h.holesOf()).toEqual([1]);
  });
});

describe('named shortcuts', () => {
  it('maps letters case-insensitively and the arrows, and leaves other keys alone', () => {
    const h = harness(18);
    for (const k of ['c', 'C', 'l', 'f', 'h', 'm', 'n', 'p', 'ArrowRight', 'ArrowLeft']) expect(h.keys.press(k)).toBe(true);
    expect(h.actions.map(a => a.type)).toEqual(['camera', 'camera', 'light', 'flight', 'clean', 'markers', 'next', 'prev', 'next', 'prev']);
    for (const k of ['x', 'Escape', 'Shift', 'Enter', ' ', '', undefined, 'ArrowUp']) expect(h.keys.press(k)).toBe(false);
  });

  it('steps the camera through the rail order and wraps', () => {
    expect(CAMERA_CYCLE).toEqual(['tee', 'green', 'orbit', 'top']);
    expect(nextInCycle(CAMERA_CYCLE, 'top')).toBe('tee');
    expect(nextInCycle(CAMERA_CYCLE, 'orbit')).toBe('top');
    expect(nextInCycle(CAMERA_CYCLE, 'unknown')).toBe('tee');
    expect(nextInCycle([], 'tee')).toBeUndefined();
  });

  it('every key the menu lists does something (Esc is the drawer\'s own handler)', () => {
    const glyph = { '←': 'ArrowLeft', '→': 'ArrowRight' };
    for (const [keys] of SHORTCUT_ROWS) {
      for (const k of keys) {
        if (k === '–' || k === 'Esc') continue;
        const h = harness(18);
        const handled = /^\d+$/.test(k) ? [...k].every(d => h.keys.press(d)) : h.keys.press(glyph[k] ?? k);
        h.advance(CHORD_MS);
        expect(handled, `menu key ${k}`).toBe(true);
        expect(h.actions.length, `menu key ${k}`).toBeGreaterThan(0);
      }
    }
  });

  it('rejects an invalid hole count', () => {
    expect(() => createShortcutKeys({ holes: 0, onAction() {} })).toThrow('Invalid hole count');
  });
});
