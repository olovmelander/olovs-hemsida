import { ShapeUtils, Vector2 } from 'three/webgpu';
import source from './norrfallsviken-range-site.json' with { type: 'json' };
import { projectFacilityPoint } from './norrfallsviken-facilities.mjs';
import { centroidOf, inRing, hyp } from '../geom.js';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const localRing = ring => ring.map(([e, n]) => {
  const [x, , z] = projectFacilityPoint([e, n, 0], 0); return [x, z];
});
export const rangeSite = Object.fromEntries(['mats', 'pads', 'hardstanding', 'targets'].map(kind => [kind,
  source[kind].map(item => ({ ...item, ring: localRing(item.ringEpsg3006) })),
]));
export const rangeFeatureIds = [...rangeSite.hardstanding, ...rangeSite.pads, ...rangeSite.mats, ...rangeSite.targets].map(f => f.id);
const ownedIds = new Set(rangeFeatureIds);
export const isReviewedRangeFeature = feature => ownedIds.has(feature.id);

/** A display revision of the source outlines; the retained intake is untouched. */
export function prepareRangeScenery(scenery) {
  const replacements = new Map();
  for (const [key, kind, material] of [['mats', 'range_mat', 'green-artificial-turf'],
    ['pads', 'range_platform', 'concrete'], ['hardstanding', 'paved_path', 'gravel'],
    ['targets', 'range_target_surface', 'unverified-turf-surface']]) {
    for (const item of rangeSite[key]) replacements.set(item.id, { ...item, kind, material,
      rings: [item.ring], prov: 'lm-orthophoto', observedYear: 2024, notSurveyed: true,
      displayGeometrySource: 'nvgkbuild/facilities/driving-range-review.json',
      evidence: 'Native 0.16 m orthophoto review; small-object corners remain image estimates.' });
  }
  const mappedFeatures = (scenery.mappedFeatures || []).map(feature => {
    const revised = replacements.get(feature.id);
    if (!revised) return feature;
    replacements.delete(feature.id);
    return { ...feature, ...revised };
  });
  mappedFeatures.push(...replacements.values());
  return { ...scenery, mappedFeatures };
}

/** Shared edge subdivision prevents cracks between terrain-following triangles.
 * Every edge longer than maxEdge is halved at a midpoint shared by both faces
 * on it, and a face is split into two, three or four well-shaped triangles by
 * which of its edges were halved. No centroid is ever inserted: a centroid split
 * makes slivers whose edges barely shorten, and on the gravel hardstanding that
 * ran the face count past the budget before it converged. */
export function tessellateRangeSurface(ring, maxEdge = .65) {
  const vertices = ring.map(p => [...p]);
  let faces = ShapeUtils.triangulateShape(ring.map(p => new Vector2(...p)), []).map(f => [...f]);
  const edgeKey = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
  for (let pass = 0; pass < 24; pass++) {
    const split = new Map();
    for (const face of faces) for (let i = 0; i < 3; i++) {
      const a = face[i], b = face[(i + 1) % 3], key = edgeKey(a, b);
      if (hyp(vertices[a], vertices[b]) <= maxEdge || split.has(key)) continue;
      split.set(key, vertices.length);
      vertices.push([(vertices[a][0] + vertices[b][0]) / 2, (vertices[a][1] + vertices[b][1]) / 2]);
    }
    if (!split.size) return { vertices, faces };
    const next = [];
    for (const face of faces) {
      // Rotate so the split pattern is canonical: one split on edge 0-1, two
      // splits on edges 0-1 and 1-2, three on all of them.
      const mids = [0, 1, 2].map(i => split.get(edgeKey(face[i], face[(i + 1) % 3])));
      const count = mids.filter(m => m !== undefined).length;
      if (count === 0) { next.push(face); continue; }
      let r = 0;
      if (count === 1) r = mids.findIndex(m => m !== undefined);
      else if (count === 2) r = (mids.findIndex(m => m === undefined) + 1) % 3;
      const [p0, p1, p2] = [0, 1, 2].map(i => face[(r + i) % 3]);
      const [m01, m12, m20] = [0, 1, 2].map(i => mids[(r + i) % 3]);
      if (count === 1) next.push([p0, m01, p2], [m01, p1, p2]);
      else if (count === 2) next.push([p0, m01, p2], [m01, p1, m12], [m01, m12, p2]);
      else next.push([p0, m01, m20], [m01, p1, m12], [m20, m12, p2], [m01, m12, m20]);
    }
    faces = next;
    assert(faces.length < 100000, 'Range surface exceeds geometry budget');
  }
  throw new Error('Range surface did not converge');
}

