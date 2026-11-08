/* A golf ball, from the club to where it rests.

   World frame: metres, y up, the ground plane is x/z (the detailed course's own
   frame). Pure functions on plain arrays, no three.js, so the whole shot can be
   simulated ahead (the aim marker, the putt preview) and tested in node.

   Flight: gravity, drag and the spin's lift (Magnus), in the wind of a log
   profile over short grass. The aerodynamic coefficients follow the usual fits
   for a dimpled ball against the spin factor S = r*omega/|v| (Smits and Smith
   1994; Bearman and Harvey 1976), and the spin decays a few percent a second.

   Ground: each surface has its own bounce (restitution and the grip that turns
   backspin into check), its own rolling resistance (a green rolls at about 10
   on the stimpmeter) and its own rules: sand plugs, water keeps the ball, the
   cup takes a ball that reaches it slowly enough. A rolling ball follows the
   real slopes of the height field, with the 5/7 of a rolling sphere. */

export const BALL = Object.freeze({ mass: .04593, radius: .02135, rho: 1.2, g: 9.81 });
export const CUP_RADIUS = .054;
const AREA = Math.PI * BALL.radius * BALL.radius;
const RPM = 2 * Math.PI / 60;

/* Surfaces: e = restitution of a normal impact, keep = tangential speed kept
   through a bounce, grip = how much backspin bites (check and spin-back),
   roll = rolling resistance (deceleration / g). The green's 0.06 is a stimp of
   about 10 feet; sand stops a ball almost at once. */
export const SURFACES = Object.freeze({
  green:   { e: .30, keep: .58, mu: .55, grip: .95, roll: .060 },
  fringe:  { e: .32, keep: .55, mu: .55, grip: .75, roll: .105 },
  fairway: { e: .40, keep: .62, mu: .50, grip: .55, roll: .135 },
  tee:     { e: .40, keep: .62, mu: .50, grip: .55, roll: .130 },
  rough:   { e: .22, keep: .36, mu: .75, grip: .20, roll: .360 },
  forest:  { e: .20, keep: .30, mu: .85, grip: .15, roll: .450 },
  sand:    { e: .05, keep: .12, mu: 1.4, grip: .10, roll: .900 },
  path:    { e: .58, keep: .82, mu: .35, grip: .30, roll: .035 },
  water:   { e: 0, keep: 0, mu: 1, grip: 0, roll: 1 },
});
export function surfaceOf(kind) { return SURFACES[kind] || SURFACES.rough; }

/* Launch by club. Angles and spins are typical for a good amateur (TrackMan
   averages); the ball speed of a full swing is solved per player so that the
   no-wind carry on flat ground equals the carry of their own bag. */
export const CLUB_LAUNCH = Object.freeze({
  driver: { launch: 12.5, spin: 2700, swing: 'Driver' },
  wood:   { launch: 12.0, spin: 3700, swing: 'Wood' },
  hybrid: { launch: 13.5, spin: 4400, swing: 'Wood' },
  iron3:  { launch: 13.5, spin: 4400, swing: 'Iron' },
  iron4:  { launch: 14.5, spin: 4800, swing: 'Iron' },
  iron5:  { launch: 15.5, spin: 5400, swing: 'Iron' },
  iron6:  { launch: 17.0, spin: 6200, swing: 'Iron' },
  iron7:  { launch: 18.5, spin: 7000, swing: 'Iron' },
  iron8:  { launch: 20.5, spin: 7800, swing: 'Iron' },
  iron9:  { launch: 22.5, spin: 8500, swing: 'Iron' },
  pw:     { launch: 25.0, spin: 9200, swing: 'Wedge' },
  gw:     { launch: 28.0, spin: 9600, swing: 'Wedge' },
  sw:     { launch: 31.0, spin: 9900, swing: 'Wedge' },
  lw:     { launch: 34.0, spin: 10200, swing: 'Wedge' },
  putter: { launch: 1.5, spin: 0, swing: 'Putter' },
});

const v = (x = 0, y = 0, z = 0) => [x, y, z];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a); return l > 1e-12 ? mul(a, 1 / l) : [0, 0, 0]; };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** Drag and lift coefficients against the spin factor. */
export function aeroCoefficients(spinFactor) {
  const S = clamp(spinFactor, 0, .45);
  return { cd: .225 + .25 * S, cl: S <= 0 ? 0 : Math.min(.36, .36 * Math.pow(S, .3)) };
}

/** The wind at a height: a log profile over short grass, scaled from its 10 m value. */
export function windAt(wind10, height) {
  const z0 = .03, h = Math.max(.2, height);
  const k = Math.log(h / z0) / Math.log(10 / z0);
  return [wind10[0] * k, 0, wind10[1] * k];
}

