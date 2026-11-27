import { describe, expect, it } from 'vitest';
import { EventDispatcher, PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createGroundClamp, GROUND_CLAMP } from '../engine/camera-clamp.mjs';
import { SHORTCUT_ROWS } from '../engine/keyboard-shortcuts.mjs';
import {
  MOVE_KEYS, NAVIGATION, NAVIGATION_HINT, NAVIGATION_ROWS,
  createCameraNavigation, cursorRay, installCameraNavigation, pickGround, viewBasis,
} from './camera-navigation.mjs';

/* The mouse and the keyboard in the detailed course (ui/camera-navigation.mjs),
   against the installed OrbitControls and the real ground clamp, in main.js's
   frame order: the navigation's step, the controls' update, the clamp. Three's
   own projection says where a point is drawn, so the module's ray maths is
   checked by something other than itself. */

const W = 1600, H = 900, EYE = GROUND_CLAMP.eye;

function rig({ ground = () => 0, position = [0, 40, 80], target = [0, 0, 0], still = false, clamp = false } = {}) {
  const document = new EventDispatcher(), element = new EventDispatcher();
  Object.assign(element, { ownerDocument: document, style: {}, clientWidth: W, clientHeight: H,
    getRootNode: () => document, setPointerCapture() {}, releasePointerCapture() {} });
  const camera = new PerspectiveCamera(48, W / H, 1, 14000);
  camera.position.set(...position);
  const controls = new OrbitControls(camera, element);
  controls.enableDamping = true; controls.dampingFactor = 0.055;
  controls.maxPolarAngle = Math.PI - 0.08; controls.minDistance = 1.8; controls.maxDistance = 4200;
  controls.target.set(...target);
  controls.update();
  const state = { still };
  const nav = createCameraNavigation({ camera, controls, groundAt: ground, eye: EYE,
    viewport: () => ({ left: 0, top: 0, width: W, height: H }), still: () => state.still });
  const groundClamp = clamp ? createGroundClamp({ heightAt: ground }) : null;
  const frame = (dt = 1 / 60) => { nav.step(dt); controls.update(); groundClamp?.step(camera.position, dt); nav.remember(); };
  const run = (seconds, dt = 1 / 60) => { for (let i = 0, n = Math.round(seconds / dt); i < n; i++) frame(dt); };
  const screen = p => {
    camera.updateMatrixWorld(true);
    const v = new Vector3(p.x, p.y, p.z).project(camera);
    return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H };
  };
  const groundUnder = (x, y) => {
    const basis = viewBasis(camera.position, controls.target, camera.quaternion);
    return pickGround(camera.position, cursorRay(basis, x / W * 2 - 1, 1 - y / H * 2, Math.tan(camera.fov * Math.PI / 360), camera.aspect), ground);
  };
  const heading = () => { const f = viewBasis(camera.position, controls.target).f; return Math.atan2(f.x, -f.z); };
  const above = () => camera.position.y - ground(camera.position.x, camera.position.z);
  return { camera, controls, nav, state, groundClamp, frame, run, screen, groundUnder, heading, above };
}

