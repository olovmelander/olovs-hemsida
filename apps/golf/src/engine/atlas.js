/* Runtime ground atlas.

   The pack remains fmt:1: this module rasterizes the existing course vectors once
   at boot, then both the shader and CPU-side placement code use constant-time
   lookups. Rasterization is deliberately implemented on typed arrays rather than
   an antialiased canvas: interpolated canvas colours are not valid class ids, and
   the pure implementation is probe-testable in Node. */

import * as THREE from 'three/webgpu';
import { ringBBox } from './geom.js';
import { SURFACE, SURFACE_PRIORITY } from './surface.js';

const MAX_EDGE_DISTANCE = 8;
/* Route distance is stored in a byte at 0.25 m so the shader can rebuild mow
   phase per fragment. Mown route bands only exist within ~40 m of a centreline,
   so the 63.75 m saturation point is deep in unbanded rough. A wrapped PHASE
   byte was tried first: linear filtering across each 2pi wrap manufactures a
   garbage seam per stripe, and a 1.5 m green stripe cannot live in a 1 m raster
   at all -- coordinates interpolate, phases do not. */
const ROUTE_SCALE = 4;
const INF = 1e20;
const SQRT2 = Math.SQRT2;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth01 = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const PRIORITY = new Uint8Array(256);
for (let i = 0; i < SURFACE_PRIORITY.length; i++) {
  PRIORITY[SURFACE_PRIORITY[i]] = SURFACE_PRIORITY.length - i;
}

function pointSegmentDistance(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 > 1e-9 ? clamp(((x - a[0]) * dx + (z - a[1]) * dz) / l2, 0, 1) : 0;
  return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
}

function rasterBounds(bb, bounds, pad = 0) {
  const { x0, z0, w, h, res } = bounds;
  return {
    i0: clamp(Math.floor((bb.x0 - pad - x0) / res), 0, w - 1),
    i1: clamp(Math.floor((bb.x1 + pad - x0) / res), 0, w - 1),
    j0: clamp(Math.floor((bb.z0 - pad - z0) / res), 0, h - 1),
    j1: clamp(Math.floor((bb.z1 + pad - z0) / res), 0, h - 1),
  };
}

/* Mow bands are sin(route distance x k): a 4% chamfer direction error is a
   visible wobble in every stripe, so the distance is EXACT out to the radius
   bands can reach (semi's outer falloff ends at 38 m) and the chamfer only
   serves the far field, where dLine gates broad colour ramps. ~30 ms. */
const EXACT_ROUTE_RADIUS = 42;

function buildRouteField(bounds, holes) {
  const { x0, z0, w, h, res } = bounds;
  const distance = new Float32Array(w * h);
  const owner = new Uint8Array(w * h);
  distance.fill(INF);

  for (const hole of holes || []) {
    const line = hole.line || [];
    for (let s = 0; s + 1 < line.length; s++) {
      const a = line[s], b = line[s + 1];
      const bb = {
        x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]),
        z0: Math.min(a[1], b[1]), z1: Math.max(a[1], b[1]),
      };
      const r = rasterBounds(bb, bounds, EXACT_ROUTE_RADIUS);
      for (let j = r.j0; j <= r.j1; j++) {
        const wz = z0 + (j + 0.5) * res;
        for (let i = r.i0; i <= r.i1; i++) {
          const wx = x0 + (i + 0.5) * res;
          const d = pointSegmentDistance(wx, wz, a, b);
          if (d > EXACT_ROUTE_RADIUS) continue;
          const k = j * w + i;
          if (d < distance[k]) { distance[k] = d; owner[k] = hole.n || 0; }
        }
      }
    }
  }

  const relax = (k, nk, step) => {
    const d = distance[nk] + step;
    if (d < distance[k]) { distance[k] = d; owner[k] = owner[nk]; }
  };
  const d1 = res, d2 = res * SQRT2;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i;
    if (i) relax(k, k - 1, d1);
    if (j) relax(k, k - w, d1);
    if (i && j) relax(k, k - w - 1, d2);
    if (i + 1 < w && j) relax(k, k - w + 1, d2);
  }
  for (let j = h - 1; j >= 0; j--) for (let i = w - 1; i >= 0; i--) {
    const k = j * w + i;
    if (i + 1 < w) relax(k, k + 1, d1);
    if (j + 1 < h) relax(k, k + w, d1);
    if (i + 1 < w && j + 1 < h) relax(k, k + w + 1, d2);
    if (i && j + 1 < h) relax(k, k + w - 1, d2);
  }
  return { distance, owner };
}

