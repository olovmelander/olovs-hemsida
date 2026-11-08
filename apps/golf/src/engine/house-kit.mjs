/* THE HOUSE KIT (8 November, owner request: "on veckefjärden, i want more things
   like houses etc to be modelled in Blender to not just look like Boxes, do this
   for the inner detailed ring!"). See docs/visual-houses-2026-11-08.md.

   Every footprint the pack maps inside the course's own extract (the surroundings
   record's `inner` box) is drawn as the house it is, not as a box under a roof:
   - THE SHELL, from the footprint itself, into the building batch (main.js), so
     the wall's foot, the ridge and winter's snow reach it as they reach the rest:
     a concrete plinth, the walls, and a roof with thickness, overhang, fascia,
     barge boards and gutters -- gable, hip, gambrel, a hall's low pitch, or flat
     behind a parapet; an L or a T takes a cross gable.
   - THE PARTS, modelled in Blender (tools/blender-props/house_kit.py): windows,
     doors, porches, chimneys, corner boards, downpipes, garage, barn and roller
     doors, entrances and balconies, laid along the walls by the house's type and
     drawn as one instanced mesh per part and colour channel.
   The footprint is never moved or changed: the plan reads it and the walls stand
   on it. `?houses=before` draws every house as it was. */
import * as THREE from 'three/webgpu';
import { attribute, float, mix, normalWorld, positionWorld, smoothstep, vec3, vec4, vertexColor } from 'three/tsl';
import { inspectBuildingGlb } from './authored-buildings.mjs';
import { BUILDING_PAINT } from './building-paint.mjs';
import { snowOnRoof } from './snow.mjs';

export const HOUSE_KIT_ASSET = Object.freeze({
  url: 'models/props/house-kit-4f9baf652477184d0ac6cb352ad46a215c270d6e99c2921439cc4ef0b93f5bde.glb',
  sha256: '4f9baf652477184d0ac6cb352ad46a215c270d6e99c2921439cc4ef0b93f5bde',
  bytes: 168132,
});

/* Each part's channels: `wall`, `trim`, `roof` and `accent` take the house's colours per
   instance; `fixed` keeps its own; `glass` is drawn glossier. */
export const KIT_PARTS = Object.freeze({
  window: ['glass', 'trim'], window_small: ['glass', 'trim'], window_tall: ['glass', 'trim'],
  window_wide: ['glass', 'trim'], window_strip: ['fixed', 'glass'], shopfront: ['fixed', 'glass'],
  window_modern: ['fixed', 'glass'], door: ['accent', 'fixed', 'glass', 'trim'], door_plain: ['accent', 'fixed'],
  door_board: ['fixed', 'trim', 'wall'], garage_door: ['fixed', 'trim'], barn_door: ['fixed', 'trim', 'wall'],
  roller_door: ['fixed'], entrance: ['fixed', 'glass'], porch: ['fixed', 'roof', 'trim', 'wall'],
  porch_low: ['fixed', 'roof', 'trim'], balcony: ['accent', 'fixed'], chimney: ['fixed'], chimney_brick: ['fixed'],
  corner: ['trim'], downpipe: ['fixed'],
  /* a far house's windows and doors: flat plates, one metre square, stretched to the near part's size */
  window_far: ['glass', 'trim'], window_far_alu: ['fixed', 'glass'], door_far: ['accent', 'trim'],
  /* a glazed lean-to veranda: bays along a wall, a side panel at each end */
  veranda: ['fixed', 'glass', 'trim'], veranda_side: ['glass', 'trim'],
});
export const TINTED = Object.freeze(['wall', 'trim', 'roof', 'accent']);

/* the parts' outer sizes in metres (width along the wall, height from the origin), as built */
export const PART_SIZE = Object.freeze({
  window: [1.22, 1.51], window_small: [0.8, 0.76], window_tall: [1.4, 1.68], window_wide: [2.2, 1.55],
  window_strip: [3.06, 0.78], shopfront: [2.86, 2.35], window_modern: [1.46, 1.45],
  door: [1.28, 2.38], door_plain: [1.12, 2.15], door_board: [1.3, 2.1], garage_door: [2.75, 2.3],
  barn_door: [3.7, 3.25], roller_door: [4.36, 4.75], entrance: [3.2, 3.75], porch: [2.84, 3.66],
  porch_low: [2.9, 2.51], balcony: [3.35, 1.06], veranda: [2.5, 2.45],
});
/* the parts that cast a shadow worth drawing into the sun's map; a window's frame is too thin */
export const SHADOW_PARTS = Object.freeze(['porch', 'porch_low', 'chimney', 'chimney_brick', 'balcony', 'entrance', 'roller_door', 'veranda']);

export const HOUSE_KIT = Object.freeze({
  eaveOverhang: 0.45, gableOverhang: 0.35, roofThickness: 0.2, plinthOut: 0.035,
  parapet: 0.55, cornerMargin: 0.85,
  plinth: { villa: 0.45, shed: 0.15, garage: 0.1, outbuilding: 0.2, barn: 0.35, hall: 0.15, block: 0.6, store: 0.2, school: 0.4 },
  /* a footprint is a rectangle when it fills this share of its oriented box */
  rectCover: 0.9,
  colours: { plinth: 0x8f8b84, gutter: 0x45494c, membrane: 0x3b3e40, steel: 0x5d6265, metalRoof: 0x5f666a,
    coping: 0x6b7073, doors: [0x2f4a3a, 0x24384f, 0x6e2e25, 0xf0ead7, 0x7a5434, 0x3a3d40, 0x8a7a5f],
    blockWalls: [0xc9a96e, 0x9a5038, 0xded4ac, 0xe3ded2, 0xa8aaa5], hallWalls: [0x9faeb0, 0xb9bdbf, 0x5f7d6a, 0x7d8c99, 0xa2483a],
    balconies: [0xe3ded2, 0x6f7b80, 0x8a5a44, 0x4f6b5a] },
});

/* HOW MUCH OF EACH PART (8 November, owner request: "Set that up!", after the question whether the
   detailed buildings were worth it). Detail goes by where a house stands, as the trees' bands do, never
   by how far the camera is. A house within `PARTS_REACH` metres of a hole's line takes every part as it
   was modelled. One further out keeps every part too, but its windows and doors are flat plates from
   the same kit (`FAR_PART`: a frame, the glass and a glazing bar, six triangles where a window has about
   ninety), stretched to the near part's size: past about 500 m a window is a pixel, and from the free
   camera the house still has its windows. `?houseparts=all` lays the near parts everywhere (the before).
   At low quality every house takes the flat windows and doors, as the trees take their lighter model there. */
export const PARTS_REACH = 800;
export const FAR_PART = Object.freeze({
  window: 'window_far', window_small: 'window_far', window_tall: 'window_far', window_wide: 'window_far',
  window_strip: 'window_far_alu', shopfront: 'window_far_alu', window_modern: 'window_far_alu',
  door: 'door_far', door_plain: 'door_far', door_board: 'door_far',
});
export const allPartsEverywhere = (search = globalThis.location?.search || '') => new URLSearchParams(search).get('houseparts') === 'all';
/** The part a house `distance` metres from the nearest hole line draws for placement `p`: itself, or its flat plate. */
export function partAt(p, distance, reach = PARTS_REACH) {
  const far = distance > reach && FAR_PART[p.part];
  if (!far) return p;
  const [w, h] = PART_SIZE[p.part];
  /* the plate stands on the near part's foot: a window's casing, a door's threshold */
  return { ...p, part: far, sx: p.sx * w, sy: p.sy * h };
}

/** The before switch: `?houses=before` draws every house as the batch drew it. */
export function houseKitAllowed(search = globalThis.location?.search || '') {
  return new URLSearchParams(search).get('houses') !== 'before';
}

