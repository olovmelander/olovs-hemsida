import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import architecture from './norrfallsviken-facilities-meshes.json' with { type: 'json' };
import site from './norrfallsviken-facilities-site.json' with { type: 'json' };
import { architectureStatus, authoredSiteHeights, compileFacilityGeometry, facilityFootprints,
  isFacilityInterior, isFacilityTreeObstruction, loadFacilities, projectFacilityPoint } from './norrfallsviken-facilities.mjs';
import { renderReviewedFacilities } from './norrfallsviken-architecture.mjs';

const DATUM = 20.3432;
const FOUNDATION = [.184475, .171441, .144128];
const SOLAR = [.018, .034, .047];
const centre = ring => ring.reduce((sum, point) => point.map((value, axis) => sum[axis] + value / ring.length), [0, 0]);
const sameColour = (left, right) => left.every((value, axis) => value === right[axis]);
const compile = options => compileFacilityGeometry({ terrainH: () => 45, v2Active: true,
  verticalDatumOffsetMetres: DATUM, ...options });
const disposables = [];
afterEach(() => {
  for (const result of disposables.splice(0)) result.dispose();
  vi.restoreAllMocks();
});

function context(options = {}) {
  const scene = new THREE.Scene();
  const unrelated = new THREE.Object3D(); unrelated.name = 'Unrelated course object'; scene.add(unrelated);
  return { THREE, scene, courseSlug: 'norrfallsviken', terrainH: () => 45, v2Active: true,
    verticalDatumOffsetMetres: DATUM,
    buildings: [{ id: 'w1205924894', ring: facilityFootprints[0].ring },
      { id: 'lm-range-shelter', ring: facilityFootprints[3].ring },
      { id: 'lm-practice-shed', ring: [[0, 0], [1, 0], [0, 1]] }],
    ...options };
}
async function install(options) {
  const result = await loadFacilities(options); disposables.push(result); return result;
}
function triangles(positions) {
  const result = [];
  for (let i = 0; i < positions.length; i += 9) {
    result.push([0, 3, 6].map(offset => new THREE.Vector3(...positions.slice(i + offset, i + offset + 3))));
  }
  return result;
}

