/* The swing, by touch, mouse or keyboard.

   Dra (the default): press on the swing pad, pull straight down for the
   backswing -- how far is the power -- and push straight back up through the
   start line to strike. Drifting sideways on the way up opens or closes the
   face (where the ball starts) and bends the path (how it curves). Letting go
   before the strike cancels the swing.

   Tryck (the accessible one, also Space): tap to start the meter, tap again
   to set the power, and a third time as the marker passes the line to set the
   accuracy. Nothing needs a steady drag or a precise gesture.

   Pure state machines with a small DOM view; the play mode decides what a
   strike does. */

export const SWING_METHODS = Object.freeze({ drag: 'Dra', tap: 'Tryck' });
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** The drag swing's arithmetic, from pointer positions (px, y grows downward). */
export function dragSwing({ height, width }) {
  let state = 'idle', x0 = 0, y0 = 0, deepest = 0, xTop = 0, power = 0;
  return {
    get state() { return state; },
    get power() { return power; },
    down(x, y) { state = 'back'; x0 = x; y0 = y; deepest = y; xTop = x; power = 0; },
    move(x, y) {
      if (state === 'back') {
        if (y > deepest) { deepest = y; xTop = x; }
        power = clamp((deepest - y0) / height, 0, 1.1);
        // A clear turn upward after a real backswing starts the downswing.
        if (deepest - y > Math.max(10, height * .06) && power > .04) state = 'down';
        return { phase: 'back', power };
      }
      if (state === 'down') {
        if (y <= y0) {
          state = 'idle';
          const face = clamp((x - x0) / (width * .38), -1, 1);
          const path = clamp((x - xTop) / (width * .5), -1, 1);
          return { phase: 'strike', power, face, path };
        }
        return { phase: 'down', power, drift: (x - x0) / (width * .38) };
      }
      return null;
    },
    up() { const was = state; state = 'idle'; return was === 'idle' ? null : { phase: 'cancel' }; },
  };
}

/** The three-tap meter: tap() advances it, step(dt) moves its marker. */
export function tapMeter({ rise = 1.05, fall = 1.4 } = {}) {
  let state = 'idle', marker = 0, power = 0, dir = 1;
  return {
    get state() { return state; },
    get marker() { return marker; },
    get power() { return power; },
    tap() {
      if (state === 'idle') { state = 'power'; marker = 0; dir = 1; power = 0; return { phase: 'start' }; }
      if (state === 'power') { power = clamp(marker, .02, 1.1); state = 'accuracy'; return { phase: 'power', power }; }
      if (state === 'accuracy') {
        state = 'idle';
        const off = marker;                // the line is at 0
        const face = clamp(off / .12, -1, 1);
        return { phase: 'strike', power, face, path: face * .6 };
      }
      return null;
    },
    step(dt) {
      if (state === 'power') {
        marker += dir * dt / rise;
        if (marker >= 1.1) { marker = 1.1; dir = -1; }
        if (marker <= 0 && dir < 0) { state = 'idle'; marker = 0; return { phase: 'cancel' }; }
        return { phase: 'power', marker };
      }
      if (state === 'accuracy') {
        marker -= dt * fall;
        if (marker < -.2) { state = 'idle'; return { phase: 'strike', power, face: -1, path: -.7 }; }
        return { phase: 'accuracy', marker };
      }
      return null;
    },
    cancel() { state = 'idle'; marker = 0; },
  };
}

/**
 * The swing pad's view and its event wiring.
 * callbacks: onBack(power) while pulling back, onStrike({ power, face, path }), onCancel().
 */
