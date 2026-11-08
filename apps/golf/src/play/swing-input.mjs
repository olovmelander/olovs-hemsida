/* The swing, by touch, mouse or keyboard.

   Dra (the default): press on the swing pad, pull straight down for the
   backswing -- how far is the power -- and push straight back up through the
   start line to strike. Drifting sideways on the way up opens or closes the
   face (where the ball starts) and bends the path (how it curves). Letting go
   before the strike cancels the swing.

   Tryck (the accessible one, also Space): tap to start the meter, tap again
   to set the power, and a third time as the marker passes the line to set the
   accuracy. Nothing needs a steady drag or a precise gesture.

   Spak: a game controller's right stick swings as the pad does -- pull it
   back, push it through -- and is timed the same way.

   Tempo (the drag and the stick): the backswing, the turn at the top and the
   downswing are timed. A tour swing's backswing takes about three times its
   downswing (the "3:1" of tour tempo studies): near that the strike is pure
   and the drift's error is halved; a downswing that dawdles decelerates through
   the ball (shorter, open, a slice); one snatched from the top closes the face
   (a pull or a hook); a hurried backswing spreads every miss.

   Pure state machines with a small DOM view; the play mode decides what a
   strike does. */

export const SWING_METHODS = Object.freeze({ drag: 'Dra', tap: 'Tryck' });
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const now = () => (globalThis.performance?.now?.() ?? Date.now()) / 1000;

/** What a swing's timing does to the strike. back and down in seconds. */
export function tempoOf({ back, down, power = 1 } = {}) {
  if (!(back > 0) || !(down > 0)) return { ratio: null, grade: 'none', label: '', powerMul: 1, faceAdd: 0, pathAdd: 0, errorMul: 1 };
  const ratio = back / down;
  let grade = 'perfect', label = 'Perfekt tempo', powerMul = 1, faceAdd = 0, pathAdd = 0, errorMul = .5;
  if (ratio < 2.2) {
    const k = Math.min(1, (2.2 - ratio) / 1.4);
    grade = 'slow'; label = 'För långsamt genom bollen'; powerMul = 1 - .16 * k; faceAdd = .35 * k; pathAdd = .3 * k; errorMul = 1;
  } else if (ratio > 4.4) {
    const k = Math.min(1, (ratio - 4.4) / 3);
    grade = 'fast'; label = 'För snabbt från toppen'; powerMul = 1 - .04 * k; faceAdd = -.4 * k; pathAdd = -.45 * k; errorMul = 1.15;
  } else if (ratio < 2.6 || ratio > 3.8) {
    grade = 'good'; label = 'Bra tempo'; errorMul = .8;
  }
  // A backswing hurried for its size spreads the miss, whatever the ratio.
  const least = .28 + .32 * Math.min(1, power);
  if (back < least) {
    if (grade === 'perfect') grade = 'good';
    label = 'Stressad baksving'; errorMul *= 1.3; faceAdd -= .12;
  }
  return { ratio, grade, label, powerMul, faceAdd, pathAdd, errorMul, back, down };
}

/** The drag swing's arithmetic, from pointer positions (px, y grows downward). */
export function dragSwing({ height, width }) {
  let state = 'idle', x0 = 0, y0 = 0, deepest = 0, xTop = 0, power = 0, t0 = 0, tTop = 0, tTurn = 0;
  return {
    get state() { return state; },
    get power() { return power; },
    down(x, y, t = now()) { state = 'back'; x0 = x; y0 = y; deepest = y; xTop = x; power = 0; t0 = t; tTop = t; },
    move(x, y, t = now()) {
      if (state === 'back') {
        if (y > deepest) { deepest = y; xTop = x; tTop = t; }
        power = clamp((deepest - y0) / height, 0, 1.1);
        // A clear turn upward after a real backswing starts the downswing.
        if (deepest - y > Math.max(10, height * .06) && power > .04) { state = 'down'; tTurn = tTop; }
        return { phase: 'back', power };
      }
      if (state === 'down') {
        if (y <= y0) {
          state = 'idle';
          const face = clamp((x - x0) / (width * .38), -1, 1);
          const path = clamp((x - xTop) / (width * .5), -1, 1);
          const tempo = tempoOf({ back: tTop - t0, down: t - tTurn, power });
          return { phase: 'strike', power, face, path, tempo };
        }
        return { phase: 'down', power, drift: (x - x0) / (width * .38) };
      }
      return null;
    },
    up() { const was = state; state = 'idle'; return was === 'idle' ? null : { phase: 'cancel' }; },
  };
}

