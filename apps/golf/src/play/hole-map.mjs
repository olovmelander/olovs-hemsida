/* The hole map: the detailed course's Minikarta, made for the game.

   The tour games keep a map of the hole in a corner: the hole turned to run up
   the screen, the ball, where the shot is aimed and may land, the pin and the
   shots played. This one is drawn from the same ground the ball plays on (the
   lies and heights the physics reads, shaded by their relief), with the
   course's own trees and white stakes, so it never disagrees with the course.

   The ground is sampled a few milliseconds a frame (during the hole's flyover),
   then kept; only the marks over it are redrawn. A tap on the map aims there and
   measures it, as the rangefinder's tapped point does. */

/** The frame that turns a hole to run up the map: tee at the bottom, green at the top. */
export function holeFrame(line, { margin = 42, behind = 25, beyond = 32, aspect = 0 } = {}) {
  const o = line[0], end = line[line.length - 1];
  const length = Math.hypot(end[0] - o[0], end[1] - o[1]) || 1;
  const ux = (end[0] - o[0]) / length, uz = (end[1] - o[1]) / length;
  // Facing up the hole on a top view (x east, z south), right is the direction turned a quarter clockwise.
  const rx = -uz, rz = ux;
  const toHole = (x, z) => [(x - o[0]) * ux + (z - o[1]) * uz, (x - o[0]) * rx + (z - o[1]) * rz];
  const toWorld = (a, c) => [o[0] + ux * a + rx * c, o[1] + uz * a + rz * c];
  let aMin = -behind, aMax = length + beyond, cMin = -margin, cMax = margin;
  for (const p of line) {
    const [a, c] = toHole(p[0], p[1]);
    aMin = Math.min(aMin, a - behind); aMax = Math.max(aMax, a + beyond);
    cMin = Math.min(cMin, c - margin); cMax = Math.max(cMax, c + margin);
  }
  // Wide enough to fill a box of this width over height: more of the ground either side.
  const wide = aspect * (aMax - aMin);
  if (cMax - cMin < wide) { const grow = (wide - (cMax - cMin)) / 2; cMin -= grow; cMax += grow; }
  return { o, u: [ux, uz], r: [rx, rz], aMin, aMax, cMin, cMax, toHole, toWorld };
}

/** Pixels for a frame drawn into a w x h box: to and from the world. */
export function fitFrame(frame, w, h, pad = 0) {
  // Cover the box: the frame is drawn as wide as the box's own shape, so little is cut away.
  const scale = Math.max((w - 2 * pad) / (frame.cMax - frame.cMin), (h - 2 * pad) / (frame.aMax - frame.aMin));
  const cMid = (frame.cMin + frame.cMax) / 2, aMid = (frame.aMin + frame.aMax) / 2;
  return {
    scale,
    toPx(x, z) { const [a, c] = frame.toHole(x, z); return [w / 2 + (c - cMid) * scale, h / 2 - (a - aMid) * scale]; },
    fromPx(px, py) { return frame.toWorld(aMid - (py - h / 2) / scale, cMid + (px - w / 2) / scale); },
  };
}

const COLOURS = {
  green: [150, 214, 112], fringe: [131, 197, 99], fairway: [117, 178, 84], tee: [131, 192, 98],
  rough: [77, 128, 64], forest: [52, 92, 54], sand: [234, 219, 172], water: [74, 160, 205], path: [182, 174, 152],
};

