/* Per-class EXACT signed distance fields, built at boot from the course vectors.

   WHY THIS EXISTS. The boot atlas used to take its edge distance from its own
   binary 1 m class raster: every boundary texel stored +/-0.5 m whatever its
   true distance, so the reconstructed contour followed the raster -- 1 m risers
   with treads of 1/sin(angle), which is the square sawtooth round every green,
   collar, fairway and tee (Angso's 2nd green: mean 0.32 m, max 0.93 m off its
   own ring). A distance taken from the VECTORS, stored in the same 1 m byte and
   read with the same single bilinear tap, puts that contour 0.02 m (rms) from
   the ring with no risers at all: the resolution was never the limit, the
   field's construction was. A field grown from a binary mask never becomes
   smooth, it only gets smaller steps -- the 25 cm mask behind Puttom's published
   chunks still wavers by 6 degrees.

   And one distance per texel cannot hold two edges closer than ~5 m, which is
   every collar (3.2 m), tee surround (2.2 m) and semi band (4.5 m) on a course:
   the pair atlas threads a stair-stepped sliver of the wrong class down the
   middle of each one. One channel per class has no such watershed. Measured on
   the GPU at Angso: wrong-class area in the green collar 6.6% -> 0.0%, in the
   tee collar 16% -> 0.03%.

   No imports: the same file runs in the browser bundle and in Node. The caller
   hands in the surface registry so this module never has to resolve it.

   1. fitRing(): corner-aware centripetal Catmull-Rom THROUGH every supplied
      vertex. A vertex turning >= cornerDeg stays a corner (the spline is broken
      there), rings of four or fewer vertices (rectangular tee decks) stay
      straight, and the curve is flattened adaptively to a chord error.
   2. buildExactClassSdf(): per ring, the exact point-to-segment distance at
      every texel centre within reach (a per-segment splat into a sparse
      "touched" list, so the cost follows the boundary length and never the
      window area), the sign from an even-odd scanline at the same texel
      centres, bands as the parent distance plus their pad, one byte per class
      over +/-limit metres (the class-sdf-v1 encoding), classes max-combined
      across their rings, and finally the priority CSG in byte space:
          R_c = min(U_c, 255 - max over higher-priority U)
      which is what surface-sdf-grid / createClassSdfDecorator expect.
   3. The mow-ring coordinate: exact unsigned distance to the nearest green or
      tee ring edge, in the class-sdf-v1 0.16 m byte. */

const INF = Infinity;

/* ------------------------------------------------------------ curve fit */

function cleanRing(ring) {
  const out = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (q && Math.abs(q[0] - p[0]) < 1e-6 && Math.abs(q[1] - p[1]) < 1e-6) continue;
    out.push([p[0], p[1]]);
  }
  if (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) out.pop();
  }
  return out;
}

function turnDegrees(a, b, c) {
  const ux = b[0] - a[0], uz = b[1] - a[1], vx = c[0] - b[0], vz = c[1] - b[1];
  const cross = ux * vz - uz * vx, dot = ux * vx + uz * vz;
  return Math.abs(Math.atan2(cross, dot)) * 180 / Math.PI;
}

function pointChordDistance(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
  let t = l2 > 1e-18 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
}

/** Corner-aware centripetal Catmull-Rom through every vertex of a closed ring. */
export function fitRing(source, options = {}) {
  const ring = cleanRing(source);
  if (ring.length <= 4) { if (options.stats) options.stats.keptStraight++; return ring; }
  return fitCurve(ring, true, options);
}

/** The same curve through an OPEN polyline -- a path, a gravel track. Its two
 *  ends are corners by definition, so the curve neither overshoots nor turns
 *  back at them, and a two-point line is returned as it came. */
export function fitLine(source, options = {}) {
  const line = [];
  for (const p of source) {
    const q = line[line.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 1e-6 || Math.abs(q[1] - p[1]) > 1e-6) line.push([p[0], p[1]]);
  }
  return line.length < 3 ? line : fitCurve(line, false, options);
}