/* ------------------------------------------------------------------ small helpers */
/** The footprint check the roof colours are tied by: FNV-1a over the ring's JSON (geobuild/facilities/roof-colours.py). */
export function ringCheck(ring) {
  const text = JSON.stringify(ring);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** The roofs read off the orthophoto, by building index; each is used only while its footprint is the one it was read from. */
export function measuredRoofs(record) {
  const out = new Map();
  if (record?.schemaVersion !== 2 || !Array.isArray(record.roofs)) return out;
  for (const [index, check, roof] of record.roofs) if (Number.isInteger(index) && /^#[0-9a-f]{6}$/.test(roof))
    out.set(index, { check, roof: roofAlbedo(linear(parseInt(roof.slice(1), 16))) });
  return out;
}

/* A photographed roof is its paint under a June sun, seen through a few hundred metres of haze, and a
   light metal one glints: the game lights it again. Its luminance is eased above a knee toward a ceiling,
   so pale roofs stay pale without reading as snow, and the chroma the haze took is given back (its
   luminance kept). The palette's own roofs sit at 0.11 (slate) and 0.15 (clay); the measured median is 0.11. */
export const ROOF_EASE = Object.freeze({ knee: 0.22, ceiling: 0.34, chroma: 1.3 });
const lumOf = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
export function roofAlbedo(rgb) {
  const lum = lumOf(rgb), { knee, ceiling, chroma } = ROOF_EASE;
  const eased = lum <= knee ? lum : knee + (ceiling - knee) * (1 - Math.exp(-(lum - knee) / (ceiling - knee)));
  const k = lum > 0 ? eased / lum : 1;
  return rgb.map(v => Math.max(0, eased + (v * k - eased) * chroma));
}
export const measuredRoofFor = (table, index, ring) => {
  const m = table.get(index);
  return m && m.check === ringCheck(ring) ? m.roof : null;
};

/** The roofs' before switch: `?roofs=palette` gives every roof the painted palette's colour. */
export const measuredRoofsAllowed = (search = globalThis.location?.search || '') => new URLSearchParams(search).get('roofs') !== 'palette';

const sRGB = v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
export const linear = hex => [sRGB(((hex >> 16) & 255) / 255), sRGB(((hex >> 8) & 255) / 255), sRGB((hex & 255) / 255)];
const scale = (c, k) => c.map(v => v * k);
/** a deterministic number in [0, 1) for a house and a question */
export function rnd(seed, k) {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul((k | 0) + 0x632be5ab, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
export const seedOf = (x, z) => (Math.round(x * 10) * 73856093) ^ (Math.round(z * 10) * 19349663);

export function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(a / 2);
}
const signedArea = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a / 2; };
export function inside(x, z, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/** The minimum-area oriented box, long axis first: the same box main.js's obb2 finds. */
export function orientedBox(ring) {
  if (ring.length < 3) return null;
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    const ang = Math.atan2(bz - az, bx - ax), c = Math.cos(ang), s = Math.sin(ang);
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const [x, z] of ring) {
      const u = x * c + z * s, v = -x * s + z * c;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area - 1e-9) {
      const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
      best = { area, cx: um * c - vm * s, cz: um * s + vm * c, hw: (u1 - u0) / 2, hd: (v1 - v0) / 2, ang };
    }
  }
  if (best.hd > best.hw) { const t = best.hw; best.hw = best.hd; best.hd = t; best.ang += Math.PI / 2; }
  return best;
}

/** The unit direction from (x, z) to the nearest point of any of `lines` within `reach`, or null. */
export function nearestRoadDirection(x, z, lines, reach = 70) {
  let best = null, bd = reach;
  for (const line of lines) for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(px - x, pz - z);
    if (d < bd && d > 0.5) { bd = d; best = [(px - x) / d, (pz - z) / d]; }
  }
  return best;
}

/* ------------------------------------------------------------------ the footprint's frame */
/** A rectangle: centre, its long axis (ax, az) and the axis across it (bx, bz), half-length and half-span. */
const rectFrame = (cx, cz, ang, hl, hs) => ({ cx, cz, ax: Math.cos(ang), az: Math.sin(ang), bx: -Math.sin(ang), bz: Math.cos(ang), hl, hs });
const at = (f, u, v, y) => [f.cx + f.ax * u + f.bx * v, y, f.cz + f.az * u + f.bz * v];

/** What a footprint is: a rectangle, an orthogonal union of up to three rectangles, or neither. */
export function footprintFrame(ring) {
  const area = ringArea(ring), box = orientedBox(ring);
  if (!box) return { kind: 'none', area };
  const cover = area / (4 * box.hw * box.hd);
  if (cover >= HOUSE_KIT.rectCover) {
    const f = rectFrame(box.cx, box.cz, box.ang, box.hw, box.hd);
    return { kind: 'rect', area, box, cover, rects: [f], ring: rectRing(f) };
  }
  const ortho = orthogonalRects(ring, box);
  if (ortho) return { kind: 'ortho', area, box, cover, rects: ortho.rects, ring: ortho.ring, contacts: ortho.contacts };
  return { kind: 'complex', area, box, cover, rects: [], ring };
}

function rectRing(f) {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => {
    const p = at(f, su * f.hl, sv * f.hs, 0);
    return [p[0], p[2]];
  });
}

/* Orthogonal footprints (an L, a T, a stepped wing) into at most three rectangles: the
   ring in its box's frame, every edge along an axis, its coordinates snapped onto a grid,
   and the largest rectangle of grid cells taken first. */
