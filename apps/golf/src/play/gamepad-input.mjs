/* A game controller in Spela (the Gamepad API's standard mapping).

   Left stick aims, the right stick swings (pulled back and pushed through, as
   the swing pad is dragged), the shoulders change club, the pad's arrows shape
   the shot (left/right draw/fade, up/down height), the triggers set the spin,
   A confirms and hurries a flight on, B goes back, X changes the shot type,
   Y the overview, Back the replay and Start the menu. The browser only reports
   a controller after one of its buttons has been pressed on the page. */

export const PAD_BUTTONS = Object.freeze({
  a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9, ls: 10, rs: 11, up: 12, down: 13, left: 14, right: 15,
});
const NAMES = Object.entries(PAD_BUTTONS);

/** A stick axis past its dead zone, rescaled so the zone's edge reads 0. */
export function deadZone(value, zone = .16) {
  const v = Number(value) || 0, a = Math.abs(v);
  return a <= zone ? 0 : Math.sign(v) * Math.min(1, (a - zone) / (1 - zone));
}

/**
 * One controller's state against the last frame's: the sticks, which buttons
 * are held and which were pressed since (a press is an edge, never a repeat).
 */
export function readPad(gamepad, previous = new Set()) {
  const held = new Set(), pressed = new Set();
  if (!gamepad) return { connected: false, held, pressed, lx: 0, ly: 0, rx: 0, ry: 0 };
  for (const [name, index] of NAMES) {
    const b = gamepad.buttons?.[index];
    const on = Boolean(b && (b.pressed || b.value > .5));
    if (on) { held.add(name); if (!previous.has(name)) pressed.add(name); }
  }
  const axes = gamepad.axes || [];
  // The sticks are read raw for the swing (it has its own thresholds), with a dead zone for aiming.
  return { connected: true, held, pressed, lx: deadZone(axes[0]), ly: deadZone(axes[1]), rx: Number(axes[2]) || 0, ry: Number(axes[3]) || 0, id: gamepad.id };
}

export function createGamepadInput({ onConnect } = {}) {
  let previous = new Set(), index = -1, connected = false;
  const pick = () => {
    const pads = globalThis.navigator?.getGamepads?.() || [];
    if (index >= 0 && pads[index]?.connected) return pads[index];
    for (const gp of pads) if (gp?.connected) { index = gp.index; return gp; }
    index = -1;
    return null;
  };
  return {
    /** This frame's controller state (connected false when none is there). */
    poll() {
      const state = readPad(pick(), previous);
      previous = state.held;
      if (state.connected !== connected) { connected = state.connected; onConnect?.(connected, state.id); }
      return state;
    },
    get connected() { return connected; },
    /** A short rumble, where the controller has one. */
    rumble(strength = .5, ms = 120) {
      const gp = index >= 0 ? globalThis.navigator?.getGamepads?.()[index] : null;
      gp?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strength), weakMagnitude: Math.min(1, strength * .7) })?.catch?.(() => {});
    },
  };
}