/** The launch velocity and spin vector for a yaw (radians, 0 = +z), elevation and spin axis tilt. */
export function launchState({ speed, launchDeg, yaw, spinRpm, axisDeg = 0 }) {
  const el = launchDeg * Math.PI / 180;
  const dir = [Math.sin(yaw) * Math.cos(el), Math.sin(el), Math.cos(yaw) * Math.cos(el)];
  const velocity = mul(dir, speed);
  // Backspin's axis is horizontal, to the right of the flight (v x up); a tilt
  // turns it about the flight: positive curves the ball to the right.
  const right = norm(cross(dir, [0, 1, 0]));
  const a = axisDeg * Math.PI / 180;
  const axis = add(mul(right, Math.cos(a)), mul(cross(dir, right), Math.sin(a)));
  return { velocity, spin: mul(norm(axis), spinRpm * RPM) };
}

function acceleration(p, vel, spin, wind10, rho = BALL.rho) {
  const rel = sub(vel, windAt(wind10, p[1]));
  const speed = len(rel);
  const accel = [0, -BALL.g, 0];
  if (speed < 1e-6) return accel;
  const omega = len(spin);
  const { cd, cl } = aeroCoefficients(BALL.radius * omega / speed);
  const q = .5 * rho * AREA * speed / BALL.mass;
  const drag = mul(rel, -q * cd);
  let lift = [0, 0, 0];
  if (omega > 1e-6) {
    const dir = norm(cross(spin, rel));
    lift = mul(dir, q * cl * speed);
  }
  return add(add(accel, drag), lift);
}

/* A deterministic generator, so the same shot always plays the same. */
export function seeded(seed) {
  let s = (Math.floor(Math.abs(seed)) % 2147483647) || 1;
  return () => (s = s * 16807 % 2147483647) / 2147483647;
}

export function groundNormal(heightAt, x, z, h = .25) {
  const dx = heightAt(x + h, z) - heightAt(x - h, z);
  const dz = heightAt(x, z + h) - heightAt(x, z - h);
  return norm([-dx, 2 * h, -dz]);
}

/**
 * Simulate a shot from a lie to its rest.
 *
 * world: { heightAt(x, z), surfaceAt(x, z) -> SURFACES key, cup: [x, z] | null,
 *          isOut(x, z) -> boolean, trees: { near(x, z, r) -> [{ x, y, z, height, radius, trunk }] } | null,
 *          ground(kind) -> a surface (the day's: wet, firm, snow; SURFACES when left out),
 *          plug: 0..1 how much likelier a ball buries itself in sand (a wet day) }
 * shot:  { start: [x, y, z], velocity, spin (rad/s vector), wind: [wx, wz] at 10 m, seed,
 *          rho: the air's density (kg/m3; BALL.rho when left out: colder air is thicker) }
 * Returns { path: [[t, x, y, z, phase]], rest: [x, y, z], outcome, carry, total, apex, landing, ... }.
 * outcome: 'rest' | 'holed' | 'water' | 'out'. For water, `entry` is where it crossed into the water.
 */
