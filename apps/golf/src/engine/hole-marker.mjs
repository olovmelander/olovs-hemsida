import { Vector3 } from 'three/webgpu';
import { BADGE, areaOver, clamp, clearEdge, edgePlacement, inset, sizeOf } from './hole-marker-edge.mjs';
import '../styles/hole-marker.css';

const setText = (el, text) => { if (el.textContent !== String(text)) el.textContent = text; };
const setAttr = (el, name, value) => { if (el.getAttribute(name) !== value) el.setAttribute(name, value); };
const setStyle = (el, name, value) => { if (el.style[name] !== value) el.style[name] = value; };

/* The badge drops its NAME. "Green 1" and "Tee 58" were already on the hole
   card above the scene, so the pills said it twice while costing a phone a
   strip of the course -- the thing the app is for. The name still reaches
   assistive technology through the live region and the button's label; it is
   the PAINT that is gone, not the information.

   `metric` is the exception, and it is the owner's: the tee keeps its length
   beside the icon, because that is the number a player reads off a tee marker
   in the first place. The green's badge is the bare disc. */

/** Draw the tee first and reserve its badge for the green, so the two
 * annotations share projection and layout without mutual layout jitter. */
export function createHoleMarker({ id, kind, icon, camera, heightAt, onLocate, describe, metric = false }) {
  const root = document.createElement('div');
  root.id = id;
  root.className = 'hole-marker';
  root.dataset.kind = kind;
  root.dataset.mode = 'point';
  root.hidden = true;
  root.innerHTML = `
    <svg class="hole-marker-map" aria-hidden="true">
      <path class="hole-marker-outline-shadow" /><path class="hole-marker-outline" />
      <path class="hole-marker-ring-shadow" /><path class="hole-marker-ring" />
      <path class="hole-marker-leader-shadow" /><path class="hole-marker-leader" />
    </svg>
    <span class="hole-marker-point selected-${kind}-point" aria-hidden="true"><i></i></span>
    <button class="hole-marker-card selected-${kind}-card" type="button">
      <span class="hole-marker-emblem" aria-hidden="true">${icon}</span>
      <span class="hole-marker-arrow" aria-hidden="true">
        <svg viewBox="0 0 12 12" fill="none"><path d="M2 6h7M6 2.5 9.5 6 6 9.5"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
      <span class="hole-marker-metric" aria-hidden="true"></span>
      <span class="hole-marker-copy" role="status" aria-live="polite" aria-atomic="true">
        <strong class="hole-marker-label"></strong>
        <span class="hole-marker-value"></span>
      </span>
    </button>`;
  root.dataset.metric = String(metric);
  document.body.append(root);
  const card = root.querySelector('button'), map = root.querySelector('.hole-marker-map');
  const point = root.querySelector('.hole-marker-point');
  const arrow = root.querySelector('.hole-marker-arrow');
  const paths = name => root.querySelectorAll(`.hole-marker-${name}, .hole-marker-${name}-shadow`);
  const rings = paths('ring'), leaders = paths('leader'), outlines = paths('outline');
  const label = root.querySelector('.hole-marker-label'), value = root.querySelector('.hole-marker-value');
  const metricEl = root.querySelector('.hole-marker-metric');
  const v = new Vector3();
  let selected = null, offscreen = false, outline = [];
  let obstacles = [], nextMeasure = 0, size = sizeOf();
  card.addEventListener('click', () => onLocate(offscreen));

  function select(selection) {
    if (!selection) { selected = null; root.hidden = true; return; }
    if (selected?.key === selection.key) return;
    selected = selection;
    root.dataset.hole = selected.hole;
    if (selected.teeIndex != null) root.dataset.tee = selected.teeIndex;
    setText(label, selected.label); setText(value, selected.value || '');
    if (metric) setText(metricEl, selected.value || '');
    // Subdivide the real green boundary to follow sloping ground.
    outline = [];
    if (selected.outline?.length >= 3) selected.outline.forEach((a, i, ring) => {
      const b = ring[(i + 1) % ring.length];
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
      for (let j = 0; j < steps; j++) outline.push([a[0] + (b[0] - a[0]) * j / steps, a[1] + (b[1] - a[1]) * j / steps]);
    });
    point.classList.remove('just-selected');
    void point.offsetWidth;
    point.classList.add('just-selected');
    nextMeasure = 0;
  }

  function project(x, y, z, width, height) {
    // Camera-space depth works with WebGL, WebGPU and reversed depth.
    const inFront = v.set(x, y, z).applyMatrix4(camera.matrixWorldInverse).z < 0;
    v.set(x, y, z).project(camera);
    return { x: (v.x + 1) * width / 2, y: (1 - v.y) * height / 2, z: v.z, inFront };
  }

  function measure(now) {
    if (now < nextMeasure) return;
    nextMeasure = now + 400;
    /* The green's badge is a 34 px disc by construction; the tee's grows with
       the digits in its length, so it is read rather than assumed. */
    size = sizeOf(card.offsetWidth || size.width, card.offsetHeight || size.height);
    obstacles = [...document.querySelectorAll('#card, #rail, #mini, #note, #courseNav, .holes-wrap, .mobile-hud-cluster, #gpsStatus, #kikOut.show, #kikTag .kt-box')]
      .filter(el => el.getClientRects().length && getComputedStyle(el).opacity !== '0')
      .map(el => el.getBoundingClientRect());
  }

  function placeBadge(p, box, reserved) {
    const { width: bw, height: bh } = size;
    const right = p.x + 16, left = p.x - 16 - bw;
    const candidates = [[right, p.y - bh / 2], [left, p.y - bh / 2],
      [right, p.y - bh - 12], [left, p.y - bh - 12],
      [right, p.y + 12], [left, p.y + 12]];
    const rectangle = ([x, y]) => {
      const l = clamp(x, box.side, box.width - bw - box.side);
      const top = clamp(y, box.top, box.height - bh - box.bottom);
      return { left: l, top, right: l + bw, bottom: top + bh };
    };
    const blocked = [...obstacles, ...reserved];
    const score = rect => blocked.reduce((sum, r) => sum + areaOver(rect, r), 0);
    const rects = candidates.map(rectangle);
    const preferred = rects.reduce((best, rect) => score(rect) < score(best) ? rect : best);
    if (score(preferred) === 0) return preferred;
    // A bottom sheet can cover every position close to the ground anchor.
    // Try the edges of the actual panels/tags before accepting an overlap.
    const extras = blocked.flatMap(r => [
      [preferred.left, r.top - bh - 12], [preferred.left, r.bottom + 12],
      [r.left - bw - 12, preferred.top], [r.right + 12, preferred.top],
    ]).map(rectangle);
    const distance = r => Math.hypot(r.left - preferred.left, r.top - preferred.top);
    return extras.reduce((best, rect) => score(rect) < score(best) ||
      (score(rect) === score(best) && distance(rect) < distance(best)) ? rect : best, preferred);
  }

  function update({ now = performance.now(), hidden = false, opacity: markerOpacity = 1, mode = 'orbit', reserved = [] } = {}) {
    const nextHidden = !selected || hidden || markerOpacity <= 0;
    if (root.hidden !== nextHidden) root.hidden = nextHidden;
    setStyle(root, 'opacity', String(markerOpacity));
    if (root.hidden) return null;
    const width = innerWidth, height = innerHeight;
    const box = inset(width, height);
    camera.updateMatrixWorld();
    const [x, z] = selected.c, y = heightAt(x, z) + 0.18;
    const p = project(x, y, z, width, height);
    const distance = camera.position.distanceTo(v.set(x, y, z)), near = distance < 3;
    /* Off screen is a question about the SAFE box, not the viewport: a badge
       behind the hole card or under the quick actions is no more findable than
       one past the edge, and the arrow can point at both alike. */
    offscreen = !p.inFront || p.z < -1 || p.z > 1
      || p.x < box.side || p.x > width - box.side || p.y < box.top || p.y > height - box.bottom;
    const text = describe({ docked: offscreen, near, mode }, selected);
    const wasOffscreen = root.dataset.mode === 'edge';
    setAttr(root, 'data-mode', offscreen ? 'edge' : 'point');
    if (wasOffscreen !== offscreen) nextMeasure = 0;
    setAttr(card, 'title', `${selected.accessibleLabel}. ${text.action}.`);
    setAttr(card, 'aria-label', `${selected.accessibleLabel}. ${text.action}.`);
    measure(now);
    setStyle(map, 'display', offscreen ? 'none' : '');
    setStyle(point, 'display', offscreen || near ? 'none' : '');
    if (offscreen) {
      const edge = edgePlacement(p, box, size);
      const rect = clearEdge(edge, [...obstacles, ...reserved], size);
      setStyle(card, 'transform', `translate(${rect.left.toFixed(1)}px, ${rect.top.toFixed(1)}px)`);
      /* The arrow sits where the direction leaves the badge's own rim, so it
         stays outside a tee pill that is twice as wide as it is tall -- a fixed
         radius would park it inside the digits. */
      const radians = edge.angle * Math.PI / 180;
      const ax = Math.cos(radians), ay = Math.sin(radians);
      const reach = Math.min(ax ? (size.width / 2 + 5) / Math.abs(ax) : Infinity,
        ay ? (size.height / 2 + 5) / Math.abs(ay) : Infinity);
      setStyle(arrow, 'transform', `translate(${(ax * reach).toFixed(1)}px, ${(ay * reach).toFixed(1)}px)`
        + ` rotate(${edge.angle.toFixed(1)}deg)`);
      return rect;
    }
    setStyle(point, 'transform', `translate(${p.x}px, ${p.y}px)`);
    /* Within a few metres the ring's own radius fills the screen, so it stops
       describing the target and only clutters it. */
    let ring = '';
    if (!near) {
      const pxPerMetre = height / (2 * Math.tan(camera.fov * Math.PI / 360) * distance);
      const radius = clamp(2 * pxPerMetre, 8, 16) / pxPerMetre;
      for (let i = 0; i <= 40; i++) {
        const angle = i / 40 * Math.PI * 2;
        const q = project(x + Math.cos(angle) * radius, y, z + Math.sin(angle) * radius, width, height);
        ring += `${i ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)} `;
      }
    }
    for (const path of rings) setAttr(path, 'd', ring ? ring + 'Z' : '');
    // At ground level the flag remains legible without tracing the horizon.
    const opacity = clamp(((camera.position.y - y) / distance - 0.12) / 0.3, 0, 1);
    let boundary = '';
    if (outline.length && opacity > 0) {
      for (const [i, [gx, gz]] of outline.entries()) {
        const q = project(gx, heightAt(gx, gz) + 0.18, gz, width, height);
        if (!q.inFront || q.z < -1 || q.z > 1) { boundary = ''; break; }
        boundary += `${i ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)} `;
      }
    }
    for (const path of outlines) {
      setAttr(path, 'd', boundary ? boundary + 'Z' : '');
      setStyle(path, 'opacity', String(opacity));
    }
    const rect = placeBadge(p, box, reserved);
    setStyle(card, 'transform', `translate(${rect.left}px, ${rect.top}px)`);
    const endX = clamp(p.x, rect.left + 4, rect.right - 4);
    const endY = clamp(p.y, rect.top + 4, rect.bottom - 4);
    for (const path of leaders) setAttr(path, 'd', `M${p.x},${p.y} L${endX},${endY}`);
    return rect;
  }
  return { select, update };
}
