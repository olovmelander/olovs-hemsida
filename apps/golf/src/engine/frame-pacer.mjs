/* THE FRAME CAP (ported from serenity-blocks' theme-frame-pacer.js, 2 November).

   The player rendered a full course once per vsync: 240 renders a second on a
   240 Hz laptop panel, four times the work of a 60 fps picture that looks the
   same, and the fans and the battery paid for it. The cap renders at most the
   target rate, and never below it:

     240 Hz cadence, 60 fps target -> every 4th frame = 60 fps (saves 75%)
     144 Hz cadence, 60 fps target -> every 2nd frame = 72 fps (saves 50%)
      90 Hz cadence, 60 fps target -> every frame     = 90 fps (declines to cap)
      60 Hz cadence, 60 fps target -> every frame     = 60 fps (no-op)

   A naive `elapsed >= 1000 / target` gate would turn a 90 Hz cadence into
   45 fps. The rule looks one observed frame ahead instead: it skips only when
   the NEXT frame would still land inside the target interval, so a cadence
   that does not divide the target renders a little faster, never slower, and a
   loop the GPU has already slowed below the target is never gated at all.
   Pure and renderer-free, so the rule is tested directly. */

const SAME_FRAME_MS = 1;
const INTERVAL_EMA_ALPHA = 0.2;
const DEADLINE_SLACK_MS = 0.5;

/** The rates the menu offers; 0 is unlimited. */
export const FRAME_CAPS = Object.freeze([30, 60, 0]);
export const DEFAULT_FRAME_CAP = 60;
export const FRAME_CAP_KEY = 'banvy-fps';

export function createFramePacer() {
  return { started: false, lastCallAt: 0, lastDecision: true, lastRenderAt: 0, intervalEma: 0 };
}

/** Forget the cadence after a gap (a hidden tab, a stopped loop). */
export function resetFramePacer(state) {
  Object.assign(state, createFramePacer());
}

function observe(state, now) {
  if (state.started) {
    const delta = now - state.lastCallAt;
    /* a clock jump or a restored tab is not a cadence */
    if (delta > 0 && delta < 250) {
      state.intervalEma = state.intervalEma > 0
        ? state.intervalEma * (1 - INTERVAL_EMA_ALPHA) + delta * INTERVAL_EMA_ALPHA
        : delta;
    }
  }
  state.started = true;
  state.lastCallAt = now;
}

/** Whether this animation frame should render, at most `target` fps (0 = every frame).
 *  Call once a frame; a repeat call in the same frame returns the same answer. */
export function shouldRenderFrame(state, now, target) {
  const fps = Number(target);
  if (!Number.isFinite(fps) || fps <= 0) {
    observe(state, now);
    state.lastRenderAt = now;
    state.lastDecision = true;
    return true;
  }
  if (state.started && now - state.lastCallAt < SAME_FRAME_MS) return state.lastDecision;
  observe(state, now);
  if (state.lastRenderAt === 0) {
    state.lastRenderAt = now;
    state.lastDecision = true;
    return true;
  }
  const elapsed = now - state.lastRenderAt;
  if (elapsed + state.intervalEma <= 1000 / fps + DEADLINE_SLACK_MS) {
    state.lastDecision = false;
    return false;
  }
  state.lastRenderAt = now;
  state.lastDecision = true;
  return true;
}

/** The cap for this visit: the URL's ?fps= (0 = unlimited) wins, then the
 *  viewer's choice, then 60. A stored value outside the menu's set is ignored. */
export function resolveFrameCap(search, storage) {
  const asked = new URLSearchParams(search).get('fps');
  if (asked !== null && asked !== '') {
    const n = Number(asked);
    return Number.isFinite(n) && n >= 0 ? (n === 0 ? 0 : Math.max(30, n)) : DEFAULT_FRAME_CAP;
  }
  let stored = null;
  try { stored = storage?.getItem(FRAME_CAP_KEY) ?? null; } catch {}
  const n = stored === null ? NaN : Number(stored);
  return FRAME_CAPS.includes(n) ? n : DEFAULT_FRAME_CAP;
}

/** The next rate in the menu's cycle: 60 -> 0 (unlimited) -> 30 -> 60. */
export function nextFrameCap(current) {
  const order = [60, 0, 30];
  const i = order.indexOf(current);
  return order[(i + 1) % order.length];
}

export const frameCapLabel = cap => (cap > 0 ? `${cap} bilder/s` : 'Obegränsad');
