/* A SHORELINE IS A CURVE, AND THE TRACE IS A POLYGON.

   The surveyed water rings run in straight segments -- around Veckefjärden's
   island 14th they average 15 m and reach 48 m -- and the visible waterline is
   where terrainH crosses the water level, which that ring carves. So the island
   came out as a faceted plate with hard corners where the club's photographs
   show a smooth rounded promontory.

   Two passes, in the order that matters: split the long segments so a curve CAN
   exist, then average the points so it is one. Only near the played ground --
   the shoreline that matters is the shoreline you stand next to, and this ring
   is walked by terrainH for every terrain sample, so making the whole fjärd
   dense would be paid for on ground nobody ever sees. Nothing finer than the
   4 m terrain grid is worth resolving, which is why the split is 3 m.

   Shared between the app's boot and the v2 surface compiler for one reason:
   the compiler must rasterise the SAME rings the app draws. It once took the
   raw pack rings while the app smoothed its copy, and the two disagreed by up
   to 0.8 m at every green vertex -- an error the transect audit measured and
   nothing else could see. */

export function smoothShore(ring, near, step = 3, passes = 3, minPts = 8) {
  if (!ring || ring.length < minPts) return ring;
  const dense = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    dense.push(a);
    if (!near(a) && !near(b)) continue;
    const n = Math.min(24, Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 1; k < n; k++)
      dense.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  /* light averaging passes: corner-cutting without the point doubling chaikin
     would add, and it leaves anything outside `near` exactly as traced */
  let out = dense;
  for (let pass = 0; pass < passes; pass++) {
    const next = out.slice();
    for (let i = 0; i < out.length; i++) {
      if (!near(out[i])) continue;
      const p = out[(i - 1 + out.length) % out.length], q = out[(i + 1) % out.length];
      next[i] = [(p[0] + out[i][0] * 2 + q[0]) / 4, (p[1] + out[i][1] * 2 + q[1]) / 4];
    }
    out = next;
  }
  return out;
}

const always = () => true;

/* THE MOWN EDGES, at a finer step than a shoreline.
   Measured across the six courses, fairway rings run a 10-31 m MEDIAN segment
   and reach 136 m, and a green -- about 20 m across -- carries a 4-7 m median,
   which makes it a twelve-sided polygon. Those are the longest boundaries on a
   hole and the most obviously straight.

   The cost lands in different places and that is what makes this affordable:
   fairway rings are rasterised into the atlas ONCE and are not walked
   per-sample in atlas mode, so densifying them is nearly free. Green and tee
   rings ARE walked per terrain sample (their pads, and the scatter apron), so
   they get a coarser step and fewer passes -- enough to round a polygon, not
   enough to multiply the ring.

   Returns NEW hole and scenery objects; the caller's model is not touched, so
   a compiler can smooth a pack it must not mutate and the app can smooth its
   own live copy. Synthesised tee pads are already rectangles and stay so. */
export function smoothMownEdges({ holes = [], scenery = {} } = {}) {
  const smoothedHoles = holes.map(h => {
    if (!h || typeof h !== 'object') return h;
    const out = { ...h };
    if (h.green?.ring) out.green = { ...h.green, ring: smoothShore(h.green.ring, always, 2.0, 2, 6) };
    if (h.fairway?.rings) {
      out.fairway = { ...h.fairway, rings: h.fairway.rings.map(r => smoothShore(r, always, 2.5, 3, 6)) };
    }
    if (h.tees?.pads) {
      out.tees = {
        ...h.tees,
        pads: h.tees.pads.map(t => (t && t.prov !== 'synth' && t.ring
          ? { ...t, ring: smoothShore(t.ring, always, 2.5, 1, 6) }
          : t)),
      };
    }
    return out;
  });
  const smoothedScenery = { ...scenery };
  if (Array.isArray(scenery.fairways)) {
    smoothedScenery.fairways = scenery.fairways.map(r => smoothShore(r, always, 2.5, 3, 6));
  }
  if (Array.isArray(scenery.greens)) {
    smoothedScenery.greens = scenery.greens.map(r => smoothShore(r, always, 2.0, 2, 6));
  }
  return { holes: smoothedHoles, scenery: smoothedScenery };
}
