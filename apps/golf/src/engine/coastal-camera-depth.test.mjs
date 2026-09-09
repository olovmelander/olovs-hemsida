import { expect, it } from 'vitest';
import { coastalCameraNear } from './coastal-camera-depth.mjs';

it('keeps nearby views and unavailable or ineligible world bounds at the original near plane', () => {
  const base = { enabled: true, terrainCeiling: 58.06, focusDistance: 4200 };
  for (const cameraHeight of [0, 1.7, 30, 58, 122]) {
    expect(coastalCameraNear({ ...base, cameraHeight })).toBe(1);
  }
  expect(coastalCameraNear({ ...base, cameraHeight: 1600, enabled: false })).toBe(1);
  expect(coastalCameraNear({ ...base, cameraHeight: 1600, terrainCeiling: NaN })).toBe(1);
  expect(coastalCameraNear({ ...base, cameraHeight: 1600, focusDistance: 6 })).toBe(1);
});

it('fits the near rectangle above the scene, including wide views and downward camera pitches', () => {
  const terrainCeiling = 58.06;
  for (const cameraHeight of [180, 400, 1600, 4200]) for (const focusDistance of [6, 100, 2000, 4200]) {
    const near = coastalCameraNear({ enabled: true, cameraHeight, terrainCeiling, focusDistance });
    // Bounding sphere of the full near rectangle at FOV 48°, aspect <= 4.
    const nearRadius = near * Math.sqrt(1 + 17 * Math.tan(48 * Math.PI / 360) ** 2);
    expect(cameraHeight - nearRadius).toBeGreaterThan(terrainCeiling + 64);
    expect(near).toBeLessThanOrEqual(128);
    expect(near).toBeLessThan(focusDistance);
  }
});