describe('Norrfällsviken measured facility coordinates and geometry', () => {
  it('applies the course terrain bridge and RH2000 offset exactly once', () => {
    expect(projectFacilityPoint([678970.625, 6988556.634, 0])).toEqual([0, DATUM, 0]);
    // A pinned measured main-roof ridge vertex through the declared linear
    // terrain bridge. Using true north directly shifts it by tens of metres.
    const ridge = projectFacilityPoint([678583.486, 6988398.141, 38.414]);
    expect(ridge[0]).toBeCloseTo(-394.2115063760277, 8);
    expect(ridge[1]).toBeCloseTo(58.7572, 8);
    expect(ridge[2]).toBeCloseTo(136.82252009679456, 8);
    const noDatum = projectFacilityPoint([678583.486, 6988398.141, 38.414], 0);
    expect(noDatum).toEqual([ridge[0], 38.414, ridge[2]]);
  });

  it('excludes vegetation within all four real footprints, with a bounded edge margin', () => {
    expect(facilityFootprints.map(f => f.id)).toEqual(architecture.facilities.map(f => f.id));
    for (const { ring } of facilityFootprints) expect(isFacilityInterior(...centre(ring))).toBe(true);
    expect(isFacilityInterior(0, 0)).toBe(false);
    const ring = facilityFootprints.find(f => f.id === 'lm-range-shelter').ring;
    const c = centre(ring), middle = ring[0].map((v, k) => (v + ring[1][k]) / 2);
    const direction = middle.map((v, k) => v - c[k]);
    const length = Math.hypot(...direction);
    const outside = distance => middle.map((v, k) => v + direction[k] / length * distance);
    expect(isFacilityInterior(...outside(.1), .2)).toBe(true);
    expect(isFacilityInterior(...outside(.5), .2)).toBe(false);
  });

  it('filters a low crown intersecting from outside the wall while retaining a safe high overhang', () => {
    const facility = facilityFootprints.find(f => f.id === 'lm-range-shelter');
    const [a, b] = facility.ring, c = centre(facility.ring);
    const middle = a.map((v, i) => (v + b[i]) / 2);
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let outward = [(b[1] - a[1]) / length, -(b[0] - a[0]) / length];
    if (outward[0] * (middle[0] - c[0]) + outward[1] * (middle[1] - c[1]) < 0) {
      outward = outward.map(v => -v);
    }
    const treeAt = distance => Object.freeze({ x: middle[0] + outward[0] * distance,
      z: middle[1] + outward[1] * distance, y: facility.floorWorld - .5, height: 15, radius: 1.8 });
    const adjacent = treeAt(2), distant = treeAt(8);
    expect(isFacilityInterior(adjacent.x, adjacent.z, .3)).toBe(false);
    expect(isFacilityTreeObstruction(adjacent, facility.roofTopWorld - 1)).toBe(true);
    expect(isFacilityTreeObstruction(adjacent, facility.roofTopWorld + .1)).toBe(false);
    expect(isFacilityTreeObstruction(distant, facility.roofTopWorld - 1)).toBe(false);
    expect(isFacilityTreeObstruction({ ...adjacent, height: .4 }, facility.floorWorld - .3)).toBe(false);
    // A clear crown cannot rescue a trunk planted inside the building itself.
    expect(isFacilityTreeObstruction({ ...adjacent, x: c[0], z: c[1] }, facility.roofTopWorld + 5)).toBe(true);
  });

  it('retains absolute measured roofs across sloping terrain while foundations follow the ground', () => {
    const flat = compile();
    const terrainH = (x, z) => 44 + .015 * (x + 400) + .008 * (z - 130);
    const slope = compile({ terrainH });
    for (const placement of slope.placements) {
      const source = architecture.facilities.find(f => f.id === placement.id);
      expect(placement.mode).toBe('absolute-rh2000');
      expect(placement.shift).toBe(DATUM);
      expect(placement.roofHeightWorld).toEqual(source.roofHeightRH2000.map(h => h + DATUM));
      expect(placement.floor).toBe(source.floorRH2000Estimate + DATUM);
      expect(placement.foundationSamples).toBeGreaterThan(30);
      expect(placement.maximumFoundationDepth).toBeGreaterThan(5);
    }
    expect(slope.placements.map(p => p.roofHeightWorld)).toEqual(flat.placements.map(p => p.roofHeightWorld));
    expect(slope.batches.filter(b => !sameColour(b.colour, FOUNDATION)))
      .toEqual(flat.batches.filter(b => !sameColour(b.colour, FOUNDATION)));
    const foundation = slope.batches.find(b => sameColour(b.colour, FOUNDATION));
    const bottoms = triangles(foundation.positions).flat().filter(p => p.y < 50);
    expect(bottoms.length).toBeGreaterThan(100);
    for (const p of bottoms) expect(p.y).toBeCloseTo(terrainH(p.x, p.z) - .15, 8);
  });

  it('keeps every generated foundation face outward on the owning footprint', () => {
    const layout = compile({ terrainH: (x, z) => 44 + x * .005 + z * .003 });
    const faces = triangles(layout.batches.find(b => sameColour(b.colour, FOUNDATION)).positions);
    let cursor = 0;
    for (const { ring } of facilityFootprints) {
      const [cx, cz] = centre(ring);
      const faceCount = ring.reduce((count, a, i) => {
        const b = ring[(i + 1) % ring.length];
        return count + Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])) * 2;
      }, 0);
      for (const [a, b, c] of faces.slice(cursor, cursor + faceCount)) {
        const normal = b.clone().sub(a).cross(c.clone().sub(a));
        const midpoint = a.clone().add(b).add(c).multiplyScalar(1 / 3);
        expect(normal.x * (midpoint.x - cx) + normal.z * (midpoint.z - cz)).toBeGreaterThan(0);
      }
      cursor += faceCount;
    }
    expect(cursor).toBe(faces.length);
  });

  it('anchors fallback buildings rigidly and shares one shift across the connected clubhouse roofs', () => {
    const terrainH = (x, z) => 65 + .07 * (x + 400) + .12 * (z - 130);
    const layout = compile({ terrainH, v2Active: false });
    const main = layout.placements.find(p => p.id === 'clubhouse-main-roof-native');
    const cross = layout.placements.find(p => p.id === 'clubhouse-cross-roof-native');
    expect(cross.shift).toBe(main.shift);
    expect(cross.floor).toBe(main.floor);
    expect(main.roofHeightWorld[0] - cross.roofHeightWorld[0]).toBeCloseTo(38.414 - 37.616, 8);
    for (const placement of layout.placements.filter(p => p !== cross)) {
      const ring = facilityFootprints.find(f => f.id === placement.id).ring;
      expect(placement.floor).toBeCloseTo(terrainH(...centre(ring)) + .12, 8);
      expect(placement.mode).toBe('legacy-terrain-anchor');
    }
    expect(layout.siteHeights.padelCourt).toBeNull();
    expect(layout.siteHeights.terrace).toBeCloseTo(32.82 + main.shift, 8);
  });

  it('rejects a wrong vertical bridge and unavailable foundation samples', () => {
    expect(() => compile({ verticalDatumOffsetMetres: DATUM + 1 })).toThrow(/bridge mismatch/);
    expect(() => compile({ terrainH: () => NaN })).toThrow(/ground unavailable/);
    const centres = facilityFootprints.map(f => centre(f.ring));
    const terrainH = (x, z) => centres.some(c => Math.hypot(c[0] - x, c[1] - z) < .001) ? 45 : NaN;
    expect(() => compile({ terrainH })).toThrow(/Foundation ground unavailable/);
  });

  it('triangulates both whole solar quads and retains all source corner heights', () => {
    const layout = compile();
    const solar = layout.batches.find(b => sameColour(b.colour, SOLAR));
    expect(site.solarArrays).toHaveLength(2);
    expect(solar.positions).toHaveLength(4 * 9);
    expect(solar.roughness).toBe(.34);
    const actualVertices = new Set(triangles(solar.positions).flat().map(p => p.toArray().join(',')));
    const expectedVertices = new Set(site.solarArrays.flatMap(array => array.verticesEpsg3006RH2000)
      .map(p => projectFacilityPoint(p).join(',')));
    expect(actualVertices).toEqual(expectedVertices);
    for (const [a, b, c] of triangles(solar.positions)) {
      expect(b.clone().sub(a).cross(c.clone().sub(a)).y).toBeGreaterThan(0);
    }
  });
});