/**
 * A game controller's stick as the swing: y > 0 is pulled back (toward the
 * player), y < 0 pushed through. The backswing starts past a dead zone, power is
 * how far back it went, the strike comes when the stick is pushed through the
 * top; a stick let go to the middle (or left at the top) cancels.
 */
export function stickSwing() {
  let state = 'idle', deepest = 0, xTop = 0, power = 0, t0 = 0, tTop = 0, tTurn = 0, still = 0, last = 0;
  return {
    get state() { return state; },
    get power() { return power; },
    feed(x, y, t = now()) {
      const dt = last ? t - last : 0; last = t;
      if (state === 'idle') {
        if (y > .22) { state = 'back'; deepest = y; xTop = x; t0 = t; tTop = t; power = 0; still = 0; }
        return null;
      }
      if (state === 'back') {
        if (y > deepest) { deepest = y; xTop = x; tTop = t; }
        power = clamp((deepest - .22) / .72, 0, 1);
        if (deepest - y > .28 && power > .04) { state = 'down'; tTurn = tTop; still = 0; return { phase: 'back', power }; }
        if (t - tTop > 2.5) { state = 'idle'; return { phase: 'cancel' }; }
        return { phase: 'back', power };
      }
      if (state === 'down') {
        if (y < -.55) {
          state = 'idle';
          const face = clamp(x / .55, -1, 1), path = clamp((x - xTop) / .8, -1, 1);
          return { phase: 'strike', power, face, path, tempo: tempoOf({ back: tTop - t0, down: t - tTurn, power }) };
        }
        // Let go: the stick sits in the middle instead of going through.
        still = Math.abs(y) < .2 ? still + dt : 0;
        if (still > .3 || t - tTurn > 1.4) { state = 'idle'; return { phase: 'cancel' }; }
        return { phase: 'down', power, drift: x / .55 };
      }
      return null;
    },
    cancel() { state = 'idle'; },
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
 * callbacks: onBack(power, source) while pulling back (source: drag, stick or tap),
 * onStrike({ power, face, path, tempo }), onCancel().
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
  const stick = stickSwing();
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
    if (out.phase === 'back') { showPower(out.power); onBack?.(out.power, 'drag'); }
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
    if (out?.phase === 'power') onBack?.(out.power, 'tap');
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
      if (out?.phase === 'power') onBack?.(m, 'tap');
      if (out?.phase === 'cancel') { el.classList.remove('active'); onCancel?.(); }
      if (out?.phase === 'strike' && out.power) { el.classList.remove('active'); onStrike(out); }
    },
    /** A controller's right stick (x, y in -1..1): swings in any method. */
    stick(x, y) {
      if (!enabled) { stick.cancel(); return; }
      const out = stick.feed(x, y);
      if (!out) return;
      if (out.phase === 'back') { showPower(out.power); el.classList.add('active'); onBack?.(out.power, 'stick'); }
      if (out.phase === 'down') el.style.setProperty('--drift', clamp(out.drift, -1.5, 1.5).toFixed(3));
      if (out.phase === 'strike') { el.classList.remove('active'); showPower(0); el.style.setProperty('--drift', 0); onStrike(out); }
      if (out.phase === 'cancel') { el.classList.remove('active'); showPower(0); el.style.setProperty('--drift', 0); onCancel?.(); }
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
