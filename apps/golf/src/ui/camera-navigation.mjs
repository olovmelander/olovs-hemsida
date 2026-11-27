/* How the detailed course is moved through with a mouse and a keyboard
   (owner request, 27 November: tighter, smoother, better).

   The stock orbit controls turned the camera round a target that a named view
   leaves 200 m down the fairway, took a twentieth of what the hand asked each
   frame (a 0.3 s lag, and as long a coast), stepped the zoom toward the middle
   of the screen in one frame, and had no keys at all. This module takes the
   mouse and the keyboard over and leaves touch, the tweens, the flights and
   the ground clamp exactly as they were:

   - LEFT DRAG turns the world round what the hand took hold of. The ground
     under the cursor is the pivot, so it stays under the cursor. Ground too
     far away to swing round (from standing height, anything past ten metres)
     and the sky turn the eye in place instead, the scene following the hand,
     and between the two the drag is a share of each.
   - RIGHT DRAG moves the ground: the point taken hold of stays under the
     cursor, on a level plane through it. Never the horizon: a ray flatter than
     PAN.minSlope is read as that slope.
   - MIDDLE DRAG turns the eye in place, wherever it is.
   - THE WHEEL zooms toward the ground under the cursor, eased over a few
     frames; the point under the cursor keeps its place.
   - W A S D walk, level with the view's heading; Q and E sink and rise; Shift
     is three times the pace. The pace follows the height above the ground, so
     the picture moves as fast from the air as from a tee.

   Everything is asked for as an amount still owed and paid out as a share per
   frame, 1 - exp(-dt / tau): the same picture at 60 and 144 Hz, 40 ms behind
   the hand where the stock controls were 300. A drag let go while moving
   glides on for a moment; one stopped first stays where it is put.

   The ground clamp (engine/camera-clamp.mjs) is still the only thing that
   lifts the camera out of the ground. Nothing here snaps it to the terrain:
   - a frame of navigation never STEERS the eye under standing height (a swing,
     a zoom or Q that would is held at it, the view still turning), so the
     clamp is not fought and books no lift for it;
   - a movement begun near the ground RIDES it: the eye is carried by what the
     ground under it rose or fell, read over a footprint a few metres wide, so
     a walk down a fairway does not leave the eye in the air. The share is
     taken once, where the movement begins (all of it under FOLLOW.below, none
     above FOLLOW.above), and kept for its length: a share that changed along
     the way would not give back on the far side of a hill what it took on the
     near side. Begun in the air, a movement flies level.

   The module lives outside the hashed folders and reaches the course through
   window.V3D, as ui/detailed-hud.mjs does: main.js is not edited, so the
   prepared startup data stays valid. It steps inside the controls' own
   update(), which main.js calls once a frame while the player owns the
   camera, and announces a gesture as the controls' own `start`, which is what
   stops a tween, a flight or a tour (engine/camera-gesture-interrupt.mjs).
   Spela and Återupplev keep the stock controls.

   ?nav=before is the stock controls; BANVY_NAV.setEnabled(false) is the same
   on a running page. See docs/camera-navigation-2026-11-27.md. */