describe('Norrfällsviken authored terrace terrain clearance', () => {
  it.each([false, true])('covers an interior terrain hump with upward paving and no invented railing (reverse=%s)', reverse => {
    const baseRing = [[-2, -2], [2, -2], [2, 2], [-2, 2]];
    const ring = (reverse ? [...baseRing].reverse() : baseRing).map(p => Object.freeze(p));
    const feature = Object.freeze({ id: 'terrace-regression', kind: 'terrace', height: .7,
      rings: Object.freeze([Object.freeze(ring)]) });
    const buildings = Object.freeze([{ id: 'w1205924894', ring: [[-10, -10], [-9, -10], [-9, -9], [-10, -9]] }]);
    const sourceGround = (x, z) => 10 + .7 * Math.max(0, 1 - x * x / 4) * Math.max(0, 1 - z * z / 4);
    const terrainH = vi.fn(sourceGround), emitted = [];
    const result = renderReviewedFacilities({ features: Object.freeze([feature]), buildings, terrainH,
      tri: (...triangle) => emitted.push(triangle), L: colour => colour,
      siteHeights: Object.freeze({ terrace: 10.1, padelCourt: null }) });
    expect(result.counts).toEqual({ terrace: 1 });
    expect(result.triangles).toBe(128); // 4 m square, 0.5 m cells, two triangles each.
    expect(emitted).toHaveLength(128);
    expect(new Set(emitted.map(t => t[3]))).toEqual(new Set([0x9a8c74]));
    const vertices = emitted.flatMap(t => t.slice(0, 3));
    expect(vertices.some(([x, y, z]) => x === 0 && z === 0 && Math.abs(y - 10.745) < 1e-8)).toBe(true);
    for (const [x, y, z] of vertices) {
      expect(y).toBeCloseTo(Math.max(10.1, sourceGround(x, z) + .045), 8);
      expect(y).toBeLessThanOrEqual(10.745 + 1e-8);
    }
    for (const triangle of emitted) {
      const [a, b, c] = triangle.slice(0, 3).map(p => new THREE.Vector3(...p));
      expect(b.clone().sub(a).cross(c.clone().sub(a)).y).toBeGreaterThan(0);
      // The smooth hump also clears the interpolated triangle interiors, where
      // the previous four-corner flat surface exposed the middle of the DTM.
      const midpoint = a.clone().add(b).add(c).multiplyScalar(1 / 3);
      expect(midpoint.y).toBeGreaterThan(sourceGround(midpoint.x, midpoint.z));
    }
    expect(terrainH.mock.calls.some(([x, z]) => x === 0 && z === 0)).toBe(true);
    expect(feature.height).toBe(.7);
    expect(feature.rings[0]).toEqual(reverse ? [...baseRing].reverse() : baseRing);
    expect(sourceGround(0, 0)).toBe(10.7);
  });

  it('keeps flat authored paving at its source floor without adding the legacy 0.7 m deck offset', () => {
    const emitted = [];
    const result = renderReviewedFacilities({
      features: [{ kind: 'terrace', height: .7, rings: [[[0, 0], [1, 0], [1, 1], [0, 1]]] }],
      buildings: [{ id: 'w1205924894', ring: [[0, 0], [1, 0], [0, 1]] }],
      terrainH: () => 10, tri: (...triangle) => emitted.push(triangle), L: colour => colour,
      siteHeights: { terrace: 10.1, padelCourt: null },
    });
    expect(result).toMatchObject({ triangles: 8, counts: { terrace: 1 } });
    expect(emitted.flatMap(t => t.slice(0, 3)).every(p => p[1] === 10.1)).toBe(true);
    expect(emitted.every(t => t[3] === 0x9a8c74)).toBe(true);
  });
});