describe('the ray through the picture', () => {
  it('agrees with three about where a point is drawn', () => {
    const r = rig({ position: [30, 25, 60], target: [-10, 2, -40] });
    for (const [x, y] of [[800, 450], [200, 700], [1500, 120], [40, 880]]) {
      const hit = r.groundUnder(x, y);
      if (!hit) continue;
      const at = r.screen(hit);
      expect(Math.hypot(at.x - x, at.y - y)).toBeLessThan(0.05);
    }
    expect(r.groundUnder(800, 800)).not.toBeNull();
  });

  it('keeps a level right-hand axis looking straight down, from the camera itself', () => {
    const b = viewBasis({ x: 0, y: 100, z: 0 }, { x: 0, y: 0, z: 0 }, { x: -Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 });
    expect(b.r.x).toBeCloseTo(1, 12); expect(b.r.y).toBe(0); expect(b.r.z).toBeCloseTo(0, 12);
    expect(b.f.y).toBe(-1);
  });

  it('finds the first ground a ray meets, and none in the sky or from under it', () => {
    const hill = (x, z) => 20 * Math.exp(-((z + 100) ** 2) / 800);
    const hit = pickGround({ x: 0, y: 5, z: 0 }, { x: 0, y: 0, z: -1 }, hill);
    expect(hill(hit.x, hit.z)).toBeCloseTo(5, 2);
    expect(hit.z).toBeGreaterThan(-100);   /* the near slope, not the far one */
    expect(pickGround({ x: 0, y: 5, z: 0 }, { x: 0, y: 0.6, z: -0.8 }, () => 0)).toBeNull();
    expect(pickGround({ x: 0, y: -1, z: 0 }, { x: 0, y: -1, z: 0 }, () => 0)).toBeNull();
    let samples = 0;
    pickGround({ x: 0, y: 2, z: 0 }, { x: 0, y: -0.0003, z: -1 }, () => { samples++; return 0; }, { max: 6000 });
    expect(samples).toBeLessThan(400);
  });
});

