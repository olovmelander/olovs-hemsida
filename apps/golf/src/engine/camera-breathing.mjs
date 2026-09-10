/* A small change in gaze, with a relaxed breath and a slower sideways sway.
   Angles are local to the camera and never change its navigation position,
   target or lens. Apply them after controls/flight rebuild the base orientation
   each frame, so the motion cannot accumulate into a drifting view. */
export function createCameraBreathing() {
  let elapsed = 0, strength = 0, quietTime = 0;
  const angles = { pitch: 0, yaw: 0 };
  const radians = Math.PI / 180;
  return {
    // A wheel gesture can start and end between frames. Keep its damping quiet.
    pause() { quietTime = 0.8; },
    step(dt, { enabled = true, active = true } = {}) {
      if (!enabled) {
        elapsed = 0;
        strength = 0;
        angles.pitch = angles.yaw = 0;
        return angles;
      }
      const seconds = Math.max(0, Math.min(0.1, dt));
      elapsed += seconds;
      quietTime = Math.max(0, quietTime - seconds);
      active = active && quietTime === 0;
      // Ease back in after a gesture or view transition; yield to input quickly.
      strength += ((active ? 1 : 0) - strength) * -Math.expm1(-seconds / (active ? 0.9 : 0.2));
      const phase = elapsed * Math.PI * 2 / 5.5;
      // About 16 px of vertical travel at a 900 px viewport and the 48° lens:
      // readable against the treeline without turning the breath into a bob.
      angles.pitch = Math.sin(phase) * 0.45 * radians * strength;
      angles.yaw = Math.sin(phase * 0.61) * 0.18 * radians * strength;
      return angles;
    },
  };
}