/* `near(point)` limits the fit to spans with an end it accepts -- a lake ring is
   walked by every CPU water test, so only the shore a player stands beside is
   worth the points. `straightOver` keeps any span longer than that many metres
   STRAIGHT and its two ends sharp: a chord that long is never a surveyed shore,
   it is where a ring was cut (an extract's edge, a window's), and its neighbour
   across the cut has to keep meeting it vertex for vertex. */
function fitCurve(ring, closed, { cornerDeg = 60, chordError = 0.01, alpha = 0.5, stats = null, near = null, straightOver = Infinity } = {}) {
  const n = ring.length;
  const corner = new Uint8Array(n);
  let corners = 0;
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) { corner[i] = 1; continue; }
    const turn = turnDegrees(ring[(i - 1 + n) % n], ring[i], ring[(i + 1) % n]);
    if (turn >= cornerDeg) { corner[i] = 1; corners++; if (stats && turn > 120) stats.spikes++; }
  }
  const untouched = i => {
    const a = ring[i], b = ring[(i + 1) % n];
    return (near && !near(a) && !near(b)) || Math.hypot(b[0] - a[0], b[1] - a[1]) > straightOver;
  };
  const spans = closed ? n : n - 1;
  for (let i = 0; i < spans; i++) if (untouched(i)) { corner[i] = 1; corner[(i + 1) % n] = 1; }
  if (stats) { stats.fitted++; stats.corners += corners; }
  const knot = (a, b) => Math.max(1e-6, Math.hypot(b[0] - a[0], b[1] - a[1]) ** alpha);
  const out = [];
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const i2 = (i + 1) % n;
    const p1 = ring[i], p2 = ring[i2];
    if (corner[i] && corner[i2]) { out.push(p1); continue; }
    /* a corner ends the curve: mirror the span so the end is curvature-free */
    const p0 = corner[i] ? [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]] : ring[(i - 1 + n) % n];
    const p3 = corner[i2] ? [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]] : ring[(i + 2) % n];
    const t0 = 0, t1 = t0 + knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
    const at = t => {
      const L = (a, b, ta, tb) => {
        const u = (tb - t) / (tb - ta), v = (t - ta) / (tb - ta);
        return [a[0] * u + b[0] * v, a[1] * u + b[1] * v];
      };
      const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
      const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
      return L(B1, B2, t1, t2);
    };
    const subdivide = (ta, pa, tb, pb, depth) => {
      const tm = (ta + tb) / 2, pm = at(tm);
      /* the quarter points too: a symmetric S passes the midpoint test */
      const flat = depth >= 9 || (pointChordDistance(pm, pa, pb) <= chordError &&
        pointChordDistance(at((ta + tm) / 2), pa, pb) <= chordError &&
        pointChordDistance(at((tm + tb) / 2), pa, pb) <= chordError);
      if (flat) return;
      subdivide(ta, pa, tm, pm, depth + 1);
      out.push(pm);
      subdivide(tm, pm, tb, pb, depth + 1);
    };
    out.push(p1);
    subdivide(t1, p1, t2, p2, 0);
  }
  if (!closed) out.push(ring[n - 1]);
  if (stats) stats.pointsIn += n, stats.pointsOut += out.length;
  return out;
}

/** A ring traced off a RASTER is the one case a vertex is not a surveyed point: a
 *  lattice corner is where a cell boundary fell, not where the edge is, and a
 *  spline through a staircase keeps every stair (its 90 degree turns are all
 *  "corners"). The edge crossed each of those cell sides somewhere, and the
 *  unbiased estimate is the side's midpoint -- the midpoints of a staircase's
 *  edges lie ON the diagonal the raster approximated, so the steps go with no
 *  averaging, by at most half a lattice step, with no net area change. A ring is
 *  taken for a raster trace when 30% of its edges are exactly axis-aligned; a
 *  surveyed ring measures 0-2%. Long edges are real straights and are kept. */
export function unstairRing(ring, { near = null, longest = 12 } = {}) {
  if (!Array.isArray(ring) || ring.length < 8) return ring;
  let axis = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (Math.abs(a[0] - b[0]) < 1e-6 || Math.abs(a[1] - b[1]) < 1e-6) axis++;
  }
  if (axis < ring.length * 0.3) return ring;
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const stair = Math.hypot(b[0] - a[0], b[1] - a[1]) <= longest && (!near || near(a) || near(b));
    out.push(stair ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : a);
  }
  return out;
}