describe('a left drag', () => {
  it('turns the world round the ground it took hold of, which stays under the cursor', () => {
    const r = rig();
    const grabbed = r.groundUnder(1000, 600);
    r.nav.pointerDown({ button: 0, x: 1000, y: 600 });
    expect(r.nav.state().drag.swing).toBe(1);
    const start = r.heading(), from = r.camera.position.clone();
    r.nav.pointerMove({ x: 1240, y: 520, now: 500 });
    r.run(0.5);
    const at = r.screen(grabbed);
    expect(Math.hypot(at.x - 1000, at.y - 600)).toBeLessThan(0.5);
    /* 240 px at a quarter of a degree each, in the stock controls' sense: the camera goes left, its heading right */
    expect((r.heading() - start) * 180 / Math.PI).toBeCloseTo(60, 3);
    expect(r.camera.position.distanceTo(from)).toBeGreaterThan(20);
  });

  it('has most of what the hand asked within a few frames, the same at 60 and 144 Hz', () => {
    /* the heading after one, seven and eighteen sixtieths of a second, drawn at 60 Hz or at `rate` */
    const turned = rate => {
      const r = rig();
      r.nav.pointerDown({ button: 0, x: 800, y: 500 });
      const start = r.heading();
      r.nav.pointerMove({ x: 1000, y: 500, now: 10 });
      let drawn = 0;
      return [1, 7, 18].map(sixtieths => {
        for (; drawn < sixtieths * rate / 60; drawn++) r.frame(1 / rate);
        return (r.heading() - start) * 180 / Math.PI;
      });
    };
    const slow = turned(60), quick = turned(720);
    expect(slow[0] / 50).toBeGreaterThan(0.3);     /* the stock damping gave 0.055 of it in the first frame */
    expect(slow[1] / 50).toBeGreaterThan(0.94);
    expect(slow[2]).toBeCloseTo(50, 1);
    for (let i = 0; i < 3; i++) expect(quick[i]).toBeCloseTo(slow[i], 6);   /* the same picture whatever the frame rate */
  });

  it('from standing height turns the eye in place for far ground and for the sky, the scene following the hand', () => {
    for (const y of [470, 200]) {   /* ground 45 m off, and the sky */
      const r = rig({ position: [0, EYE, 0], target: [0, EYE + 3, -220] });
      r.nav.pointerDown({ button: 0, x: 800, y });
      expect(r.nav.state().drag.swing).toBe(0);
      const landmark = { x: 30, y: 12, z: -300 }, before = r.screen(landmark), stood = r.camera.position.clone();
      r.nav.pointerMove({ x: 900, y, now: 400 });
      r.run(0.5);
      expect(r.camera.position.distanceTo(stood)).toBeLessThan(1e-9);
      /* twice what would keep it exactly under the cursor */
      expect(r.screen(landmark).x - before.x).toBeGreaterThan(150);
      expect(r.screen(landmark).x - before.x).toBeLessThan(250);
    }
  });

  it('from standing height still swings round ground close by: the cup, the ball', () => {
    const r = rig({ position: [0, EYE, 0], target: [0, 0, -6] });
    const cup = r.groundUnder(800, 450);
    expect(cup.t).toBeLessThan(NAVIGATION.orbit.near);
    r.nav.pointerDown({ button: 0, x: 800, y: 450 });
    expect(r.nav.state().drag.swing).toBe(1);
    r.nav.pointerMove({ x: 1000, y: 450, now: 400 });
    r.run(0.5);
    const at = r.screen(cup);
    expect(Math.hypot(at.x - 800, at.y - 450)).toBeLessThan(0.5);
    expect(Math.hypot(r.camera.position.x, r.camera.position.z)).toBeGreaterThan(3);
  });

  it('reaches further from the air, and never much past the middle of the view', () => {
    const swingAt = (position, target, x, y) => { const r = rig({ position, target }); r.nav.pointerDown({ button: 0, x, y }); return r.nav.state().drag.swing; };
    /* the opening view of a hole: 40 m up, looking 215 m down it */
    expect(swingAt([0, 40, 0], [0, 4, -211], 800, 520)).toBe(1);
    expect(swingAt([0, 40, 0], [0, 4, -211], 800, 300)).toBe(0);    /* a kilometre off, three reaches out: the eye turns */
    /* from 5 m the reach is 50 m */
    expect(swingAt([0, 5, 0], [0, 0, -30], 800, 450)).toBe(1);
    const part = swingAt([0, 5, 0], [0, 0, -60], 800, 420);
    expect(part).toBeGreaterThan(0); expect(part).toBeLessThan(1);
  });

  it('is never steered under standing height: the ground stops the swing and the view still turns', () => {
    const r = rig({ position: [0, 6, 14], target: [0, 0, 0], clamp: true });
    r.nav.pointerDown({ button: 0, x: 800, y: 450 });
    const tilt = () => Math.asin(viewBasis(r.camera.position, r.controls.target).f.y);
    const before = tilt();
    let lowest = Infinity;
    for (let i = 1; i <= 60; i++) {
      r.nav.pointerMove({ x: 800, y: 450 - i * 8, now: i * 16 });   /* dragged up: the camera swings down */
      r.frame();
      lowest = Math.min(lowest, r.above());
    }
    r.run(0.4);
    expect(lowest).toBeGreaterThan(EYE - 1e-9);
    expect(r.above()).toBeCloseTo(EYE, 6);
    expect(tilt()).toBeGreaterThan(before + 1);       /* from looking down at it to looking up past it */
    expect(r.groundClamp.lift).toBeLessThan(1e-9);    /* the clamp was not fought, and books nothing */
  });

  it('stops at the poles, and leaves a pose already past one alone', () => {
    const r = rig();
    r.nav.pointerDown({ button: 1, x: 800, y: 450 });
    r.nav.pointerMove({ x: 800, y: 450 + 20000, now: 300 });
    r.run(1);
    const f = viewBasis(r.camera.position, r.controls.target).f;
    expect(Math.acos(-f.y)).toBeCloseTo(r.controls.maxPolarAngle, 6);   /* looking up, as far as the stock controls let it */
    expect(Number.isFinite(r.camera.position.x + r.controls.target.x)).toBe(true);
  });
});

