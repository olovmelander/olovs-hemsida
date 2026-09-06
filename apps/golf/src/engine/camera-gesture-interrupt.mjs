/**
 * Give an accepted OrbitControls gesture ownership of the current camera pose.
 * Three dispatches `start` before wheel zoom and before the first drag/pinch
 * movement. Listening to `change` would also cancel our own camera updates.
 *
 * The stop callbacks must honour preserveView: release flight/tour state and
 * UI without moving the camera, restoring its lens, or starting a return tween.
 * Attach only after the camera and tour state are initialized. The returned
 * disposer removes the single listener; nothing is added to the frame loop.
 */
export function bindCameraGestureInterrupt({
  controls, tween, isFlying, isTour, stopFlight, endTour,
}) {
  const onStart = () => {
    if (controls.enabled === false) return;
    tween.on = false;
    if (isTour()) endTour({ preserveView: true });
    else if (isFlying()) stopFlight({ preserveView: true });
  };
  controls.addEventListener('start', onStart);
  return () => controls.removeEventListener('start', onStart);
}