/* A CRISP EDGE DRAWS EVERY SLIP OF THE DIGITISER. While the mown edges were a
   metre of staircase nobody could see them; the day they became exact curves
   they came out as needles and comb teeth. Two kinds, measured over every ring of
   every course:

   - a SPIKE: the outline runs out and straight back -- a turn past 120 degrees,
     the two neighbours under three metres apart, a leg under eight. 39 of them,
     32 on Tortuna's fairways. Removed on every surface. The leg test is what
     spares a real neck: Veckefjarden's 3rd narrows between 22 and 32 m legs, and
     that is the fairway, not a slip.
   - a TOOTH: a sharp vertex (60 degrees or more) that encloses almost nothing --
     under three square metres. Fairways and their first cut ONLY: there it is a
     pixel trace's jitter (a quarter of Tortuna's fairway vertices), but a bunker
     is digitised with two-metre legs and its LOBES are sharp vertices of about a
     square metre and a half, which this rule would shave off. A tee deck's corner
     encloses twenty, a real fairway corner four or more, and both stay.

   Dropping a vertex is the one thing here that does not pass through it, and it
   is meant to: a slip is not a surveyed point. */
export function despikeRing(ring, { teeth = false, stats = null } = {}) {
  /* a duplicated closing vertex hides a spike at the seam of the ring */
  let out = cleanRing(ring);
  for (let pass = 0; pass < 4 && out.length > 4; pass++) {
    const n = out.length, keep = [];
    let dropped = 0, droppedPrevious = false;
    for (let i = 0; i < n; i++) {
      const a = out[(i - 1 + n) % n], b = out[i], c = out[(i + 1) % n];
      const turn = turnDegrees(a, b, c);
      const la = Math.hypot(b[0] - a[0], b[1] - a[1]), lb = Math.hypot(c[0] - b[0], c[1] - b[1]);
      const spike = turn > 120 && Math.min(la, lb) < 8 && Math.hypot(c[0] - a[0], c[1] - a[1]) < 3;
      const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
      const tooth = teeth && turn >= 60 && area < 3;
      /* never two neighbours in one pass: the second is judged against a vertex
         that is already gone */
      if ((spike || tooth) && !droppedPrevious && n - dropped > 4) {
        dropped++; droppedPrevious = true;
        if (stats) stats[spike ? 'spikesRemoved' : 'teethRemoved']++;
        continue;
      }
      droppedPrevious = false;
      keep.push(b);
    }
    if (!dropped) break;
    out = keep;
  }
  return out;
}

/** Replace the rings of the played (crisp) classes by their fitted curves. One
 *  fit per source ring, shared by every feature that uses it (fairway + semi,
 *  green + fringe), so the band stays an exact offset of its parent. */