export const NAVIGATION = Object.freeze({
  /* seconds: how soon the camera has what a drag asked for (the stock damping was 0.30 at 60 Hz) */
  dragTau: 0.04,
  /* seconds: the same for the wheel */
  zoomTau: 0.08,
  orbit: Object.freeze({
    degreesPerPixel: 0.25,   /* the stock controls gave a full turn per viewport height: 0.33 at 1080 px */
    /* metres: from standing height, the furthest ground the camera swings round */
    near: 10,
    /* that reach grows with the height above the ground, as (height / eye) to this power: 50 m at 5 m, 260 m at 15 m */
    heightPower: 1.5,
    /* and is never more than this many times the distance to the ground at the middle of the view */
    centreFactor: 1.5,
    /* past the reach the swing gives way to turning the eye, all of it by this many reaches */
    fade: 3,
    /* metres: ground nearer than this is not a pivot */
    min: 0.5,
  }),
  look: Object.freeze({
    /* turning the eye in place: this many times what would keep the scene exactly under the cursor */
    gain: 2,
  }),
  /* radians from straight down or straight up that a drag never turns the view past */
  poleMargin: 0.01,
  pan: Object.freeze({
    minSlope: 2.5 * Math.PI / 180,   /* radians below level: the flattest ray the ground is taken hold of along */
    minHeight: 1,                    /* metres the grabbed plane lies under the eye, at least */
  }),
  zoom: Object.freeze({
    perNotch: 0.12,     /* the share of the distance to the anchor one wheel notch closes (the stock controls: 0.05) */
    notchPixels: 100,
    maxPixels: 240,     /* one event never asks for more than this: a free-spinning wheel */
    pinchGain: 10,      /* a trackpad pinch arrives as ctrl+wheel in small steps */
    nearest: 2.5,       /* metres: the closest the eye comes to its anchor */
    farthest: 6000,
    anchorReach: 1200,  /* metres: an anchor further off is brought in to this */
    hold: 0.4,          /* seconds a still cursor keeps its anchor between wheel events */
  }),
  focus: Object.freeze({ nearest: 3 }),   /* metres: the least the orbit target stays ahead of the eye */
  glide: Object.freeze({
    tau: 0.12,        /* seconds: how a drag let go while moving runs out (the stock coast was 0.30) */
    window: 0.08,     /* seconds of the hand's last motion its speed is read from */
    minSpeed: 60,     /* pixels a second: a slower release is a stop */
    maxSpeed: 4000,
  }),
  keys: Object.freeze({
    walk: 5,           /* metres a second at standing height */
    perHeight: 0.9,    /* and this many heights-above-ground a second once that is faster */
    max: 600,
    rise: 3, risePerHeight: 0.6,
    fast: 3,           /* Shift */
    startTau: 0.10, stopTau: 0.12,
  }),
  follow: Object.freeze({
    below: 3, above: 10,        /* metres above the ground where a movement begins: it rides the ground below, flies level above */
    footprint: Object.freeze([1.5, 6]),   /* metres: the radius the ground is read over, 0.6 of that height between these */
  }),
  pickReach: 6000,
  /* metres a pose may differ from where this module left it before it counts as placed by something else */
  placedTolerance: 1e-4,
});

/* What the menu lists under the shortcuts: [keys, description], as engine/keyboard-shortcuts.mjs's rows. */
export const NAVIGATION_ROWS = Object.freeze([
  [['Dra'], 'Vrid kring det du tar tag i'],
  [['Högerdra'], 'Flytta marken'],
  [['Mittendra'], 'Se dig omkring'],
  [['Rulla'], 'Zooma mot pekaren'],
  [['W', 'A', 'S', 'D'], 'Gå framåt, åt sidorna och bakåt'],
  [['Q', 'E'], 'Sjunk / stig'],
  [['Shift'], 'Håll in för högre fart'],
]);
export const NAVIGATION_HINT = 'dra för att vrida · högerdra för att flytta · rulla för att zooma · W A S D för att gå';

/* the physical keys, so the hand's place holds on any layout: [forward, right, up] */
export const MOVE_KEYS = Object.freeze({ KeyW: [1, 0, 0], KeyS: [-1, 0, 0], KeyD: [0, 1, 0], KeyA: [0, -1, 0], KeyE: [0, 0, 1], KeyQ: [0, 0, -1] });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const share = (dt, tau) => (tau > 0 && dt > 0 ? 1 - Math.exp(-dt / tau) : 1);

/* The camera's axes from where it stands and what it looks at: f forward, r right (always level), u up.
   Looking straight down or up, the right is the camera's own (its quaternion). */
export function viewBasis(position, target, quaternion = null) {
  let fx = target.x - position.x, fy = target.y - position.y, fz = target.z - position.z;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;
  let rx = -fz, rz = fx, rl = Math.hypot(rx, rz);
  if (rl < 1e-6 && quaternion) {
    const { x, y, z, w } = quaternion;
    rx = 1 - 2 * (y * y + z * z); rz = 2 * (x * z - w * y); rl = Math.hypot(rx, rz);
  }
  if (rl < 1e-9) { rx = 1; rz = 0; rl = 1; }
  rx /= rl; rz /= rl;
  return { f: { x: fx, y: fy, z: fz }, r: { x: rx, y: 0, z: rz }, u: { x: -rz * fy, y: rz * fx - rx * fz, z: rx * fy } };
}