function orthogonalRects(ring, box) {
  const c = Math.cos(box.ang), s = Math.sin(box.ang);
  const local = ring.map(([x, z]) => [(x - box.cx) * c + (z - box.cz) * s, -(x - box.cx) * s + (z - box.cz) * c]);
  for (let i = 0; i < local.length; i++) {
    const a = local[i], b = local[(i + 1) % local.length];
    const du = Math.abs(b[0] - a[0]), dv = Math.abs(b[1] - a[1]), len = Math.hypot(du, dv);
    if (len < 0.25) continue;
    if (Math.min(du, dv) > len * 0.12) return null;
  }
  const snap = values => {
    const sorted = [...values].sort((p, q) => p - q), out = [];
    for (const v of sorted) if (!out.length || v - out[out.length - 1].last > 0.45) out.push({ sum: v, n: 1, last: v });
    else { const g = out[out.length - 1]; g.sum += v; g.n++; g.last = v; }
    return out.map(g => g.sum / g.n);
  };
  const U = snap(local.map(p => p[0])), V = snap(local.map(p => p[1]));
  const near = (arr, v) => arr.reduce((best, w) => Math.abs(w - v) < Math.abs(best - v) ? w : best, arr[0]);
  const snapped = local.map(([u, v]) => [near(U, u), near(V, v)]);
  const cells = [];
  for (let i = 0; i < U.length - 1; i++) {
    cells.push([]);
    for (let j = 0; j < V.length - 1; j++) cells[i].push(inside((U[i] + U[i + 1]) / 2, (V[j] + V[j + 1]) / 2, snapped));
  }
  const rects = [];
  for (let k = 0; k < 3; k++) {
    let best = null;
    for (let i0 = 0; i0 < U.length - 1; i0++) for (let i1 = i0; i1 < U.length - 1; i1++)
      for (let j0 = 0; j0 < V.length - 1; j0++) for (let j1 = j0; j1 < V.length - 1; j1++) {
        let full = true;
        for (let i = i0; i <= i1 && full; i++) for (let j = j0; j <= j1; j++) if (!cells[i][j]) { full = false; break; }
        if (!full) continue;
        const a = (U[i1 + 1] - U[i0]) * (V[j1 + 1] - V[j0]);
        if (!best || a > best.a) best = { a, i0, i1, j0, j1 };
      }
    if (!best) break;
    for (let i = best.i0; i <= best.i1; i++) for (let j = best.j0; j <= best.j1; j++) cells[i][j] = false;
    rects.push({ u0: U[best.i0], u1: U[best.i1 + 1], v0: V[best.j0], v1: V[best.j1 + 1] });
  }
  if (cells.some(col => col.some(Boolean))) return null;
  if (rects.length < 2 || rects.some(r => Math.min(r.u1 - r.u0, r.v1 - r.v0) < 2.4)) return null;
  /* each wing must touch an earlier rectangle along a side */
  const contacts = [];
  for (let k = 1; k < rects.length; k++) {
    const w = rects[k];
    let contact = null;
    for (let m = 0; m < k && !contact; m++) {
      const n = rects[m];
      const overlapV = Math.min(w.v1, n.v1) - Math.max(w.v0, n.v0), overlapU = Math.min(w.u1, n.u1) - Math.max(w.u0, n.u0);
      if (overlapV > 1 && Math.abs(w.u1 - n.u0) < 0.05) contact = { to: m, du: 1, dv: 0 };
      else if (overlapV > 1 && Math.abs(w.u0 - n.u1) < 0.05) contact = { to: m, du: -1, dv: 0 };
      else if (overlapU > 1 && Math.abs(w.v1 - n.v0) < 0.05) contact = { to: m, du: 0, dv: 1 };
      else if (overlapU > 1 && Math.abs(w.v0 - n.v1) < 0.05) contact = { to: m, du: 0, dv: -1 };
    }
    if (!contact) return null;
    contacts.push({ wing: k, ...contact });
  }
  const toWorld = (u, v) => [box.cx + u * c - v * s, box.cz + u * s + v * c];
  const frames = rects.map(r => {
    const [cx, cz] = toWorld((r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2);
    const lu = (r.u1 - r.u0) / 2, lv = (r.v1 - r.v0) / 2;
    return { ...(lu >= lv ? rectFrame(cx, cz, box.ang, lu, lv) : rectFrame(cx, cz, box.ang + Math.PI / 2, lv, lu)), local: r };
  });
  return { rects: frames, contacts, ring: snapped.map(([u, v]) => toWorld(u, v)) };
}

/* ------------------------------------------------------------------ what a building is */
/** The house type a footprint is drawn as, from its tags, its size and the land use round it, or null
    for a building the kit must not draw as a house (a church keeps the batch's drawing). Lantmäteriet's
    purpose (`municipalSubtype`, on a measured ground) comes before OpenStreetMap's tag where it exists. */
export function classifyBuilding({ kind = 'yes', name = null, area, landuse = null, seed = 0, subtype = null, depth = null, amenity = null }) {
  /* a barn is deep; a farmhouse in the same yard is not (the short side of its oriented box) */
  const deep = depth == null ? rnd(seed, 1) < 0.5 : depth > 10.5;
  if (name && /kyrka|kapell|church|chapel|vattentorn|water tower/i.test(name)) return null;
  if (name && /förskola|preschool/i.test(name)) return 'villa';
  if (name && /skola|school|vittra/i.test(name)) return 'school';
  if (name && /hall(en)?\b|arena|ishall|fjärrvärme|värmeverk|heating/i.test(name)) return 'hall';
  if (name && /garbage|soprum|miljöhus/i.test(name)) return 'shed';
  if (name && /pump/i.test(name)) return 'outbuilding';
  /* a restaurant, a café or a hotel is a house people come to, never a barn or a block of flats */
  if (amenity && /^(restaurant|cafe|hotel|pub|bar|fast_food|guest_house)$/.test(amenity)) return area > 1500 ? 'store' : 'villa';
  if (subtype === 'Bostad') return area > 320 ? 'block' : 'villa';
  if (subtype === 'Komplementbyggnad') return area < 22 ? 'shed' : kind === 'garage' || area < 80 ? 'garage' : 'outbuilding';
  if (subtype === 'Samhällsfunktion') return area > 300 ? 'school' : 'villa';
  if (kind === 'industrial' || kind === 'warehouse') return area < 55 ? 'outbuilding' : 'hall';
  if (kind === 'commercial' || kind === 'retail' || kind === 'supermarket') return area < 55 ? 'outbuilding' : 'store';
  if (kind === 'school') return 'school';
  if (kind === 'sport' || kind === 'sports_hall') return area > 300 ? 'hall' : 'outbuilding';
  if (kind === 'garage' || kind === 'garages') return area < 18 ? 'shed' : 'garage';
  if (kind === 'shed') return area < 40 ? 'shed' : 'outbuilding';
  if (kind === 'hut' || kind === 'cabin') return area < 30 ? 'shed' : 'villa';
  if (kind === 'outbuilding') return area < 22 ? 'shed' : area > 150 ? 'barn' : 'outbuilding';
  if (kind === 'farm_auxiliary' || kind === 'barn' || kind === 'cowshed' || kind === 'stable') return area < 60 ? 'outbuilding' : 'barn';
  if (kind === 'house' || kind === 'detached' || kind === 'semidetached_house' || kind === 'farm') return area < 22 ? 'shed' : 'villa';
  if (area < 22) return 'shed';
  if (area < 58) return 'outbuilding';
  if (kind === 'residential' || kind === 'apartments' || kind === 'block') return area > 200 ? 'block' : 'villa';
  if (landuse === 'residential') return area > 320 ? 'block' : 'villa';
  if (landuse === 'commercial' || landuse === 'retail') return 'store';
  if (landuse === 'industrial') return 'hall';
  if (landuse === 'farmland' || landuse === 'farmyard' || landuse === 'meadow') return area > 90 && deep ? 'barn' : 'villa';
  return area > 450 ? 'hall' : area > 110 && deep ? 'barn' : 'villa';
}

/** Does a pack call (nearly) every building a house? Lidingö's, Tortuna's and Visby's do, from their
    conversion: there `house` is no evidence of a dwelling, and the type comes from size, shape and land use. */
export function genericHouseTag(buildings = []) {
  const houses = buildings.filter(b => b.kind === 'house').length;
  return buildings.length >= 20 && houses / buildings.length > 0.9;
}

/* Clear of the trees. The lattice keeps its trees six metres off every wall, but a measured tree (the
   laser's) can stand where it stands, beside a house. A porch or an entrance canopy reaches out from the
   wall: where a trunk stands in that strip, the porch is left off and the entrance keeps only its doors,
   and the door keeps its step. `PROTRUDING` is each one's half-width along the wall and reach out of it. */
export const PROTRUDING = Object.freeze({ porch: [1.45, 2.75], porch_low: [1.45, 2.75], entrance: [1.6, 1.45] });
export const TRUNK_CLEARANCE = 0.4;
/** `p` as it may stand among the trees `treesNear(x, z, r)` gives ([[x, z], ...]): itself, its doors only, or nothing. */
export function clearOfTrees(p, treesNear) {
  const reach = PROTRUDING[p.part];
  if (!reach || !treesNear) return p;
  const [half, out] = reach, ux = p.nz, uz = -p.nx;
  for (const [tx, tz] of treesNear(p.x, p.z, Math.hypot(half, out) + TRUNK_CLEARANCE)) {
    const dx = tx - p.x, dz = tz - p.z, along = dx * ux + dz * uz, off = dx * p.nx + dz * p.nz;
    if (Math.abs(along) < half + TRUNK_CLEARANCE && off > -0.2 && off < out + TRUNK_CLEARANCE)
      return p.part === 'entrance' ? { ...p, part: 'door_plain' } : null;
  }
  return p;
}

/* A ground whose objects come only from their own evidence (`objectPlacement: 'mapped-only'`) keeps its
   buildings' silhouettes: the parts on their walls are their own appearance, but what would stand out
   from a mapped wall at a guessed place -- a porch, a balcony, a chimney, a canopy -- is left off, as the
   batch already leaves off the clubhouse's chimneys and terrace there. An entrance keeps its doors. */
export const MAPPED_ONLY_LEAVES = Object.freeze(['porch', 'porch_low', 'balcony', 'chimney', 'chimney_brick']);
export function mappedOnlyPart(p) {
  if (MAPPED_ONLY_LEAVES.includes(p.part)) return null;
  return p.part === 'entrance' ? { ...p, part: 'door_plain' } : p;
}

/** Each house's colours (linear), the wall and roof the batch would have given it kept. */
export function housePalette(type, { wall, roof, trim, seed }) {
  const C = HOUSE_KIT.colours, pick = (list, k) => linear(list[Math.floor(rnd(seed, k) * list.length) % list.length]);
  const p = { wall, roof, trim, accent: pick(C.doors, 11), plinth: linear(C.plinth), gutter: linear(C.gutter) };
  if (type === 'block' || type === 'school') { p.wall = pick(C.blockWalls, 12); p.accent = pick(C.balconies, 13); }
  if (type === 'hall') { p.wall = pick(C.hallWalls, 14); p.trim = linear(C.steel); p.roof = linear(C.metalRoof); p.accent = linear(C.steel); }
  if (type === 'store') { p.trim = linear(C.coping); }
  if (type === 'barn' && rnd(seed, 15) < 0.8) p.wall = linear(0xa2442e);
  return p;
}

/* ------------------------------------------------------------------ the plan */
/* how high each type's eaves stand over its floor, its roof, and its storeys */
function massing(type, frame, seed) {
  const r = k => rnd(seed, k), S = frame.rects[0]?.hs ?? Math.sqrt(frame.area) / 2, area = frame.area;
  switch (type) {
    case 'villa': {
      const q = r(2);
      const storeys = area < 90 ? (q < 0.7 ? 1 : 1.5) : area < 170 ? (q < 0.45 ? 1 : q < 0.8 ? 1.5 : 2) : (q < 0.35 ? 1 : 2);
      if (storeys === 1.5) return { storeys, eave: 3.4, pitch: 38 + r(3) * 7, roof: 'gable' };
      if (storeys === 2) return { storeys, eave: 5.5, pitch: 22 + r(3) * 8, roof: r(4) < 0.45 ? 'hip' : 'gable' };
      return { storeys, eave: 2.7, pitch: 21 + r(3) * 7, roof: r(4) < 0.25 ? 'hip' : 'gable' };
    }
    case 'shed': return { storeys: 1, eave: 2.15, pitch: 20 + r(3) * 8, roof: 'gable' };
    case 'garage': case 'outbuilding': return { storeys: 1, eave: 2.45, pitch: 18 + r(3) * 9, roof: 'gable' };
    case 'barn': return { storeys: 1, eave: 3.6, pitch: 36, roof: r(4) < 0.6 && S >= 3.5 ? 'gambrel' : 'gable' };
    case 'hall': return { storeys: 1, eave: Math.min(8.5, 5.4 + area / 900), pitch: 7, roof: frame.kind === 'rect' && S < 22 ? 'low' : 'flat' };
    case 'block': {
      const storeys = 2 + Math.floor(r(2) * 3);
      return { storeys, eave: storeys * 2.85, pitch: 16, roof: frame.kind === 'rect' && r(4) < 0.6 ? 'hip' : 'flat' };
    }
    case 'store': return { storeys: 1, eave: 4.4, pitch: 0, roof: 'flat' };
    case 'school': return { storeys: 2, eave: 7.0, pitch: 14, roof: frame.kind === 'rect' && S < 14 ? 'hip' : 'flat' };
    default: return { storeys: 1, eave: 3, pitch: 25, roof: 'gable' };
  }
}

/* WHAT A COURSE KNOWS OF ONE BUILDING (scenery module `houseKitBuildings`, by the building's id; owner
   request, 8 November: "this is the hotel at norrfällsviken, not the big white building we currently
   show"). Where its evidence shows it, a course may state a building's type and storeys, its colours, and
   the wings its roofs follow, traced off the orthophoto in the course's own metres (`from`, `to`: each
   ridge's ends; `width`: wall to wall; `ends`: which ends are gables, the others joining a neighbour), an
   entrance with its porch and glazed verandas (points by the walls they stand on). Such a building is a
   display revision, as a facility's model is: it is drawn from its wings, and its source footprint stays
   the data every other reader takes. */
function wingFrames(wings) {
  return wings.map(w => {
    const [a, b] = [w.from, w.to], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const f = rectFrame((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.atan2(b[1] - a[1], b[0] - a[0]), len / 2, w.width / 2);
    return { ...f, ends: w.ends ?? [true, true], ring: rectRing(f) };
  });
}
function insideFrame(f, x, z, margin = 0) {
  const dx = x - f.cx, dz = z - f.cz, u = dx * f.ax + dz * f.az, v = dx * f.bx + dz * f.bz;
  return Math.abs(u) < f.hl - margin && Math.abs(v) < f.hs - margin;
}
/* each wall of a ring: its ends, its outward normal, its length */
function edgesOf(walls, offset = 0) {
  const ccw = signedArea(walls) > 0;
  return walls.map((a, i) => {
    const b = walls[(i + 1) % walls.length], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1;
    let nx = dz / len, nz = -dx / len;
    if (!ccw) { nx = -nx; nz = -nz; }
    const mx = (a[0] + b[0]) / 2 + nx * 0.05, mz = (a[1] + b[1]) / 2 + nz * 0.05;
    if (inside(mx, mz, walls)) { nx = -nx; nz = -nz; }
    return { a, b, len, nx, nz, i: i + offset };
  });
}
/* the wall nearest a point, and how far along it the point stands */
function wallAt(edges, [x, z]) {
  let best = null;
  for (const e of edges) {
    const ux = (e.b[0] - e.a[0]) / e.len, uz = (e.b[1] - e.a[1]) / e.len;
    const t = Math.max(0, Math.min(e.len, (x - e.a[0]) * ux + (z - e.a[1]) * uz));
    const d = Math.hypot(e.a[0] + ux * t - x, e.a[1] + uz * t - z);
    if (!best || d < best.d) best = { e, t, d };
  }
  return best;
}

/** The plan of one house: its shell drawn through `emit` ({ tri, quad, slope }) and the kit parts it carries.
    `base` is where its floor's plinth starts (its highest corner), `skirt` how far the walls reach down. */
export function planHouse({ ring, type, base, skirt, palette, seed, front = null, groundAt = null, emit, mappedOnly = false, treesNear = null, override = null }) {
  const wings = override?.wings?.length ? wingFrames(override.wings) : null;
  const frame = wings ? { kind: 'wings', area: wings.reduce((a, w) => a + 4 * w.hl * w.hs, 0), rects: wings, ring: wings[0].ring }
    : footprintFrame(ring);
  const m = massing(type, frame, seed);
  if (override?.storeys) Object.assign(m, override.storeys === 2 ? { storeys: 2, eave: 5.5 } : override.storeys === 1.5 ? { storeys: 1.5, eave: 3.4 } : { storeys: 1, eave: 2.7 });
  if (override?.pitch) m.pitch = override.pitch;
  if (wings) {
    m.roof = 'gable';
    /* a traced building stands on its own ground: its highest wing corner, its walls down past the lowest */
    if (groundAt) {
      const heights = wings.flatMap(w => w.ring.map(([x, z]) => groundAt(x, z))).filter(Number.isFinite);
      if (heights.length) { base = Math.max(...heights) + 0.06; skirt = Math.max(1.2, Math.max(...heights) - Math.min(...heights) + 0.5); }
    }
  }
  if (frame.kind === 'complex' && m.roof !== 'flat') m.roof = 'flat';
  if (frame.kind === 'ortho' && !['gable', 'hip', 'gambrel', 'low'].includes(m.roof)) m.roof = 'flat';
  if (frame.kind === 'ortho' && m.roof !== 'flat') m.roof = 'gable';
  const plinth = HOUSE_KIT.plinth[type] ?? 0.3;
  const floor = base + plinth, E = floor + m.eave;
  const walls = frame.ring.length >= 3 ? frame.ring : ring;
  const out = { type, frame: frame.kind, roof: m.roof, storeys: m.storeys, floor, eave: E, ridge: E, parts: [], triangles: 0, base };
  const P = palette;
  const count = n => { out.triangles += n; };
  const E2 = { tri: (...a) => { emit.tri(...a); count(1); }, quad: (...a) => { emit.quad(...a); count(2); },
    slope: (pts, c, sh) => { emit.slope(pts, c, sh); count(pts.length === 4 ? 4 : 3); } };
  /* each wall: its ends, its outward normal, its length (a traced building's are its wings') */
  const edges = wings ? wings.flatMap((w, k) => edgesOf(w.ring, 4 * k)) : edgesOf(walls);
  const top = m.roof === 'flat' ? E + HOUSE_KIT.parapet : E;
  /* the walls and the plinth in front of them */
  const lowY = base - skirt;
  for (const e of edges) {
    E2.quad([e.a[0], lowY, e.a[1]], [e.b[0], lowY, e.b[1]], [e.b[0], top, e.b[1]], [e.a[0], top, e.a[1]], P.wall);
    const o = HOUSE_KIT.plinthOut, ux = (e.b[0] - e.a[0]) / e.len, uz = (e.b[1] - e.a[1]) / e.len;
    const A = [e.a[0] + e.nx * o - ux * o, e.a[1] + e.nz * o - uz * o], B = [e.b[0] + e.nx * o + ux * o, e.b[1] + e.nz * o + uz * o];
    if (plinth > 0.05) {
      E2.quad([A[0], lowY, A[1]], [B[0], lowY, B[1]], [B[0], floor, B[1]], [A[0], floor, A[1]], P.plinth);
      E2.quad([A[0], floor, A[1]], [B[0], floor, B[1]], [e.b[0], floor + 0.02, e.b[1]], [e.a[0], floor + 0.02, e.a[1]], P.plinth);
    }
  }
  /* the roof */
  const roofs = [];
  if (wings) for (const w of wings) roofs.push(roofOver(E2, w, E, m, P, { ends: w.ends }));
  else if (m.roof === 'flat') flatRoof(E2, walls, edges, E, P, emit.triangulate);
  else if (frame.kind === 'rect') roofs.push(roofOver(E2, frame.rects[0], E, m, P, { ends: [true, true] }));
  else {
    /* the main block takes its own pitch; each wing reaches into its neighbour no higher than the main ridge */
    const main = frame.rects[0];
    const mainRoof = roofOver(E2, main, E, m, P, { ends: endsExterior(main, walls) });
    roofs.push(mainRoof);
    for (const c of frame.contacts) {
      const w = frame.rects[c.wing], n = frame.rects[c.to];
      /* the wing's ridge runs toward the neighbour; its frame turned so +u points there */
      const dir = [c.du * Math.cos(frame.box.ang) - c.dv * Math.sin(frame.box.ang), c.du * Math.sin(frame.box.ang) + c.dv * Math.cos(frame.box.ang)];
      const along = Math.abs(dir[0] * w.ax + dir[1] * w.az) > 0.7;
      const hl = along ? w.hl : w.hs, hs = along ? w.hs : w.hl;
      const wf = rectFrame(w.cx, w.cz, Math.atan2(dir[1], dir[0]), hl, hs);
      const crosses = Math.abs(dir[0] * n.ax + dir[1] * n.az) < 0.3;
      const reach = crosses ? n.hs : Math.min(hs, n.hl);
      const rise = Math.min(hs * Math.tan(m.pitch * Math.PI / 180), (mainRoof.ridge - E) - 0.08);
      const pitch = Math.atan2(Math.max(0.4, rise), hs) * 180 / Math.PI;
      const exterior = endsExterior(wf, walls);
      roofs.push(roofOver(E2, wf, E, { ...m, roof: 'gable', pitch }, P, { ends: [exterior[0], false], extend: [0, reach] }));
    }
  }
  out.ridge = Math.max(E, ...roofs.map(r => r.ridge));
  out.parts = layParts({ type, m, frame, edges, base, floor, E, top, roofs, palette: P, seed, front, groundAt });
  if (wings) {
    /* a wall that runs inside another wing is not a wall anyone sees: nothing hangs on it */
    const within = (x, z) => wings.some(w => insideFrame(w, x, z, 0.05));
    out.parts = out.parts.filter(p => p.part === 'chimney' || p.part === 'chimney_brick' || (p.part === 'corner'
      ? !within(p.x + (p.nx - p.nz) * 0.4, p.z + (p.nz + p.nx) * 0.4) && !within(p.x + (p.nx + p.nz) * 0.4, p.z + (p.nz - p.nx) * 0.4)
      : !within(p.x + p.nx * 0.6, p.z + p.nz * 0.6)));
  }
  if (mappedOnly) out.parts = out.parts.map(mappedOnlyPart).filter(Boolean);
  if (treesNear) {
    const kept = [];
    out.treeBlocked = 0;
    for (const p of out.parts) {
      const q = clearOfTrees(p, treesNear);
      if (q !== p) out.treeBlocked++;
      if (q) kept.push(q);
    }
    out.parts = kept;
  }
  /* what the course knows stands there, from its own evidence: laid last, never thinned by the rules above */
  if (override) out.parts.push(...statedParts(override, edges, floor, E, P, groundAt, base));
  return out;
}

function statedParts(override, edges, floor, E, palette, groundAt, base) {
  const parts = [], ground = (x, z) => groundAt ? groundAt(x, z) : base;
  const put = (part, e, t, y, extra = {}) => {
    const ux = (e.b[0] - e.a[0]) / e.len, uz = (e.b[1] - e.a[1]) / e.len;
    const x = e.a[0] + ux * t + e.nx * 0.001, z = e.a[1] + uz * t + e.nz * 0.001;
    parts.push({ part, x, y, z, nx: e.nx, nz: e.nz, sx: 1, sy: 1, sz: 1, ground: ground(x, z), palette, ...extra });
  };
  if (override.entrance) {
    const { e, t } = wallAt(edges, override.entrance);
    put('door', e, t, floor);
    put('porch', e, t, floor);
  }
  for (const v of override.verandas || []) {
    const a = wallAt(edges, v.from), b = wallAt(edges, v.to);
    if (a.e !== b.e) continue;
    const t0 = Math.min(a.t, b.t), t1 = Math.max(a.t, b.t), n = Math.max(1, Math.round((t1 - t0) / PART_SIZE.veranda[0]));
    const bay = (t1 - t0) / n, sy = Math.max(0.7, Math.min(1.2, (E - floor - 0.35) / 2.4));
    for (let k = 0; k < n; k++) put('veranda', a.e, t0 + bay * (k + 0.5), floor, { sx: bay / PART_SIZE.veranda[0], sy });
    for (const t of [t0, t1]) put('veranda_side', a.e, t, floor, { sy });
  }
  return parts;
}

/* is each end of a rectangle's long axis (-u, +u) on the footprint's outside? */
function endsExterior(f, walls) {
  return [-1, 1].map(s => {
    const p = at(f, s * (f.hl + 0.3), 0, 0), q = at(f, s * (f.hl + 0.3), f.hs * 0.6, 0), r = at(f, s * (f.hl + 0.3), -f.hs * 0.6, 0);
    return !inside(p[0], p[2], walls) && !inside(q[0], q[2], walls) && !inside(r[0], r[2], walls);
  });
}

/* A pitched roof over one rectangle, its ridge along f's long axis: a slab with thickness,
   the eaves and gables overhanging, fascia and barge boards, gutters along the eaves, and the
   gable walls under it. `ends` says which gable ends are the footprint's outside; `extend`
   carries a wing's roof on past a closed end into its neighbour. */
function roofOver(E2, f, E, m, P, { ends = [true, true], extend = [0, 0] } = {}) {
  const K = HOUSE_KIT, oe = m.roof === 'low' ? 0.3 : K.eaveOverhang, og = m.roof === 'low' ? 0.3 : K.gableOverhang;
  const t = m.roof === 'low' ? 0.15 : K.roofThickness;
  const tp = Math.tan(m.pitch * Math.PI / 180), L = f.hl, S = f.hs;
  const soffit = scale(P.trim, 0.78), fascia = P.trim;
  const uA = -(L + (ends[0] ? og : extend[0])), uB = L + (ends[1] ? og : extend[1]);
  const Q = (u, v, y) => at(f, u, v, y);
  const up = (pts, colour, slope = false) => orient(E2, pts, [0, 1, 0], colour, slope);
  const facing = (pts, dir, colour) => orient(E2, pts, dir, colour, false);
  const ax = [f.ax, 0, f.az], bx = [f.bx, 0, f.bz], neg = v => v.map(c => -c);
  if (m.roof === 'hip' && L > S) {
    const Lp = L + oe, Sp = S + oe, ye = E - oe * tp, yr = E + S * tp, rl = L - S;
    const sides = [
      [Q(-Lp, -Sp, ye), Q(Lp, -Sp, ye), Q(rl, 0, yr), Q(-rl, 0, yr)],
      [Q(Lp, Sp, ye), Q(-Lp, Sp, ye), Q(-rl, 0, yr), Q(rl, 0, yr)],
      [Q(Lp, -Sp, ye), Q(Lp, Sp, ye), Q(rl, 0, yr)],
      [Q(-Lp, Sp, ye), Q(-Lp, -Sp, ye), Q(-rl, 0, yr)],
    ];
    for (const s of sides) {
      up(s, P.roof, true);
      orient(E2, s.map(p => [p[0], p[1] - t, p[2]]), [0, -1, 0], soffit, false);
    }
    const ring = [Q(-Lp, -Sp, ye), Q(Lp, -Sp, ye), Q(Lp, Sp, ye), Q(-Lp, Sp, ye)];
    for (let i = 0; i < 4; i++) {
      const a = ring[i], b = ring[(i + 1) % 4], mid = [(a[0] + b[0]) / 2 - f.cx, 0, (a[2] + b[2]) / 2 - f.cz];
      facing([a, b, [b[0], b[1] - t, b[2]], [a[0], a[1] - t, a[2]]], mid, fascia);
      gutter(E2, a, b, mid, ye, P.gutter);
    }
    return { frame: f, ridge: yr, ridgeHalf: rl, kind: 'hip', pitch: m.pitch };
  }
  if (m.roof === 'gambrel') {
    /* the barn's broken roof: a steep lower slope to a knee, a shallow upper one to the ridge */
    const k = 0.5, p1 = Math.tan(58 * Math.PI / 180), p2 = Math.tan(24 * Math.PI / 180);
    const ye = E - oe * p1, yk = E + (S - k * S) * p1, yr = yk + k * S * p2, Sp = S + oe;
    const prof = [[-Sp, ye], [-k * S, yk], [0, yr], [k * S, yk], [Sp, ye]];
    for (let i = 0; i < 4; i++) {
      const [v0, y0] = prof[i], [v1, y1] = prof[i + 1];
      const s = [Q(uA, v0, y0), Q(uB, v0, y0), Q(uB, v1, y1), Q(uA, v1, y1)];
      i < 2 ? up(s, P.roof, true) : up([s[2], s[3], s[0], s[1]], P.roof, true);
      orient(E2, s.map(p => [p[0], p[1] - t, p[2]]), [0, -1, 0], soffit, false);
    }
    for (const [ui, end] of [[uA, 0], [uB, 1]]) {
      if (!ends[end]) continue;
      const dir = end ? ax : neg(ax);
      for (let i = 0; i < 4; i++) {
        const [v0, y0] = prof[i], [v1, y1] = prof[i + 1];
        facing([Q(ui, v0, y0), Q(ui, v1, y1), Q(ui, v1, y1 - t), Q(ui, v0, y0 - t)], dir, fascia);
      }
      const wu = end ? L : -L;
      const gable = [[-S, E], [-k * S, yk], [0, yr], [k * S, yk], [S, E]].map(([v, y]) => Q(wu, v, y));
      for (let i = 1; i < 4; i++) facing([gable[0], gable[i], gable[i + 1]], dir, P.wall);
    }
    for (const sv of [-1, 1]) {
      const a = Q(uA, sv * Sp, ye), b = Q(uB, sv * Sp, ye), dir = sv > 0 ? bx : neg(bx);
      facing([a, b, [b[0], b[1] - t, b[2]], [a[0], a[1] - t, a[2]]], dir, fascia);
      gutter(E2, a, b, dir, ye, P.gutter);
    }
    return { frame: f, ridge: yr, ridgeHalf: L, kind: 'gambrel', pitch: 58 };
  }
  /* a gable, or a hall's low pitch */
  const ye = E - oe * tp, yr = E + S * tp, Sp = S + oe;
  for (const sv of [-1, 1]) {
    const s = [Q(uA, sv * Sp, ye), Q(uB, sv * Sp, ye), Q(uB, 0, yr), Q(uA, 0, yr)];
    up(s, P.roof, true);
    orient(E2, s.map(p => [p[0], p[1] - t, p[2]]), [0, -1, 0], soffit, false);
    const a = s[0], b = s[1], dir = sv > 0 ? bx : neg(bx);
    facing([a, b, [b[0], b[1] - t, b[2]], [a[0], a[1] - t, a[2]]], dir, fascia);
    gutter(E2, a, b, dir, ye, P.gutter);
  }
  for (const [ui, end] of [[uA, 0], [uB, 1]]) {
    if (!ends[end]) continue;
    const dir = end ? ax : neg(ax);
    /* the barge boards, down both slopes of the gable */
    for (const sv of [-1, 1]) facing([Q(ui, sv * Sp, ye), Q(ui, 0, yr), Q(ui, 0, yr - t - 0.04), Q(ui, sv * Sp, ye - t - 0.04)], dir, fascia);
    const wu = end ? L : -L;
    facing([Q(wu, -S, E), Q(wu, S, E), Q(wu, 0, yr)], dir, P.wall);
  }
  return { frame: f, ridge: yr, ridgeHalf: L, kind: m.roof, pitch: m.pitch };
}

function gutter(E2, a, b, dir, ye, colour) {
  /* a gutter hung under the fascia: its face and its underside */
  const l = Math.hypot(dir[0], dir[2]) || 1, nx = dir[0] / l * 0.12, nz = dir[2] / l * 0.12;
  const y0 = ye - 0.17, y1 = ye - 0.05;
  orient(E2, [[a[0] + nx, y0, a[2] + nz], [b[0] + nx, y0, b[2] + nz], [b[0] + nx, y1, b[2] + nz], [a[0] + nx, y1, a[2] + nz]], dir, colour, false);
  orient(E2, [[a[0], y0, a[2]], [b[0], y0, b[2]], [b[0] + nx, y0, b[2] + nz], [a[0] + nx, y0, a[2] + nz]], [0, -1, 0], colour, false);
}

/* A flat roof behind a parapet: the membrane, the parapet's inner face, its coping. */
function flatRoof(E2, walls, edges, E, P, triangulate) {
  /* a roof read off the orthophoto is its own colour, flat or pitched; else the dark membrane */
  const K = HOUSE_KIT, top = E + K.parapet, inset = 0.25, membrane = P.roofMeasured ? P.roof : linear(K.colours.membrane), coping = P.trim;
  if (triangulate) for (const [a, b, c] of triangulate(walls))
    orient(E2, [[walls[a][0], E + 0.05, walls[a][1]], [walls[b][0], E + 0.05, walls[b][1]], [walls[c][0], E + 0.05, walls[c][1]]], [0, 1, 0], membrane, false);
  for (const e of edges) {
    const ix = -e.nx * inset, iz = -e.nz * inset;
    const A = [e.a[0] + ix, e.a[1] + iz], B = [e.b[0] + ix, e.b[1] + iz];
    orient(E2, [[A[0], E, A[1]], [B[0], E, B[1]], [B[0], top, B[1]], [A[0], top, A[1]]], [-e.nx, 0, -e.nz], scale(P.wall, 0.8), false);
    const o = 0.05;
    orient(E2, [[e.a[0] + e.nx * o, top, e.a[1] + e.nz * o], [e.b[0] + e.nx * o, top, e.b[1] + e.nz * o], [B[0], top, B[1]], [A[0], top, A[1]]], [0, 1, 0], coping, false);
    orient(E2, [[e.a[0] + e.nx * o, top - 0.1, e.a[1] + e.nz * o], [e.b[0] + e.nx * o, top - 0.1, e.b[1] + e.nz * o], [e.b[0] + e.nx * o, top, e.b[1] + e.nz * o], [e.a[0] + e.nx * o, top, e.a[1] + e.nz * o]], [e.nx, 0, e.nz], coping, false);
  }
}

/* Emit a polygon facing `dir`: winding made to agree, so snow and the sun read it the right way up.
   A roof slope keeps its corner order (eaves first, then the ridge) when it is turned. */
function orient(E2, pts, dir, colour, slope) {
  const [a, b, c] = pts;
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  const flip = n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2] < 0;
  let p = pts;
  if (flip) p = pts.length === 4 ? [pts[1], pts[0], pts[3], pts[2]] : [pts[1], pts[0], pts[2]];
  if (slope) E2.slope(p, colour, true);
  else if (p.length === 4) E2.quad(p[0], p[1], p[2], p[3], colour);
  else E2.tri(p[0], p[1], p[2], colour);
}

/* ------------------------------------------------------------------ the parts on the walls */
function slots(len, width, pitch, margin) {
  const usable = len - 2 * margin;
  if (usable < width + 0.2) return [];
  const n = Math.max(1, Math.round(usable / pitch));
  const step = usable / n;
  return Array.from({ length: n }, (_, i) => margin + step * (i + 0.5));
}

function layParts({ type, m, frame, edges, base, floor, E, top, roofs, palette, seed, front, groundAt }) {
  const parts = [], r = k => rnd(seed, k);
  const ground = (x, z) => groundAt ? groundAt(x, z) : base;
  const put = (part, e, t, y, extra = {}) => {
    const ux = (e.b[0] - e.a[0]) / e.len, uz = (e.b[1] - e.a[1]) / e.len;
    const x = e.a[0] + ux * t + e.nx * 0.001, z = e.a[1] + uz * t + e.nz * 0.001;
    parts.push({ part, x, y, z, nx: e.nx, nz: e.nz, sx: 1, sy: 1, sz: 1, ground: ground(x, z), palette, ...extra });
  };
  const main = roofs[0];
  /* which wall a long side is: its normal across the ridge of the roof over it */
  const gableEnd = e => main && frame.kind === 'rect' && main.kind !== 'hip' && Math.abs(e.nx * main.frame.ax + e.nz * main.frame.az) > 0.7;
  const usable = edges.filter(e => e.len >= 1.6);
  /* the front: the wall that faces the road, a long wall when there is a choice */
  const score = e => (front ? e.nx * front[0] + e.nz * front[1] : e.nz) + (gableEnd(e) ? 0 : 0.35) + e.len * 0.01;
  const frontWall = usable.length ? usable.reduce((p, q) => score(q) > score(p) ? q : p) : null;
  const facingFront = e => e.nx * frontWall.nx + e.nz * frontWall.nz;
  const backWall = frontWall ? usable.filter(e => e !== frontWall).reduce((p, q) => !p || facingFront(q) < facingFront(p) ? q : p, null) : null;

  /* corner boards at every right-angled outside corner, from the floor to the eaves (or the parapet) */
  const cornerTop = top - 0.04, cornerFrom = Math.max(base, floor - 0.02);
  for (const e of edges) {
    const ux = (e.b[0] - e.a[0]) / e.len, uz = (e.b[1] - e.a[1]) / e.len;
    /* the part's +x runs (nz, -nx); the corner sits at the wall's low end along it */
    const along = e.nz * ux - e.nx * uz;
    const corner = along > 0 ? e.a : e.b;
    const other = edges.find(o => o !== e && (o.a === corner || o.b === corner));
    if (!other) continue;
    const far = other.a === corner ? other.b : other.a;
    const dx = far[0] - corner[0], dz = far[1] - corner[1], dl = Math.hypot(dx, dz) || 1;
    if ((dx * -e.nx + dz * -e.nz) / dl < 0.94) continue;
    const x = corner[0], z = corner[1];
    parts.push({ part: 'corner', x, y: cornerFrom, z, nx: e.nx, nz: e.nz, sx: 1, sy: Math.max(0.5, cornerTop - cornerFrom), sz: 1,
      ground: ground(x, z), palette });
  }

  const W = (part, e, t, y) => put(part, e, t, y);
  const windowsAlong = (e, part, y, pitch, margin, skip = []) => {
    const [w] = PART_SIZE[part];
    for (const t of slots(e.len, w, pitch, margin)) {
      if (skip.some(([c, half]) => Math.abs(t - c) < half + w / 2 + 0.25)) continue;
      W(part, e, t, y);
    }
  };
  const mid = e => e.len / 2;
  const doorAt = e => Math.max(1.4, Math.min(e.len - 1.4, e.len * (0.32 + r(21) * 0.36)));

  switch (type) {
    case 'villa': {
      const storeys = m.storeys, rows = storeys === 2 ? [floor + 0.85, floor + 3.6] : [floor + 0.85];
      const tDoor = frontWall ? doorAt(frontWall) : 0;
      for (const e of usable) {
        const isFront = e === frontWall, isBack = e === backWall && e.len > 7.5;
        const skip = isFront ? [[tDoor, 0.85]] : [];
        let wideAt = null;
        if (isBack) { wideAt = e.len * (0.3 + r(22) * 0.4); W('window_wide', e, wideAt, rows[0]); skip.push([wideAt, 1.1]); }
        for (const [k, y] of rows.entries()) windowsAlong(e, 'window', y, gableEnd(e) ? 3.3 : 2.9, HOUSE_KIT.cornerMargin, k === 0 ? skip : isFront ? [[tDoor, 0.2]] : []);
        /* a gable end's own windows, where the roof leaves room */
        if (gableEnd(e) && main) {
          const S = main.frame.hs, tp = Math.tan(main.pitch * Math.PI / 180);
          if (storeys === 1.5) {
            const y = floor + 2.75 + 0.75, pair = S >= 3.9;
            for (const c of pair ? [-0.95, 0.95] : [0]) {
              const room = E + (S - (Math.abs(c) + 0.75)) * tp;
              if (room >= y + 1.51 + 0.2) W('window', e, mid(e) + c, y);
            }
          } else if (r(23) < 0.6) {
            const y = E + 0.35, room = E + (S - 0.55) * tp;
            if (room >= y + 0.76 + 0.15) W('window_small', e, mid(e), y);
          }
        }
      }
      if (frontWall) {
        W('door', frontWall, tDoor, floor);
        /* a porch where the roof leaves room for it: a gable end, or tall eaves */
        const S = main?.frame?.hs ?? 4, tp = main ? Math.tan(main.pitch * Math.PI / 180) : 0.5;
        const underEave = E - HOUSE_KIT.eaveOverhang * tp - HOUSE_KIT.roofThickness - floor;
        if (frame.kind === 'rect' && r(24) < 0.8) {
          if (gableEnd(frontWall) && E + (S - 1.5) * tp - floor > 3.8) W('porch', frontWall, tDoor, floor);
          else if (underEave > 3.75) W('porch', frontWall, tDoor, floor);
          else if (underEave > 2.6) W('porch_low', frontWall, tDoor, floor);
        }
      }
      chimneyOn(parts, main, seed, palette, ground, r(25) < 0.75);
      downpipes(parts, edges, main, base, E, palette, ground, gableEnd);
      break;
    }
    case 'shed': case 'outbuilding': case 'garage': {
      const road = front && frontWall && (frontWall.nx * front[0] + frontWall.nz * front[1]) > 0.5;
      const garage = type === 'garage' || (type === 'outbuilding' && road && frontWall.len >= 3.4 && r(31) < 0.7);
      if (frontWall) {
        if (garage) {
          const n = frontWall.len >= 6.8 && r(32) < 0.5 ? 2 : 1;
          for (let i = 0; i < n; i++) W('garage_door', frontWall, frontWall.len * (i + 0.5) / n, floor);
        } else W('door_board', frontWall, doorAt(frontWall), floor);
      }
      for (const e of usable) {
        if (e === frontWall) continue;
        if (e.len > 3 && r(33 + e.i) < (type === 'shed' ? 0.45 : 0.75)) {
          windowsAlong(e, 'window_small', floor + 1.15, 3.2, 0.9);
        }
      }
      if (garage && backWall && backWall.len > 2.4 && r(36) < 0.5) W('door_board', backWall, doorAt(backWall), floor);
      break;
    }
    case 'barn': {
      if (frontWall) W('barn_door', frontWall, mid(frontWall), floor);
      for (const e of usable) {
        const skip = e === frontWall ? [[mid(e), PART_SIZE.barn_door[0] / 2]] : [];
        windowsAlong(e, 'window_small', floor + 1.25, 3.4, 1.0, skip);
      }
      if (backWall) W('door_board', backWall, doorAt(backWall), floor);
      break;
    }
    case 'hall': {
      const stripY = Math.max(floor + 2.6, E - 1.5);
      if (frontWall) {
        const n = frontWall.len > 34 ? 3 : frontWall.len > 16 ? 2 : frontWall.len > 6 ? 1 : 0;
        const doors = Array.from({ length: n }, (_, i) => frontWall.len * (i + 0.5) / n);
        for (const t of doors) W('roller_door', frontWall, t, floor - 0.1);
        const pd = doors.length ? (doors[0] > 4 ? doors[0] - 3.4 : doors[0] + 3.4) : doorAt(frontWall);
        if (pd > 1 && pd < frontWall.len - 1) W('door_plain', frontWall, pd, floor);
        windowsAlong(frontWall, 'window_strip', Math.max(stripY, floor + 5.0), 6.5, 2.0);
      }
      for (const e of usable) if (e !== frontWall) windowsAlong(e, 'window_strip', stripY, 6.5, 2.0);
      if (backWall && backWall.len > 4) W('door_plain', backWall, doorAt(backWall), floor);
      break;
    }
    case 'store': {
      if (frontWall) {
        const tE = mid(frontWall);
        W('entrance', frontWall, tE, floor);
        windowsAlong(frontWall, 'shopfront', floor, 3.6, 1.2, [[tE, 1.6]]);
      }
      for (const e of usable) if (e !== frontWall) windowsAlong(e, 'window_modern', floor + 1.0, 6.0, 1.6);
      if (backWall && backWall.len > 3) W('door_plain', backWall, doorAt(backWall), floor);
      break;
    }
    case 'block': case 'school': {
      const storey = type === 'school' ? 3.4 : 2.85, n = type === 'school' ? 2 : m.storeys;
      const part = type === 'school' ? 'window_modern' : 'window_tall', pitch = type === 'school' ? 2.7 : 3.1;
      const entries = frontWall ? Array.from({ length: Math.max(1, Math.round(frontWall.len / 24)) }, (_, i) => frontWall.len * (i + 0.5) / Math.max(1, Math.round(frontWall.len / 24))) : [];
      for (const t of entries) W('entrance', frontWall, t, floor);
      for (const e of usable) {
        const balconies = type === 'block' && e === backWall && e.len > 8;
        const cols = slots(e.len, PART_SIZE[part][0], pitch, 1.2);
        cols.forEach((t, ci) => {
          for (let k = 0; k < n; k++) {
            const y = floor + k * storey;
            if (e === frontWall && k === 0 && entries.some(c => Math.abs(c - t) < 2.4)) continue;
            if (balconies && k > 0 && ci % 2 === 1) { W('balcony', e, t, y); W('window_tall', e, t, y + 0.02); continue; }
            W(part, e, t, y + 0.8);
          }
        });
      }
      downpipes(parts, edges, main, base, E, palette, ground, gableEnd);
      break;
    }
    default: break;
  }
  return parts;
}

function chimneyOn(parts, roof, seed, palette, ground, wanted) {
  if (!wanted || !roof || roof.kind === 'gambrel') return;
  const f = roof.frame, half = Math.max(0, Math.min(roof.ridgeHalf, f.hl) - 0.9);
  const u = (rnd(seed, 41) * 2 - 1) * half * 0.7;
  const [x, , z] = at(f, u, 0, 0);
  parts.push({ part: rnd(seed, 42) < 0.6 ? 'chimney' : 'chimney_brick', x, y: roof.ridge, z, nx: f.bx, nz: f.bz, sx: 1, sy: 1, sz: 1,
    ground: ground(x, z), palette });
}

function downpipes(parts, edges, roof, base, E, palette, ground, gableEnd) {
  /* two downpipes, at opposite ends of the eaves */
  const eaves = edges.filter(e => e.len > 4 && !gableEnd(e)).sort((p, q) => q.len - p.len).slice(0, 2);
  eaves.forEach((e, k) => {
    const t = k === 0 ? 0.32 : e.len - 0.32, ux = (e.b[0] - e.a[0]) / e.len, uz = (e.b[1] - e.a[1]) / e.len;
    const x = e.a[0] + ux * t, z = e.a[1] + uz * t, y = base - 0.3;
    parts.push({ part: 'downpipe', x, y, z, nx: e.nx, nz: e.nz, sx: 1, sy: Math.max(0.5, E - 0.15 - y), sz: 1, ground: ground(x, z), palette });
  });
}

/* ------------------------------------------------------------------ the kit's meshes */
const hex = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
  .map(b => b.toString(16).padStart(2, '0')).join('');

/** The kit's geometries, verified: { part: { channel: BufferGeometry } }, each in its part's frame. */
export async function loadHouseKit({ baseUrl = '/', fetchImpl = fetch, asset = HOUSE_KIT_ASSET } = {}) {
  const res = await fetchImpl(baseUrl + asset.url);
  if (!res.ok) throw new Error(`house kit: HTTP ${res.status}`);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength !== asset.bytes) throw new Error(`house kit: ${bytes.byteLength} bytes, the record says ${asset.bytes}`);
  if (await hex(bytes) !== asset.sha256) throw new Error('house kit: sha256 does not match the record');
  inspectBuildingGlb(bytes);
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().parseAsync(bytes, '');
  return kitFromScene(gltf.scene);
}

