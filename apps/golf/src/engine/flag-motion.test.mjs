import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { decodeFlagCloth, sampleFlagCloth, flagClothHang } from './flag-cloth.mjs';
import { FLAG_CLOTH_ASSET } from './flag-cloth-asset.mjs';
import { createFlagMotion, stepFlagMotion, flagBandBlend, flagWindYaw, flagGustEnvelope, poseDrawnFlag, turnFlagCloth } from './flag-motion.mjs';
import { FLAG_GRID, FLAG_SLEEVE_RADIUS, FLAG_POLE_PROFILE, anchorFlagHoist, clearFlagPole, createFlagGeometry } from './flag-appearance.mjs';

const cloth = await decodeFlagCloth(fs.readFileSync(new URL(`../../public/${FLAG_CLOTH_ASSET.path}`, import.meta.url)),
  async bytes => new Uint8Array(zlib.inflateRawSync(bytes)));
function pose(speed, time) {
  const b = flagBandBlend(cloth, speed), out = new Float32Array(cloth.nv * 3);
  return sampleFlagCloth(cloth, b, time, out);
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
    let nearestFreeVertex = Infinity, maxHoistRadius=0, minHoistY=Infinity, maxHoistY=-Infinity;
    for (let ms = 0; ms <= 28; ms += 0.5) for (let frame = 0; frame < cloth.frames; frame += 3) {
      const p = pose(ms, frame / cloth.fps + 0.01);
      clearFlagPole(cloth.grid, p);
      const shift = anchorFlagHoist(p, {});
      for (let j = 0; j < cloth.grid.nz; j++) {
        const k = j * cloth.grid.nx * 3;
        maxHoistRadius=Math.max(maxHoistRadius,Math.hypot(p[k]+shift.x,p[k+2]+shift.z));
        minHoistY=Math.min(minHoistY,p[k+1]); maxHoistY=Math.max(maxHoistY,p[k+1]);
        for (let i = 1; i < cloth.grid.nx; i++) {
          const v = k + i * 3;
          if (p[v+1] <= 2.6) nearestFreeVertex = Math.min(nearestFreeVertex, Math.hypot(p[v]+shift.x,p[v+2]+shift.z));
        }
      }
      expect([...p].every(Number.isFinite)).toBe(true);
      expect(flagClothHang(cloth, p)).toBeGreaterThanOrEqual(0);
    }
    expect(Math.max(...FLAG_POLE_PROFILE.map(p => p[0]))).toBe(0.026);
    expect(maxHoistRadius).toBeLessThan(FLAG_SLEEVE_RADIUS);
    expect(minHoistY).toBeGreaterThan(2.015); expect(maxHoistY).toBeLessThan(2.545);
    expect(nearestFreeVertex).toBeGreaterThan(FLAG_SLEEVE_RADIUS + 0.0009);
  }, 15000);

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
      // Airflow and sleeve response are coupled; below 0.12 degrees across FPS.
      expect(Math.abs(s.yaw - reference.yaw)).toBeLessThan(0.002);
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
    for (const key of ['ms', 'yaw', 'swing', 'tailYaw', 'poseTime', 'wavePhase']) expect(a[key]).toBe(b[key]);
  });

  it('preserves fabric area when adjacent winds have opposing folds', () => {
    const {nx,nz,width,height}=cloth.grid;
    let smallest=Infinity;
    for(const ms of [1.5,2.75,4.5,6,7.5,8.5,12,20]) for(const time of [0,1.2,3.8117,5.4117]) {
      const p=pose(ms,time); let area=0;
      for(let j=1;j<nz;j++) for(let i=1;i<nx;i++) {
        const k=(j*nx+i)*3;
        for(const [a,b,c] of [[k,k-3,k-3*nx],[k-3,k-3-3*nx,k-3*nx]]) {
          const ax=p[b]-p[a],ay=p[b+1]-p[a+1],az=p[b+2]-p[a+2];
          const bx=p[c]-p[a],by=p[c+1]-p[a+1],bz=p[c+2]-p[a+2];
          area+=Math.hypot(ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx)/2;
        }
      }
      smallest=Math.min(smallest,area/(width*height));
    }
    // The former position crossfade collapsed the 2.75 m/s pose to 32%.
    expect(smallest).toBeGreaterThan(0.96);
  });

  it('lets the fly lag a reversal while keeping every hoist vertex fixed, then settles', () => {
    const s = createFlagMotion(1);
    stepFlagMotion(s, 0, { ms: 5, yaw: 0 });
    for (let i = 0; i < 30; i++) stepFlagMotion(s, 1/60, { ms: 5, yaw: Math.PI });
    expect(s.tailYaw).toBeLessThan(-0.1);
    const original = pose(s.ms, s.poseTime), turned = turnFlagCloth(cloth.grid, s, original.slice());
    expect(maxDelta(original, turned)).toBeGreaterThan(0.01);
    for (let j = 0; j < cloth.grid.nz; j++) {
      const k = j * cloth.grid.nx * 3;
      expect(turned.slice(k,k+3)).toEqual(original.slice(k,k+3));
    }
    for (let i = 0; i < 900; i++) stepFlagMotion(s, 1/60, { ms: 5, yaw: Math.PI });
    expect(Math.abs(s.tailYaw)).toBeLessThan(1e-5);
  });

  it('leaves calm cloth facing where it settled and bounds storm response', () => {
    const s = createFlagMotion(2);
    stepFlagMotion(s, 0, { ms: 0, yaw: 0.5 });
    const calmPhase=s.poseTime;
    for (let i = 0; i < 180; i++) stepFlagMotion(s, 1/60, { ms: 0, yaw: -2 });
    expect(s.yaw).toBe(0.5); expect(s.tailYaw).toBe(0);
    expect(s.poseTime).toBe(calmPhase);
    for (let i = 0; i < 180; i++) stepFlagMotion(s, 1/60, { ms: 40, gust: 50, yaw: -2 });
    expect(Number.isFinite(s.poseTime)).toBe(true);
    expect(Math.abs(s.tailYaw)).toBeLessThanOrEqual(0.28);
    const b = flagBandBlend(cloth, s.ms);
    expect(b.weight).toBe(1); expect(b.hi).toBe(cloth.bands.length-1);
  });

  it('unloads a reversing wind before the cloth fills in the other direction', () => {
    const s=createFlagMotion(1);
    stepFlagMotion(s,0,{ms:8,yaw:0});
    let minimum=8;
    for(let i=0;i<60;i++) { stepFlagMotion(s,1/60,{ms:8,yaw:Math.PI}); minimum=Math.min(minimum,s.ms); }
    expect(minimum).toBeLessThan(0.5);
    for(let i=0;i<600;i++) stepFlagMotion(s,1/60,{ms:8,yaw:Math.PI});
    expect(s.ms).toBeGreaterThan(7.6);
    expect(Math.abs(Math.atan2(Math.sin(s.yaw-Math.PI),Math.cos(s.yaw-Math.PI)))).toBeLessThan(0.001);
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