export function createHoleMap({ parent, surfaceAt, heightAt, trees, onAim, small = false }) {
  const el = document.createElement('div');
  el.className = `pl-map pl-glass${small ? ' small' : ''}`;
  el.innerHTML = `<canvas class="pl-map-base" aria-hidden="true"></canvas><canvas class="pl-map-over" role="img" aria-label="Hålkarta: tryck för att sikta dit"></canvas>
    <button class="pl-map-size" type="button" aria-label="${small ? 'Förstora hålkartan' : 'Förminska hålkartan'}" title="Hålkarta (M)"></button>`;
  parent.append(el);
  const base = el.querySelector('.pl-map-base'), over = el.querySelector('.pl-map-over'), sizeButton = el.querySelector('.pl-map-size');
  const bctx = base.getContext('2d'), octx = over.getContext('2d');
  const raster = document.createElement('canvas'), rctx = raster.getContext('2d');
  let frame = null, fit = null, job = null, hole = null, marks = null, w = 0, h = 0, dpr = 1;

  function resize() {
    const r = el.getBoundingClientRect();
    dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    w = Math.max(40, Math.round(r.width)); h = Math.max(60, Math.round(r.height));
    for (const c of [base, over]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    if (frame) fit = fitFrame(frame, w, h);
    paintBase(); paintMarks();
  }
  function setSmall(on) {
    small = on; el.classList.toggle('small', on);
    sizeButton.setAttribute('aria-label', on ? 'Förstora hålkartan' : 'Förminska hålkartan');
    requestAnimationFrame(resize);
  }
  sizeButton.addEventListener('click', e => { e.stopPropagation(); setSmall(!small); });
  over.addEventListener('click', e => {
    if (small) { setSmall(false); return; }
    if (!fit) return;
    const r = over.getBoundingClientRect();
    const [x, z] = fit.fromPx(e.clientX - r.left, e.clientY - r.top);
    onAim?.(x, z);
  });

  /* The ground, a slice at a time: colour by lie, shaded by its relief (lit from the map's top left). */
  function startRaster() {
    const along = frame.aMax - frame.aMin, across = frame.cMax - frame.cMin;
    const cell = Math.max(1.5, along / 240);
    const cols = Math.ceil(across / cell), rows = Math.ceil(along / cell);
    raster.width = cols; raster.height = rows;
    job = { cell, cols, rows, row: 0, heights: new Float32Array(cols * rows), kinds: new Array(cols * rows), image: rctx.createImageData(cols, rows) };
  }
  function shadeRow(j) {
    const { cell, cols, rows, heights, kinds, image } = job;
    // Light from the map's top left: up the hole and to its left.
    const lu = Math.SQRT1_2, lc = -Math.SQRT1_2;
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      const hA = heights[Math.max(0, j - 1) * cols + i], hB = heights[Math.min(rows - 1, j + 1) * cols + i];
      const hL = heights[j * cols + Math.max(0, i - 1)], hR = heights[j * cols + Math.min(cols - 1, i + 1)];
      // Rows run down the map (down the hole is -a), columns across it (+c).
      const da = (hA - hB) / (2 * cell), dc = (hR - hL) / (2 * cell);
      const shade = Math.max(.72, Math.min(1.28, 1 + 2.4 * (da * lu + dc * lc)));
      const col = COLOURS[kinds[k]] || COLOURS.rough;
      image.data[k * 4] = Math.min(255, col[0] * shade); image.data[k * 4 + 1] = Math.min(255, col[1] * shade);
      image.data[k * 4 + 2] = Math.min(255, col[2] * shade); image.data[k * 4 + 3] = 255;
    }
  }
  /** Sample more of the ground, for at most `budgetMs`. Returns true once the map is whole. */
  function step(budgetMs = 4) {
    if (!job || job.done) return true;
    const started = performance.now();
    const { cell, cols, rows, heights, kinds } = job;
    while (job.row < rows && performance.now() - started < budgetMs) {
      const j = job.row++;
      const a = frame.aMax - (j + .5) * cell;
      for (let i = 0; i < cols; i++) {
        const c = frame.cMin + (i + .5) * cell;
        const [x, z] = frame.toWorld(a, c);
        heights[j * cols + i] = heightAt(x, z);
        kinds[j * cols + i] = surfaceAt(x, z);
      }
      if (j > 0) shadeRow(j - 1);
    }
    if (job.row >= rows) {
      shadeRow(rows - 1);
      rctx.putImageData(job.image, 0, 0);
      job.done = true;
      paintBase();
      return true;
    }
    return false;
  }
  function paintBase() {
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bctx.clearRect(0, 0, w, h);
    if (!frame || !fit) return;
    if (job?.done) {
      // The raster turned and scaled into place: its columns run across the hole, its rows down it.
      const tl = fit.toPx(...frame.toWorld(frame.aMax, frame.cMin));
      bctx.imageSmoothingEnabled = true;
      bctx.drawImage(raster, tl[0], tl[1], (frame.cMax - frame.cMin) * fit.scale, (frame.aMax - frame.aMin) * fit.scale);
    } else {
      bctx.fillStyle = 'rgba(77,128,64,.55)'; bctx.fillRect(0, 0, w, h);
    }
    // The trees, as their crowns from above.
    const corners = [[frame.aMin, frame.cMin], [frame.aMin, frame.cMax], [frame.aMax, frame.cMin], [frame.aMax, frame.cMax]].map(([a, c]) => frame.toWorld(a, c));
    const xs = corners.map(p => p[0]), zs = corners.map(p => p[1]);
    bctx.fillStyle = 'rgba(34,66,38,.82)';
    for (const t of trees?.within(Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)) || []) {
      const [px, py] = fit.toPx(t.x, t.z);
      if (px < -4 || py < -4 || px > w + 4 || py > h + 4) continue;
      bctx.beginPath(); bctx.arc(px, py, Math.max(1.2, t.radius * fit.scale * .8), 0, Math.PI * 2); bctx.fill();
    }
    // The white stakes.
    bctx.strokeStyle = 'rgba(255,255,255,.85)'; bctx.lineWidth = 1.2; bctx.setLineDash([3, 3]);
    for (const line of hole?.boundaries || []) {
      if (!Array.isArray(line) || line.length < 2) continue;
      bctx.beginPath();
      line.forEach((p, i) => { const q = fit.toPx(p[0], p[1]); if (i) bctx.lineTo(q[0], q[1]); else bctx.moveTo(q[0], q[1]); });
      bctx.stroke();
    }
    bctx.setLineDash([]);
  }
  function paintMarks() {
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, w, h);
    if (!fit || !marks) return;
    const P = p => fit.toPx(p[0], p[1]);
    const { ball, aim, landing, spread, strokes = [], flight, target, pin } = marks;
    // The hole's line, faint.
    if (hole?.line) {
      octx.strokeStyle = 'rgba(255,255,255,.28)'; octx.lineWidth = 1; octx.setLineDash([2, 4]);
      octx.beginPath(); hole.line.forEach((p, i) => { const q = P(p); if (i) octx.lineTo(q[0], q[1]); else octx.moveTo(q[0], q[1]); }); octx.stroke();
      octx.setLineDash([]);
    }
    // Shots played on this hole.
    octx.strokeStyle = 'rgba(255,255,255,.75)'; octx.lineWidth = 1.4;
    for (const s of strokes) {
      if (!s.from || !s.to) continue;
      const a = P(s.from), b = P(s.to);
      octx.beginPath(); octx.moveTo(a[0], a[1]); octx.lineTo(b[0], b[1]); octx.stroke();
      octx.fillStyle = 'rgba(255,255,255,.75)'; octx.beginPath(); octx.arc(a[0], a[1], 1.6, 0, Math.PI * 2); octx.fill();
    }
    if (flight?.length > 1) {
      octx.strokeStyle = '#fff2c4'; octx.lineWidth = 2;
      octx.beginPath(); flight.forEach((p, i) => { const q = P(p); if (i) octx.lineTo(q[0], q[1]); else octx.moveTo(q[0], q[1]); }); octx.stroke();
    }
    // Where the shot is aimed and may land.
    if (ball && aim) {
      const a = P(ball), b = P(aim);
      octx.strokeStyle = 'rgba(240,162,58,.95)'; octx.lineWidth = 1.6;
      octx.beginPath(); octx.moveTo(a[0], a[1]); octx.lineTo(b[0], b[1]); octx.stroke();
    }
    if (spread) {
      const c = P(spread.centre);
      const angle = Math.atan2(...(() => { const d = [spread.dir[0], spread.dir[1]]; const [ua, uc] = [d[0] * frame.u[0] + d[1] * frame.u[1], d[0] * frame.r[0] + d[1] * frame.r[1]]; return [uc, ua]; })());
      octx.save(); octx.translate(c[0], c[1]); octx.rotate(angle);
      octx.fillStyle = 'rgba(240,162,58,.22)'; octx.strokeStyle = 'rgba(255,210,138,.9)'; octx.lineWidth = 1;
      octx.beginPath(); octx.ellipse(0, 0, Math.max(2, spread.half * fit.scale), Math.max(2, spread.depth * fit.scale), 0, 0, Math.PI * 2);
      octx.fill(); octx.stroke(); octx.restore();
    }
    if (landing) {
      const q = P(landing);
      octx.strokeStyle = '#f0a23a'; octx.lineWidth = 1.6;
      octx.beginPath(); octx.arc(q[0], q[1], 3.5, 0, Math.PI * 2); octx.stroke();
    }
    if (target) {
      const q = P(target);
      octx.strokeStyle = '#ffffff'; octx.lineWidth = 1.4;
      octx.beginPath(); octx.moveTo(q[0] - 5, q[1]); octx.lineTo(q[0] + 5, q[1]); octx.moveTo(q[0], q[1] - 5); octx.lineTo(q[0], q[1] + 5); octx.stroke();
    }
    if (pin) {
      const q = P(pin);
      octx.strokeStyle = '#ffffff'; octx.lineWidth = 1.2;
      octx.beginPath(); octx.moveTo(q[0], q[1]); octx.lineTo(q[0], q[1] - 11); octx.stroke();
      octx.fillStyle = '#f5d24a'; octx.beginPath(); octx.moveTo(q[0], q[1] - 11); octx.lineTo(q[0] + 7, q[1] - 8.5); octx.lineTo(q[0], q[1] - 6); octx.fill();
      octx.fillStyle = '#0b1a13'; octx.beginPath(); octx.arc(q[0], q[1], 1.6, 0, Math.PI * 2); octx.fill();
    }
    if (ball) {
      const q = P(ball);
      octx.fillStyle = '#ffffff'; octx.strokeStyle = 'rgba(0,0,0,.55)'; octx.lineWidth = 1;
      octx.beginPath(); octx.arc(q[0], q[1], 3.2, 0, Math.PI * 2); octx.fill(); octx.stroke();
    }
  }

  return {
    el,
    /** A new hole: its line ([[x, z], ...] tee to green), its pin and its white stakes. */
    setHole({ line, boundaries = [] }) {
      hole = { line, boundaries };
      // The large map's shape, so either size fills its box.
      frame = holeFrame(line, { aspect: 224 / 300 });
      startRaster();
      resize();
    },
    step,
    get ready() { return Boolean(job?.done); },
    /** The marks: ball, aim (the aim line's end), landing, spread { centre, dir, half, depth }, strokes, flight, target, pin. */
    marks(next) { marks = next; paintMarks(); },
    setSmall,
    get small() { return small; },
    set hidden(v) { el.hidden = v; },
    dispose() { el.remove(); },
  };
}