/* The direction through a point of the picture: ndc x and y in -1..1, y up. */
export function cursorRay(basis, ndcX, ndcY, tanHalfFov, aspect) {
  const a = ndcX * tanHalfFov * aspect, b = ndcY * tanHalfFov, { f, r, u } = basis;
  const x = f.x + r.x * a + u.x * b, y = f.y + r.y * a + u.y * b, z = f.z + r.z * a + u.z * b;
  const l = Math.hypot(x, y, z);
  return { x: x / l, y: y / l, z: z / l };
}

/* Where a ray first meets the ground: steps that lengthen with the distance
   (2% of it, never under 0.75 m), then a bisection. About 300 heights for the
   whole reach, against the 1700 of a fixed 3 m step. */
export function pickGround(origin, dir, groundAt, { max = NAVIGATION.pickReach } = {}) {
  const above = t => origin.y + dir.y * t - groundAt(origin.x + dir.x * t, origin.z + dir.z * t);
  if (!(above(0) > 0)) return null;
  let near = 0, far = 0.5;
  while (far <= max) {
    const a = above(far);
    if (!Number.isFinite(a)) return null;
    if (a <= 0) {
      for (let i = 0; i < 14; i++) { const mid = (near + far) / 2; if (above(mid) <= 0) far = mid; else near = mid; }
      const t = (near + far) / 2;
      return { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t, t };
    }
    if (dir.y > 0 && a > 300) return null;   /* climbing away from ground already far below */
    near = far; far += Math.max(0.75, far * 0.02);
  }
  return null;
}

/* Turn a point round an axis through a centre (Rodrigues), in place. */
function turnAbout(p, c, n, angle) {
  const s = Math.sin(angle), co = Math.cos(angle);
  const x = p.x - c.x, y = p.y - c.y, z = p.z - c.z;
  const d = (n.x * x + n.y * y + n.z * z) * (1 - co);
  const cx = n.y * z - n.z * y, cy = n.z * x - n.x * z, cz = n.x * y - n.y * x;
  p.x = c.x + x * co + cx * s + n.x * d;
  p.y = c.y + y * co + cy * s + n.y * d;
  p.z = c.z + z * co + cz * s + n.z * d;
}
const UP = Object.freeze({ x: 0, y: 1, z: 0 });

/**
 * @param {object} o
 * @param {{position: {x,y,z}, quaternion?: {x,y,z,w}, fov: number, aspect: number}} o.camera
 * @param {{target: {x,y,z}, minPolarAngle?: number, maxPolarAngle?: number, maxDistance?: number}} o.controls
 * @param {(x: number, z: number) => number} o.groundAt   the drawn ground's height
 * @param {number} [o.eye]                                standing height, the ground clamp's
 * @param {() => {left: number, top: number, width: number, height: number}} o.viewport   the canvas, in client pixels
 * @param {() => boolean} [o.still]                       reduced motion: nothing is eased or glides
 */
