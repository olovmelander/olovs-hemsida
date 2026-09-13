import { Vector3 } from 'three/webgpu';
import '../styles/hole-marker.css';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const setText = (el, text) => { if (el.textContent !== String(text)) el.textContent = text; };
const setAttr = (el, name, value) => { if (el.getAttribute(name) !== value) el.setAttribute(name, value); };
const areaOver = (a, b) => Math.max(0, Math.min(a.right + 8, b.right) - Math.max(a.left - 8, b.left))
  * Math.max(0, Math.min(a.bottom + 8, b.bottom) - Math.max(a.top - 8, b.top));

/** Draw the tee first and reserve its card for the green, so the two
 * annotations share projection and layout without mutual layout jitter. */
export function createHoleMarker({ id, kind, icon, camera, heightAt, onLocate, describe }) {
  const root = document.createElement('div');
  root.id = id;
  root.className = 'hole-marker';
  root.dataset.kind = kind;
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
      <span class="hole-marker-copy" role="status" aria-live="polite" aria-atomic="true">
        <strong class="hole-marker-label"></strong>
        <span class="hole-marker-value"></span>
      </span>
      <svg class="hole-marker-open" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M4 12 12 4M5 4h7v7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>`;
  document.body.append(root);
  const card = root.querySelector('button'), map = root.querySelector('.hole-marker-map');
  const point = root.querySelector('.hole-marker-point');
  const paths = name => root.querySelectorAll(`.hole-marker-${name}, .hole-marker-${name}-shadow`);
  const rings = paths('ring'), leaders = paths('leader'), outlines = paths('outline');
  const label = root.querySelector('.hole-marker-label'), value = root.querySelector('.hole-marker-value');
  const v = new Vector3();
  let selected = null, docked = false, outline = [];
  let obstacles = [], nextMeasure = 0, cardWidth = kind === 'tee' ? 140 : 82, cardHeight = 30;
  card.addEventListener('click', () => onLocate(docked));

  function select(selection) {
    if (!selection) { selected = null; root.hidden = true; return; }
    if (selected?.key === selection.key) return;
    selected = selection;
    root.dataset.hole = selected.hole;
    if (selected.teeIndex != null) root.dataset.tee = selected.teeIndex;
    setText(label, selected.label); setText(value, selected.value || '');
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
    cardWidth = card.offsetWidth || cardWidth; cardHeight = card.offsetHeight || cardHeight;
    obstacles = [...document.querySelectorAll('#card, #rail, #mini, #note, #courseNav, .holes-wrap, .mobile-hud-cluster, #gpsStatus, #kikOut.show, #kikTag .kt-box')]
      .filter(el => el.getClientRects().length && getComputedStyle(el).opacity !== '0')
      .map(el => el.getBoundingClientRect());
  }

  function placeCard(p, width, height, reserved) {
    const margin = 12, topMargin = width <= 768 ? 60 : 82;
    const right = p.x + 20, left = p.x - 20 - cardWidth;
    let candidates = [[right, p.y - cardHeight / 2], [left, p.y - cardHeight / 2],
      [right, p.y - cardHeight - 14], [left, p.y - cardHeight - 14],
      [right, p.y + 14], [left, p.y + 14]];
    if (docked) {
      const x = (width - cardWidth) / 2, y = height - (width <= 768 ? 108 : 70) - cardHeight;
      candidates = [[x, y], [x + cardWidth + 12, y], [x - cardWidth - 12, y],
        [x, y - cardHeight - 12], [x, y - cardHeight * 2 - 24]];
    }
    const rectangle = ([x, y]) => {
      const left = clamp(x, margin, width - cardWidth - margin);
      const top = clamp(y, topMargin, height - cardHeight - 70);
      return { left, top, right: left + cardWidth, bottom: top + cardHeight };
    };
    const blocked = [...obstacles, ...reserved];
    const score = rect => blocked.reduce((sum, r) => sum + areaOver(rect, r), 0);
    const rects = candidates.map(rectangle);
    const preferred = rects.reduce((best, rect) => score(rect) < score(best) ? rect : best);
    if (score(preferred) === 0) return preferred;
    // A bottom sheet can cover every position close to the ground anchor.
    // Try the edges of the actual panels/tags before accepting an overlap.
    const extras = blocked.flatMap(r => [
      [preferred.left, r.top - cardHeight - 12], [preferred.left, r.bottom + 12],
      [r.left - cardWidth - 12, preferred.top], [r.right + 12, preferred.top],
    ]).map(rectangle);
    const distance = r => Math.hypot(r.left - preferred.left, r.top - preferred.top);
    return extras.reduce((best, rect) => score(rect) < score(best) ||
      (score(rect) === score(best) && distance(rect) < distance(best)) ? rect : best, preferred);
  }

  function update({ now = performance.now(), hidden = false, mode = 'orbit', reserved = [] } = {}) {
    root.hidden = !selected || hidden;
    if (root.hidden) return null;
    const width = innerWidth, height = innerHeight;
    camera.updateMatrixWorld();
    const [x, z] = selected.c, y = heightAt(x, z) + 0.18;
    const p = project(x, y, z, width, height);
    const distance = camera.position.distanceTo(v.set(x, y, z)), near = distance < 3;
    const outside = !p.inFront || p.z < -1 || p.z > 1 || p.x < 12 || p.x > width - 12 || p.y < 12 || p.y > height - 40;
    docked = near || outside;
    const text = describe({ docked, near, mode }, selected);
    const previousDock = root.dataset.docked === 'true';
    setAttr(root, 'data-docked', String(docked));
    if (previousDock !== docked) nextMeasure = 0;
    setAttr(card, 'title', `${selected.accessibleLabel}. ${text.action}.`);
    setAttr(card, 'aria-label', `${selected.accessibleLabel}. ${text.action}.`);
    measure(now);
    map.style.display = point.style.display = docked ? 'none' : '';
    if (!docked) {
      point.style.transform = `translate(${p.x}px, ${p.y}px)`;
      const pxPerMetre = height / (2 * Math.tan(camera.fov * Math.PI / 360) * distance);
      const radius = clamp(2 * pxPerMetre, 8, 16) / pxPerMetre;
      let ring = '';
      for (let i = 0; i <= 40; i++) {
        const angle = i / 40 * Math.PI * 2;
        const q = project(x + Math.cos(angle) * radius, y, z + Math.sin(angle) * radius, width, height);
        ring += `${i ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)} `;
      }
      for (const path of rings) path.setAttribute('d', ring + 'Z');
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
        path.setAttribute('d', boundary ? boundary + 'Z' : '');
        path.style.opacity = opacity;
      }
    }
    const rect = placeCard(p, width, height, reserved);
    card.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
    if (!docked) {
      const endX = clamp(p.x, rect.left + 4, rect.right - 4);
      const endY = clamp(p.y, rect.top + 4, rect.bottom - 4);
      const leader = `M${p.x},${p.y} L${endX},${endY}`;
      for (const path of leaders) path.setAttribute('d', leader);
    }
    return rect;
  }
  return { select, update };
}
