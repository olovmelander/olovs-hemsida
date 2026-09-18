/* Runtime ground atlas.

   The pack remains fmt:1: this module rasterizes the existing course vectors once
   at boot, then both the shader and CPU-side placement code use constant-time
   lookups. Rasterization is deliberately implemented on typed arrays rather than
   an antialiased canvas: interpolated canvas colours are not valid class ids, and
   the pure implementation is probe-testable in Node. */

import * as THREE from 'three/webgpu';
import { ringBBox } from './geom.js';
import { SURFACE, SURFACE_PRIORITY } from './surface.js';
import { canopySampler } from './canopy-cover.mjs';
import { fitFeatures, buildExactClassSdf, packClassPlanes, encodeDistance } from './exact-class-sdf.mjs';

const MAX_EDGE_DISTANCE = 8;
/* Route distance is stored in a byte at 0.25 m so the shader can rebuild mow
   phase per fragment. Mown route bands only exist within ~40 m of a centreline,
   so the 63.75 m saturation point is deep in unbanded rough. A wrapped PHASE
   byte was tried first: linear filtering across each 2pi wrap manufactures a
   garbage seam per stripe, and a 1.5 m green stripe cannot live in a 1 m raster
   at all -- coordinates interpolate, phases do not. */
const ROUTE_SCALE = 4;
/* Distance to a surface's own edge, UNCLAMPED, in the spare field channel.
   Greens and their collars are mown in rings from the edge inward, and that
   coordinate used to be taken from the SDF -- which is clamped to +/-8 m for
   edge precision, so on any green wider than 16 m the whole middle saturated at
   8 and the rings stopped: a flat disc with a banded rim. Greens here run
   20-30 m across, so that was most of every green on all six courses. This
   channel carries the same chamfer distance at 0.16 m over 0-40 m, which is
   coarser than the SDF and does not care, because a mow ring is 1.5 m wide. */