export function fitFeatures(features, { crisp, lines = new Set(), toothed = new Set(), cornerDeg, chordError } = {}) {
  /* one fit per source ring AND per cleaning rule: a fairway and its first cut
     share a ring and a rule, so the band stays an exact offset of its parent */
  const caches = [new Map(), new Map()];
  const stats = { fitted: 0, keptStraight: 0, corners: 0, spikes: 0, unstaired: 0, spikesRemoved: 0, teethRemoved: 0, pointsIn: 0, pointsOut: 0 };
  const fit = (ring, teeth) => {
    if (!Array.isArray(ring) || ring.length < 3) return ring;
    const cache = caches[teeth ? 1 : 0];
    let fitted = cache.get(ring);
    if (!fitted) {
      /* the stairs first: a raster trace is ALL tiny sharp vertices, and the
         tooth rule would eat it at random instead of straightening it */
      const source = unstairRing(ring);
      if (source !== ring) stats.unstaired++;
      fitted = fitRing(despikeRing(source, { teeth, stats }), { cornerDeg, chordError, stats });
      cache.set(ring, fitted);
    }
    return fitted;
  };
  /* A NATURAL ring surveyed as a polygon stays the polygon it was surveyed as:
     its edge is a ramp metres wide and nobody reads its chords. One traced off a
     raster is different -- a reed belt read off the laser on a 4 m lattice draws
     a 4 m staircase through any ramp (Angso, from above) -- so those, and only
     those, lose their stairs and take a coarse curve. */
  const softCache = new Map();
  const softFit = ring => {
    if (!Array.isArray(ring) || ring.length < 3) return ring;
    let fitted = softCache.get(ring);
    if (!fitted) {
      const source = unstairRing(ring);
      fitted = source === ring ? ring : fitRing(source, { cornerDeg, chordError: 0.1, stats });
      if (source !== ring) stats.unstaired++;
      softCache.set(ring, fitted);
    }
    return fitted;
  };
  const out = features.map(feature => {
    if (feature.line) {
      return lines.has(feature.surface) && feature.line.length > 2
        ? { ...feature, line: fitLine(feature.line, { cornerDeg, chordError, stats }) } : feature;
    }
    if (!crisp.has(feature.surface)) {
      const next = { ...feature };
      if (feature.rings) next.rings = feature.rings.map(softFit);
      if (feature.polygons) next.polygons = feature.polygons.map(polygon => ({ ...polygon, rings: (polygon?.rings || []).map(softFit) }));
      return next;
    }
    const next = { ...feature };
    const teeth = toothed.has(feature.surface);
    if (feature.rings) next.rings = feature.rings.map(ring => fit(ring, teeth));
    if (feature.polygons) next.polygons = feature.polygons.map(polygon => ({ ...polygon, rings: (polygon?.rings || []).map(ring => fit(ring, teeth)) }));
    return next;
  });
  return { features: out, stats };
}

/* ------------------------------------------------------ exact distances */

export function encodeDistance(metres, limit) {
  const clamped = metres < -limit ? -limit : metres > limit ? limit : metres;
  return Math.round((clamped + limit) / (2 * limit) * 255);
}