/** Split a loaded kit scene into its parts' channel geometries, checking every name against KIT_PARTS. */
export function kitFromScene(root) {
  const kit = {};
  root.updateMatrixWorld(true);
  root.traverse(node => {
    if (!node.isMesh) return;
    const [part, channel] = node.name.split('__');
    if (!KIT_PARTS[part]?.includes(channel)) throw new Error(`house kit: unexpected mesh ${node.name}`);
    const g = node.geometry.clone().applyMatrix4(node.matrixWorld);
    if (!g.attributes.color || !g.attributes.normal) throw new Error(`house kit: ${node.name} lacks colours or normals`);
    if (g.attributes.color.itemSize === 4) {
      const c = g.attributes.color, rgb = new Float32Array(c.count * 3);
      for (let i = 0; i < c.count; i++) { rgb[i * 3] = c.getX(i); rgb[i * 3 + 1] = c.getY(i); rgb[i * 3 + 2] = c.getZ(i); }
      g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
    }
    (kit[part] ||= {})[channel] = g;
  });
  for (const [part, channels] of Object.entries(KIT_PARTS))
    for (const channel of channels) if (!kit[part]?.[channel]) throw new Error(`house kit: ${part}__${channel} is missing`);
  return kit;
}

/** A part's matrix: x along the wall, y up, z out of it along (nx, nz); stretched by sx, sy, sz. */
export function partMatrix(p, out = new THREE.Matrix4()) {
  const ux = p.nz, uz = -p.nx;
  return out.set(
    ux * p.sx, 0, p.nx * p.sz, p.x,
    0, p.sy, 0, p.y,
    uz * p.sx, 0, p.nz * p.sz, p.z,
    0, 0, 0, 1);
}