describe('a right drag', () => {
  it('moves the ground with the hand: the point taken hold of stays under the cursor', () => {
    const r = rig();
    const grabbed = r.groundUnder(700, 620);
    const y = r.camera.position.y;
    r.nav.pointerDown({ button: 2, x: 700, y: 620 });
    r.nav.pointerMove({ x: 1010, y: 480, now: 300 });
    r.run(0.5);
    const at = r.screen(grabbed);
    expect(Math.hypot(at.x - 1010, at.y - 480)).toBeLessThan(0.5);
    expect(r.camera.position.y).toBeCloseTo(y, 9);     /* level: the stock pan moved the camera up the screen */
  });

  it('never takes hold of the horizon', () => {
    const r = rig({ position: [0, EYE, 0], target: [0, EYE, -200] });
    const from = r.camera.position.clone();
    r.nav.pointerDown({ button: 2, x: 800, y: 460 });
    r.nav.pointerMove({ x: 800, y: 100, now: 300 });    /* dragged far up into the sky */
    r.run(0.5);
    const reach = EYE / Math.tan(NAVIGATION.pan.minSlope);
    expect(r.camera.position.distanceTo(from)).toBeLessThan(2 * reach);
    expect(Number.isFinite(r.camera.position.z)).toBe(true);
  });

  it('with Shift is the swing, and a left drag with Shift is the pan, as the stock controls had it', () => {
    const r = rig();
    r.nav.pointerDown({ button: 2, x: 800, y: 600, swap: true });
    expect(r.nav.state().drag.mode).toBe('orbit');
    r.nav.pointerUp();
    r.nav.pointerDown({ button: 0, x: 800, y: 600, swap: true });
    expect(r.nav.state().drag.mode).toBe('pan');
  });
});

describe('the wheel', () => {
  it('zooms toward the ground under the cursor, which keeps its place, a notch at a time', () => {
    const r = rig();
    const anchor = r.groundUnder(1200, 650);
    const before = r.camera.position.distanceTo(new Vector3(anchor.x, anchor.y, anchor.z));
    r.nav.wheel({ deltaY: -100, x: 1200, y: 650, now: 0 });
    r.frame();
    const first = r.camera.position.distanceTo(new Vector3(anchor.x, anchor.y, anchor.z));
    expect(first).toBeLessThan(before);
    expect(first).toBeGreaterThan(before * (1 - NAVIGATION.zoom.perNotch) + 1);   /* eased over frames, not stepped in one */
    r.run(0.6);
    expect(r.camera.position.distanceTo(new Vector3(anchor.x, anchor.y, anchor.z))).toBeCloseTo(before * (1 - NAVIGATION.zoom.perNotch), 1);
    const at = r.screen(anchor);
    expect(Math.hypot(at.x - 1200, at.y - 650)).toBeLessThan(0.5);
    /* and back out again */
    r.nav.wheel({ deltaY: 100, x: 1200, y: 650, now: 1000 });
    r.run(0.6);
    expect(r.camera.position.distanceTo(new Vector3(anchor.x, anchor.y, anchor.z))).toBeCloseTo(before, 1);
  });

  it('stops short of its anchor, slides along at standing height, and stays inside the controls\' own distances', () => {
    const r = rig({ position: [0, EYE, 0], target: [0, EYE + 3, -220], clamp: true });
    const anchor = r.groundUnder(800, 520);
    for (let i = 0; i < 60; i++) { r.nav.wheel({ deltaY: -100, x: 800, y: 520, now: i * 50 }); r.run(0.05); expect(r.above()).toBeGreaterThan(EYE - 1e-9); }
    r.run(0.5);
    expect(r.above()).toBeCloseTo(EYE, 6);
    expect(r.camera.position.distanceTo(new Vector3(anchor.x, anchor.y, anchor.z))).toBeGreaterThan(EYE - 1e-6);
    expect(r.camera.position.z).toBeLessThan(-anchor.t * 0.5);      /* it walked forward to it */
    expect(r.camera.position.distanceTo(r.controls.target)).toBeGreaterThanOrEqual(NAVIGATION.focus.nearest - 1e-9);
    expect(r.groundClamp.lift).toBeLessThan(1e-9);
    for (let i = 0; i < 200; i++) { r.nav.wheel({ deltaY: 240, x: 800, y: 520, now: 9000 + i * 50 }); r.run(0.05); }
    expect(r.camera.position.distanceTo(r.controls.target)).toBeLessThanOrEqual(r.controls.maxDistance + 1e-6);
  });
});