export function buildExactClassSdf({ CORE, features, res = 1, limit = 4, priority, ringSurfaces = [], ringStep = 0.16, ringReach = 24, rasterPlanes = [], waterRings = [], bankStep = 0.05, bankReach = 6, bankLongestEdge = 150 }) {
  const started = performance.now();
  const w = Math.max(1, Math.ceil((CORE.x1 - CORE.x0) / res));
  const h = Math.max(1, Math.ceil((CORE.z1 - CORE.z0) / res));
  const x0 = CORE.x0, z0 = CORE.z0;
  const count = w * h;
  const rank = new Map(priority.map((id, index) => [id, index]));

  const d2 = new Float32Array(count).fill(INF);
  const inside = new Uint8Array(count);
  let touched = new Int32Array(1 << 16), touchedCount = 0;
  const touch = k => {
    if (touchedCount === touched.length) { const grown = new Int32Array(touched.length * 2); grown.set(touched); touched = grown; }
    touched[touchedCount++] = k;
  };
  const planes = new Map();
  const plane = surface => {
    let bytes = planes.get(surface);
    if (!bytes) planes.set(surface, bytes = new Uint8Array(count));
    return bytes;
  };
  const ringBytes = new Uint8Array(count).fill(255);
  const stats = { w, h, texels: count, segments: 0, visits: 0, touched: 0, shapes: 0, lines: 0 };

  const splat = (ax, az, bx, bz, reach) => {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    if (l2 < 1e-12) return;
    const inv = 1 / l2, r2 = reach * reach;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - x0) / res)), i1 = Math.min(w - 1, Math.floor((Math.max(ax, bx) + reach - x0) / res));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - z0) / res)), j1 = Math.min(h - 1, Math.floor((Math.max(az, bz) + reach - z0) / res));
    for (let j = j0; j <= j1; j++) {
      const pz = z0 + (j + 0.5) * res - az, row = j * w;
      for (let i = i0; i <= i1; i++) {
        const px = x0 + (i + 0.5) * res - ax;
        let t = (px * dx + pz * dz) * inv;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = px - dx * t, ez = pz - dz * t, v = ex * ex + ez * ez;
        if (v > r2) continue;
        const k = row + i;
        if (v < d2[k]) { if (d2[k] === INF) touch(k); d2[k] = v; }
      }
      if (i1 >= i0) stats.visits += i1 - i0 + 1;
    }
    stats.segments++;
  };

  /* even-odd scanline over all rings of one shape, at texel centres; returns
     the spans so the mask can be cleared without touching the whole grid */
  const spans = [];
  const fill = rings => {
    spans.length = 0;
    let zmin = Infinity, zmax = -Infinity;
    for (const ring of rings) for (const p of ring) { if (p[1] < zmin) zmin = p[1]; if (p[1] > zmax) zmax = p[1]; }
    const j0 = Math.max(0, Math.floor((zmin - z0) / res)), j1 = Math.min(h - 1, Math.floor((zmax - z0) / res));
    const xs = [];
    for (let j = j0; j <= j1; j++) {
      const wz = z0 + (j + 0.5) * res;
      xs.length = 0;
      for (const ring of rings) {
        for (let p = 0, q = ring.length - 1; p < ring.length; q = p++) {
          const a = ring[q], b = ring[p];
          if ((a[1] > wz) === (b[1] > wz)) continue;
          xs.push(a[0] + (wz - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
        }
      }
      xs.sort((a, b) => a - b);
      for (let n = 0; n + 1 < xs.length; n += 2) {
        const i0 = Math.max(0, Math.ceil((xs[n] - x0) / res - 0.5)), i1 = Math.min(w - 1, Math.floor((xs[n + 1] - x0) / res - 0.5));
        if (i1 < i0) continue;
        const row = j * w;
        for (let i = i0; i <= i1; i++) inside[row + i] = 1;
        spans.push(row + i0, row + i1);
      }
    }
  };

  /* one SHAPE = the rings that are filled together (a lone ring, or a polygon
     with its holes) + every (surface, pad) that uses it */
  const shapes = new Map();
  const shapeOf = (key, rings) => {
    let shape = shapes.get(key);
    if (!shape) shapes.set(key, shape = { rings, users: [] });
    return shape;
  };
  const lines = [];
  for (const feature of features) {
    if (!Number.isInteger(feature.surface) || !rank.has(feature.surface)) continue;
    for (const ring of feature.rings || []) {
      if (!ring || ring.length < 3) continue;
      shapeOf(ring, [ring]).users.push({ surface: feature.surface, pad: feature.pad || 0 });
    }
    for (const polygon of feature.polygons || []) {
      const rings = (polygon?.rings || []).filter(ring => Array.isArray(ring) && ring.length >= 3);
      if (rings.length) shapeOf(polygon, rings).users.push({ surface: feature.surface, pad: 0 });
    }
    if (feature.line && feature.line.length > 1) lines.push(feature);
  }

  for (const shape of shapes.values()) {
    const isRingSource = shape.users.some(user => ringSurfaces.includes(user.surface));
    const maxPad = Math.max(...shape.users.map(user => user.pad));
    const reach = Math.max(limit + maxPad, isRingSource ? ringReach : 0);
    touchedCount = 0;
    for (const ring of shape.rings) {
      for (let p = 0, q = ring.length - 1; p < ring.length; q = p++) splat(ring[q][0], ring[q][1], ring[p][0], ring[p][1], reach);
    }
    fill(shape.rings);
    const users = shape.users.map(user => ({ bytes: plane(user.surface), pad: user.pad }));
    /* deep interior beyond reach: saturated inside for every user */
    for (let s = 0; s < spans.length; s += 2) {
      for (let k = spans[s]; k <= spans[s + 1]; k++) {
        if (d2[k] !== INF) continue;
        for (const user of users) user.bytes[k] = 255;
      }
    }
    for (let n = 0; n < touchedCount; n++) {
      const k = touched[n];
      const d = Math.sqrt(d2[k]);
      const sd = inside[k] ? d : -d;
      for (const user of users) {
        const byte = encodeDistance(sd + user.pad, limit);
        if (byte > user.bytes[k]) user.bytes[k] = byte;
      }
      if (isRingSource) {
        const byte = Math.min(255, Math.round(d / ringStep));
        if (byte < ringBytes[k]) ringBytes[k] = byte;
      }
      d2[k] = INF;
    }
    for (let s = 0; s < spans.length; s += 2) inside.fill(0, spans[s], spans[s + 1] + 1);
    stats.touched += touchedCount;
    stats.shapes++;
  }

  /* lines carry no interior: U = half - distance, max-combined per segment */
  for (const feature of lines) {
    const half = Math.max(res * 0.5, feature.width || 1);
    const reach = limit + half;
    const bytes = plane(feature.surface);
    touchedCount = 0;
    for (let p = 0; p + 1 < feature.line.length; p++) {
      splat(feature.line[p][0], feature.line[p][1], feature.line[p + 1][0], feature.line[p + 1][1], reach);
    }
    for (let n = 0; n < touchedCount; n++) {
      const k = touched[n];
      const byte = encodeDistance(half - Math.sqrt(d2[k]), limit);
      if (byte > bytes[k]) bytes[k] = byte;
      d2[k] = INF;
    }
    stats.touched += touchedCount;
    stats.lines++;
  }
  /* THE WATERLINE, for the damp bank the material draws on its land side: the
     exact unsigned distance to the nearest shore, 5 cm a step. Unsigned is enough
     -- the side under the water is under the water. An edge longer than
     bankLongestEdge is never shore: it is where a ring was CUT (a sea ring closed
     offshore, a lake clipped at the extract's edge), and at Norrfallsviken such
     an edge crosses the peninsula, where it would draw a damp line over dry
     land. */
  let bankBytes = null;
  if (waterRings.length) {
    bankBytes = new Uint8Array(count).fill(255);
    touchedCount = 0;
    for (const ring of waterRings) {
      if (!ring || ring.length < 3) continue;
      for (let p = 0, q = ring.length - 1; p < ring.length; q = p++) {
        if (Math.hypot(ring[p][0] - ring[q][0], ring[p][1] - ring[q][1]) > bankLongestEdge) continue;
        splat(ring[q][0], ring[q][1], ring[p][0], ring[p][1], bankReach);
      }
    }
    for (let n = 0; n < touchedCount; n++) {
      const k = touched[n];
      bankBytes[k] = Math.min(255, Math.round(Math.sqrt(d2[k]) / bankStep));
      d2[k] = INF;
    }
  }

  /* a class with no vectors of its own (the canopy floor's cover raster) arrives
     already encoded, and joins its class before the priority step like any ring */
  for (const extra of rasterPlanes) {
    if (!rank.has(extra.surface) || extra.bytes.length !== count) continue;
    const bytes = plane(extra.surface);
    for (let k = 0; k < count; k++) if (extra.bytes[k] > bytes[k]) bytes[k] = extra.bytes[k];
  }
  const distanceMs = performance.now() - started;

  /* priority CSG in byte space, highest priority first */
  const csgStarted = performance.now();
  const channels = [...planes.keys()].sort((a, b) => rank.get(a) - rank.get(b));
  const above = new Uint8Array(count);
  for (const surface of channels) {
    const bytes = planes.get(surface);
    for (let k = 0; k < count; k++) {
      const u = bytes[k], cap = 255 - above[k];
      if (u > above[k]) above[k] = u;
      if (cap < u) bytes[k] = cap;
    }
  }
  const csgMs = performance.now() - csgStarted;
  return {
    bounds: { x0, z0, x1: x0 + w * res, z1: z0 + h * res, w, h, res },
    channels, planes, ringBytes, bankBytes, bankStep, limit, ringStep,
    stats: { ...stats, distanceMs: +distanceMs.toFixed(1), csgMs: +csgMs.toFixed(1), totalMs: +(performance.now() - started).toFixed(1) },
  };
}

/** Pack the class planes four to an RGBA8 buffer; an absent slot is byte 0 (-limit, "far outside"). */
export function packClassPlanes({ channels, planes, bounds, bankBytes = null }) {
  const count = bounds.w * bounds.h;
  const textures = [];
  /* the waterline rides in the slot after the last class -- free on every course
     whose class count is not a multiple of four, one more texture where it is */
  const all = bankBytes ? [...channels.map(c => planes.get(c)), bankBytes] : channels.map(c => planes.get(c));
  for (let first = 0; first < all.length; first += 4) {
    const data = new Uint8Array(count * 4);
    for (let slot = 0; slot < 4 && first + slot < all.length; slot++) {
      const bytes = all[first + slot];
      for (let k = 0; k < count; k++) data[k * 4 + slot] = bytes[k];
    }
    textures.push(data);
  }
  return textures;
}