export function createCameraNavigation({ camera, controls, groundAt, eye = 1.7, viewport, still = () => false, settings = NAVIGATION }) {
  const C = camera.position, T = controls.target;
  let drag = null;
  const orbit = { yaw: 0, pitch: 0, pivot: null };
  const look = { yaw: 0, pitch: 0 };
  const zoom = { owed: 0, anchor: null, x: NaN, y: NaN, at: -Infinity };
  const held = new Set();
  const pace = { f: 0, r: 0, u: 0 };
  let fast = false, left = null, lastGround = 0;
  /* how much of the ground's rise and fall this movement rides, and the footprint it is read over; null between movements */
  let ride = null;

  const ground = (x, z) => { const h = groundAt(x, z); if (Number.isFinite(h)) lastGround = h; return Number.isFinite(h) ? h : lastGround; };
  const height = () => Math.max(0, C.y - ground(C.x, C.z));
  const tanHalf = () => Math.tan(camera.fov * Math.PI / 360);

  function rayAt(x, y) {
    const v = viewport(), basis = viewBasis(C, T, camera.quaternion);
    return { basis, dir: cursorRay(basis, (x - v.left) / v.width * 2 - 1, 1 - (y - v.top) / v.height * 2, tanHalf(), camera.aspect) };
  }

  /* ---- what a drag takes hold of */
  function takeOrbit(x, y) {
    const { basis, dir } = rayAt(x, y);
    const hit = pickGround(C, dir, groundAt, { max: settings.pickReach });
    orbit.pivot = null;
    if (!hit || hit.t < settings.orbit.min) return 0;
    const centre = pickGround(C, basis.f, groundAt, { max: settings.pickReach });
    const reach = Math.min(settings.orbit.near * Math.pow(Math.max(eye, height()) / eye, settings.orbit.heightPower),
      settings.orbit.centreFactor * (centre ? centre.t : Infinity));
    const swing = 1 - smoothstep(reach, reach * settings.orbit.fade, hit.t);
    if (swing > 0) orbit.pivot = { x: hit.x, y: hit.y, z: hit.z };
    return swing;
  }
  function onPlane(dir, planeY) {
    const drop = Math.max(settings.pan.minHeight, C.y - planeY), level = Math.hypot(dir.x, dir.z);
    if (level < 1e-9) return { x: C.x, z: C.z };
    let down = -dir.y, flat = level;
    const s = Math.sin(settings.pan.minSlope);
    if (down < s) { down = s; flat = Math.cos(settings.pan.minSlope); }
    const reach = drop * flat / down;
    return { x: C.x + dir.x / level * reach, z: C.z + dir.z / level * reach };
  }
  function takeGround(x, y) {
    const { dir } = rayAt(x, y);
    const hit = pickGround(C, dir, groundAt, { max: settings.pickReach });
    const planeY = Math.min(hit ? hit.y : ground(C.x, C.z), C.y - settings.pan.minHeight);
    const p = onPlane(dir, planeY);
    return { x: p.x, y: planeY, z: p.z };
  }
  function take(d) {
    if (d.mode === 'orbit') d.swing = takeOrbit(d.x, d.y);
    else if (d.mode === 'pan') d.grab = takeGround(d.x, d.y);
    else { d.swing = 0; orbit.pivot = null; }
  }

  /* ---- the moves, each on the camera and its target alike */
  function meanGround(x, z, radius) {
    const d = radius * Math.SQRT1_2;
    return (ground(x, z) + ground(x + radius, z) + ground(x - radius, z) + ground(x, z + radius) + ground(x, z - radius)
      + ground(x + d, z + d) + ground(x - d, z + d) + ground(x + d, z - d) + ground(x - d, z - d)) / 9;
  }
  function begin() {
    const h = height();
    ride = { share: 1 - smoothstep(settings.follow.below, settings.follow.above, h),
      radius: clamp(h * 0.6, settings.follow.footprint[0], settings.follow.footprint[1]) };
  }
  function travel(dx, dz) { C.x += dx; C.z += dz; T.x += dx; T.z += dz; }
  function rise(dy) { C.y += dy; T.y += dy; }
  function keepFocus() {
    const dx = T.x - C.x, dy = T.y - C.y, dz = T.z - C.z, d = Math.hypot(dx, dy, dz);
    const want = clamp(d, settings.focus.nearest, controls.maxDistance ?? Infinity);
    if (d > 1e-9 && want !== d) { const k = want / d; T.x = C.x + dx * k; T.y = C.y + dy * k; T.z = C.z + dz * k; }
  }
  function turn(pivot, yaw, pitch) {
    const P = pivot || C;
    if (yaw) { if (P !== C) turnAbout(C, P, UP, yaw); turnAbout(T, P, UP, yaw); }
    if (!pitch) return;
    const ox = C.x - T.x, oy = C.y - T.y, oz = C.z - T.z, len = Math.hypot(ox, oy, oz);
    if (!(len > 0)) return;
    const phi = Math.acos(clamp(oy / len, -1, 1));
    const lo = Math.max(controls.minPolarAngle ?? 0, settings.poleMargin);
    const hi = Math.min(controls.maxPolarAngle ?? Math.PI, Math.PI - settings.poleMargin);
    /* a pose already past a limit is not pushed further, and not pulled back */
    const next = pitch < 0 ? Math.max(phi + pitch, Math.min(phi, lo)) : Math.min(phi + pitch, Math.max(phi, hi));
    const d = next - phi;
    if (!d) return;
    /* the level axis the view tilts about: (camera - target) x up, or the camera's own right looking straight down */
    let nx = -oz, nz = ox, nl = Math.hypot(nx, nz);
    if (nl < 1e-6 * len) { const b = viewBasis(C, T, camera.quaternion); nx = -b.r.x; nz = -b.r.z; nl = 1; }
    const n = { x: nx / nl, y: 0, z: nz / nl };
    if (P !== C) turnAbout(C, P, n, -d);
    turnAbout(T, P, n, -d);
  }
  function zoomBy(log) {
    const a = zoom.anchor, ax = C.x - a.x, ay = C.y - a.y, az = C.z - a.z, d = Math.hypot(ax, ay, az);
    if (!(d > 0)) return false;
    let f = Math.exp(log);
    if (f < 1) f = Math.max(f, Math.min(1, settings.zoom.nearest / d));
    else {
      const span = Math.hypot(T.x - C.x, T.y - C.y, T.z - C.z);
      f = Math.min(f, Math.max(1, (controls.maxDistance ?? Infinity) / span), Math.max(1, settings.zoom.farthest / d));
    }
    if (f === 1) return false;
    /* the camera and its target close on the anchor alike, so the anchor keeps its place in the picture */
    T.x = a.x + (T.x - a.x) * f; T.y = a.y + (T.y - a.y) * f; T.z = a.z + (T.z - a.z) * f;
    C.x = a.x + ax * f; C.y = a.y + ay * f; C.z = a.z + az * f;
    keepFocus();
    return true;
  }

  /* ---- the hand */
  function moved(dx, dy) {
    if (!drag || (!dx && !dy)) return;
    drag.x += dx; drag.y += dy;
    if (drag.mode === 'pan') return;   /* the pan reads the cursor's place, not its motion */
    const swing = drag.swing, turnRate = settings.orbit.degreesPerPixel * Math.PI / 180;
    const lookRate = settings.look.gain * 2 * Math.atan(tanHalf()) / viewport().height;
    /* a swing takes the stock controls' sense, the near side following the hand;
       turning the eye is the other way round, so the scene still follows it */
    orbit.yaw -= swing * turnRate * dx; orbit.pitch -= swing * turnRate * dy;
    look.yaw += (1 - swing) * lookRate * dx; look.pitch += (1 - swing) * lookRate * dy;
  }
  function settle() {
    orbit.yaw = orbit.pitch = look.yaw = look.pitch = 0;
    zoom.owed = 0; zoom.anchor = null;
  }

  return {
    get dragging() { return !!drag?.held; },
    /** what is held and owed, for a harness */
    state() {
      return { drag: drag && { mode: drag.mode, held: drag.held, swing: drag.swing ?? null, x: drag.x, y: drag.y,
        grab: drag.grab ? { ...drag.grab } : null }, pivot: orbit.pivot && { ...orbit.pivot },
        owed: { yaw: orbit.yaw + look.yaw, pitch: orbit.pitch + look.pitch, zoom: zoom.owed },
        anchor: zoom.anchor && { ...zoom.anchor }, keys: [...held], pace: { ...pace }, fast, ride: ride && { ...ride } };
    },

    /** button 0 swings, 2 moves the ground, 1 turns the eye; Shift, Ctrl or Cmd swap the first two, as the stock controls did */
    pointerDown({ button = 0, x, y, swap = false, now = 0 }) {
      let mode = button === 1 ? 'look' : button === 2 ? 'pan' : button === 0 ? 'orbit' : null;
      if (!mode) return false;
      if (swap && mode !== 'look') mode = mode === 'orbit' ? 'pan' : 'orbit';
      settle();
      drag = { mode, x, y, held: true, swing: 0, grab: null, vx: 0, vy: 0, trail: [{ t: now, x, y }] };
      take(drag);
      begin();
      return true;
    },
    pointerMove({ x, y, now = 0 }) {
      if (!drag?.held) return;
      moved(x - drag.x, y - drag.y);
      drag.trail.push({ t: now, x, y });
      while (drag.trail.length > 2 && now - drag.trail[0].t > settings.glide.window * 1000) drag.trail.shift();
    },
    pointerUp({ now = 0 } = {}) {
      if (!drag?.held) return;
      drag.held = false;
      const first = drag.trail[0], last = drag.trail.at(-1), span = (last.t - first.t) / 1000;
      /* a hand that stopped before letting go has let go of a still picture */
      if (!still() && span > 0 && now - last.t < settings.glide.window * 1000) {
        const vx = (last.x - first.x) / span, vy = (last.y - first.y) / span, speed = Math.hypot(vx, vy);
        if (speed >= settings.glide.minSpeed) {
          const k = Math.min(1, settings.glide.maxSpeed / speed);
          drag.vx = vx * k; drag.vy = vy * k;
        }
      }
    },
    /** deltaY in pixels (negative closes in), the cursor in client pixels */
    wheel({ deltaY, x, y, pinch = false, now = 0 }) {
      if (!deltaY) return false;
      const pixels = clamp(deltaY * (pinch ? settings.zoom.pinchGain : 1), -settings.zoom.maxPixels, settings.zoom.maxPixels);
      if (!zoom.anchor || x !== zoom.x || y !== zoom.y || now - zoom.at > settings.zoom.hold * 1000) {
        const { dir } = rayAt(x, y);
        const hit = pickGround(C, dir, groundAt, { max: settings.pickReach });
        const t = Math.min(settings.zoom.anchorReach, hit ? hit.t
          : clamp(Math.hypot(T.x - C.x, T.y - C.y, T.z - C.z), 20, settings.zoom.anchorReach));
        zoom.anchor = { x: C.x + dir.x * t, y: C.y + dir.y * t, z: C.z + dir.z * t };
        zoom.x = x; zoom.y = y;
        if (!drag) begin();
      }
      zoom.at = now;
      zoom.owed += pixels / settings.zoom.notchPixels * -Math.log(1 - settings.zoom.perNotch);
      return true;
    },
    /** @returns {boolean} whether this press began the keys' movement */
    keyDown(code) {
      if (!MOVE_KEYS[code] || held.has(code)) return false;
      held.add(code);
      /* the keys held are the movement: a change of them (landed with Q, then W alone) begins another */
      if (!drag) begin();
      return held.size === 1;
    },
    /** @returns {boolean} whether this release ended it */
    keyUp(code) {
      if (!held.delete(code)) return false;
      if (!drag && held.size) begin();
      return held.size === 0;
    },
    /** Shift: three times the pace */
    setFast(value) { fast = !!value; },
    /** let go of everything: the window lost focus, a dialog opened, the game took the camera */
    release() { drag = null; held.clear(); pace.f = pace.r = pace.u = 0; fast = false; ride = null; settle(); },

    /** the pose as this frame leaves it, so the next can tell whether something else placed the camera */
    remember() { left = { x: C.x, z: C.z, tx: T.x, ty: T.y, tz: T.z }; },

    /** one frame: pay out what is owed. Called before the controls' own update. */
    step(dt) {
      const quiet = still();
      /* placed by a tween, a named view or the GPS since the last frame: what the hand holds is taken again from there */
      const tol = settings.placedTolerance;
      if (left && (Math.abs(C.x - left.x) > tol || Math.abs(C.z - left.z) > tol
        || Math.abs(T.x - left.tx) > tol || Math.abs(T.y - left.ty) > tol || Math.abs(T.z - left.tz) > tol)) {
        settle();
        if (drag?.held) { take(drag); begin(); } else drag = null;
      }
      const k = quiet ? 1 : share(dt, settings.dragTau);
      const x0 = C.x, y0 = C.y, z0 = C.z;

      if (drag && !drag.held && (drag.vx || drag.vy)) {
        moved(drag.vx * dt, drag.vy * dt);
        const keep = Math.exp(-dt / settings.glide.tau);
        drag.vx *= keep; drag.vy *= keep;
        if (Math.hypot(drag.vx, drag.vy) < settings.glide.minSpeed * 0.1) drag.vx = drag.vy = 0;
      }

      if (orbit.yaw || orbit.pitch) {
        turn(orbit.pivot, orbit.yaw * k, orbit.pitch * k);
        orbit.yaw *= 1 - k; orbit.pitch *= 1 - k;
        if (Math.abs(orbit.yaw) + Math.abs(orbit.pitch) < 1e-7) orbit.yaw = orbit.pitch = 0;
      }
      if (look.yaw || look.pitch) {
        turn(null, look.yaw * k, look.pitch * k);
        look.yaw *= 1 - k; look.pitch *= 1 - k;
        if (Math.abs(look.yaw) + Math.abs(look.pitch) < 1e-7) look.yaw = look.pitch = 0;
      }

      let panOwed = 0;
      if (drag?.mode === 'pan') {
        const p = onPlane(rayAt(drag.x, drag.y).dir, drag.grab.y);
        const dx = drag.grab.x - p.x, dz = drag.grab.z - p.z;
        panOwed = Math.hypot(dx, dz);
        travel(dx * k, dz * k);
      }

      if (zoom.owed && zoom.anchor) {
        const part = zoom.owed * (quiet ? 1 : share(dt, settings.zoomTau));
        zoom.owed = zoomBy(part) ? zoom.owed - part : 0;
        if (Math.abs(zoom.owed) < 1e-4) zoom.owed = 0;
      }

      if (held.size || pace.f || pace.r || pace.u) {
        let wf = 0, wr = 0, wu = 0;
        for (const code of held) { const m = MOVE_KEYS[code]; wf += m[0]; wr += m[1]; wu += m[2]; }
        const h = height(), gear = fast ? settings.keys.fast : 1, flat = Math.hypot(wf, wr) || 1;
        const speed = Math.min(settings.keys.max, Math.max(settings.keys.walk, settings.keys.perHeight * h)) * gear;
        const climb = Math.min(settings.keys.max, Math.max(settings.keys.rise, settings.keys.risePerHeight * h)) * gear;
        const kk = quiet ? 1 : share(dt, held.size ? settings.keys.startTau : settings.keys.stopTau);
        pace.f += (wf / flat * speed - pace.f) * kk;
        pace.r += (wr / flat * speed - pace.r) * kk;
        pace.u += (wu * climb - pace.u) * kk;
        if (!held.size && Math.abs(pace.f) + Math.abs(pace.r) + Math.abs(pace.u) < 0.02) pace.f = pace.r = pace.u = 0;
        /* the heading is level whatever the view's tilt: looking straight down, W is still up the picture */
        const { r } = viewBasis(C, T, camera.quaternion);
        travel((r.z * pace.f + r.x * pace.r) * dt, (-r.x * pace.f + r.z * pace.r) * dt);
        if (pace.u) rise(pace.u * dt);
      }

      if (C.x !== x0 || C.z !== z0 || C.y !== y0) {
        if (!ride) begin();
        let dy = 0;
        /* riding the ground: carried by what it rose or fell under the eye */
        if (ride.share > 0 && (C.x !== x0 || C.z !== z0)) dy = ride.share * (meanGround(C.x, C.z, ride.radius) - meanGround(x0, z0, ride.radius));
        /* and never steered under standing height: held at it, or where it was if that was lower still */
        const y = C.y + dy;
        if (y < y0) dy += Math.max(0, Math.min(y0, ground(C.x, C.z) + eye) - y);
        if (dy) rise(dy);
      }

      if (drag && !drag.held && !drag.vx && !drag.vy && panOwed < 1e-3
        && !orbit.yaw && !orbit.pitch && !look.yaw && !look.pitch) drag = null;
      if (!drag && !held.size && !pace.f && !pace.r && !pace.u && !zoom.owed) ride = null;
    },
  };
}