describe('the keys', () => {
  it('walk level with the heading, ease in and out, and are no faster on a diagonal', () => {
    const r = rig({ position: [0, EYE, 0], target: [0, EYE, -200] });
    expect(r.nav.keyDown('KeyW')).toBe(true);
    r.frame();
    const first = -r.camera.position.z;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(NAVIGATION.keys.walk / 60 * 0.5);        /* not at full pace in the first frame */
    r.run(1);
    const z1 = r.camera.position.z; r.run(1);
    expect(z1 - r.camera.position.z).toBeCloseTo(NAVIGATION.keys.walk, 2);
    expect(r.camera.position.x).toBeCloseTo(0, 9);
    expect(r.nav.keyDown('KeyD')).toBe(false);
    r.run(1);
    const p1 = r.camera.position.clone(); r.run(1);
    expect(r.camera.position.distanceTo(p1)).toBeCloseTo(NAVIGATION.keys.walk, 2);
    expect(r.camera.position.x - p1.x).toBeGreaterThan(3);              /* D is to the right */
    r.nav.keyUp('KeyD');
    expect(r.nav.keyUp('KeyW')).toBe(true);
    const stop = r.camera.position.clone();
    r.run(1);
    const glide = r.camera.position.distanceTo(stop);
    expect(glide).toBeGreaterThan(0.2); expect(glide).toBeLessThan(1);  /* a short ease to a stop */
    const rest = r.camera.position.clone(); r.run(0.5);
    expect(r.camera.position.distanceTo(rest)).toBe(0);
  });

  it('go three times the pace with Shift, and faster from the air', () => {
    const pace = (height, fast) => {
      const r = rig({ position: [0, height, 0], target: [0, height, -200] });
      r.nav.setFast(fast); r.nav.keyDown('KeyW'); r.run(1);
      const z = r.camera.position.z; r.run(1);
      return z - r.camera.position.z;
    };
    expect(pace(EYE, true)).toBeCloseTo(NAVIGATION.keys.walk * NAVIGATION.keys.fast, 1);
    expect(pace(100, false)).toBeCloseTo(100 * NAVIGATION.keys.perHeight, 0);
  });

  it('walk up the picture looking straight down', () => {
    const r = rig({ position: [0, 300, 0.001], target: [0, 0, 0] });
    r.nav.keyDown('KeyW'); r.run(0.5);
    expect(r.camera.position.z).toBeLessThan(-10);
    expect(Math.abs(r.camera.position.x)).toBeLessThan(1e-3);
  });

  it('Q sinks to standing height and no further; E rises', () => {
    const r = rig({ position: [0, 12, 0], target: [0, 12, -100], clamp: true });
    r.nav.keyDown('KeyQ'); r.run(6);
    expect(r.above()).toBeCloseTo(EYE, 9);
    expect(r.groundClamp.lift).toBeLessThan(1e-9);
    r.nav.keyUp('KeyQ'); r.nav.keyDown('KeyE'); r.run(2);
    expect(r.above()).toBeGreaterThan(EYE + 4);
    expect(viewBasis(r.camera.position, r.controls.target).f.y).toBeCloseTo(0, 9);   /* the view keeps its tilt */
  });

  it('ride the ground from standing height: down a fairway the eye is not left in the air', () => {
    const slope = (x, z) => 30 + z * 0.12;                 /* falls 12 m in 100 walking away */
    const r = rig({ ground: slope, position: [0, 30 + EYE, 0], target: [0, 30 + EYE, -200], clamp: true });
    r.nav.keyDown('KeyW'); r.run(12);
    expect(r.camera.position.z).toBeLessThan(-50);
    expect(r.above()).toBeCloseTo(EYE, 6);
    expect(r.groundClamp.lift).toBeLessThan(1e-9);
  });

  it('begun in the air, fly level over the same fall', () => {
    const slope = (x, z) => 30 + z * 0.12;
    const r = rig({ ground: slope, position: [0, 60, 0], target: [0, 60, -200] });
    r.nav.keyDown('KeyW'); r.run(3);
    expect(r.camera.position.y).toBeCloseTo(60, 9);
  });

  it('over a hill and down again, leave the eye at standing height and the clamp owed nothing', () => {
    const hill = (x, z) => 4 * Math.exp(-((z + 40) ** 2) / 200);
    const r = rig({ ground: hill, position: [0, EYE, 0], target: [0, EYE, -200], clamp: true });
    r.nav.keyDown('KeyW');
    let lowest = Infinity, highest = 0, kick = 0, y = r.camera.position.y, v = 0;
    for (let i = 0; i < 60 * 17; i++) {
      r.frame();
      lowest = Math.min(lowest, r.above()); highest = Math.max(highest, r.above());
      const step = r.camera.position.y - y; kick = Math.max(kick, Math.abs(step - v)); v = step; y = r.camera.position.y;
    }
    r.nav.keyUp('KeyW'); r.run(2);
    expect(r.camera.position.z).toBeLessThan(-80);
    expect(lowest).toBeGreaterThan(GROUND_CLAMP.floor);
    expect(highest).toBeLessThan(EYE + 1);                 /* the clamp climbs a 24% bank a little early, and gives it back */
    expect(kick).toBeLessThan(0.004);                      /* metres a frame, frame to frame: no step in the eye's height */
    expect(r.above()).toBeCloseTo(EYE, 2);
    expect(r.groundClamp.lift).toBeLessThan(0.01);
  });
});