/** Fit each of the four platforms independently, then clear the sampled DTM.
 * This is a rendering support plane, not a new measurement of slab elevation. */
export function rangePlatformPlane(ring, terrainH) {
  const mesh = tessellateRangeSurface(ring, .5);
  const samples = mesh.vertices.map(([x, z]) => [x, z, terrainH(x, z)]);
  assert(samples.flat().every(Number.isFinite), 'Range platform ground unavailable');
  const mean = samples.reduce((p, q) => p.map((v, axis) => v + q[axis] / samples.length), [0, 0, 0]);
  let xx = 0, zz = 0, xz = 0, xy = 0, zy = 0;
  for (const [px, pz, py] of samples) {
    const x = px - mean[0], z = pz - mean[1], y = py - mean[2];
    xx += x * x; zz += z * z; xz += x * z; xy += x * y; zy += z * y;
  }
  const determinant = xx * zz - xz * xz;
  assert(determinant > 1e-10, 'Degenerate range platform');
  const sx = (xy * zz - zy * xz) / determinant, sz = (zy * xx - xy * xz) / determinant;
  const plane = (x, z) => mean[2] + sx * (x - mean[0]) + sz * (z - mean[1]);
  const lift = Math.max(...samples.map(([x, z, y]) => y + .075 - plane(x, z)));
  return { heightAt: (x, z) => plane(x, z) + lift, lift, slope: [sx, sz], samples: samples.length };
}