function buildBoundaryField(bounds, classes) {
  const { w, h, res } = bounds;
  const distance = new Float32Array(w * h);
  const neighbour = new Uint8Array(w * h);
  distance.fill(INF);
  neighbour.set(classes);

  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i, c = classes[k];
    let other = c;
    if (i && classes[k - 1] !== c) other = classes[k - 1];
    if (i + 1 < w && classes[k + 1] !== c && PRIORITY[classes[k + 1]] > PRIORITY[other]) other = classes[k + 1];
    if (j && classes[k - w] !== c && PRIORITY[classes[k - w]] > PRIORITY[other]) other = classes[k - w];
    if (j + 1 < h && classes[k + w] !== c && PRIORITY[classes[k + w]] > PRIORITY[other]) other = classes[k + w];
    if (other !== c) { distance[k] = res * 0.5; neighbour[k] = other; }
  }

  /* A boundary label may spread only through its own class region. Otherwise a
     high-priority surface on the far side of a third class can become the wrong
     secondary id at a three-way junction. */
  const relax = (k, nk, step) => {
    if (classes[nk] !== classes[k]) return;
    const d = distance[nk] + step;
    if (d < distance[k]) { distance[k] = d; neighbour[k] = neighbour[nk]; }
  };
  const d1 = res, d2 = res * SQRT2;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i;
    if (i) relax(k, k - 1, d1);
    if (j) relax(k, k - w, d1);
    if (i && j) relax(k, k - w - 1, d2);
    if (i + 1 < w && j) relax(k, k - w + 1, d2);
  }
  for (let j = h - 1; j >= 0; j--) for (let i = w - 1; i >= 0; i--) {
    const k = j * w + i;
    if (i + 1 < w) relax(k, k + 1, d1);
    if (j + 1 < h) relax(k, k + w, d1);
    if (i + 1 < w && j + 1 < h) relax(k, k + w + 1, d2);
    if (i && j + 1 < h) relax(k, k + w - 1, d2);
  }
  return { distance, neighbour };
}

