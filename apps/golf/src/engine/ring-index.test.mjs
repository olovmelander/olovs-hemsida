import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ringSD, distToLine, inRing } from './geom.js';
import { ringSDIndexed, distToLineIndexed, inRingIndexed, INDEX_MIN_VERTICES } from './ring-index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

let seed = 7;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

/* a jagged star polygon with n vertices around (cx, cz), radius r0..r1 */
function star(n, cx, cz, r0, r1) {
  const ring = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, r = r0 + (r1 - r0) * rnd();
    ring.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return ring;
}

function forestRing() {
  const model = JSON.parse(fs.readFileSync(path.join(ROOT, 'puttombuild/course-model.json'), 'utf8'));
  const rings = model.vegetation.forest.map(f => f.ring || f).sort((a, b) => b.length - a.length);
  return rings[0];
}

/* the value the plain function returns, exactly, while inside the cutoff;
   otherwise the same sign and a magnitude of at least the cutoff */
function agree(indexed, plain, cutoff) {
  if (Math.abs(plain) < cutoff) {
    expect(indexed).toBe(plain);
  } else {
    expect(Math.sign(indexed)).toBe(Math.sign(plain));
    expect(Math.abs(indexed)).toBeGreaterThanOrEqual(cutoff);
  }
}

describe('the ring index', () => {
  it('returns ringSD exactly, inside and out, near and far, on a jagged ring', () => {
    const ring = star(160, 100, -50, 120, 400);
    for (let i = 0; i < 4000; i++) {
      const x = 100 + (rnd() * 2 - 1) * 700, z = -50 + (rnd() * 2 - 1) * 700;
      expect(ringSDIndexed(x, z, ring)).toBe(ringSD(x, z, ring));
    }
  });

  it('is exact within the cutoff and on the right side past it', () => {
    const ring = star(220, 0, 0, 300, 900);
    for (const cutoff of [1, 4, 12, 13, 50]) {
      for (let i = 0; i < 3000; i++) {
        const x = (rnd() * 2 - 1) * 1300, z = (rnd() * 2 - 1) * 1300;
        agree(ringSDIndexed(x, z, ring, cutoff), ringSD(x, z, ring), cutoff);
      }
    }
  });

  it('crosses exactly where inRing crosses, including on vertex rows', () => {
    const ring = star(90, 0, 0, 50, 200);
    for (const [x, z] of ring) {
      /* points on a vertex's own row, just off it either way */
      for (const dx of [-0.5, 0.5, 30, -30]) expect(Math.sign(ringSDIndexed(x + dx, z, ring))).toBe(inRing(x + dx, z, ring) ? -1 : 1);
    }
  });

  it("matches on Puttom's 378-vertex forest ring, the one that made the classifier slow", () => {
    const ring = forestRing();
    expect(ring.length).toBeGreaterThanOrEqual(INDEX_MIN_VERTICES);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    let inside = 0;
    for (let i = 0; i < 6000; i++) {
      const x = x0 - 200 + rnd() * (x1 - x0 + 400), z = z0 - 200 + rnd() * (z1 - z0 + 400);
      const plain = ringSD(x, z, ring);
      if (plain < 0) inside++;
      expect(ringSDIndexed(x, z, ring)).toBe(plain);
      agree(ringSDIndexed(x, z, ring, 12), plain, 12);
    }
    expect(inside).toBeGreaterThan(500);   /* the sample saw both sides */
  });

  it('is exact along the ring itself, where the distance is near zero', () => {
    const ring = star(120, 0, 0, 200, 600);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      for (const t of [0, 0.37, 0.5, 0.99]) {
        const x = a[0] + (b[0] - a[0]) * t + (rnd() - 0.5) * 0.2, z = a[1] + (b[1] - a[1]) * t + (rnd() - 0.5) * 0.2;
        expect(ringSDIndexed(x, z, ring, 12)).toBe(ringSD(x, z, ring));
      }
    }
  });

  it('leaves small rings to the plain walk', () => {
    const ring = star(12, 0, 0, 10, 20);
    expect(ring.length).toBeLessThan(INDEX_MIN_VERTICES);
    for (let i = 0; i < 200; i++) {
      const x = (rnd() * 2 - 1) * 40, z = (rnd() * 2 - 1) * 40;
      expect(ringSDIndexed(x, z, ring, 3)).toBe(ringSD(x, z, ring));
    }
  });
});

describe('the banded crossing test', () => {
  it("agrees with inRing everywhere on Puttom's water rings and a jagged star", () => {
    const model = JSON.parse(fs.readFileSync(path.join(ROOT, 'puttombuild/course-model.json'), 'utf8'));
    const rings = model.water.map(w => w.ring).filter(r => r.length >= INDEX_MIN_VERTICES);
    rings.push(star(140, 0, 0, 100, 500));
    expect(rings.length).toBeGreaterThan(1);
    for (const ring of rings) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      let inside = 0;
      for (let i = 0; i < 5000; i++) {
        const x = x0 - 20 + rnd() * (x1 - x0 + 40), z = z0 - 20 + rnd() * (z1 - z0 + 40);
        const plain = inRing(x, z, ring);
        if (plain) inside++;
        expect(inRingIndexed(x, z, ring)).toBe(plain);
      }
      /* the vertices' own rows, where an edge's half-open z-range matters */
      for (const [vx, vz] of ring) for (const dx of [-3, 3]) expect(inRingIndexed(vx + dx, vz, ring)).toBe(inRing(vx + dx, vz, ring));
      expect(inside).toBeGreaterThan(100);
    }
  });
});

describe('the line index', () => {
  it('returns distToLine exactly, and honours the cutoff', () => {
    const line = [];
    let x = 0, z = 0;
    for (let i = 0; i < 300; i++) { x += rnd() * 30; z += (rnd() - 0.5) * 40; line.push([x, z]); }
    for (let i = 0; i < 4000; i++) {
      const px = -200 + rnd() * (x + 400), pz = -400 + rnd() * 800;
      const plain = distToLine(px, pz, line);
      expect(distToLineIndexed(px, pz, line)).toBe(plain);
      agree(distToLineIndexed(px, pz, line, 3.1), plain, 3.1);
    }
  });
});