describe('letting go', () => {
  it('glides on when the hand was moving, and stays put when it had stopped', () => {
    const fling = pause => {
      const r = rig();
      r.nav.pointerDown({ button: 2, x: 600, y: 600, now: 0 });
      for (let i = 1; i <= 10; i++) { r.nav.pointerMove({ x: 600 + i * 12, y: 600, now: i * 16 }); r.frame(); }
      const released = r.camera.position.clone();
      r.run(pause);
      const settled = r.camera.position.clone();
      r.nav.pointerUp({ now: 160 + pause * 1000 });
      r.run(1.5);
      return { owed: settled.distanceTo(released), after: r.camera.position.distanceTo(settled), held: r.nav.state().drag };
    };
    const moving = fling(0), stopped = fling(0.3);
    expect(moving.after).toBeGreaterThan(5);
    expect(stopped.after).toBeLessThan(0.005);
    expect(moving.held).toBeNull();
  });

  it('under reduced motion nothing is eased or glides', () => {
    const r = rig({ still: true });
    r.nav.pointerDown({ button: 0, x: 800, y: 500, now: 0 });
    const start = r.heading();
    r.nav.pointerMove({ x: 1000, y: 500, now: 8 });
    r.frame();
    expect((r.heading() - start) * 180 / Math.PI).toBeCloseTo(50, 6);
    r.nav.pointerUp({ now: 10 });
    const at = r.camera.position.clone(); r.run(0.5);
    expect(r.camera.position.distanceTo(at)).toBeLessThan(1e-9);
  });

  it('a camera placed by something else is taken hold of again from where it was put', () => {
    const r = rig();
    r.nav.pointerDown({ button: 2, x: 800, y: 600 });
    r.nav.pointerMove({ x: 900, y: 600, now: 100 });
    r.frame();
    /* a named view lands mid-drag */
    r.camera.position.set(500, 30, 500); r.controls.target.set(500, 0, 440); r.controls.update();
    r.run(0.5);
    expect(r.camera.position.distanceTo(new Vector3(500, 30, 500))).toBeLessThan(1e-6);
    r.nav.pointerMove({ x: 950, y: 600, now: 700 });
    r.run(0.5);
    expect(r.camera.position.distanceTo(new Vector3(500, 30, 500))).toBeGreaterThan(1);
    expect(r.camera.position.distanceTo(new Vector3(500, 30, 500))).toBeLessThan(20);
  });
});

