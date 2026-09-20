import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { decodeFlagCloth, accumulateFlagClothPose, flagClothHang } from './flag-cloth.mjs';
import { FLAG_CLOTH_ASSET } from './flag-cloth-asset.mjs';
import { createFlagMotion, stepFlagMotion, flagBandBlend, flagWindYaw, flagGustEnvelope, poseDrawnFlag } from './flag-motion.mjs';
import { FLAG_GRID, FLAG_SLEEVE_RADIUS, FLAG_POLE_PROFILE, anchorFlagHoist, createFlagGeometry } from './flag-appearance.mjs';

const cloth = await decodeFlagCloth(fs.readFileSync(new URL(`../../public/${FLAG_CLOTH_ASSET.path}`, import.meta.url)),
  async bytes => new Uint8Array(zlib.inflateRawSync(bytes)));
function pose(speed, time) {
  const b = flagBandBlend(cloth, speed), out = new Float32Array(cloth.nv * 3);
  accumulateFlagClothPose(cloth, b.lo, time, 1 - b.weight, out);
  accumulateFlagClothPose(cloth, b.hi, time, b.weight, out);
  return out;
}
const maxDelta = (a, b) => a.reduce((max, v, i) => Math.max(max, Math.abs(v - b[i])), 0);

describe('continuous flag wind', () => {
  it('crosses every baked wind speed without a pose discontinuity', () => {
    for (const b of cloth.bands) for (const t of [0, 0.7, 2, 3.99]) {
      const before = pose(b.ms - 1e-5, t), after = pose(b.ms + 1e-5, t);
      expect(maxDelta(before, after)).toBeLessThan(0.0001);
    }
    expect(pose(-5, 1)).toEqual(pose(0, 1));
    expect(pose(99, 1)).toEqual(pose(cloth.bands.at(-1).ms, 1));
    expect(pose(NaN, 1)).toEqual(pose(4, 1));
  });

  it('keeps the attachment inside the slimmer sleeve at every speed and frame', () => {
    for (let ms = 0; ms <= 12; ms += 0.25) for (let frame = 0; frame < cloth.frames; frame += 3) {
      const p = pose(ms, frame / cloth.fps);
      const shift = anchorFlagHoist(p, {});
      for (let j = 0; j < cloth.grid.nz; j++) {
        const k = j * cloth.grid.nx * 3;
        expect(Math.hypot(p[k] + shift.x, p[k + 2] + shift.z)).toBeLessThan(FLAG_SLEEVE_RADIUS);
        expect(p[k + 1]).toBeGreaterThan(2.015);
        expect(p[k + 1]).toBeLessThan(2.545);
      }
      expect([...p].every(Number.isFinite)).toBe(true);
      expect(flagClothHang(cloth, p)).toBeGreaterThanOrEqual(0);
    }
    expect(Math.max(...FLAG_POLE_PROFILE.map(p => p[0]))).toBe(0.026);
  });

  it('takes the short direction change across north and never snaps to a new bearing', () => {
    const s = createFlagMotion(1);
    stepFlagMotion(s, 0, { ms: 4, yaw: flagWindYaw(359) });
    const start = s.yaw;
    stepFlagMotion(s, 1 / 60, { ms: 4, yaw: flagWindYaw(1) });
    expect(s.yaw).toBeLessThan(start);
    expect(Math.abs(s.yaw - start)).toBeLessThan(0.001);
    for (let i = 0; i < 600; i++) stepFlagMotion(s, 1 / 60, { ms: 4, yaw: flagWindYaw(1) });
    expect(Math.abs(Math.atan2(Math.sin(s.yaw - flagWindYaw(1)), Math.cos(s.yaw - flagWindYaw(1))))).toBeLessThan(1e-5);
  });

  it('preserves the current response when repeated readings interrupt a gust', () => {
    const s = createFlagMotion(5);
    stepFlagMotion(s, 0, { ms: 2, yaw: 0 });
    for (const ms of [10, 1, 8, 0, 12, 4]) {
      const before = { ms: s.ms, yaw: s.yaw, poseTime: s.poseTime, wavePhase: s.wavePhase };
      stepFlagMotion(s, 0, { ms, yaw: Math.PI });
      for (const key of Object.keys(before)) expect(s[key]).toBe(before[key]);
      stepFlagMotion(s, 1 / 60, { ms, yaw: Math.PI });
      expect(Math.abs(s.ms - before.ms)).toBeLessThan(0.5);
    }
  });

  it('gives comparable responses at 30, 60 and 144 FPS', () => {
    const run = fps => {
      const s = createFlagMotion(7);
      stepFlagMotion(s, 0, { ms: 1, yaw: 0 });
      for (let i = 0; i < fps * 3; i++) stepFlagMotion(s, 1 / fps, { ms: 7, yaw: 2 });
      return s;
    };
    const reference = run(144);
    for (const fps of [30, 60]) {
      const s = run(fps);
      expect(Math.abs(s.ms - reference.ms)).toBeLessThan(0.01);
      expect(Math.abs(s.yaw - reference.yaw)).toBeLessThan(1e-10);
      expect(Math.abs(s.poseTime - reference.poseTime)).toBeLessThan(0.002);
    }
  });

  it('keeps gust envelopes continuous and flags independently timed', () => {
    expect(flagGustEnvelope(-1, 4)).toBe(0);
    expect(flagGustEnvelope(0, 4)).toBe(0);
    expect(flagGustEnvelope(4, 4)).toBe(0);
    expect(flagGustEnvelope(1e-5, 4)).toBeLessThan(1e-8);
    expect(flagGustEnvelope(4 - 1e-5, 4)).toBeLessThan(1e-8);
    const flags = [createFlagMotion(1), createFlagMotion(2)];
    for (let i = 0; i < 1200; i++) for (const s of flags) {
      stepFlagMotion(s, 1 / 60, { ms: 3, gust: 9, yaw: 0 });
      expect(s.ms).toBeGreaterThan(2.8); expect(s.ms).toBeLessThan(9.2);
    }
    expect(flags[0].poseTime).not.toBe(flags[1].poseTime);
    expect(flags[0].nextGust).not.toBe(flags[1].nextGust);
  });

  it('is deterministic regardless of time, frame rate, gusts or prior live state', () => {
    const a = createFlagMotion(3), b = createFlagMotion(3);
    for (let i = 0; i < 300; i++) stepFlagMotion(a, 1 / 60, { ms: 10, gust: 14, yaw: 3 });
    for (const s of [a, b]) stepFlagMotion(s, 0.1, { ms: 4.5, gust: 12, yaw: 0.7 }, true);
    for (const key of ['ms', 'yaw', 'swing', 'poseTime', 'wavePhase']) expect(a[key]).toBe(b[key]);
  });
});

