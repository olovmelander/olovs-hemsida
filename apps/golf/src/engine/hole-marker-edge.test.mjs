import { describe, expect, it } from 'vitest';
import { BADGE, clearEdge, edgePlacement, inset } from './hole-marker-edge.mjs';

/* A phone held upright, which is the shape the redesign is for. */
const phone = inset(390, 844);
const desktop = inset(1440, 900);
const centre = box => ({ x: box.width / 2, y: box.height / 2 });
const half = BADGE / 2;

/* The angle the arrow is drawn at, as a compass-free screen direction: 0 is
   right, 90 is down, 180 is left, -90 is up. */
const bearing = angle => ((angle % 360) + 360) % 360;

describe('off-screen hole marker', () => {
  it('leaves the safe box on the side the target lies on', () => {
    const c = centre(phone);
    const right = edgePlacement({ x: c.x + 4000, y: c.y, inFront: true }, phone);
    expect(right.vertical).toBe(true);
    expect(right.x).toBeCloseTo(phone.width - phone.side - half, 5);
    expect(right.y).toBeCloseTo(c.y, 5);
    expect(bearing(right.angle)).toBeCloseTo(0, 5);

    const up = edgePlacement({ x: c.x, y: c.y - 4000, inFront: true }, phone);
    expect(up.vertical).toBe(false);
    expect(up.y).toBeCloseTo(phone.top + half, 5);
    expect(bearing(up.angle)).toBeCloseTo(270, 5);
  });

  it('never places the badge under the hole card or the quick actions', () => {
    /* The whole point of the change: the old marker docked to the bottom centre
       and sat on the course. Every direction must land inside the safe box. */
    for (const box of [phone, desktop]) {
      const c = centre(box);
      for (let degrees = 0; degrees < 360; degrees += 5) {
        const radians = degrees * Math.PI / 180;
        const p = { x: c.x + Math.cos(radians) * 5000, y: c.y + Math.sin(radians) * 5000, inFront: true };
        const edge = edgePlacement(p, box);
        expect(edge.x).toBeGreaterThanOrEqual(box.side + half - 1e-6);
        expect(edge.x).toBeLessThanOrEqual(box.width - box.side - half + 1e-6);
        expect(edge.y).toBeGreaterThanOrEqual(box.top + half - 1e-6);
        expect(edge.y).toBeLessThanOrEqual(box.height - box.bottom - half + 1e-6);
      }
    }
  });

  it('points AT a target behind the camera, not away from it', () => {
    /* A perspective projection mirrors a point behind the eye through the
       centre of the screen. Believing those coordinates sends the arrow to the
       opposite edge -- wrong by 180 degrees exactly when the player has turned
       round and the arrow is the only thing telling them where the flag went. */
    const c = centre(phone);
    const ahead = { x: c.x + 300, y: c.y + 120, inFront: true };
    const behind = { x: ahead.x, y: ahead.y, inFront: false };
    const forward = edgePlacement(ahead, phone), backward = edgePlacement(behind, phone);
    expect(Math.abs(bearing(forward.angle - backward.angle) - 180)).toBeLessThan(1e-6);
    expect(forward.x).toBeGreaterThan(c.x);
    expect(backward.x).toBeLessThan(c.x);
  });

  it('holds a direction rather than dividing by zero at the exact centre', () => {
    const c = centre(desktop);
    const edge = edgePlacement({ x: c.x, y: c.y, inFront: true }, desktop);
    expect(Number.isFinite(edge.x)).toBe(true);
    expect(Number.isFinite(edge.y)).toBe(true);
    expect(Number.isFinite(edge.angle)).toBe(true);
  });

  it('slides along its own edge to clear the other badge, and stays on that edge', () => {
    const c = centre(phone);
    const edge = edgePlacement({ x: c.x, y: c.y + 4000, inFront: true }, phone);
    const taken = { left: edge.x - half, top: edge.y - half, right: edge.x + half, bottom: edge.y + half };
    const moved = clearEdge(edge, [taken]);
    /* It moved off the tee's badge... */
    expect(Math.max(0, Math.min(moved.right, taken.right) - Math.max(moved.left, taken.left))).toBe(0);
    /* ...along the bottom edge, which is the one it belongs to. */
    expect(moved.top).toBeCloseTo(edge.y - half, 5);
    expect(moved.left).toBeGreaterThanOrEqual(phone.side - 1e-6);
    expect(moved.right).toBeLessThanOrEqual(phone.width - phone.side + 1e-6);
  });

  it('keeps its place when nothing is in the way', () => {
    const edge = edgePlacement({ x: 4000, y: 300, inFront: true }, desktop);
    const free = clearEdge(edge, []);
    expect(free.left).toBeCloseTo(edge.x - half, 5);
    expect(free.top).toBeCloseTo(edge.y - half, 5);
  });
});
