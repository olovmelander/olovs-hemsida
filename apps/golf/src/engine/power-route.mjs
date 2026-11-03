/* POWER LINES OVER THE GROUND (3 November, owner report: "the power line goes
   straight into the ground at the mountainside"). The map gives a line's points
   at its bends, not at its supports, so one drawn span could run 400 m over a
   ridge: a straight, sagging wire between two tops 8 or 19 m up passed through
   the hillside. A real line stands a support at least every so often and on
   every crest it crosses. So does this one:

   - every mapped span is cut into equal spans no longer than `maxSpan` (a pole
     line's 70 m, a tower line's 350 m), each new point a support;
   - a span whose wire would come nearer the ground than `clearance` anywhere
     along it -- under its middle or under its outermost conductors, `width`
     to either side -- is split where the ground stands highest against the
     wire (the crest) and each half tested again, down to `minSpan`.

   Pure: the ground is a function, and the result is the line's support points
   in order (the mapped ones kept, the inferred ones between). */

/** The sag of a span of `span` metres, as main.js hangs its wires. */
export const spanSag = span => Math.min(4.5, span * 0.035);

/**
 * The supports a line needs: `line` [[x, z], ...] its mapped points; `ground(x, z)`
 * the drawn ground's height; `lift` the lowest conductor's height over a support's
 * foot. Returns [[x, z], ...], the mapped points with the inferred ones between.
 */
export function followTerrain(line, { ground, lift, maxSpan, clearance, minSpan = 15, samples = 24, maxDepth = 8, sag = spanSag, width = 0 } = {}) {
  if (!Array.isArray(line) || line.length < 2) return Array.isArray(line) ? line.map(p => p.slice()) : [];
  const out = [line[0].slice()];
  /* the worst place along a span: how far the wire comes below `clearance` over the ground, and where */
  const worst = (a, b) => {
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ha = ground(a[0], a[1]) + lift, hb = ground(b[0], b[1]) + lift, s = sag(span);
    let deficit = -Infinity, at = 0.5;
    for (let k = 1; k < samples; k++) {
      const t = k / samples, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      const wireY = ha + (hb - ha) * t - Math.sin(t * Math.PI) * s;
      /* the ground under the outermost conductors too: on a side slope it stands higher there */
      const nx = span > 0 ? -(b[1] - a[1]) / span : 0, nz = span > 0 ? (b[0] - a[0]) / span : 0;
      const g = width > 0 ? Math.max(ground(x, z), ground(x + nx * width, z + nz * width), ground(x - nx * width, z - nz * width)) : ground(x, z);
      const d = g + clearance - wireY;
      if (Number.isFinite(d) && d > deficit) { deficit = d; at = t; }
    }
    return { deficit, at, span };
  };
  const add = (a, b, depth) => {
    const w = worst(a, b);
    if (w.deficit > 0 && depth < maxDepth && w.span > minSpan * 2) {
      /* the crest, kept a minimum span from either end */
      const t = Math.min(1 - minSpan / w.span, Math.max(minSpan / w.span, w.at));
      const m = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      add(a, m, depth + 1);
      add(m, b, depth + 1);
    } else out.push(b.slice());
  };
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!(span > 0)) continue;
    const pieces = Math.max(1, Math.ceil(span / maxSpan));
    let prev = a;
    for (let k = 1; k <= pieces; k++) {
      const t = k / pieces, next = k === pieces ? b : [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      add(prev, next, 0);
      prev = next;
    }
  }
  return out;
}