describe('flag design and fallback', () => {
  it('pins the procedural hoist and fits the shared culling sphere even in calm air', () => {
    const atlas = { cols: 4, rows: 5, cellW: 256, cellH: 160, pad: 8 };
    const geo = createFlagGeometry(FLAG_GRID, atlas, 17), p = geo.attributes.position.array;
    for (const ms of [0, 1, 4, 10, 30]) for (const time of [0, 3, 30]) {
      const s = createFlagMotion(2); stepFlagMotion(s, 0, { ms, yaw: 0 }, true); s.wavePhase = time;
      poseDrawnFlag(FLAG_GRID, s, p);
      for (let j = 0; j < FLAG_GRID.nz; j++) {
        const k = j * FLAG_GRID.nx * 3;
        expect(p[k]).toBeCloseTo(FLAG_GRID.hoistX, 6);
        expect(p[k + 2]).toBeCloseTo(0, 8);
      }
      for (let k = 0; k < p.length; k += 3) {
        const c = geo.boundingSphere.center;
        expect(Math.hypot(p[k] - c.x, p[k + 1] - c.y, p[k + 2] - c.z)).toBeLessThan(geo.boundingSphere.radius);
      }
      geo.computeVertexNormals();
      expect([...geo.attributes.normal.array].every(Number.isFinite)).toBe(true);
    }
    geo.dispose();
  });

  it('maps each number to its own padded atlas cell with cloth UVs independent of the number', () => {
    const atlas = { cols: 4, rows: 5, cellW: 256, cellH: 160, pad: 8 };
    const first = createFlagGeometry(FLAG_GRID, atlas, 0), last = createFlagGeometry(FLAG_GRID, atlas, 17);
    expect(first.attributes.flagUv.array).toEqual(last.attributes.flagUv.array);
    expect(first.attributes.uv.array).not.toEqual(last.attributes.uv.array);
    for (const geo of [first, last]) for (const n of geo.attributes.uv.array) {
      expect(n).toBeGreaterThan(0); expect(n).toBeLessThan(1);
    }
    first.dispose(); last.dispose();
  });
});