/** Pure, Node-testable raster half of createGroundAtlas(). */
export function rasterizeGroundAtlas({ CORE, HOLES = [], features = [], res = 1 }) {
  if (!(res > 0)) throw new Error('ground atlas resolution must be positive');
  const w = Math.max(1, Math.ceil((CORE.x1 - CORE.x0) / res));
  const h = Math.max(1, Math.ceil((CORE.z1 - CORE.z0) / res));
  const bounds = { x0: CORE.x0, z0: CORE.z0, x1: CORE.x0 + w * res, z1: CORE.z0 + h * res, w, h, res };
  const classes = new Uint8Array(w * h);
  const ranks = new Uint8Array(w * h);
  const route = buildRouteField(bounds, HOLES);
  ranks.fill(PRIORITY[SURFACE.ROUGH]);

  const paint = (i, j, feature) => {
    const k = j * w + i;
    const rank = PRIORITY[feature.surface] || 0;
    if (rank < ranks[k]) return;
    classes[k] = feature.surface;
    ranks[k] = rank;
    if (feature.hole) route.owner[k] = feature.hole;
  };

  function fillRing(ring, feature) {
    if (!ring || ring.length < 3) return;
    const rb = ringBBox(ring);
    const area = rasterBounds(rb, bounds);
    /* Even/odd scanline fill at texel centres: crisp integer class ids, no canvas
       antialias colours leaking into the id texture. */
    for (let j = area.j0; j <= area.j1; j++) {
      const wz = bounds.z0 + (j + 0.5) * res;
      const xs = [];
      for (let p = 0, q = ring.length - 1; p < ring.length; q = p++) {
        const a = ring[q], b = ring[p];
        if ((a[1] > wz) === (b[1] > wz)) continue;
        xs.push(a[0] + (wz - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
      xs.sort((a, b) => a - b);
      for (let n = 0; n + 1 < xs.length; n += 2) {
        const i0 = clamp(Math.ceil((xs[n] - bounds.x0) / res - 0.5), 0, w - 1);
        const i1 = clamp(Math.floor((xs[n + 1] - bounds.x0) / res - 0.5), 0, w - 1);
        for (let i = i0; i <= i1; i++) paint(i, j, feature);
      }
    }
    const pad = feature.pad || 0;
    if (pad <= 0) return;
    /* Rounded segment dilation reproduces offsetRing without constructing fragile
       offset polygons. Work is proportional to boundary length x padding. */
    for (let p = 0; p < ring.length; p++) {
      const a = ring[p], b = ring[(p + 1) % ring.length];
      const bb = { x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), z0: Math.min(a[1], b[1]), z1: Math.max(a[1], b[1]) };
      const r = rasterBounds(bb, bounds, pad);
      for (let j = r.j0; j <= r.j1; j++) {
        const wz = bounds.z0 + (j + 0.5) * res;
        for (let i = r.i0; i <= r.i1; i++) {
          const wx = bounds.x0 + (i + 0.5) * res;
          if (pointSegmentDistance(wx, wz, a, b) <= pad) paint(i, j, feature);
        }
      }
    }
  }

  function strokeLine(line, feature) {
    if (!line || line.length < 2) return;
    const half = Math.max(res * 0.5, feature.width || 1);
    for (let p = 0; p + 1 < line.length; p++) {
      const a = line[p], b = line[p + 1];
      const bb = { x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), z0: Math.min(a[1], b[1]), z1: Math.max(a[1], b[1]) };
      const r = rasterBounds(bb, bounds, half);
      for (let j = r.j0; j <= r.j1; j++) {
        const wz = bounds.z0 + (j + 0.5) * res;
        for (let i = r.i0; i <= r.i1; i++) {
          const wx = bounds.x0 + (i + 0.5) * res;
          if (pointSegmentDistance(wx, wz, a, b) <= half) paint(i, j, feature);
        }
      }
    }
  }

  for (const feature of features) {
    if (!Number.isInteger(feature.surface)) continue;
    for (const ring of feature.rings || []) fillRing(ring, feature);
    if (feature.line) strokeLine(feature.line, feature);
  }

  const edge = buildBoundaryField(bounds, classes);
  const idData = new Uint8Array(w * h * 2);
  const fieldData = new Uint8Array(w * h * 4);
  const signedDistance = new Float32Array(w * h);
  const classCounts = new Uint32Array(256);
  for (let k = 0; k < classes.length; k++) {
    const current = classes[k], other = edge.neighbour[k];
    classCounts[current]++;
    let primary = current, secondary = other, sign = 1;
    if (other !== current && PRIORITY[other] > PRIORITY[current]) {
      primary = other; secondary = current; sign = -1;
    }
    const d = edge.distance[k] >= INF / 2 ? MAX_EDGE_DISTANCE : Math.min(MAX_EDGE_DISTANCE, edge.distance[k]);
    const sd = d * sign;
    signedDistance[k] = sd;
    idData[k * 2] = primary;
    idData[k * 2 + 1] = secondary;
    fieldData[k * 4] = Math.round((sd + MAX_EDGE_DISTANCE) / (MAX_EDGE_DISTANCE * 2) * 255);
    fieldData[k * 4 + 1] = Math.round(Math.min(255, route.distance[k] * ROUTE_SCALE));
    fieldData[k * 4 + 2] = route.owner[k];
    fieldData[k * 4 + 3] = 0;
  }
  return { bounds, classes, classCounts, idData, fieldData, signedDistance, routeDistance: route.distance, owner: route.owner };
}

export function createGroundAtlas(options) {
  const raster = rasterizeGroundAtlas(options);
  const { bounds, classes, classCounts, idData, fieldData, signedDistance, routeDistance, owner } = raster;
  const texID = new THREE.DataTexture(idData, bounds.w, bounds.h, THREE.RGFormat, THREE.UnsignedByteType);
  texID.minFilter = THREE.NearestFilter;
  texID.magFilter = THREE.NearestFilter;
  texID.generateMipmaps = false;
  texID.flipY = false;
  texID.needsUpdate = true;

  const texF = new THREE.DataTexture(fieldData, bounds.w, bounds.h, THREE.RGBAFormat, THREE.UnsignedByteType);
  texF.minFilter = THREE.LinearFilter;
  texF.magFilter = THREE.LinearFilter;
  texF.generateMipmaps = false;
  texF.flipY = false;
  texF.needsUpdate = true;

  const indexAt = (wx, wz) => {
    const i = Math.floor((wx - bounds.x0) / bounds.res);
    const j = Math.floor((wz - bounds.z0) / bounds.res);
    return i < 0 || j < 0 || i >= bounds.w || j >= bounds.h ? -1 : j * bounds.w + i;
  };
  const sampleAt = (wx, wz) => {
    const k = indexAt(wx, wz);
    if (k < 0) return { inBounds: false, surface: SURFACE.ROUGH, primary: SURFACE.ROUGH, secondary: SURFACE.ROUGH, sdf: MAX_EDGE_DISTANCE, hole: 0, dLine: Infinity };
    return {
      inBounds: true,
      surface: classes[k],
      primary: idData[k * 2],
      secondary: idData[k * 2 + 1],
      sdf: signedDistance[k],
      hole: owner[k],
      dLine: routeDistance[k],
    };
  };
  /* The signed distance replays the analytic ramps for the classes whose colour
     still comes from the terrain's VERTICES (forest floor, wetland): a binary
     weight there is a hard 4 m stair-step where the old classifier faded over
     six metres. sdf is signed by the PRIMARY id, so the class's own ringSD is
     -sdf when it is primary and +sdf when it is the secondary side. */
  const edgeRamp = (s, id, a, b) => {
    if (s.primary === id) return 1 - smooth01(a, b, -s.sdf);
    if (s.secondary === id) return 1 - smooth01(a, b, s.sdf);
    return 0;
  };
  const classifyAt = (wx, wz) => {
    const s = sampleAt(wx, wz);
    const c = { green: 0, fringe: 0, tee: 0, sand: 0, fair: 0, path: 0, forest: 0, wet: 0, dLine: s.dLine, hole: s.hole, surface: s.surface, inBounds: s.inBounds };
    if (s.surface === SURFACE.GREEN) c.green = 1;
    else if (s.surface === SURFACE.FRINGE) { c.fringe = 1; c.fair = 0.35; }
    else if (s.surface === SURFACE.TEE) c.tee = 1;
    else if (s.surface === SURFACE.SAND) c.sand = 1;
    else if (s.surface === SURFACE.FAIRWAY) c.fair = 1;
    else if (s.surface === SURFACE.SEMI) c.fair = 0.35;
    else if ([SURFACE.PATH, SURFACE.ASPHALT, SURFACE.GRAVEL, SURFACE.DIRT].includes(s.surface)) c.path = 1;
    c.forest = edgeRamp(s, SURFACE.FOREST, -6, 2);
    c.wet = Math.max(s.surface === SURFACE.MUD ? 1 : 0, edgeRamp(s, SURFACE.WETLAND, -4, 2));
    return c;
  };

  return {
    texID,
    texF,
    bounds,
    sampleAt,
    classifyAt,
    contains: (x, z) => indexAt(x, z) >= 0,
    dispose: () => { texID.dispose(); texF.dispose(); },
    /* Exposed only for deterministic probes/tests and boot telemetry. */
    data: { bounds, classes, classCounts, idData, fieldData },
  };
}
