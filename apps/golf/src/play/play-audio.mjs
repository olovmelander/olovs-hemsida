/* Spela's sound, made on the spot with Web Audio (no sound files to download).

   Every sound is a few oscillators and filtered noise with short envelopes:
   the club's strike (a driver's crack, an iron's click and the turf, a wedge's
   softer one, the putter's tock, a splash of sand), the swing's whoosh, each
   bounce by what it lands on, a trunk's knock and the leaves, the cup's rattle
   and its plunk, a splash, the roll of a putt and the wind in the background.
   Browsers start audio only after the player has touched or pressed something,
   so the context is made on the first gesture. The sound is off while the tab
   is hidden, and the menu turns it off altogether. */

export function createPlayAudio({ enabled = true } = {}) {
  let ctx = null, out = null, noise = null, on = enabled;
  let windGain = null, windFilter = null, rollGain = null, rollFilter = null, windTarget = 0;

  function ensure() {
    if (ctx || !on) return ctx;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { return null; }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    out = ctx.createGain(); out.gain.value = .75;
    out.connect(comp); comp.connect(ctx.destination);
    // Two seconds of white noise, looped by every noisy sound.
    const length = ctx.sampleRate * 2;
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < length; i++) { seed = seed * 16807 % 2147483647; data[i] = seed / 1073741823.5 - 1; }
    // The wind: low noise, slowly gusting.
    const windSource = loop();
    windFilter = ctx.createBiquadFilter(); windFilter.type = 'lowpass'; windFilter.frequency.value = 420; windFilter.Q.value = .4;
    windGain = ctx.createGain(); windGain.gain.value = 0;
    const gust = ctx.createOscillator(), gustDepth = ctx.createGain();
    gust.frequency.value = .11; gustDepth.gain.value = 160;
    gust.connect(gustDepth); gustDepth.connect(windFilter.frequency); gust.start();
    windSource.connect(windFilter); windFilter.connect(windGain); windGain.connect(out);
    // The roll of a ball on short grass.
    const rollSource = loop();
    rollFilter = ctx.createBiquadFilter(); rollFilter.type = 'bandpass'; rollFilter.frequency.value = 700; rollFilter.Q.value = .8;
    rollGain = ctx.createGain(); rollGain.gain.value = 0;
    rollSource.connect(rollFilter); rollFilter.connect(rollGain); rollGain.connect(out);
    setWind(windTarget);
    return ctx;
  }
  function loop() {
    const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
    src.loopStart = Math.random(); src.start(0, Math.random() * 1.5);
    return src;
  }
  const ready = () => ctx && on && ctx.state === 'running';

  /** A burst of filtered noise. */
  function hiss(at, { type = 'bandpass', freq = 1000, freqEnd = null, q = 1, gain = .5, attack = .002, decay = .08, hold = 0 }) {
    const src = ctx.createBufferSource(); src.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, at); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, at + attack + hold + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(gain, at + attack);
    g.gain.setValueAtTime(gain, at + attack + hold);
    g.gain.exponentialRampToValueAtTime(.0005, at + attack + hold + decay);
    src.connect(f); f.connect(g); g.connect(out);
    const length = attack + hold + decay + .05;
    src.start(at, Math.random() * Math.max(0, 1.9 - length)); src.stop(at + length);
  }
  /** A struck tone. */
  function tone(at, { freq = 440, freqEnd = null, type = 'sine', gain = .3, attack = .001, decay = .1 }) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, at);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, at + attack + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(gain, at + attack);
    g.gain.exponentialRampToValueAtTime(.0005, at + attack + decay);
    o.connect(g); g.connect(out);
    o.start(at); o.stop(at + attack + decay + .05);
  }
  function setWind(ms) {
    windTarget = ms;
    if (!ctx) return;
    const level = ms > .3 ? Math.min(.22, .025 + ms * .016) : .012;
    windGain.gain.setTargetAtTime(on ? level : 0, ctx.currentTime, .8);
    windFilter.frequency.setTargetAtTime(320 + ms * 45, ctx.currentTime, .8);
  }

  const onVisibility = () => { if (!ctx) return; if (document.hidden) ctx.suspend(); else if (on) ctx.resume(); };
  globalThis.document?.addEventListener('visibilitychange', onVisibility);

  return {
    /** Call from a user gesture: makes or wakes the audio. */
    unlock() { if (!on) return; ensure(); if (ctx?.state === 'suspended' && !document.hidden) ctx.resume(); },
    get enabled() { return on; },
    setEnabled(value) {
      on = Boolean(value);
      if (on) { ensure(); ctx?.resume(); setWind(windTarget); }
      else if (ctx) { windGain.gain.setTargetAtTime(0, ctx.currentTime, .05); rollGain.gain.setTargetAtTime(0, ctx.currentTime, .05); }
    },
    wind(ms) { setWind(Number(ms) || 0); },
    /** The club meeting the ball. kind: driver|wood|iron|wedge|putter; pure: 0..1 how clean; lie: the surface it was struck from. */
    strike(kind, { pure = .5, power = 1, lie = 'fairway' } = {}) {
      if (!ready()) return;
      const t = ctx.currentTime + .005, p = Math.max(.15, Math.min(1.1, power));
      if (kind === 'putter') {
        tone(t, { freq: 1180, gain: .32 * p + .08, decay: .04 });
        tone(t, { freq: 2650, gain: .08 * p, decay: .016 });
        hiss(t, { freq: 1900, q: 2, gain: .12 * p, decay: .02 });
        return;
      }
      if (lie === 'sand') {
        hiss(t, { freq: 1400, q: .6, gain: .75 * p, attack: .005, decay: .32, freqEnd: 700 });
        tone(t, { freq: 140, gain: .25 * p, decay: .1 });
        return;
      }
      const v = .35 + .65 * p;
      if (kind === 'driver' || kind === 'wood') {
        hiss(t, { freq: 4300, q: 1.1, gain: .85 * v, decay: .09 });
        tone(t, { freq: kind === 'driver' ? 1850 : 2100, freqEnd: 1400, type: 'triangle', gain: .32 * v, decay: .06 });
        tone(t, { freq: 170, gain: .3 * v, decay: .07 });
      } else {
        const wedge = kind === 'wedge';
        hiss(t, { freq: wedge ? 2600 : 3100, q: 1.5, gain: (wedge ? .55 : .75) * v, decay: .055 });
        tone(t, { freq: wedge ? 2100 : 2450, gain: .18 * v, decay: .025 });
        // The turf taken after the ball.
        if (lie !== 'tee') hiss(t + .012, { type: 'lowpass', freq: 900, gain: .45 * v, attack: .004, decay: .14 });
        tone(t, { freq: 120, freqEnd: 85, gain: .25 * v, decay: .1 });
      }
      if (pure > .85) tone(t, { freq: 3300, gain: .1, decay: .07 });
    },
    /** The club through the air, peaking `inSeconds` from now (at impact). */
    whoosh(inSeconds = .3, power = 1) {
      if (!ready() || power < .12) return;
      const t = ctx.currentTime, rise = Math.max(.08, inSeconds);
      hiss(t, { freq: 420, freqEnd: 2300, q: 1.6, gain: .1 + .25 * Math.min(1, power), attack: rise, decay: .16 });
    },
    bounce(surface, speed = 5) {
      if (!ready()) return;
      const t = ctx.currentTime + .003, v = Math.max(.06, Math.min(1, speed / 14));
      if (surface === 'sand') { hiss(t, { freq: 1700, q: .8, gain: .5 * v, decay: .14 }); return; }
      if (surface === 'path') { tone(t, { freq: 950, gain: .3 * v, decay: .03 }); hiss(t, { freq: 3200, gain: .4 * v, decay: .02 }); return; }
      if (surface === 'rough' || surface === 'forest') {
        hiss(t, { type: 'lowpass', freq: 380, gain: .4 * v, decay: .08 });
        hiss(t, { freq: 2600, gain: .14 * v, decay: .06 });
        return;
      }
      tone(t, { freq: 85 + 45 * v, gain: .45 * v, decay: .06 });
      hiss(t, { type: 'lowpass', freq: 520, gain: .45 * v, decay: .05 });
    },
    trunk() {
      if (!ready()) return;
      const t = ctx.currentTime + .003;
      tone(t, { freq: 360, gain: .5, decay: .1 }); tone(t, { freq: 740, gain: .2, decay: .05 });
      hiss(t, { freq: 900, q: 3, gain: .35, decay: .07 });
    },
    leaves() {
      if (!ready()) return;
      const t = ctx.currentTime + .003;
      hiss(t, { type: 'highpass', freq: 2400, gain: .28, attack: .02, decay: .35 });
      hiss(t + .05, { freq: 5200, gain: .15, attack: .01, decay: .22 });
    },
    cup() {
      if (!ready()) return;
      const t = ctx.currentTime + .003;
      [2150, 1900, 1720].forEach((f, i) => tone(t + i * .055, { freq: f, gain: .2 - i * .04, decay: .022 }));
      tone(t + .17, { freq: 330, freqEnd: 250, gain: .45, decay: .2 });
    },
    splash() {
      if (!ready()) return;
      const t = ctx.currentTime + .003;
      hiss(t, { type: 'lowpass', freq: 2400, freqEnd: 420, gain: .6, attack: .008, decay: .7 });
      for (let i = 0; i < 4; i++) tone(t + .12 + i * .09 + Math.random() * .05, { freq: 600 + Math.random() * 400, freqEnd: 1100, gain: .06, decay: .05 });
    },
    /** A putt's roll: its loudness follows the ball's speed (0 stops it). */
    roll(speed) {
      if (!ctx || !rollGain) return;
      const level = on ? Math.min(.16, Math.max(0, speed) * .05) : 0;
      rollGain.gain.setTargetAtTime(level, ctx.currentTime, .05);
      rollFilter.frequency.setTargetAtTime(500 + Math.min(4, speed) * 120, ctx.currentTime, .05);
    },
    /** Two soft notes for a hole played at par or better. */
    chime(good = true) {
      if (!ready()) return;
      const t = ctx.currentTime + .02;
      tone(t, { freq: 784, gain: .12, attack: .01, decay: .5 });
      tone(t + .14, { freq: good ? 988 : 880, gain: .12, attack: .01, decay: .7 });
    },
    dispose() {
      globalThis.document?.removeEventListener('visibilitychange', onVisibility);
      ctx?.close?.(); ctx = null;
    },
  };
}
