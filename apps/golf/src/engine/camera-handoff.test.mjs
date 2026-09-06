import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { EventDispatcher, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { bindCameraGestureInterrupt } from './camera-gesture-interrupt.mjs';

const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
function declaration(name) {
  const start = main.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Missing application camera function ${name}`);
  const end = main.indexOf('\n}', start);
  if (end < 0) throw new Error(`Unterminated application camera function ${name}`);
  return main.slice(start, end + 2);
}

function classList(...initial) {
  const names = new Set(initial);
  return {
    remove: name => names.delete(name), contains: name => names.has(name),
    toggle(name, on) { if (on) names.add(name); else names.delete(name); },
  };
}

// Execute the real application's camera functions together. Only unrelated
// terrain/UI dependencies are stubbed; flight cleanup and lens/tween ownership
// must be proved here rather than represented by helper callback spies.
function fixture({ tour = false, reducedMotion = false, flying = true } = {}) {
  const camera = new PerspectiveCamera(46, 4 / 3, 1, 14000);
  camera.position.set(11, 17, 23);
  vi.spyOn(camera, 'updateProjectionMatrix');
  const controls = new EventDispatcher();
  controls.target = new Vector3(0, 3, 72);
  controls.enabled = true;
  const camTween = {
    on: true, t: 0.3, dur: 1.5, from: new Vector3(), to: new Vector3(),
    lookFrom: new Vector3(), lookTo: new Vector3(),
  };
  const card = { classList: classList('show') };
  const body = { classList: classList(...(tour ? ['tour', 'clean'] : [])) };
  const state = {
    camera, controls, camTween, flying: flying ? 0.4 : 0, tour: tour ? 1 : 0,
    heldFlightLens: false,
    tourFlight: { st: { n: 3 }, cardPending: true, baseFov: 48 },
    document: { body, getElementById: () => card, querySelectorAll: () => [] },
    window: {}, groundClamp: { reset: vi.fn() },
    setClean: on => body.classList.toggle('clean', on), syncURL: vi.fn(),
    V3: (x, y, z) => new Vector3(x, y, z),
    HOLES: [{ tees: { marks: [{ c: [0, 0] }] }, line: [[0, 0], [0, 100]], pin: [0, 100] }],
    hole: 1, teeIdx: 0, camMode: 'tee', RMOTION: reducedMotion,
    terrainH: () => 0, alongLine: (_line, t) => ({ x: 0, z: 100 * t, b: 0 }),
    polyLen: () => 100,
  };
  runInNewContext(['flyTo', 'setCam', 'stopFlight', 'endTour'].map(declaration).join('\n'), state);
  const unbind = bindCameraGestureInterrupt({
    controls, tween: camTween, isFlying: () => state.flying > 0,
    isTour: () => Boolean(state.tour), stopFlight: state.stopFlight, endTour: state.endTour,
  });
  return { state, camera, controls, camTween, card, body, unbind,
    gesture: () => controls.dispatchEvent({ type: 'start' }),
  };
}

describe('application camera handoff', () => {
  it.each([
    { tour: false, label: 'standalone flight' },
    { tour: true, label: 'tour' },
  ])('preserves position, target and lens when taking over a $label', ({ tour }) => {
    const f = fixture({ tour });
    const position = f.camera.position.clone(), target = f.controls.target.clone();
    f.gesture();
    expect(f.camera.position.equals(position)).toBe(true);
    expect(f.controls.target.equals(target)).toBe(true);
    expect(f.camera.fov).toBe(46);
    expect(f.camera.updateProjectionMatrix).not.toHaveBeenCalled();
    expect(f.state.flying).toBe(0);
    expect(f.state.tour).toBe(0);
    expect(f.camTween.on).toBe(false);
    expect(f.state.tourFlight.st).toBeNull();
    expect(f.state.tourFlight.cardPending).toBe(false);
    expect(f.card.classList.contains('show')).toBe(false);
    expect(f.body.classList.contains('tour')).toBe(false);
    expect(f.body.classList.contains('clean')).toBe(false);
    expect(f.state.heldFlightLens).toBe(true);
    f.gesture();
    expect(f.camTween.on).toBe(false);
    expect(f.camera.fov).toBe(46);
    f.unbind();
  });

  it('restores player framing on the next explicit view after gesture takeover', () => {
    const f = fixture({ tour: true });
    f.gesture();
    f.state.setCam('tee');
    expect(f.camera.fov).toBe(48);
    expect(f.camera.updateProjectionMatrix).toHaveBeenCalledTimes(1);
    expect(f.state.heldFlightLens).toBe(false);
    expect(f.camTween.on).toBe(true);
    expect(f.camTween.to.toArray()).toEqual([0, 2.4, -7]);
    expect(f.camTween.lookTo.toArray()).toEqual([0, 3, 72]);
    // Once the held lens is released, explicitly selected/custom lens values
    // keep the pre-existing setCam behaviour (including V3D.setFov callers).
    f.camera.fov = 57;
    f.state.setCam('tee');
    expect(f.camera.fov).toBe(57);
    expect(f.camera.updateProjectionMatrix).toHaveBeenCalledTimes(1);
    f.unbind();
  });

  it('keeps an explicit stop restoring the player lens', () => {
    const f = fixture();
    f.state.stopFlight();
    expect(f.state.flying).toBe(0);
    expect(f.camera.fov).toBe(48);
    expect(f.camera.updateProjectionMatrix).toHaveBeenCalledTimes(1);
    expect(f.state.heldFlightLens).toBe(false);
    expect(f.card.classList.contains('show')).toBe(false);
    f.unbind();
  });

  it('keeps explicit tour exit returning to the selected view', () => {
    const f = fixture({ tour: true });
    f.state.endTour();
    expect(f.state.tour).toBe(0);
    expect(f.state.flying).toBe(0);
    expect(f.camera.fov).toBe(48);
    expect(f.camTween.on).toBe(true);
    expect(f.camTween.to.toArray()).toEqual([0, 2.4, -7]);
    expect(f.body.classList.contains('tour')).toBe(false);
    expect(f.body.classList.contains('clean')).toBe(false);
    f.unbind();
  });

  it.each([
    { reducedMotion: true, instant: false },
    { reducedMotion: false, instant: true },
  ])('does not introduce a tween for a reduced-motion/instant view: %j', options => {
    const f = fixture(options);
    f.gesture();
    f.state.setCam('tee', options.instant);
    expect(f.camera.fov).toBe(48);
    expect(f.camera.position.toArray()).toEqual([0, 2.4, -7]);
    expect(f.controls.target.toArray()).toEqual([0, 3, 72]);
    expect(f.camTween.on).toBe(false);
    f.gesture();
    expect(f.camTween.on).toBe(false);
    expect(f.camera.position.toArray()).toEqual([0, 2.4, -7]);
    f.unbind();
  });
});
