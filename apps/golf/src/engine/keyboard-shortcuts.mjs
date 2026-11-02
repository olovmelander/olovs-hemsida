/* The player's keyboard shortcuts, as the menu lists them.

   The menu promised 1-9 and 0 for holes, C for the camera, L for the light and
   F for a flight, while the only handler knew the arrows, N/P, H and M: five of
   the seven listed keys did nothing. This module turns a key into one named
   action, so the list in shell/menu.js and the behaviour can be held to each
   other by a test.

   A hole is typed as its number. A digit that could still begin a longer hole
   number on this course (the 1 of 10-18) waits CHORD_MS for the next digit and
   then commits; every other digit commits at once, so 2-9 answer immediately
   and "1", "4" is hole 14. 0 alone is hole 10, as on a phone's keypad. A digit
   that cannot extend the number typed so far commits that number and starts a
   new one. Any other key flushes a pending number first, so nothing typed is
   lost or applied out of order.

   Letters are case-insensitive (Shift+C is still C). Modifier chords, text
   fields and the open chooser are the caller's guards (main.js), as before. */

export const CHORD_MS = 700;

/* The rail's camera buttons, in the order C steps through them. */
export const CAMERA_CYCLE = Object.freeze(['tee', 'green', 'orbit', 'top']);

const LETTERS = Object.freeze({
  c: 'camera', l: 'light', f: 'flight', h: 'clean', m: 'markers', n: 'next', p: 'prev',
});
const KEYS = Object.freeze({ ArrowRight: 'next', ArrowLeft: 'prev' });

/* The next entry after `current` in `cycle`, wrapping; the first if unknown. */
export function nextInCycle(cycle, current) {
  if (!cycle.length) return undefined;
  const i = cycle.indexOf(current);
  return cycle[(i + 1) % cycle.length];
}

/**
 * @param {object} options
 * @param {number} options.holes  holes on this course (9 or 18 here)
 * @param {(action: {type: string, hole?: number}) => void} options.onAction
 * @param {number} [options.chordMs]
 * @param {(fn: () => void, ms: number) => unknown} [options.setTimer]
 * @param {(id: unknown) => void} [options.clearTimer]
 */
export function createShortcutKeys({ holes, onAction, chordMs = CHORD_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id) }) {
  if (!Number.isInteger(holes) || holes < 1) throw new Error(`Invalid hole count: ${holes}`);
  let typed = '', timer = null;

  const cancel = () => { if (timer !== null) { clearTimer(timer); timer = null; } };
  const commit = () => {
    cancel();
    const n = Number(typed);
    typed = '';
    if (n >= 1 && n <= holes) onAction({ type: 'hole', hole: n });
  };
  const digit = d => {
    if (typed === '' && d === '0') {
      if (holes >= 10) onAction({ type: 'hole', hole: 10 });
      return holes >= 10;
    }
    if (typed !== '' && Number(typed + d) > holes) commit();
    if (typed === '' && Number(d) > holes) return false;
    typed += d;
    cancel();
    // Could another digit still make a hole on this course?
    if (Number(typed) * 10 <= holes) timer = setTimer(commit, chordMs);
    else commit();
    return true;
  };

  return {
    /** @returns {boolean} whether the key was a shortcut (the caller may preventDefault) */
    press(key) {
      if (typeof key !== 'string' || !key) return false;
      if (key.length === 1 && key >= '0' && key <= '9') return digit(key);
      const type = KEYS[key] ?? (key.length === 1 ? LETTERS[key.toLowerCase()] : undefined);
      if (!type) return false;
      if (typed) commit();
      onAction({ type });
      return true;
    },
    /** Commit a hole number still waiting for a second digit. */
    flush() { if (typed) commit(); },
    /** Forget a pending number without applying it (the chooser opened, say). */
    reset() { cancel(); typed = ''; },
    get pending() { return typed; },
  };
}

/* What the menu lists, one row per shortcut: [keys, description]. The menu
   renders these rows, and the test checks every listed key reaches an action. */
export const SHORTCUT_ROWS = Object.freeze([
  [['1', '–', '18'], 'Gå till hål: skriv numret'],
  [['0'], 'Hål 10'],
  [['←', '→'], 'Föregående / nästa hål (även N / P)'],
  [['C'], 'Byt kameravy'],
  [['L'], 'Växla ljus / tid på dygnet'],
  [['F'], 'Starta / stoppa flygtur'],
  [['M'], 'Skyltar: av, hål, faciliteter'],
  [['H'], 'Dölj / visa UI'],
  [['Esc'], 'Stäng meny'],
]);