export function renderRangeDetails({ terrainH, tri, L }) {
  const counts = { range_mat: 0, range_platform: 0, range_gravel: 0, range_target_surface: 0, range_ball_tray: 0 };
  const colours = new Map(), placements = []; let triangles = 0;
  const emit = (a, b, c, colour) => {
    if (!colours.has(colour)) colours.set(colour, L(colour));
    tri(a, b, c, colours.get(colour)); triangles++;
  };
  const quad = (a, b, c, d, colour) => { emit(a, b, c, colour); emit(a, c, d, colour); };
  const top = (a, b, c, colour) => {
    const up = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    if (up < 0) emit(a, c, b, colour); else emit(a, b, c, colour);
  };
  const drape = (ring, lift, colour, maxEdge) => {
    const mesh = tessellateRangeSurface(ring, maxEdge);
    const points = mesh.vertices.map(([x, z]) => [x, terrainH(x, z) + lift, z]);
    for (const face of mesh.faces) top(...face.map(i => points[i]), colour);
  };
  const slab = (ring, heightAt, baseAt, colour, edgeColour) => {
    const points = ring.map(([x, z]) => [x, heightAt(x, z), z]);
    const faces = ShapeUtils.triangulateShape(ring.map(p => new Vector2(...p)), []);
    for (const face of faces) top(...face.map(i => points[i]), colour);
    const centre = centroidOf(ring);
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length], steps = Math.ceil(hyp(p, q) / .5);
      const point = t => {
        const x = p[0] + (q[0] - p[0]) * t, z = p[1] + (q[1] - p[1]) * t;
        return [x, heightAt(x, z), z];
      };
      for (let j = 0; j < steps; j++) {
        const a = point(j / steps), b = point((j + 1) / steps);
        const aa = [a[0], baseAt(a[0], a[2]), a[2]], bb = [b[0], baseAt(b[0], b[2]), b[2]];
        const outward = -(b[2] - a[2]) * (a[0] - centre[0]) + (b[0] - a[0]) * (a[2] - centre[1]) > 0;
        if (outward) quad(aa, bb, b, a, edgeColour); else quad(aa, a, b, bb, edgeColour);
      }
    }
  };
  for (const surface of rangeSite.hardstanding) {
    drape(surface.ring, .045, 0x968d82, .5); counts.range_gravel++;
  }
  const planes = new Map();
  for (const pad of rangeSite.pads) {
    const plane = rangePlatformPlane(pad.ring, terrainH);
    planes.set(pad.id, plane);
    slab(pad.ring, plane.heightAt, (x, z) => Math.min(terrainH(x, z) - .015, plane.heightAt(x, z) - .07), 0xaaa79c, 0x817f76);
    placements.push({ id: pad.id, matIds: pad.matIds, supportLift: plane.lift, slope: plane.slope, samples: plane.samples });
    counts.range_platform++;
  }
  for (const mat of rangeSite.mats) {
    const pad = rangeSite.pads.find(p => p.matIds.includes(mat.id));
    assert(pad && mat.ring.length === 4, 'Reviewed rectangular mat needs a platform');
    const plane = planes.get(pad.id), height = (x, z) => plane.heightAt(x, z) + .028;
    slab(mat.ring, height, plane.heightAt, 0x377340, 0x26382b);
    counts.range_mat++;
    // Ball trays are visible in the club's 2025 photograph. Their small offsets
    // and dimensions are display estimates, separate from the traced mat corners.
    const centre = centroidOf(mat.ring), [e, n] = mat.ringEpsg3006[0];
    const [de, dn] = mat.shotDirectionEpsg3006;
    const [x0, , z0] = projectFacilityPoint([e, n, 0], 0), [x1, , z1] = projectFacilityPoint([e + de, n + dn, 0], 0);
    const len = Math.hypot(x1 - x0, z1 - z0), forward = [(x1 - x0) / len, (z1 - z0) / len], right = [-forward[1], forward[0]];
    const rear = Math.min(...mat.ring.map(p => (p[0] - centre[0]) * forward[0] + (p[1] - centre[1]) * forward[1]));
    const trayCentre = centre.map((v, axis) => v + forward[axis] * (rear - .19));
    const rect = (hw, hd) => [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) =>
      [trayCentre[0] + right[0] * u + forward[0] * v, trayCentre[1] + right[1] * u + forward[1] * v]);
    const outer = rect(.32, .13), inner = rect(.29, .10);
    if (outer.every(([x, z]) => inRing(x, z, pad.ring))) {
      slab(outer, (x, z) => plane.heightAt(x, z) + .022, plane.heightAt, 0x252b27, 0x252b27);
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        const at = (p, h) => [p[0], plane.heightAt(...p) + h, p[1]];
        quad(at(outer[i], .022), at(outer[j], .022), at(outer[j], .075), at(outer[i], .075), 0x303732);
        quad(at(inner[j], .022), at(inner[i], .022), at(inner[i], .075), at(inner[j], .075), 0x1b221d);
        top(at(outer[i], .075), at(outer[j], .075), at(inner[j], .075), 0x384039);
        top(at(outer[i], .075), at(inner[j], .075), at(inner[i], .075), 0x384039);
      }
      counts.range_ball_tray++;
    }
  }
  for (const target of rangeSite.targets) {
    // These are visible turf patches, with unverified function. Do not add
    // invented distance signs/flags or stretch a flat sheet across their slope.
    drape(target.ring, .055, 0x5e724a, .65); counts.range_target_surface++;
  }
  return { triangles, counts, platforms: placements, evidence: 'native-ortho-2024-06-27; range-photo-2025-05-28',
    limitations: 'Mat corners, slab support planes and tray placement are image/display estimates.' };
}
