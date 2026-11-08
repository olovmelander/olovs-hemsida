/* The green's read: small arrows laid on the green round the putt, each
   drifting slowly downhill, faster and warmer in colour where the green is
   steeper (the tour games' grid). They read the drawn ground itself, the same
   heights the ball rolls on, so the break they show is the break it takes.

   One instanced draw; the arrows' places are measured once a putt, their
   drift is a per-frame matrix update. Overlay order 3, depth tested. */
import * as THREE from 'three/webgpu';

const SPACING = .9;
const MAX = 1400;
/* Slope (as a fraction) to colour: level greens pale, steep ones amber to red. */
const STOPS = [[0, [.75, .88, 1]], [.01, [.55, .95, .7]], [.022, [1, .86, .35]], [.035, [1, .55, .25]], [.06, [.95, .25, .2]]];

export function slopeColour(slope) {
  const s = Math.max(0, slope);
  for (let i = 1; i < STOPS.length; i++) {
    const [b, cb] = STOPS[i], [a, ca] = STOPS[i - 1];
    if (s <= b) { const t = (s - a) / (b - a); return ca.map((c, k) => c + (cb[k] - c) * t); }
  }
  return STOPS.at(-1)[1];
}

/** The arrows for a putt: points on the green near the line, each with its downhill direction and slope. */
export function greenArrows({ heightAt, isGreen, from, to, margin = 5, spacing = SPACING, limit = MAX }) {
  const minX = Math.min(from[0], to[0]) - margin, maxX = Math.max(from[0], to[0]) + margin;
  const minZ = Math.min(from[1], to[1]) - margin, maxZ = Math.max(from[1], to[1]) + margin;
  const out = [], e = .45;
  // A stagger on alternate rows keeps the grid from reading as stripes.
  for (let z = minZ, row = 0; z <= maxZ && out.length < limit; z += spacing, row++) {
    for (let x = minX + (row % 2) * spacing / 2; x <= maxX && out.length < limit; x += spacing) {
      if (!isGreen(x, z)) continue;
      const gx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), gz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
      const slope = Math.hypot(gx, gz);
      if (!Number.isFinite(slope) || slope < .002) continue;
      out.push({ x, z, y: heightAt(x, z), dx: -gx / slope, dz: -gz / slope, slope, phase: ((x * 12.9898 + z * 78.233) % 1 + 1) % 1 });
    }
  }
  return out;
}

export function createGreenRead({ scene, heightAt }) {
  // A flat chevron pointing +z, 32 cm long.
  const shape = new THREE.Shape();
  shape.moveTo(0, .16); shape.lineTo(.11, -.06); shape.lineTo(0, 0); shape.lineTo(-.11, -.06); shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(Math.PI / 2);                       // the shape's y becomes the world's +z
  const material = new THREE.MeshBasicNodeMaterial({ color: '#ffffff', transparent: true, opacity: .82, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geometry, material, MAX);
  mesh.count = 0; mesh.renderOrder = 3; mesh.frustumCulled = false; mesh.visible = false;
  const colour = new THREE.Color();
  for (let i = 0; i < MAX; i++) mesh.setColorAt(i, colour.setRGB(1, 1, 1));
  scene.add(mesh);
  let arrows = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  return {
    show({ from, to, isGreen }) {
      arrows = greenArrows({ heightAt, isGreen, from, to });
      mesh.count = arrows.length; mesh.visible = arrows.length > 0;
      arrows.forEach((a, i) => mesh.setColorAt(i, colour.setRGB(...slopeColour(a.slope))));
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      return arrows.length;
    },
    hide() { mesh.visible = false; mesh.count = 0; arrows = []; },
    get visible() { return mesh.visible; },
    /** Drift each arrow downhill; still under reduced motion. */
    update(time, still = false) {
      if (!mesh.visible) return;
      for (let i = 0; i < arrows.length; i++) {
        const a = arrows[i];
        const u = still ? .5 : (a.phase + time * (.25 + a.slope * 14)) % 1;
        const shift = (u - .5) * SPACING * .7, grow = still ? 1 : Math.sin(u * Math.PI);
        // Downhill by `shift` is lower by slope x shift: no height lookups per frame.
        p.set(a.x + a.dx * shift, a.y - a.slope * shift + .025, a.z + a.dz * shift);
        q.setFromAxisAngle(up, Math.atan2(a.dx, a.dz));
        const size = (.45 + Math.min(1, a.slope * 25) * .4) * grow;
        s.set(size, 1, size);
        mesh.setMatrixAt(i, m.compose(p, q, s));
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() { scene.remove(mesh); geometry.dispose(); material.dispose(); mesh.dispose?.(); },
  };
}
