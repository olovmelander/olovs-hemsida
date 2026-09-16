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

  it('goes round the corner when a panel owns the whole side', () => {
    /* Measured on the built app at 1440x900: the control panel stands at
       x 1210..1426, y 14..586 -- 572 px of the right-hand side -- and both
       badges landed inside it, painted behind it (z-index 18 against 20), so
       all that showed was the arrow poking past its edge. Sliding one or two
       badge-widths along that same side cannot reach past a panel that tall. */
    const desk = inset(1440, 900);
    const rail = { left: 1210, top: 14, right: 1426, bottom: 586 };
    const edge = edgePlacement({ x: 9000, y: 400, inFront: true }, desk);
    const before = { left: edge.x - half, top: edge.y - half, right: edge.x + half, bottom: edge.y + half };
    const overlapBefore = Math.max(0, Math.min(before.right, rail.right) - Math.max(before.left, rail.left))
      * Math.max(0, Math.min(before.bottom, rail.bottom) - Math.max(before.top, rail.top));
    expect(overlapBefore).toBeGreaterThan(0); // the case really is the broken one

    const moved = clearEdge(edge, [rail]);
    const overlapAfter = Math.max(0, Math.min(moved.right, rail.right) - Math.max(moved.left, rail.left))
      * Math.max(0, Math.min(moved.bottom, rail.bottom) - Math.max(moved.top, rail.top));
    expect(overlapAfter).toBe(0);
    /* and it is still on the safe box, not parked somewhere arbitrary */
    expect(moved.left).toBeGreaterThanOrEqual(desk.side - 1e-6);
    expect(moved.right).toBeLessThanOrEqual(desk.width - desk.side + 1e-6);
    expect(moved.top).toBeGreaterThanOrEqual(desk.top - 1e-6);
    expect(moved.bottom).toBeLessThanOrEqual(desk.height - desk.bottom + 1e-6);
  });

  it('accepts the least bad place when the HUD leaves nowhere clear', () => {
    /* A menu covering everything must not spin or throw; it returns a place. */
    const box = inset(390, 844);
    const everything = [{ left: -100, top: -100, right: 500, bottom: 1000 }];
    const edge = edgePlacement({ x: 4000, y: 400, inFront: true }, box);
    const moved = clearEdge(edge, everything);
    expect(Number.isFinite(moved.left) && Number.isFinite(moved.top)).toBe(true);
  });

  it('keeps its place when nothing is in the way', () => {
    const edge = edgePlacement({ x: 4000, y: 300, inFront: true }, desktop);
    const free = clearEdge(edge, []);
    expect(free.left).toBeCloseTo(edge.x - half, 5);
    expect(free.top).toBeCloseTo(edge.y - half, 5);
  });
});