describe('Norrfällsviken facility installation and cleanup', () => {
  it('loads compact architecture with finite face normals and unchanged linear material colours', async () => {
    const ctx = context(), originalBuildings = structuredClone(ctx.buildings);
    const result = await install(ctx), compiled = compile();
    expect(result.report.status, result.report.reason).toBe('loaded');
    // 87 base parts less the 22 base range-shelter parts, plus the 23 refined
    // shelter parts (nvgkbuild/facilities/range-refinement-validation.json).
    expect(result.report.sourceParts).toBe(88);
    expect(result.report.refinedRangeShelterParts).toBe(23);
    expect(result.report.triangles).toBe(4182);
    expect([...result.replacedBuildingIds]).toEqual(['w1205924894', 'lm-range-shelter']);
    expect(result.replacedBuildingIds.has('lm-practice-shed')).toBe(false);
    expect(ctx.buildings).toEqual(originalBuildings);
    expect(result.root.parent).toBe(ctx.scene);
    expect(result.root.children).toHaveLength(compiled.batches.length);
    result.root.children.forEach((mesh, index) => {
      const position = mesh.geometry.getAttribute('position'), normal = mesh.geometry.getAttribute('normal');
      expect(mesh.isMesh).toBe(true);
      expect(mesh.geometry.index).toBeNull();
      expect(position.count % 3).toBe(0);
      expect([...position.array].every(Number.isFinite)).toBe(true);
      expect(normal.count).toBe(position.count);
      for (let i = 0; i < normal.count; i++) {
        expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 5);
      }
      expect(mesh.material.color.toArray()).toEqual(compiled.batches[index].colour);
      expect(mesh.material.roughness).toBe(compiled.batches[index].roughness);
      expect(mesh.material.flatShading).toBe(true);
      expect(mesh.material.map).toBeNull();
    });
    // The source workspace includes 190,926 points and 22,082 ground triangles;
    // neither reference dataset may enter this optional architecture group. The
    // refined shelter alone is 3,188 triangles by its own receipt.
    expect(result.report.triangles).toBeLessThan(6000);
    expect(result.root.children.every(mesh => mesh.geometry.getAttribute('position').count < 6000)).toBe(true);
    expect(architecture.parts.some(p => /reference|ground|unresolved/i.test(p.name))).toBe(false);
  });

  it.each([
    ['foreign course', { courseSlug: 'tortuna' }, /another course/],
    ['missing replacement', { buildings: [{ id: 'w1205924894', ring: [[0, 0], [1, 0], [0, 1]] }] }, /footprint missing/],
    ['missing ground', { terrainH: () => NaN }, /ground unavailable/],
    ['wrong datum', { verticalDatumOffsetMetres: 0 }, /bridge mismatch/],
  ])('keeps existing scenery and replacement ownership untouched for %s', async (_name, options, reason) => {
    const ctx = context(options), before = [...ctx.scene.children];
    const result = await install(ctx);
    expect(result.root).toBeNull();
    expect(result.report.status).toBe('fallback');
    expect(result.report.reason).toMatch(reason);
    expect(result.replacedBuildingIds.size).toBe(0);
    expect(ctx.scene.children).toEqual(before);
    expect(() => { result.dispose(); result.dispose(); }).not.toThrow();
  });

  it('rejects an already-aborted request before sampling terrain', async () => {
    const controller = new AbortController(); controller.abort();
    const terrainH = vi.fn(() => 45), ctx = context({ signal: controller.signal, terrainH });
    const result = await install(ctx);
    expect(result.report.reason).toMatch(/cancelled/);
    expect(terrainH).not.toHaveBeenCalled();
    expect(result.replacedBuildingIds.size).toBe(0);
    expect(ctx.scene.children).toHaveLength(1);
  });

  it('disposes prepared resources after navigation invalidates the current course', async () => {
    const geometryDisposal = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const materialDisposal = vi.spyOn(THREE.Material.prototype, 'dispose');
    const ctx = context({ isCurrentCourse: vi.fn().mockReturnValueOnce(true).mockReturnValue(false) });
    const result = await install(ctx);
    expect(result.report.status).toBe('fallback');
    expect(result.report.reason).toMatch(/cancelled/);
    expect(result.replacedBuildingIds.size).toBe(0);
    expect(ctx.scene.children).toHaveLength(1);
    expect(geometryDisposal).toHaveBeenCalledTimes(14);
    expect(materialDisposal).toHaveBeenCalledTimes(14);
    result.dispose();
    expect(geometryDisposal).toHaveBeenCalledTimes(14);
  });

  it('cleans up atomically when an abort arrives during foundation sampling', async () => {
    const controller = new AbortController();
    const geometryDisposal = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    let calls = 0;
    const terrainH = () => { if (++calls === 2) controller.abort(); return 45; };
    const ctx = context({ terrainH, signal: controller.signal });
    const result = await install(ctx);
    expect(result.report.status).toBe('fallback');
    expect(result.report.reason).toMatch(/cancelled/);
    expect(result.replacedBuildingIds.size).toBe(0);
    expect(ctx.scene.children).toHaveLength(1);
    expect(geometryDisposal).toHaveBeenCalledTimes(14);
  });

  it('releases each installed GPU resource once on abort and clears site-height ownership', async () => {
    const controller = new AbortController(), ctx = context({ signal: controller.signal });
    const result = await install(ctx);
    const geometries = result.root.children.map(mesh => vi.spyOn(mesh.geometry, 'dispose'));
    const materials = result.root.children.map(mesh => vi.spyOn(mesh.material, 'dispose'));
    expect(architectureStatus().status).toBe('loaded');
    expect(authoredSiteHeights()).toEqual(result.report.siteHeights);
    controller.abort(); result.dispose();
    expect(result.root.parent).toBeNull();
    expect(ctx.scene.children).toHaveLength(1);
    expect(result.replacedBuildingIds.size).toBe(0);
    expect(geometries.every(spy => spy.mock.calls.length === 1)).toBe(true);
    expect(materials.every(spy => spy.mock.calls.length === 1)).toBe(true);
    expect(architectureStatus().status).toBe('fallback');
    expect(authoredSiteHeights()).toBeNull();
  });

  it('keeps a newer layout active when an earlier load is disposed or a foreign load fails', async () => {
    const first = await install(context());
    const second = await install(context({ v2Active: false, terrainH: () => 77 }));
    first.dispose();
    expect(authoredSiteHeights()).toEqual(second.report.siteHeights);
    const foreign = await install(context({ courseSlug: 'upsala' }));
    expect(foreign.report.status).toBe('fallback');
    expect(architectureStatus().status).toBe('loaded');
    expect(authoredSiteHeights()).toEqual(second.report.siteHeights);
    second.dispose();
    expect(authoredSiteHeights()).toBeNull();
  });
});
