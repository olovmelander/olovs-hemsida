import { describe, expect, it } from 'vitest';
import { createCameraBreathing } from './camera-breathing.mjs';

const degrees = 180 / Math.PI;
function advance(breathing, seconds, fps = 60, options) {
  let angles;
  for (let i = 0; i < Math.round(seconds * fps); i++) angles = breathing.step(1 / fps, options);
  return { ...angles };
}

describe('camera breathing', () => {
  it('stays bounded over a long idle, with smooth motion in both directions', () => {
    const breathing = createCameraBreathing();
    let previous = { pitch: 0, yaw: 0 }, minPitch = 0, maxPitch = 0, minYaw = 0, maxYaw = 0;
    for (let i = 0; i < 60 * 120; i++) {
      const current = breathing.step(1 / 60);
      expect(Math.abs(current.pitch) * degrees).toBeLessThanOrEqual(0.45);
      expect(Math.abs(current.yaw) * degrees).toBeLessThanOrEqual(0.18);
      expect(Math.abs(current.pitch - previous.pitch) * degrees).toBeLessThan(0.012);
      expect(Math.abs(current.yaw - previous.yaw) * degrees).toBeLessThan(0.004);
      minPitch = Math.min(minPitch, current.pitch * degrees);
      maxPitch = Math.max(maxPitch, current.pitch * degrees);
      minYaw = Math.min(minYaw, current.yaw * degrees);
      maxYaw = Math.max(maxYaw, current.yaw * degrees);
      previous = { ...current };
    }
    expect(minPitch).toBeLessThan(-0.44);
    expect(maxPitch).toBeGreaterThan(0.44);
    expect(minYaw).toBeLessThan(-0.17);
    expect(maxYaw).toBeGreaterThan(0.17);
  });

  it('runs at the same pace across frame rates', () => {
    const slow = advance(createCameraBreathing(), 12, 30);
    const fast = advance(createCameraBreathing(), 12, 144);
    expect(slow.pitch).toBeCloseTo(fast.pitch, 12);
    expect(slow.yaw).toBeCloseTo(fast.yaw, 12);
  });

  it('fades out during input and eases back when idle', () => {
    const breathing = createCameraBreathing();
    advance(breathing, 10);
    const quiet = advance(breathing, 2, 60, { active: false });
    expect(Math.abs(quiet.pitch) * degrees).toBeLessThan(0.000025);
    expect(Math.abs(quiet.yaw) * degrees).toBeLessThan(0.00001);
    const first = breathing.step(1 / 60);
    expect(Math.abs(first.pitch) * degrees).toBeLessThan(0.009);
    const resumed = advance(breathing, 5);
    expect(Math.abs(resumed.pitch) * degrees).toBeGreaterThan(0.02);
  });

  it('holds off after a wheel gesture that ends between frames', () => {
    const breathing = createCameraBreathing();
    breathing.pause();
    expect(advance(breathing, 0.75)).toEqual({ pitch: 0, yaw: 0 });
    expect(advance(breathing, 1).pitch).not.toBe(0);
  });

  it('disables immediately and restarts gently without a stale offset', () => {
    const breathing = createCameraBreathing();
    advance(breathing, 10);
    expect(breathing.step(1 / 60, { enabled: false })).toEqual({ pitch: 0, yaw: 0 });
    expect(advance(breathing, 2, 60, { enabled: false })).toEqual({ pitch: 0, yaw: 0 });
    const first = breathing.step(1 / 60);
    expect(Math.abs(first.pitch) * degrees).toBeLessThan(0.001);
    expect(Math.abs(first.yaw) * degrees).toBeLessThan(0.001);
  });

  it('bounds the motion step after a long frame', () => {
    const delayed = createCameraBreathing(), normal = createCameraBreathing();
    advance(delayed, 2);
    advance(normal, 2);
    expect(delayed.step(60)).toEqual(normal.step(0.1));
  });
});