/* ------------------------------------------------------------------ the page */
function page({ search = '?bana=puttom', ground = () => 0 } = {}) {
  const r = rig({ ground });
  const element = r.controls.domElement, document = element.ownerDocument;
  const classes = new Set(), listeners = [], timers = [];
  const nodes = { hint: { textContent: 'dra för att se dig omkring · rulla för att zooma' } };
  const made = [];
  const node = tag => { const n = { tag, children: [], className: '', id: '', textContent: '', append(...c) { n.children.push(...c); } }; made.push(n); return n; };
  const list = { after(...c) { list.followed = c; } };
  element.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H });
  Object.assign(document, {
    body: { classList: { contains: c => classes.has(c) } },
    getElementById: id => nodes[id] ?? null,
    querySelector: () => list, createElement: node,
  });
  let clock = 1000;
  const win = {
    V3D: { harness: () => ({ camera: r.camera, controls: r.controls, renderer: { domElement: element } }),
      groundAt: ground, groundClamp: () => ({ lift: 0, ...GROUND_CLAMP }) },
    document, location: { search }, performance: { now: () => clock },
    matchMedia: () => ({ matches: false }), setTimeout: fn => timers.push(fn),
    addEventListener: (type, fn, options) => listeners.push({ type, fn, capture: options === true || !!options?.capture }),
  };
  /* a browser's order: the window's capturing listeners, the target's own, then the window's as the event bubbles */
  const send = (target, type, props = {}) => {
    const event = { type, target: target === 'window' ? win : element, pointerId: 1, pointerType: 'mouse', button: 0,
      clientX: 800, clientY: 500, pageX: 800, pageY: 500, timeStamp: clock, prevented: false,
      preventDefault() { event.prevented = true; }, ...props };
    for (const l of listeners) if (l.type === type && l.capture) l.fn(event);
    /* three's dispatcher rewrites `target`; the DOM event keeps its own */
    if (target === 'element') element.dispatchEvent({ ...event, target: undefined, preventDefault: event.preventDefault });
    else if (target === 'document') document.dispatchEvent({ ...event, target: undefined });
    for (const l of listeners) if (l.type === type && !l.capture) l.fn(event);
    for (const fn of timers.splice(0)) fn();
    return event;
  };
  const tick = (seconds = 1 / 60) => { clock += seconds * 1000; r.controls.update(); };
  const started = []; r.controls.addEventListener('start', () => started.push('start')); r.controls.addEventListener('end', () => started.push('end'));
  return { ...r, win, classes, nodes, list, made, send, tick, started, key: (type, code, props = {}) => send('window', type, { code, key: code.replace('Key', '').toLowerCase(), ...props }) };
}