/* ------------------------------------------------------------------ the page
   Bound to the running course through window.V3D. Returns null where the stock
   controls stay (?nav=before, or no course on the page). */
export function installCameraNavigation({ page = globalThis } = {}) {
  const V = page.V3D, doc = page.document;
  if (!V?.harness || !doc) return null;
  if (new URLSearchParams(page.location.search).get('nav') === 'before') return null;
  const { camera, controls, renderer } = V.harness();
  const canvas = renderer.domElement, body = doc.body;
  const motion = page.matchMedia?.('(prefers-reduced-motion: reduce)');
  const nav = createCameraNavigation({
    camera, controls, groundAt: V.groundAt, eye: V.groundClamp?.().eye ?? 1.7,
    viewport: () => canvas.getBoundingClientRect(), still: () => !!motion?.matches,
  });
  let on = true, pointer = null, keysMoving = false;
  /* Spela and Återupplev keep the stock controls round the ball */
  const stock = () => !on || controls.enabled === false || body.classList.contains('pl-on');
  const keysShut = () => stock() || body.classList.contains('choosing')
    || !!doc.getElementById('navDrawer')?.classList.contains('open') || !!page.BANVY_GOLFER;
  const announce = type => controls.dispatchEvent({ type });

  /* inside the controls' own update: after a tween or a flight has placed the camera, before the ground clamp */
  const update = controls.update.bind(controls);
  let last = 0;
  controls.update = deltaTime => {
    const now = page.performance.now(), gap = (now - last) / 1000;
    last = now;
    if (stock()) nav.release();
    else {
      if (keysMoving && keysShut()) endKeys();
      nav.step(gap > 0.25 ? 1 / 60 : Math.min(0.1, gap));
    }
    const changed = update(deltaTime);
    nav.remember();
    return changed;
  };

  /* The controls' own mouse buttons are set aside for a drag this module takes
     (they stay in their NONE state and announce nothing), and are theirs again
     for touch, a pen, the game and the before. */
  const theirs = controls.mouseButtons, none = Object.freeze({ LEFT: -1, MIDDLE: -1, RIGHT: -1 });
  const onDown = event => {
    if (pointer === null) controls.mouseButtons = theirs;
    if (stock() || pointer !== null || event.pointerType !== 'mouse' || event.target !== canvas) return;
    if (!nav.pointerDown({ button: event.button, x: event.clientX, y: event.clientY,
      swap: event.shiftKey || event.ctrlKey || event.metaKey, now: event.timeStamp })) return;
    controls.mouseButtons = none;
    pointer = event.pointerId;
    announce('start');
  };
  const onMove = event => { if (event.pointerId === pointer) nav.pointerMove({ x: event.clientX, y: event.clientY, now: event.timeStamp }); };
  const onUp = event => {
    if (event.pointerId !== pointer) return;
    pointer = null;
    nav.pointerUp({ now: event.timeStamp });
    controls.mouseButtons = theirs;
  };
  /* The wheel is this module's while it is on: the controls are told not to
     zoom for the length of the event's dispatch, which still reaches the
     canvas and whoever listens there. */
  let zoomWas = null;
  const giveBack = () => { if (zoomWas !== null) { controls.enableZoom = zoomWas; zoomWas = null; } };
  const onWheel = event => {
    if (stock() || event.target !== canvas) return;
    event.preventDefault();
    if (zoomWas === null) { zoomWas = controls.enableZoom; controls.enableZoom = false; page.setTimeout(giveBack, 0); }
    if (zoomWas === false) return;
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1);
    announce('start');
    nav.wheel({ deltaY: pixels, x: event.clientX, y: event.clientY, pinch: event.ctrlKey, now: event.timeStamp });
    announce('end');
  };
  function endKeys() { keysMoving = false; for (const code of Object.keys(MOVE_KEYS)) nav.keyUp(code); announce('end'); }
  const onKeyDown = event => {
    nav.setFast(event.shiftKey);
    if (!MOVE_KEYS[event.code] || event.ctrlKey || event.metaKey || event.altKey) return;
    if (keysShut() || event.target?.closest?.('input, textarea, select, [contenteditable]')) return;
    if (nav.keyDown(event.code)) { keysMoving = true; announce('start'); }
  };
  const onKeyUp = event => {
    nav.setFast(event.shiftKey);
    if (nav.keyUp(event.code) && keysMoving) { keysMoving = false; announce('end'); }
  };
  const onBlur = () => { pointer = null; controls.mouseButtons = theirs; if (keysMoving) endKeys(); nav.release(); };

  page.addEventListener('pointerdown', onDown, { capture: true });
  page.addEventListener('pointermove', onMove);
  page.addEventListener('pointerup', onUp);
  page.addEventListener('pointercancel', onUp);
  page.addEventListener('wheel', onWheel, { capture: true, passive: false });
  page.addEventListener('wheel', giveBack);
  page.addEventListener('keydown', onKeyDown);
  page.addEventListener('keyup', onKeyUp);
  page.addEventListener('blur', onBlur);

  /* what the screen says about it: the hint under the course, and the menu's list */
  const hint = doc.getElementById('hint');
  if (hint) hint.textContent = NAVIGATION_HINT;
  const list = doc.querySelector('#navDrawer .drawer-shortcuts');
  if (list && !doc.getElementById('navRows')) {
    const heading = doc.createElement('h3'), rows = doc.createElement('div');
    heading.className = 'nd-h'; heading.textContent = 'Mus och tangentbord';
    rows.className = 'drawer-shortcuts'; rows.id = 'navRows';
    for (const [keys, text] of NAVIGATION_ROWS) {
      const row = doc.createElement('div');
      row.className = 'sc-row';
      for (const key of keys) { const kbd = doc.createElement('kbd'); kbd.textContent = key; row.append(kbd, ' '); }
      const label = doc.createElement('span');
      label.textContent = text;
      row.append(label);
      rows.append(row);
    }
    list.after(heading, rows);
  }

  const api = {
    get enabled() { return on; },
    /** false is the stock controls again, on this page */
    setEnabled(value) { on = !!value; if (!on) onBlur(); return on; },
    state: () => nav.state(),
    settings: NAVIGATION,
  };
  page.BANVY_NAV = api;
  return api;
}