export function simulateShot(world, shot, options = {}) {
  const dt = options.dt ?? 1 / 240, maxTime = options.maxTime ?? 40;
  const record = options.record !== false, every = options.every ?? 4;
  const rand = seeded(shot.seed ?? 7);
  const { heightAt, surfaceAt } = world;
  const groundOf = world.ground || surfaceOf, plugBonus = world.plug || 0, rho = shot.rho ?? BALL.rho;
  const cup = world.cup || null;
  let p = shot.start.slice(), vel = shot.velocity.slice(), spin = shot.spin.slice();
  const wind = shot.wind || [0, 0];
  const path = [];
  /* What a listener would hear: every bounce and branch, the cup, the water. */
  const events = [];
  let t = 0, phase = shot.roll ? 'roll' : 'air', step = 0, bounces = 0, apex = p[1], landing = null, treeHits = 0;
  let lastDry = [p[0], p[2]], entry = null, plugged = false;
  const startXZ = [p[0], p[2]];
  const push = () => { if (record) path.push([t, p[0], p[1], p[2], phase]); };
  push();
  const finish = (outcome, extra = {}) => {
    if (record) path.push([t, p[0], p[1], p[2], phase]);
    const total = Math.hypot(p[0] - startXZ[0], p[2] - startXZ[1]);
    if (outcome === 'holed') events.push({ t, type: 'cup' });
    if (outcome === 'water') events.push({ t, type: 'water' });
    return { path, events, rest: p, outcome, total, apex: apex - shot.start[1], landing, bounces, treeHits, time: t, plugged,
      carry: landing ? Math.hypot(landing[0] - startXZ[0], landing[2] - startXZ[1]) : total, ...extra };
  };
  const holeCheck = (a, b, speed) => {
    if (!cup) return false;
    // Closest approach of this step's segment to the cup's centre.
    const ax = a[0] - cup[0], az = a[2] - cup[1], bx = b[0] - a[0], bz = b[2] - a[2];
    const l2 = bx * bx + bz * bz;
    const s = l2 > 0 ? clamp(-(ax * bx + az * bz) / l2, 0, 1) : 0;
    const d = Math.hypot(ax + bx * s, az + bz * s);
    // A ball dies in when its centre passes over the cup slowly enough; faster
    // it needs to be truer to the middle, and above ~1.6 m/s it lips out.
    const allowed = CUP_RADIUS * clamp(1.15 - speed / 1.6, 0, 1);
    return d < allowed;
  };

  while (t < maxTime) {
    if (phase === 'air') {
      // RK4 through the air.
      const a1 = acceleration(p, vel, spin, wind, rho);
      const p2 = add(p, mul(vel, dt / 2)), v2 = add(vel, mul(a1, dt / 2));
      const a2 = acceleration(p2, v2, spin, wind, rho);
      const p3 = add(p, mul(v2, dt / 2)), v3 = add(vel, mul(a2, dt / 2));
      const a3 = acceleration(p3, v3, spin, wind, rho);
      const p4 = add(p, mul(v3, dt)), v4 = add(vel, mul(a3, dt));
      const a4 = acceleration(p4, v4, spin, wind, rho);
      const prev = p;
      p = add(p, mul(add(add(vel, mul(add(v2, v3), 2)), v4), dt / 6));
      vel = add(vel, mul(add(add(a1, mul(add(a2, a3), 2)), a4), dt / 6));
      spin = mul(spin, Math.exp(-dt / 24));
      t += dt; apex = Math.max(apex, p[1]);
      // Trees: the trunk turns the ball back, the crown slows and scatters it.
      if (world.trees) {
        for (const tree of world.trees.near(p[0], p[2], 12)) {
          const rx = p[0] - tree.x, rz = p[2] - tree.z, h = p[1] - tree.y;
          if (h < 0 || h > tree.height) continue;
          const horizontal = Math.hypot(rx, rz);
          const crownBase = tree.height * .32, crownMid = tree.height * .62;
          const crownR = tree.radius, crownH = tree.height - crownBase;
          if (h < crownBase + .4 && horizontal < tree.trunk + BALL.radius) {
            const nx = rx / (horizontal || 1), nz = rz / (horizontal || 1);
            const vn = vel[0] * nx + vel[2] * nz;
            if (vn < 0) { vel = [vel[0] - 1.45 * vn * nx, vel[1], vel[2] - 1.45 * vn * nz]; vel = mul(vel, .55); treeHits++; events.push({ t, type: 'trunk' }); }
            continue;
          }
          const ex = horizontal / crownR, ey = (h - crownMid) / (crownH * .5);
          if (ex * ex + ey * ey < 1) {
            // A chance per metre travelled through foliage of meeting a branch.
            const travelled = len(vel) * dt;
            if (rand() < travelled * .32) {
              const speed = len(vel) * (.25 + .25 * rand());
              const out = norm([rand() - .5, -.4 - rand() * .6, rand() - .5]);
              vel = mul(norm(add(mul(norm(vel), .35), out)), speed);
              spin = mul(spin, .3); treeHits++; events.push({ t, type: 'leaves' });
            }
          }
        }
      }
      const ground = heightAt(p[0], p[2]);
      const kindHere = surfaceAt(p[0], p[2]);
      if (kindHere !== 'water') lastDry = [p[0], p[2]];
      else if (!entry && kindHere === 'water') entry = lastDry.slice();
      if (p[1] - BALL.radius <= ground) {
        // Back to the contact point along this step.
        p[1] = ground + BALL.radius;
        const kind = surfaceAt(p[0], p[2]);
        if (!landing) landing = p.slice();
        if (cup && kind === 'green' && Math.hypot(p[0] - cup[0], p[2] - cup[1]) < CUP_RADIUS - BALL.radius * .3 && len(vel) < 12) {
          return finish('holed');
        }
        if (kind === 'water') return finish('water', { entry: entry || lastDry });
        const s = groundOf(kind);
        const n = groundNormal(heightAt, p[0], p[2]);
        const vn = dot(vel, n);
        // A steep, fast first landing in sand buries the ball where it lands: a plugged lie
        // (likelier in wet sand).
        if (kind === 'sand' && bounces === 0 && -vn > 11 - 4 * plugBonus && rand() < clamp((-vn - 11) / 10 + .4 * plugBonus, 0, .85)) {
          plugged = true; vel = [0, 0, 0]; phase = 'roll'; bounces++;
          events.push({ t, type: 'bounce', surface: kind, speed: -vn });
          push();
          continue;
        }
        let vt = sub(vel, mul(n, vn));
        const tangentSpeed = len(vt);
        // Backspin bites: it takes tangential speed off in proportion to the
        // normal impact, so a steep wedge checks and can draw back on a green.
        const backspin = Math.max(0, dot(spin, norm(cross(norm(vt.length ? vt : vel), n))));
        const bite = s.grip * (backspin / (9000 * RPM)) * Math.abs(vn) * .55;
        // Friction takes at most (1 - keep) of the tangential speed, and never
        // more than the impact's own friction impulse: a shallow touchdown skids on.
        const loss = Math.min(tangentSpeed * (1 - s.keep), s.mu * (1 + s.e) * Math.abs(vn));
        let kept = tangentSpeed - loss - bite;
        vt = mul(norm(vt), kept);
        // Restitution falls with impact speed (soft turf takes a hard landing).
        const e = s.e * clamp(1.15 - Math.abs(vn) / 40, .45, 1);
        vel = add(vt, mul(n, -vn * e));
        spin = mul(spin, .35);
        bounces++;
        events.push({ t, type: 'bounce', surface: kind, speed: Math.abs(vn) });
        if (Math.abs(vn) * e < .7 || bounces > 6 || kind === 'sand') {
          phase = 'roll';
          vel = sub(vel, mul(n, dot(vel, n)));
          if (kind === 'sand') vel = mul(vel, .15);
        }
        push();
        continue;
      }
      if (cup && p[1] - heightAt(p[0], p[2]) < .2 && holeCheck(prev, p, len(vel))) return finish('holed');
    } else {
      // Rolling on the surface: the slope's pull (5/7 g for a rolling sphere),
      // rolling resistance against the motion, the cup when it is reached.
      const kind = surfaceAt(p[0], p[2]);
      if (kind === 'water') return finish('water', { entry: entry || lastDry });
      lastDry = [p[0], p[2]];
      const s = groundOf(kind);
      const e = .3, hx = (heightAt(p[0] + e, p[2]) - heightAt(p[0] - e, p[2])) / (2 * e);
      const hz = (heightAt(p[0], p[2] + e) - heightAt(p[0], p[2] - e)) / (2 * e);
      const slope = [-hx * BALL.g * 5 / 7, -hz * BALL.g * 5 / 7];
      const speed = Math.hypot(vel[0], vel[2]);
      const pull = Math.hypot(slope[0], slope[1]);
      const resist = s.roll * BALL.g;
      if (speed < .025 && pull < resist * 1.35) {
        p[1] = heightAt(p[0], p[2]) + BALL.radius;
        if (world.isOut?.(p[0], p[2])) return finish('out');
        return finish('rest', { surface: kind });
      }
      let ax = slope[0], az = slope[1];
      if (speed > 1e-6) { ax -= resist * vel[0] / speed; az -= resist * vel[2] / speed; }
      const prev = p.slice();
      let vx = vel[0] + ax * dt, vz = vel[2] + az * dt;
      // Friction never reverses the ball; the slope may.
      if (speed > 1e-6 && (vx * vel[0] + vz * vel[2]) < 0 && pull < resist) { vx = 0; vz = 0; }
      vel = [vx, 0, vz];
      p = [p[0] + vx * dt, 0, p[2] + vz * dt];
      p[1] = heightAt(p[0], p[2]) + BALL.radius;
      t += dt;
      if (kind === 'green' || kind === 'fringe') {
        if (holeCheck(prev, p, Math.hypot(vx, vz))) { p = [cup[0], heightAt(cup[0], cup[1]) - .05, cup[1]]; return finish('holed'); }
      }
    }
    if (++step % every === 0) push();
  }
  if (world.isOut?.(p[0], p[2])) return finish('out');
  return finish('rest', { surface: surfaceAt(p[0], p[2]), timedOut: true });
}

/** The carry of a launch on flat open ground with no wind (for calibration). */
export function flatCarry({ speed, launchDeg, spinRpm }) {
  const world = { heightAt: () => 0, surfaceAt: () => 'fairway', cup: null };
  const { velocity, spin } = launchState({ speed, launchDeg, yaw: 0, spinRpm });
  return simulateShot(world, { start: [0, BALL.radius, 0], velocity, spin }, { record: false, dt: 1 / 120 }).carry;
}

/** The ball speed of a full swing that carries a club its distance (bisection). */
export function speedForCarry(club, carry) {
  const spec = CLUB_LAUNCH[club] || CLUB_LAUNCH.iron7;
  let lo = 8, hi = 95;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (flatCarry({ speed: mid, launchDeg: spec.launch, spinRpm: spec.spin }) < carry) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The starting speed that rolls a putt d metres on a flat green. */
export function puttSpeedFor(distance, roll = SURFACES.green.roll) {
  return Math.sqrt(2 * roll * BALL.g * Math.max(0, distance));
}