describe('on the page', () => {
  it('is the stock controls under ?nav=before, and where there is no course', () => {
    const p = page({ search: '?bana=puttom&nav=before' });
    const update = p.controls.update;
    expect(installCameraNavigation({ page: p.win })).toBeNull();
    expect(p.controls.update).toBe(update);
    expect(p.nodes.hint.textContent).toMatch(/se dig omkring/);
    expect(installCameraNavigation({ page: { document: {}, location: { search: '' } } })).toBeNull();
  });

  it('takes a mouse drag from the controls, announces it as theirs, and leaves a finger to them', () => {
    const p = page();
    const api = installCameraNavigation({ page: p.win });
    expect(p.win.BANVY_NAV).toBe(api);
    const theirs = p.controls.mouseButtons;
    p.send('element', 'pointerdown');
    expect(p.started).toEqual(['start']);                  /* once: what stops a tween, a flight or a tour */
    expect(p.controls.state).toBe(-1);                     /* the controls' own NONE */
    expect(api.state().drag.mode).toBe('orbit');
    const from = p.camera.position.clone();
    p.send('document', 'pointermove', { clientX: 1000, pageX: 1000 });
    p.tick(); p.tick();
    expect(p.camera.position.distanceTo(from)).toBeGreaterThan(1);
    p.send('document', 'pointerup', { clientX: 1000 });
    expect(p.controls.mouseButtons).toBe(theirs);
    expect(p.started).toEqual(['start', 'end']);
    for (let i = 0; i < 40; i++) p.tick();
    /* a finger: the controls' own rotate, as before */
    p.send('element', 'pointerdown', { pointerType: 'touch', pointerId: 7 });
    expect(p.controls.state).not.toBe(-1);
    expect(api.state().drag).toBeNull();
    p.send('document', 'pointerup', { pointerType: 'touch', pointerId: 7 });
  });

  it('takes the wheel without the controls stepping their own zoom, and hands zoom back to them', () => {
    const p = page();
    installCameraNavigation({ page: p.win });
    const before = p.camera.position.distanceTo(p.controls.target);
    const event = p.send('element', 'wheel', { deltaY: -100, deltaMode: 0 });
    expect(event.prevented).toBe(true);
    expect(p.controls.enableZoom).toBe(true);
    expect(p.started).toEqual(['start', 'end']);
    p.tick();
    const first = p.camera.position.distanceTo(p.controls.target);
    expect(first).toBeLessThan(before);
    expect(first).toBeGreaterThan(before * 0.95);           /* the stock controls' whole step in one frame */
    for (let i = 0; i < 40; i++) p.tick();
    expect(p.camera.position.distanceTo(p.controls.target)).toBeCloseTo(before * (1 - NAVIGATION.zoom.perNotch), 1);
  });

  it('walks on W and stops when a text field, the chooser, the menu or a modifier has the keys', () => {
    const p = page();
    installCameraNavigation({ page: p.win });
    const walked = () => { const z = p.camera.position.z; for (let i = 0; i < 20; i++) p.tick(); return Math.abs(p.camera.position.z - z) > 0.5; };
    p.key('keydown', 'KeyW');
    expect(p.started).toEqual(['start']);
    expect(walked()).toBe(true);
    p.key('keyup', 'KeyW');
    expect(p.started).toEqual(['start', 'end']);
    for (let i = 0; i < 60; i++) p.tick();
    expect(walked()).toBe(false);
    p.key('keydown', 'KeyW', { ctrlKey: true });            /* Ctrl+W is the browser's */
    expect(walked()).toBe(false);
    p.send('window', 'keydown', { code: 'KeyW', key: 'w', target: { closest: () => ({}) } });   /* typing */
    expect(walked()).toBe(false);
    p.classes.add('choosing');
    p.key('keydown', 'KeyW');
    expect(walked()).toBe(false);
    p.classes.delete('choosing');
    /* the chooser opening over a held key lets go of it */
    p.key('keydown', 'KeyW'); expect(walked()).toBe(true);
    p.classes.add('choosing'); for (let i = 0; i < 60; i++) p.tick();
    expect(walked()).toBe(false);
  });

  it('stands down for Spela and Återupplev, and when switched off', () => {
    const p = page();
    const api = installCameraNavigation({ page: p.win });
    p.classes.add('pl-on');
    p.send('element', 'pointerdown');
    expect(p.controls.state).not.toBe(-1);                  /* the stock rotate round the ball */
    expect(api.state().drag).toBeNull();
    p.send('document', 'pointerup');
    p.classes.delete('pl-on');
    api.setEnabled(false);
    const before = p.camera.position.distanceTo(p.controls.target);
    p.send('element', 'wheel', { deltaY: -100, deltaMode: 0 });
    p.tick();
    expect(p.camera.position.distanceTo(p.controls.target)).toBeCloseTo(before * 0.95, 6);   /* the stock step */
  });

  it('says so: the hint under the course and the menu\'s list', () => {
    const p = page();
    installCameraNavigation({ page: p.win });
    expect(p.nodes.hint.textContent).toBe(NAVIGATION_HINT);
    const [heading, rows] = p.list.followed;
    expect(heading.textContent).toBe('Mus och tangentbord');
    expect(rows.children).toHaveLength(NAVIGATION_ROWS.length);
    expect(rows.children[4].children.filter(c => c.tag === 'kbd').map(c => c.textContent)).toEqual(['W', 'A', 'S', 'D']);
  });
});

describe('the keys taken', () => {
  it('are listed, and none of them is a shortcut of the course\'s own', () => {
    const letters = Object.keys(MOVE_KEYS).map(code => code.replace('Key', ''));
    const listed = NAVIGATION_ROWS.flatMap(([keys]) => keys);
    for (const letter of letters) expect(listed).toContain(letter);
    const theirs = new Set(['C', 'L', 'F', 'H', 'M', 'N', 'P', 'G', 'B', 'I', ...SHORTCUT_ROWS.flatMap(([keys]) => keys)]);
    for (const letter of letters) expect(theirs.has(letter)).toBe(false);
  });
});
