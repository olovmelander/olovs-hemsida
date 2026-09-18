import { describe, expect, it } from 'vitest';
import { curveShore } from './ring-smoothing.mjs';

const everywhere = () => true;
const area = ring => { let a = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a / 2); };
const has = (ring, p) => ring.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-9);
const distanceToSegment = (p, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
};

describe('the drawn shoreline', () => {
  it('is a curve through every surveyed vertex of a pond', () => {
    /* a 30 m pond digitised as a 14-gon: 6.7 m chords, 26 degree corners */
    const pond = Array.from({ length: 14 }, (_, i) => [Math.cos(i / 14 * Math.PI * 2) * 15, Math.sin(i / 14 * Math.PI * 2) * 15]);
    const shore = curveShore(pond, everywhere);
    expect(shore.length).toBeGreaterThan(pond.length * 2);
    for (const p of pond) expect(has(shore, p)).toBe(true);
    /* the polygon cut 38 cm inside the circle it was traced from */
    expect(Math.max(...shore.map(q => Math.abs(Math.hypot(q[0], q[1]) - 15)))).toBeLessThan(0.06);
  });

  it('leaves the shore nobody stands beside exactly as it was traced', () => {
    const lake = Array.from({ length: 40 }, (_, i) => [Math.cos(i / 40 * Math.PI * 2) * 300, Math.sin(i / 40 * Math.PI * 2) * 300]);
    const near = p => p[0] > 200;
    const shore = curveShore(lake, near);
    const far = lake.filter(p => p[0] < 150);
    for (const p of far) expect(has(shore, p)).toBe(true);
    /* no point was added on the far side */
    expect(shore.filter(q => q[0] < 150).length).toBe(far.length);
    expect(shore.filter(q => q[0] > 200).length).toBeGreaterThan(lake.filter(p => p[0] > 200).length);
  });

  it('keeps a cut edge straight and its ends sharp', () => {
    /* half a lake, closed by a 200 m chord where the extract cut it */
    const half = Array.from({ length: 21 }, (_, i) => [Math.cos(i / 20 * Math.PI) * 100, Math.sin(i / 20 * Math.PI) * 100]);
    const shore = curveShore(half, everywhere);
    /* nothing bulges across the cut, and nothing was added along it */
    expect(Math.min(...shore.map(q => q[1]))).toBeGreaterThan(-1e-9);
    expect(shore.filter(q => Math.abs(q[1]) < 1e-9).length).toBe(2);
  });

  it('takes the stairs out of a ring traced off a raster, without averaging it away', () => {
    /* a 40 m square lying at 45 degrees, traced on a 1 m lattice: four staircases */
    const stair = [];
    const leg = (x, z, dx, dz) => { for (let k = 0; k < 28; k++) { stair.push([x, z]); x += dx; stair.push([x, z]); z += dz; } return [x, z]; };
    let p = [0, 28];
    p = leg(p[0], p[1], 1, -1); p = leg(p[0], p[1], 1, 1); p = leg(p[0], p[1], -1, 1); leg(p[0], p[1], -1, -1);
    const shore = curveShore(stair, everywhere);
    /* every point of the first leg now lies on the diagonal x + z = 28.5 that the
       stairs approximated -- they stood up to 0.71 m either side of it */
    const firstLeg = shore.filter(q => q[0] > 3 && q[0] < 25 && q[1] > 3 && q[1] < 25);
    expect(firstLeg.length).toBeGreaterThan(10);
    expect(Math.max(...firstLeg.map(q => Math.abs(q[0] + q[1] - 28.5) / Math.SQRT2))).toBeLessThan(0.03);
    expect(Math.abs(area(shore) - area(stair)) / area(stair)).toBeLessThan(0.02);
    /* and it is within half a lattice step of the trace everywhere */
    let worst = 0;
    for (const q of shore) {
      let d = Infinity;
      for (let i = 0; i < stair.length; i++) d = Math.min(d, distanceToSegment(q, stair[i], stair[(i + 1) % stair.length]));
      worst = Math.max(worst, d);
    }
    expect(worst).toBeLessThan(0.75);
  });
});