const RING_SCALE = 0.16;
const RING_MAX = 255 * RING_SCALE;
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
  /* Surface tiles reserve 16 bits for a stable owning feature id. The legacy
     material texture still narrows its hole owner to one byte at upload time,
     but keeping the raster authoritative avoids silently wrapping compiler
     feature ids above 255. */
  const owner = new Uint16Array(w * h);
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

  /* The highest-priority DIFFERING 4-neighbour, from all four sides alike.
     `other` used to start as the texel's own class with only the west test
     unconditional, so a lower-priority neighbour to the east, north or south
     never outranked it and the higher side of an edge was seeded on west-facing
     texels alone: at Angso not one green, tee or bunker texel was seeded on its
     other three sides, the unseeded ones stored up to +8 m beside -0.5 m, and a
     quarter of all mown edges had no zero crossing left -- the edge drawn there
     was the nearest-filtered id grid itself, in perfect 1 m squares. The probe
     test only ever looked at a west edge, which is how it agreed with this. */
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i, c = classes[k];
    let other = c;
    const consider = nk => {
      const n = classes[nk];
      if (n !== c && (other === c || PRIORITY[n] > PRIORITY[other])) other = n;
    };
    if (i) consider(k - 1);
    if (i + 1 < w) consider(k + 1);
    if (j) consider(k - w);
    if (j + 1 < h) consider(k + w);
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
export function rasterizeGroundAtlas({ CORE, HOLES = [], features = [], res = 1, boundaryOnly = false, classesOnly = false, canopyFloor = null }) {
  if (!(res > 0)) throw new Error('ground atlas resolution must be positive');
  const w = Math.max(1, Math.ceil((CORE.x1 - CORE.x0) / res));
  const h = Math.max(1, Math.ceil((CORE.z1 - CORE.z0) / res));
  const bounds = { x0: CORE.x0, z0: CORE.z0, x1: CORE.x0 + w * res, z1: CORE.z0 + h * res, w, h, res };
  const classes = new Uint8Array(w * h);
  const ranks = new Uint8Array(w * h);
  /* Surface compilation may ask only for a supersampled material boundary.
     Skipping route/owner fields keeps a 4x boundary pass bounded in memory and
     avoids recomputing mowing coordinates that already exist on the 1 m pass. */
  const route = boundaryOnly || classesOnly ? null : buildRouteField(bounds, HOLES);
  ranks.fill(PRIORITY[SURFACE.ROUGH]);

  const paint = (i, j, feature) => {
    const k = j * w + i;
    const rank = PRIORITY[feature.surface] || 0;
    if (rank < ranks[k]) return;
    classes[k] = feature.surface;
    ranks[k] = rank;
    if (feature.hole && route) route.owner[k] = feature.hole;
  };

  // Seed forest floor from this course's observed canopy, then let every
  // higher-priority played/hard/wet surface win. No polygon growth, new mesh,
  // tree placement or per-frame work; this runs once with atlas construction.
  if (canopyFloor) {
    const sample = canopySampler(canopyFloor);
    const feature = { surface: SURFACE.FOREST };
    const area = rasterBounds({ x0: canopyFloor.x0, z0: canopyFloor.z0,
      x1: canopyFloor.x0 + canopyFloor.nx * canopyFloor.cell,
      z1: canopyFloor.z0 + canopyFloor.nz * canopyFloor.cell }, bounds);
    for (let j = area.j0; j <= area.j1; j++) for (let i = area.i0; i <= area.i1; i++) {
      if (sample(bounds.x0 + (i + 0.5) * res, bounds.z0 + (j + 0.5) * res) === 3) paint(i, j, feature);
    }
  }

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

  function fillPolygon(rings, feature) {
    if (!Array.isArray(rings) || !rings.length) return;
    if (feature.pad > 0) {
      throw new Error('polygon-with-holes features do not support implicit padding');
    }
    const valid = rings.filter(ring => Array.isArray(ring) && ring.length >= 3);
    if (!valid.length) return;
    const boxes = valid.map(ringBBox);
    const area = rasterBounds({
      x0: Math.min(...boxes.map(box => box.x0)),
      x1: Math.max(...boxes.map(box => box.x1)),
      z0: Math.min(...boxes.map(box => box.z0)),
      z1: Math.max(...boxes.map(box => box.z1)),
    }, bounds);
    /* Even/odd fill across all rings preserves explicit interior holes. This
       path is used by canonical surface intake; the legacy ring path above is
       left byte-for-byte equivalent for existing GPK1 previews. */
    for (let j = area.j0; j <= area.j1; j++) {
      const wz = bounds.z0 + (j + 0.5) * res;
      const xs = [];
      for (const ring of valid) {
        for (let p = 0, q = ring.length - 1; p < ring.length; q = p++) {
          const a = ring[q], b = ring[p];
          if ((a[1] > wz) === (b[1] > wz)) continue;
          xs.push(a[0] + (wz - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
        }
      }
      xs.sort((a, b) => a - b);
      for (let n = 0; n + 1 < xs.length; n += 2) {
        const i0 = clamp(Math.ceil((xs[n] - bounds.x0) / res - 0.5), 0, w - 1);
        const i1 = clamp(Math.floor((xs[n + 1] - bounds.x0) / res - 0.5), 0, w - 1);
        for (let i = i0; i <= i1; i++) paint(i, j, feature);
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
    for (const polygon of feature.polygons || []) fillPolygon(polygon?.rings, feature);
    if (feature.line) strokeLine(feature.line, feature);
  }

  /* The per-class SDF compiler takes exact Euclidean distances from this
     resolved partition itself; it needs the classes and nothing propagated. */
  if (classesOnly) return { bounds, classes };
  const edge = buildBoundaryField(bounds, classes);
  if (boundaryOnly) {
    return {
      bounds,
      classes,
      boundaryDistance: edge.distance,
      boundaryNeighbour: edge.neighbour,
    };
  }
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
    const ring = edge.distance[k] >= INF / 2 ? RING_MAX : edge.distance[k];
    fieldData[k * 4 + 3] = Math.round(Math.min(255, ring / RING_SCALE));
  }
  return { bounds, classes, classCounts, idData, fieldData, signedDistance, routeDistance: route.distance, owner: route.owner };
}

/* The classes whose outline a golfer reads as a CUT: they take the curve fit and,
   in the material, a one-pixel edge. Everything else (forest floor, wetland,
   heath, shore, rock) is a soft natural ramp and keeps its surveyed chords. */
const CUT_SURFACES = new Set([SURFACE.SEMI, SURFACE.FAIRWAY, SURFACE.FRINGE, SURFACE.GREEN, SURFACE.TEE, SURFACE.SAND,
  /* laid ground too: a car park's real corners turn 90 degrees and stay corners
     under the 60 degree rule, its bowed edges become the curves they were traced from */
  SURFACE.PATH, SURFACE.GRAVEL, SURFACE.ASPHALT]);
/* A path, a track or a road is a curve somebody surveyed as a polyline. The app
   curves those lines ITSELF before it builds this atlas (main.js), because the
   lane paint, the rails and the bridges read the same lines and must agree with
   the surface painted here; fitting again is harmless -- an interpolating curve
   through a curve's own points is that curve -- and it is what a caller that did
   NOT pre-fit (the surface compiler, a test) gets. Asphalt used to be left out,
   back when only this copy was curved and its paint was not. */
const CURVED_LINES = new Set([SURFACE.PATH, SURFACE.GRAVEL, SURFACE.DIRT, SURFACE.ASPHALT]);
/* where a sharp vertex enclosing next to nothing is a pixel trace's jitter and not
   a shape: see despikeRing for why a bunker's lobes must never be on this list */
const TOOTHED_SURFACES = new Set([SURFACE.FAIRWAY, SURFACE.SEMI]);
const EXACT_LIMIT_METRES = 4;

/* A class that reaches the raster from a RASTER (the canopy floor's 3 m cover
   cells) has no vectors to measure, so its plane is read back out of the pair
   field: inside the class, or across an edge whose other side is the class, the
   chamfer distance is a distance to that class's own boundary. It is a soft
   class, blended over metres, so the chamfer's stairs never show. */
function rasterClassPlane(surface, { classes, idData, signedDistance }) {
  const bytes = new Uint8Array(classes.length);
  for (let k = 0; k < classes.length; k++) {
    const d = Math.abs(signedDistance[k]);
    if (classes[k] === surface) bytes[k] = encodeDistance(d, EXACT_LIMIT_METRES);
    else if (idData[k * 2] === surface || idData[k * 2 + 1] === surface) bytes[k] = encodeDistance(-d, EXACT_LIMIT_METRES);
  }
  return { surface, bytes };
}

/* WHICH WAY THE MOWER WENT, AND HOW FAR ACROSS THE HOLE.

   A stripe is grass laid toward you or away from you, so a green's and a tee's
   straight passes need a DIRECTION, and the direction belongs to the hole. Two
   bytes per texel, a unit vector: the hole's tee-to-green bearing, taken from the
   texel's owner (the hole whose line is nearest), and over each tee pad -- with
   three metres of margin, which is collar and carries no stripes -- the bearing
   of that hole's FIRST leg, since a tee faces its landing area and on a dogleg
   that is not where the green is. Inside one hole every texel holds the same
   vector, so linear filtering is exact; across an ownership line it blends, its
   length leaves 1, and the material fades the stripes out over that one texel
   instead of drawing the blend -- the lesson of the wrapped phase byte, met from
   the other side: store something that interpolates, and know when it has not. */
export function mowDirectionBytes({ bounds, owner, holes = [] }) {
  const count = bounds.w * bounds.h;
  const out = new Uint8Array(count * 2);
  const enc = c => Math.max(0, Math.min(255, Math.round(127.5 + 127 * c)));
  const unit = (a, b) => { const d = Math.hypot(b[0] - a[0], b[1] - a[1]); return d > 1e-6 ? [(b[0] - a[0]) / d, (b[1] - a[1]) / d] : [1, 0]; };
  const byHole = new Map();
  for (const h of holes) if (h?.line?.length >= 2) byHole.set(h.n || 0, unit(h.line[0], h.line[h.line.length - 1]));
  for (let k = 0; k < count; k++) {
    const d = byHole.get(owner[k]) || [1, 0];
    out[k * 2] = enc(d[0]); out[k * 2 + 1] = enc(d[1]);
  }
  for (const h of holes) {
    if (!(h?.line?.length >= 2)) continue;
    const d = unit(h.line[0], h.line[1]), bx = enc(d[0]), bz = enc(d[1]);
    for (const pad of h.tees?.pads || []) {
      if (!pad?.ring?.length) continue;
      const r = rasterBounds(ringBBox(pad.ring), bounds, 3);
      for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) { const k = j * bounds.w + i; out[k * 2] = bx; out[k * 2 + 1] = bz; }
    }
  }
  return out;
}

/* THE ACROSS-THE-HOLE COORDINATE, SIGNED. Fairway stripes were drawn off the
   UNSIGNED distance to the hole's line, and an unsigned distance is a contour
   map: the stripes came out mirrored about the middle of the fairway, and at each
   end of the line they wrapped round it in rings, which from the tee read as
   stripes fanning out of a point by the green. A mower does neither. This is the
   distance to the hole's OWN line with a SIDE -- left of play negative, right
   positive -- so the passes alternate straight across the whole width, and the
   first and last legs are carried straight on past their ends, so the stripes
   run out through the tee and past the green instead of turning round them.
   Only the texel's owner hole is measured: a neighbour's carried-on leg crossing
   this fairway would otherwise tear it. One byte, 0.25 m over +/-31.75 m -- the
   precision the unsigned byte had -- saturating beyond, where a fairway that
   wide takes one tone. At the inside of a dogleg the two legs' passes meet in a
   mitre, as they do on the ground. */
const LATERAL_STEP_METRES = 0.25, LATERAL_REACH_METRES = 48, LATERAL_CARRY_ON_METRES = 60;
export function mowLateralBytes({ bounds, owner, holes = [] }) {
  const { x0, z0, w, res } = bounds;
  const count = w * bounds.h;
  const out = new Uint8Array(count).fill(255);
  const best = new Float32Array(count).fill(Infinity);
  for (const hole of holes) {
    const line = hole?.line;
    if (!(line?.length >= 2)) continue;
    const n = hole.n || 0;
    for (let s = 0; s + 1 < line.length; s++) {
      const a = line[s], b = line[s + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-6) continue;
      const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
      const t0 = s === 0 ? -LATERAL_CARRY_ON_METRES : 0;
      const t1 = s + 2 === line.length ? len + LATERAL_CARRY_ON_METRES : len;
      const ax = a[0] + ux * t0, az = a[1] + uz * t0, bx = a[0] + ux * t1, bz = a[1] + uz * t1;
      const r = rasterBounds({ x0: Math.min(ax, bx), x1: Math.max(ax, bx), z0: Math.min(az, bz), z1: Math.max(az, bz) }, bounds, LATERAL_REACH_METRES);
      for (let j = r.j0; j <= r.j1; j++) {
        const pz = z0 + (j + 0.5) * res - a[1];
        for (let i = r.i0; i <= r.i1; i++) {
          const k = j * w + i;
          if (owner[k] !== n) continue;
          const px = x0 + (i + 0.5) * res - a[0];
          const t = clamp(px * ux + pz * uz, t0, t1);
          const d = Math.hypot(px - ux * t, pz - uz * t);
          if (d >= best[k] || d > LATERAL_REACH_METRES) continue;
          best[k] = d;
          const side = ux * pz - uz * px >= 0 ? 1 : -1;
          out[k] = clamp(Math.round(128 + side * d / LATERAL_STEP_METRES), 1, 255);
        }
      }
    }
  }
  return out;
}

/** `edges: 'exact'` (the default) also builds one exact signed-distance channel
 *  per class from the curve-fitted vectors -- see exact-class-sdf.mjs -- and the
 *  class raster every CPU consumer reads is filled from those same fitted rings,
 *  so what is probed and what is drawn are one outline. `edges: 'pair'` is the
 *  atlas as it was, kept as the A/B control and the way back. */
export function createGroundAtlas({ edges = 'exact', sdfMipmaps = true, ...options }) {
  if (edges !== 'exact' && edges !== 'pair') throw new TypeError(`unknown ground atlas edges: ${edges}`);
  const exactStarted = performance.now();
  const fitted = edges === 'exact'
    ? fitFeatures(options.features || [], { crisp: CUT_SURFACES, lines: CURVED_LINES, toothed: TOOTHED_SURFACES, cornerDeg: 60, chordError: 0.01 })
    : null;
  if (fitted) options = { ...options, features: fitted.features };
  const fitMs = performance.now() - exactStarted;
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
    /* The apron round a green and a tee is NOT done here, and the reason is worth
       recording: the SDF measures the distance to the ADJACENT class, and a green
       is ringed by its fringe collar, so a texel out in the rough reads
       FRINGE/ROUGH and knows nothing about the green three metres further in.
       An edgeRamp on GREEN therefore dies at the collar. main.js adds the apron
       from the green and tee rings themselves, which is exact. */
    c.forest = edgeRamp(s, SURFACE.FOREST, -6, 2);
    c.wet = Math.max(s.surface === SURFACE.MUD ? 1 : 0, edgeRamp(s, SURFACE.WETLAND, -4, 2));
    return c;
  };

  const atlas = {
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
  if (!fitted) return atlas;

  const buildStarted = performance.now();
  const exact = buildExactClassSdf({
    CORE: options.CORE, features: options.features, res: bounds.res, limit: EXACT_LIMIT_METRES,
    /* rough is the complement of the channels in the material, never one of them */
    priority: SURFACE_PRIORITY.filter(id => id !== SURFACE.ROUGH),
    ringSurfaces: [SURFACE.GREEN, SURFACE.TEE],
    rasterPlanes: options.canopyFloor ? [rasterClassPlane(SURFACE.FOREST, raster)] : [],
  });
  const packed = packClassPlanes(exact);
  /* the class-SDF material's field layout: R the SIGNED distance across the hole
     (mowLateralBytes: 128 = on the line, 0.25 m a step), G distance to the nearest
     green or tee edge (0.16 m) -- EXACT, where the pair field's fourth channel is
     a chamfer from the raster */
  const texels = bounds.w * bounds.h;
  const classField = new Uint8Array(texels * 4);
  /* ... and B, A the mowing direction (mowDirectionBytes) */
  const mowDirection = mowDirectionBytes({ bounds, owner, holes: options.HOLES || [] });
  const mowLateral = mowLateralBytes({ bounds, owner, holes: options.HOLES || [] });
  for (let k = 0; k < texels; k++) {
    classField[k * 4] = mowLateral[k];
    classField[k * 4 + 1] = exact.ringBytes[k];
    classField[k * 4 + 2] = mowDirection[k * 2];
    classField[k * 4 + 3] = mowDirection[k * 2 + 1];
  }
  const linearTexture = (data, mipmaps) => {
    const tex = new THREE.DataTexture(data, bounds.w, bounds.h, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = mipmaps;
    tex.flipY = false;
    tex.needsUpdate = true;
    return tex;
  };
  const texSdf = packed.map(data => linearTexture(data, sdfMipmaps));
  const texFClass = linearTexture(classField, false);
  const sdfBytes = packed.length * texels * 4;
  atlas.exactEdges = {
    texSdf,
    texF: texFClass,
    channels: exact.channels,
    limitMetres: exact.limit,
    routeStepMetres: 1 / ROUTE_SCALE,
    ringStepMetres: exact.ringStep,
    lateralStepMetres: LATERAL_STEP_METRES,
    /* Exposed only for deterministic probes/tests and boot telemetry. */
    data: { planes: exact.planes, ringBytes: exact.ringBytes },
    stats: {
      fitMs: +fitMs.toFixed(1),
      buildMs: +(performance.now() - buildStarted).toFixed(1),
      fit: fitted.stats,
      build: exact.stats,
      textures: packed.length,
      textureBytes: (sdfMipmaps ? Math.round(sdfBytes * 4 / 3) : sdfBytes) + texels * 4,
    },
  };
  atlas.dispose = () => { texID.dispose(); texF.dispose(); for (const tex of texSdf) tex.dispose(); texFClass.dispose(); };
  return atlas;
}
