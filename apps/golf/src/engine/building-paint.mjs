/* PAINTED BUILDINGS (docs/visual-buildings-2026-09-25.md). Buildings reach the
   screen three ways: each course's clubhouse and facilities as models made in
   Blender, with their own named colours taken from the real buildings; every
   other building in one vertex-coloured mesh in the painted palette (main.js);
   and the distant town as boxes in the haze. Both near kinds already share the
   painted light. What the batch lacked, a painter gives a building first:
   - THE WALL'S FOOT. Where a wall meets the ground it darkens, the way the
     ground's own light fails there, back to its full colour a metre up. Read
     per pixel from each vertex's height over the ground under it, stamped
     once at load, and on steep surfaces only: roofs, paving and decks keep
     their colour. The Blender models take the same foot, lighter and lower --
     they model their own plinths -- and keep every colour they were made with.
   - THE RIDGE. A gable or hip roof's slope darkens a little toward its eaves
     and lightens in a band along its ridge, baked into the vertex colours.
   The distant town is left as it is: a kilometre of haze would take it all. */
import { BufferAttribute } from 'three/webgpu';
import { float, materialColor, mix, normalWorld, positionWorld, smoothstep, attribute, vec3, vec4 } from 'three/tsl';

export const BUILDING_PAINT = Object.freeze({
  /* the wall's foot: this share of its colour at the ground line, all of it this high above */
  foot: { batch: { floor: 0.72, metres: 0.9 }, model: { floor: 0.84, metres: 0.55 } },
  /* a wall is steep: its foot fades out as |normal.y| rises through these */
  steep: [0.5, 0.8],
  /* a roof slope: this share of its colour at the eaves; a band this share of the slope along the ridge, lit to this */
  ridge: { eave: 0.94, band: 0.22, light: 1.14 },
  /* the ground is read once per cell of this size */
  groundCell: 0.25,
});

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** How much of its colour a surface keeps at its foot: `above` metres over the ground, `normalY` its normal's height. */
export function wallFootAt(above, normalY, { floor, metres }) {
  const steep = 1 - smooth(BUILDING_PAINT.steep[0], BUILDING_PAINT.steep[1], Math.abs(normalY));
  const foot = floor + (1 - floor) * smooth(0, metres, above);
  return 1 + (foot - 1) * steep;
}

/** The same in the shader, over the material's own colour: the ground under each vertex is its `aGround`.
    Only the colour darkens. A map's alpha, should a model bring one, passes through: a plain colour widens
    to (rgb, 1) here exactly as three widens it without this node. */
export function wallFootColour(shade) {
  const above = positionWorld.y.sub(attribute('aGround', 'float'));
  const steep = float(1).sub(smoothstep(BUILDING_PAINT.steep[0], BUILDING_PAINT.steep[1], normalWorld.y.abs()));
  const foot = mix(float(shade.floor), float(1), smoothstep(0, shade.metres, above));
  return materialColor.mul(vec4(vec3(mix(float(1), foot, steep)), 1));
}

/** A ground sampler that reads each small cell once: vertices crowd the same spots. */
export function groundCache(groundAt, cell = BUILDING_PAINT.groundCell) {
  const seen = new Map();
  return (x, z) => {
    const i = Math.round(x / cell), j = Math.round(z / cell), key = i * 4194304 + j;
    let h = seen.get(key);
    if (h === undefined) { h = groundAt(i * cell, j * cell); seen.set(key, h); }
    return h;
  };
}

/** Stamp a geometry's vertices with the ground's height under them (`aGround`); `matrix` takes them to the world. */
export function stampGround(geometry, groundAt, matrix = null) {
  const position = geometry.getAttribute('position'), n = position.count;
  const out = new Float32Array(n), e = matrix?.elements;
  for (let i = 0; i < n; i++) {
    let x = position.getX(i), z = position.getZ(i);
    if (e) {
      const y = position.getY(i);
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      x = wx; z = wz;
    }
    const h = groundAt(x, z);
    out[i] = Number.isFinite(h) ? h : -1e4;
  }
  geometry.setAttribute('aGround', new BufferAttribute(out, 1));
  return n;
}

/* what groundModel has painted and stamped, over every call: models loaded from one file share materials
   and geometry, and a building's nodes are painted one call apiece */
const PAINTED = new WeakSet(), STAMPED = new WeakSet();

/** Give a model made in Blender the wall's foot: every mesh under `root`, its materials' own colours kept.
    A material that already paints itself (a facility's draped ground, say) is left alone, as are its meshes. */
export function groundModel(root, groundAt, shade = BUILDING_PAINT.foot.model) {
  const report = { meshes: 0, vertices: 0, materials: 0, copies: 0, copiedVertices: 0 };
  if (!root) return report;
  root.updateMatrixWorld(true);
  const colour = wallFootColour(shade), materialsHere = new Set();
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    const materials = [mesh.material].flat().filter(Boolean);
    if (!materials.length || materials.some(m => m.colorNode && !PAINTED.has(m))) return;
    /* a geometry shared with a mesh stamped already (a clone's, another placement's): stamp its own copy */
    if (STAMPED.has(mesh.geometry)) {
      mesh.geometry = mesh.geometry.clone();
      report.copies++; report.copiedVertices += mesh.geometry.getAttribute('position').count;
    }
    report.vertices += stampGround(mesh.geometry, groundAt, mesh.matrixWorld);
    STAMPED.add(mesh.geometry);
    /* a standard material is converted to a node material as each shader is built, colorNode and all */
    for (const m of materials) {
      if (!PAINTED.has(m)) { m.colorNode = colour; m.needsUpdate = true; PAINTED.add(m); }
      materialsHere.add(m);
    }
    report.meshes++;
  });
  report.materials = materialsHere.size;
  return report;
}

/** One gable or hip roof slope, eaves `a`, `b` up to ridge `c`, `d` (or to one apex `c`), as triangles in
    `push(p, q, r, cp, cq, cr)` with a colour at each corner: a touch darker at the eaves, lit along the ridge.
    It is cut where the band begins; a gable's end wall, which shares its sloping edges, is cut at the same
    points (`shade` false, one colour), so no edge ends in the middle of another and nothing cracks. */
export function roofSlope(push, points, colour, { shade = true } = {}) {
  const { eave, band, light } = BUILDING_PAINT.ridge;
  const scale = k => shade ? colour.map(v => v * k) : colour;
  const toward = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  const [a, b, c, d = c] = points, cut = 1 - band;
  const mb = toward(b, c, cut), ma = toward(a, d, cut);
  const low = scale(eave), mid = colour, high = scale(light);
  push(a, b, mb, low, low, mid); push(a, mb, ma, low, mid, mid);
  push(ma, mb, c, mid, mid, high);
  if (points.length === 4) push(ma, c, d, mid, high, high);
}