const ROUGHNESS = { wall: 0.86, trim: 0.62, roof: 0.72, accent: 0.5, fixed: 0.7, glass: 0.06 };

/* the share of its colour a surface keeps at its foot, as wallFootColour reckons it */
function footFactor(shade) {
  const above = positionWorld.y.sub(attribute('aGround', 'float'));
  const steep = float(1).sub(smoothstep(BUILDING_PAINT.steep[0], BUILDING_PAINT.steep[1], normalWorld.y.abs()));
  const foot = mix(float(shade.floor), float(1), smoothstep(0, shade.metres, above));
  return mix(float(1), foot, steep);
}

/** One instanced mesh per part and channel for every placement. Each instance carries its
    house's colour for its channel (`aTint`) and the ground under it (`aGround`) for the wall's foot. */
export function buildHouseKitMeshes(kit, placements, { wallFoot = true, snow = false, shade = BUILDING_PAINT.foot.batch } = {}) {
  const group = new THREE.Group();
  group.name = 'house-kit';
  const byPart = new Map();
  for (const p of placements) (byPart.get(p.part) || byPart.set(p.part, []).get(p.part)).push(p);
  const materials = {};
  const materialFor = (channel, tinted) => {
    if (materials[channel]) return materials[channel];
    let colour = vertexColor().rgb;
    if (tinted) colour = colour.mul(attribute('aTint', 'vec3'));
    let node = vec4(colour, 1);
    if (wallFoot) node = node.mul(vec4(vec3(footFactor(shade)), 1));
    if (snow) node = snowOnRoof(node, normalWorld);
    const m = new THREE.MeshStandardNodeMaterial({ roughness: ROUGHNESS[channel], metalness: channel === 'glass' ? 0.0 : 0.0 });
    m.colorNode = node;
    m.name = `house-kit-${channel}`;
    return (materials[channel] = m);
  };
  const matrix = new THREE.Matrix4();
  let instances = 0, triangles = 0, draws = 0;
  for (const [part, list] of byPart) {
    for (const [channel, geometry] of Object.entries(kit[part] || {})) {
      const g = geometry.clone(), tinted = TINTED.includes(channel), n = list.length;
      const ground = new Float32Array(n), tint = tinted ? new Float32Array(n * 3) : null;
      list.forEach((p, i) => {
        ground[i] = Number.isFinite(p.ground) ? p.ground : -1e4;
        if (tint) tint.set(p.palette[channel], i * 3);
      });
      g.setAttribute('aGround', new THREE.InstancedBufferAttribute(ground, 1));
      if (tint) g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
      const mesh = new THREE.InstancedMesh(g, materialFor(channel, tinted), n);
      list.forEach((p, i) => mesh.setMatrixAt(i, partMatrix(p, matrix)));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = SHADOW_PARTS.includes(part);
      mesh.receiveShadow = true;
      mesh.name = `house-kit-${part}-${channel}`;
      mesh.userData.tag = 'house-kit';
      mesh.computeBoundingSphere();
      group.add(mesh);
      draws++;
      triangles += (g.index ? g.index.count : g.attributes.position.count) / 3 * n;
    }
    instances += list.length;
  }
  return { group, report: { parts: byPart.size, instances, triangles: Math.round(triangles), draws } };
}
