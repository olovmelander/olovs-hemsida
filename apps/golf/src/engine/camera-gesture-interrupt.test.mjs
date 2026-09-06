import { describe, expect, it, vi } from 'vitest';
import { EventDispatcher, PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { bindCameraGestureInterrupt } from './camera-gesture-interrupt.mjs';

// Run the installed OrbitControls event path, with only its DOM surface stubbed.
// This guards the ordering relied on by the app without requiring a GPU.
function fixture({ tweening = true, flying = false, tour = false } = {}) {
  const document = new EventDispatcher();
  const element = new EventDispatcher();
  Object.assign(element, {
    ownerDocument: document, style: {}, clientWidth: 800, clientHeight: 600,
    getRootNode: () => document,
    setPointerCapture() {}, releasePointerCapture() {},
  });
  const camera = new PerspectiveCamera(52, 4 / 3, 1, 14000);
  camera.position.set(0, 10, 30);
  const controls = new OrbitControls(camera, element);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  const tween = { on: tweening };
  const state = { flying, tour };
  const stopFlight = vi.fn(({ preserveView = false } = {}) => {
    state.flying = false;
    if (!preserveView) camera.fov = 48;
  });
  const endTour = vi.fn(options => {
    state.tour = false;
    stopFlight(options);
    if (!options?.preserveView) tween.on = true;
  });
  const unbind = bindCameraGestureInterrupt({
    controls, tween, isFlying: () => state.flying, isTour: () => state.tour,
    stopFlight, endTour,
  });
  const dispatch = (target, type, props = {}) => target.dispatchEvent({
    type, pointerId: 1, pointerType: 'mouse', button: 0,
    clientX: 100, clientY: 100, pageX: 100, pageY: 100,
    preventDefault() {}, ...props,
  });
  return { camera, controls, tween, state, stopFlight, endTour, unbind,
    down: props => dispatch(element, 'pointerdown', props),
    move: props => dispatch(document, 'pointermove', props),
    up: props => dispatch(document, 'pointerup', props),
    wheel: props => dispatch(element, 'wheel', { deltaY: -100, deltaMode: 0, ...props }),
    dispose() { unbind(); controls.dispose(); },
  };
}

describe('camera gesture interruption', () => {
  it('cancels a transition before a mouse drag changes the camera', () => {
    const f = fixture();
    const position = f.camera.position.clone(), target = f.controls.target.clone();
    f.down();
    expect(f.tween.on).toBe(false);
    expect(f.camera.position.equals(position)).toBe(true);
    expect(f.controls.target.equals(target)).toBe(true);
    f.move({ clientX: 150 });
    expect(f.camera.position.distanceTo(position)).toBeGreaterThan(0);
    expect(f.endTour).not.toHaveBeenCalled();
    expect(f.stopFlight).not.toHaveBeenCalled();
    f.dispose();
  });

  it('hands wheel zoom the current flight pose and lens before zoom is applied', () => {
    const f = fixture({ flying: true });
    const initialDistance = f.camera.position.distanceTo(f.controls.target);
    const distances = [];
    f.controls.addEventListener('start', () => {
      distances.push(f.camera.position.distanceTo(f.controls.target));
      expect(f.state.flying).toBe(false);
      expect(f.tween.on).toBe(false);
    });
    f.wheel();
    expect(distances).toEqual([initialDistance]);
    expect(f.camera.position.distanceTo(f.controls.target)).toBeLessThan(initialDistance);
    expect(f.camera.fov).toBe(52);
    expect(f.stopFlight).toHaveBeenCalledExactlyOnceWith({ preserveView: true });
    expect(f.endTour).not.toHaveBeenCalled();
    f.dispose();
  });

  it('ends a tour once on touch start without starting a return tween', () => {
    const f = fixture({ flying: true, tour: true });
    const position = f.camera.position.clone();
    f.down({ pointerType: 'touch' });
    expect(f.state).toEqual({ flying: false, tour: false });
    expect(f.tween.on).toBe(false);
    expect(f.camera.position.equals(position)).toBe(true);
    expect(f.camera.fov).toBe(52);
    expect(f.endTour).toHaveBeenCalledExactlyOnceWith({ preserveView: true });
    expect(f.stopFlight).toHaveBeenCalledTimes(1);
    // A second finger starts pinch handling; lifting it starts one-finger
    // handling again. Neither may replay tour cleanup or restore a camera view.
    f.down({ pointerType: 'touch', pointerId: 2, pageX: 180 });
    const distance = f.camera.position.distanceTo(f.controls.target);
    f.move({ pointerType: 'touch', pointerId: 2, pageX: 210 });
    expect(f.camera.position.distanceTo(f.controls.target)).toBeLessThan(distance);
    f.up({ pointerType: 'touch', pointerId: 2 });
    expect(f.endTour).toHaveBeenCalledTimes(1);
    expect(f.stopFlight).toHaveBeenCalledTimes(1);
    expect(f.tween.on).toBe(false);
    f.dispose();
  });

  it('leaves a settled or instant/reduced-motion camera alone on touch start', () => {
    const f = fixture({ tweening: false });
    const position = f.camera.position.clone(), target = f.controls.target.clone();
    f.down({ pointerType: 'touch' });
    expect(f.tween.on).toBe(false);
    expect(f.camera.position.equals(position)).toBe(true);
    expect(f.controls.target.equals(target)).toBe(true);
    expect(f.stopFlight).not.toHaveBeenCalled();
    expect(f.endTour).not.toHaveBeenCalled();
    f.dispose();
  });

  it('does not interrupt from programmatic camera changes or damped updates', () => {
    const f = fixture({ flying: true });
    f.camera.position.x += 2;
    f.controls.update();
    f.controls.dispatchEvent({ type: 'change' });
    expect(f.tween.on).toBe(true);
    expect(f.state.flying).toBe(true);
    expect(f.stopFlight).not.toHaveBeenCalled();
    f.dispose();
  });

  it('ignores input while controls are disabled', () => {
    const f = fixture({ flying: true, tour: true });
    f.controls.enabled = false;
    f.down();
    f.wheel();
    expect(f.tween.on).toBe(true);
    expect(f.state).toEqual({ flying: true, tour: true });
    expect(f.endTour).not.toHaveBeenCalled();
    f.dispose();
  });

  it('ignores unsupported buttons and disabled drag/zoom actions', () => {
    for (const action of ['button', 'rotate', 'zoom']) {
      const f = fixture();
      if (action === 'button') f.down({ button: 4 });
      if (action === 'rotate') { f.controls.enableRotate = false; f.down(); }
      if (action === 'zoom') { f.controls.enableZoom = false; f.wheel(); }
      expect(f.tween.on).toBe(true);
      f.dispose();
    }
  });

  it('stops listening when disposed', () => {
    const f = fixture({ flying: true });
    f.unbind();
    f.wheel();
    expect(f.tween.on).toBe(true);
    expect(f.state.flying).toBe(true);
    expect(f.stopFlight).not.toHaveBeenCalled();
    f.dispose();
  });
});