export function createSwingPad({ parent, method = 'drag', onBack, onStrike, onCancel }) {
  const el = document.createElement('div');
  el.className = 'pl-swing';
  el.innerHTML = `<div class="pl-pad" role="slider" aria-label="Sving: dra ned för kraft, för upp rakt för att slå" aria-valuemin="0" aria-valuemax="110" aria-valuenow="0" tabindex="0">
      <div class="pl-pad-fill"></div><i class="pl-mark" style="--at:.5"></i><i class="pl-mark" style="--at:.75"></i><i class="pl-mark full" style="--at:1"></i>
      <i class="pl-target"></i><div class="pl-knob"></div><div class="pl-line"></div></div>
    <div class="pl-meter" aria-hidden="true"><div class="pl-meter-fill"></div><i class="pl-meter-sweet"></i><i class="pl-meter-target"></i><i class="pl-meter-marker"></i></div>
    <button class="pl-tap" type="button">Slå</button>
    <span class="pl-swing-hint"></span>`;
  parent.append(el);
  const pad = el.querySelector('.pl-pad'), fill = el.querySelector('.pl-pad-fill'), knob = el.querySelector('.pl-knob');
  const meter = el.querySelector('.pl-meter'), meterFill = el.querySelector('.pl-meter-fill'), marker = el.querySelector('.pl-meter-marker');
  const tapButton = el.querySelector('.pl-tap'), hint = el.querySelector('.pl-swing-hint');
  let drag = null, meterState = tapMeter(), enabled = true, pointer = null;
  const showPower = p => {
    fill.style.setProperty('--p', Math.min(1.1, p).toFixed(3));
    knob.style.setProperty('--p', Math.min(1.1, p).toFixed(3));
    pad.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    el.classList.toggle('over', p > 1);
  };
  const setMethod = m => {
    method = m; el.dataset.method = m; meterState.cancel(); drag = null; showPower(0); meterFill.style.setProperty('--p', 0);
    hint.textContent = m === 'drag' ? 'Dra ned · för upp rakt' : 'Tryck: start · kraft · träff';
  };
  setMethod(method);
  pad.addEventListener('pointerdown', e => {
    if (!enabled || method !== 'drag') return;
    e.preventDefault(); pad.setPointerCapture(e.pointerId); pointer = e.pointerId;
    const r = pad.getBoundingClientRect();
    drag = dragSwing({ height: r.height * .82, width: r.width * 2.2 });
    drag.down(e.clientX, e.clientY); el.classList.add('active');
  });
  pad.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== pointer) return;
    const out = drag.move(e.clientX, e.clientY);
    if (!out) return;
    if (out.phase === 'back') { showPower(out.power); onBack?.(out.power); }
    if (out.phase === 'down') el.style.setProperty('--drift', out.drift.toFixed(3));
    if (out.phase === 'strike') { el.classList.remove('active'); drag = null; onStrike(out); }
  });
  const end = e => {
    if (!drag || e.pointerId !== pointer) return;
    const out = drag.up(); drag = null; el.classList.remove('active'); showPower(0); el.style.setProperty('--drift', 0);
    if (out?.phase === 'cancel') onCancel?.();
  };
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
  const tap = () => {
    if (!enabled || method !== 'tap') return;
    const out = meterState.tap();
    if (out?.phase === 'start') el.classList.add('active');
    if (out?.phase === 'power') onBack?.(out.power);
    if (out?.phase === 'strike') { el.classList.remove('active'); onStrike(out); }
  };
  tapButton.addEventListener('click', tap);
  return {
    el,
    get method() { return method; },
    setMethod,
    /** Space: the meter's tap, or nothing for the drag swing. */
    key() { if (method === 'tap') { tap(); return true; } return false; },
    step(dt) {
      if (method !== 'tap') return;
      const out = meterState.step(dt);
      const m = meterState.marker;
      meterFill.style.setProperty('--p', Math.max(0, meterState.state === 'accuracy' ? meterState.power : m).toFixed(3));
      marker.style.setProperty('--m', m.toFixed(3));
      if (out?.phase === 'power') onBack?.(m);
      if (out?.phase === 'cancel') { el.classList.remove('active'); onCancel?.(); }
      if (out?.phase === 'strike' && out.power) { el.classList.remove('active'); onStrike(out); }
    },
    /** The planned power (0..1) as a line to pull to; null hides it. */
    target(power) {
      el.classList.toggle('has-target', power != null);
      el.style.setProperty('--target', power == null ? 0 : Math.min(1.1, power).toFixed(3));
    },
    setEnabled(on) { enabled = on; el.classList.toggle('off', !on); if (!on) { meterState.cancel(); drag = null; showPower(0); } },
    dispose() { el.remove(); },
  };
}
