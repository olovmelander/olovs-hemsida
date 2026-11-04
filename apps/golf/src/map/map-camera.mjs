/* The map's camera: a point on the ground, how far back, which way is up the
   screen and how far it leans. Pure maths, tested without a browser.

   World: x east, y up, z south. Bearing 0 has north up the screen. */
const FOV_DEGREES = 30;
export const MIN_TILT = 0.03, MAX_TILT = 1.32;
export const MIN_DISTANCE = 45, MAX_DISTANCE = 16000;

const normalize = v => { const l = Math.hypot(...v) || 1; return v.map(n => n / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    out[c * 4 + r] = a[r] * b[c * 4] + a[r + 4] * b[c * 4 + 1] + a[r + 8] * b[c * 4 + 2] + a[r + 12] * b[c * 4 + 3];
  }
  return out;
}

export function createCamera() {
  const state = { x: 0, y: 0, z: 0, distance: 1000, bearing: 0, tilt: 0.9, width: 1, height: 1 };
  const derived = { eye: [0, 0, 0], clip: new Float32Array(16), pixelsPerRadian: 1, right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1] };

  function update() {
    const { x, y, z, distance, bearing, tilt, width, height } = state;
    const ground = [Math.sin(bearing), 0, -Math.cos(bearing)];
    const eye = [
      x - ground[0] * distance * Math.sin(tilt),
      y + distance * Math.cos(tilt),
      z - ground[2] * distance * Math.sin(tilt),
    ];
    const forward = normalize([x - eye[0], y - eye[1], z - eye[2]]);
    const right = normalize(cross(forward, [0, 1, 0]));
    const up = cross(right, forward);
    const view = new Float32Array([
      right[0], up[0], -forward[0], 0,
      right[1], up[1], -forward[1], 0,
      right[2], up[2], -forward[2], 0,
      -dot(right, eye), -dot(up, eye), dot(forward, eye), 1,
    ]);
    /* Near grows with the view: depth precision is spent on the ground in
       front of the camera and the 16 km horizon still fits. */
    const near = Math.max(4, distance * 0.08), far = Math.max(distance * 40, 42000);
    const f = 1 / Math.tan(FOV_DEGREES * Math.PI / 360);
    const projection = new Float32Array([
      f / (width / height), 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) / (near - far), -1,
      0, 0, 2 * far * near / (near - far), 0,
    ]);
    derived.eye = eye;
    derived.forward = forward;
    derived.right = right;
    derived.up = up;
    derived.clip = multiply(projection, view);
    derived.pixelsPerRadian = height * f / 2;
  }

  /* Screen pixels from a world point; w <= 0 is behind the camera. */
  function project(x, y, z) {
    const m = derived.clip;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w <= 0) return { x: NaN, y: NaN, w };
    return { x: (cx / w * 0.5 + 0.5) * state.width, y: (0.5 - cy / w * 0.5) * state.height, w };
  }

  function ray(sx, sy) {
    const f = 1 / Math.tan(FOV_DEGREES * Math.PI / 360);
    const nx = (sx / state.width * 2 - 1) * (state.width / state.height) / f;
    const ny = (1 - sy / state.height * 2) / f;
    const { forward, right, up, eye } = derived;
    return { origin: eye, direction: normalize([
      forward[0] + right[0] * nx + up[0] * ny,
      forward[1] + right[1] * nx + up[1] * ny,
      forward[2] + right[2] * nx + up[2] * ny,
    ]) };
  }

  /* Where a screen point meets a level plane: fast and steady, which is what
     keeps the ground under the finger while panning. */
  function onPlane(sx, sy, planeY = state.y) {
    const { origin, direction } = ray(sx, sy);
    if (direction[1] > -1e-4) return null;
    const t = (planeY - origin[1]) / direction[1];
    return [origin[0] + direction[0] * t, origin[2] + direction[2] * t];
  }

  /* Where a screen point meets the ground itself. */
  function pick(sx, sy, heightAt, exaggeration) {
    const { origin, direction } = ray(sx, sy);
    if (direction[1] >= 0) return null;
    const above = t => {
      const x = origin[0] + direction[0] * t, z = origin[2] + direction[2] * t;
      const h = heightAt(x, z);
      return origin[1] + direction[1] * t - (Number.isFinite(h) ? h * exaggeration : state.y);
    };
    let t = 0, step = Math.max(2, state.distance / 90);
    const limit = state.distance * 8;
    while (t < limit && above(t + step) > 0) t += step;
    if (t >= limit) return onPlane(sx, sy);
    let low = t, high = t + step;
    for (let i = 0; i < 14; i++) {
      const mid = (low + high) / 2;
      if (above(mid) > 0) low = mid; else high = mid;
    }
    return [origin[0] + direction[0] * high, origin[2] + direction[2] * high];
  }

  /* Shows every point inside a screen rectangle at the given bearing and tilt.
     Solved by looking, not by formula: perspective and relief make the closed
     form a lie, and eight projections are nothing. */
  function fit(points, { bearing, tilt, insets, minDistance = 110, pivot = null }) {
    state.bearing = bearing;
    state.tilt = tilt;
    const safe = {
      x0: insets.left, y0: insets.top,
      x1: state.width - insets.right, y1: state.height - insets.bottom,
    };
    const midX = (safe.x0 + safe.x1) / 2, midY = (safe.y0 + safe.y1) / 2;
    const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length;
    const cy = points.reduce((sum, p) => sum + p[1], 0) / points.length;
    const cz = points.reduce((sum, p) => sum + p[2], 0) / points.length;
    state.x = cx; state.y = cy; state.z = cz;
    /* Start back far enough to see them all. A camera close in on one green, asked
       for a hole 400 m away, has those points behind it: they project to nothing,
       and measuring nothing turned the whole view to NaN and blanked the map. */
    const reach = Math.max(...points.map(p => Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz)), 1);
    state.distance = Math.max(state.distance, Math.min(MAX_DISTANCE, reach * 5));
    update();
    for (let i = 0; i < 12; i++) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, unseen = 0;
      for (const p of points) {
        const s = project(p[0], p[1], p[2]);
        if (!Number.isFinite(s.x)) { unseen++; continue; }
        x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x);
        y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y);
      }
      if (unseen) {
        state.distance = Math.min(MAX_DISTANCE, state.distance * 2);
        update();
        continue;
      }
      const scale = Math.max((x1 - x0) / (safe.x1 - safe.x0), (y1 - y0) / (safe.y1 - safe.y0), 0.02);
      state.distance = Math.min(MAX_DISTANCE, Math.max(minDistance, state.distance * (1 + (scale - 1) * 0.85)));
      update();
      const a = onPlane((x0 + x1) / 2, (y0 + y1) / 2), b = onPlane(midX, midY);
      if (a && b) { state.x += a[0] - b[0]; state.z += a[1] - b[1]; }
      /* The pivot lives on the ground, where the frame loop keeps it. Solving on
         any other height moves the picture the moment the camera lands. */
      if (pivot) state.y = pivot(state.x, state.z);
      update();
    }
    return { x: state.x, y: state.y, z: state.z, distance: state.distance, bearing, tilt };
  }

  update();
  return { state, derived, update, project, ray, onPlane, pick, fit };
}

const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const shortestTurn = (from, to) => {
  const turn = (to - from) % (Math.PI * 2);
  return turn > Math.PI ? turn - Math.PI * 2 : turn < -Math.PI ? turn + Math.PI * 2 : turn;
};

/* A flight between two views. Sampled by time, so a slow frame skips ahead
   instead of slowing the map down. */
export function createFlight(from, to, duration) {
  const turn = shortestTurn(from.bearing, to.bearing);
  const scale = Math.log(to.distance / from.distance);
  return {
    at(t) {
      const k = duration > 0 ? ease(Math.min(1, t / duration)) : 1;
      return {
        x: from.x + (to.x - from.x) * k,
        y: from.y + (to.y - from.y) * k,
        z: from.z + (to.z - from.z) * k,
        distance: from.distance * Math.exp(scale * k),
        bearing: from.bearing + turn * k,
        tilt: from.tilt + (to.tilt - from.tilt) * k,
      };
    },
    done: t => t >= duration,
  };
}
