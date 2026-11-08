import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three/webgpu';
import { inspectBuildingGlb } from './authored-buildings.mjs';
import {
  HOUSE_KIT_ASSET, KIT_PARTS, PART_SIZE, classifyBuilding, footprintFrame, houseKitAllowed, housePalette,
  linear, nearestRoadDirection, partMatrix, planHouse, rnd, seedOf,
} from './house-kit.mjs';

/* a recording emitter: every triangle the shell draws, with its colour */
function recorder() {
  const tris = [];
  const tri = (a, b, c, col) => tris.push({ p: [a, b, c], col });
  return {
    tris,
    emit: {
      tri, quad: (a, b, c, d, col) => { tri(a, b, c, col); tri(a, c, d, col); },
      slope: (pts, col) => { tri(pts[0], pts[1], pts[2], col); if (pts.length === 4) tri(pts[0], pts[2], pts[3], col); },
      triangulate: ring => ring.slice(1, -1).map((_, i) => [0, i + 1, i + 2]),
    },
  };
}
const normal = ([a, b, c]) => {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
};
const palette = housePalette('villa', { wall: linear(0xb44830), roof: linear(0x505e69), trim: linear(0xf0ead7), seed: 7 });
const rect = (cx, cz, w, d, ang = 0) => [[-w, -d], [w, -d], [w, d], [-w, d]]
  .map(([u, v]) => [cx + u * Math.cos(ang) - v * Math.sin(ang), cz + u * Math.sin(ang) + v * Math.cos(ang)]);

describe('the house kit asset', () => {
  const file = new URL(`../../public/${HOUSE_KIT_ASSET.url}`, import.meta.url);
  it('is the published file: bytes, sha256 and its record', () => {
    const bytes = fs.readFileSync(file);
    expect(bytes.length).toBe(HOUSE_KIT_ASSET.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(HOUSE_KIT_ASSET.sha256);
    const record = JSON.parse(fs.readFileSync(new URL('../../public/models/props/house-kit.json', import.meta.url)));
    expect(record.asset).toEqual({ url: HOUSE_KIT_ASSET.url, sha256: HOUSE_KIT_ASSET.sha256, bytes: HOUSE_KIT_ASSET.bytes });
    expect(record.triangles).toBeLessThanOrEqual(2500);
  });
  it('carries every part and channel the planner lays, with colours and normals, and nothing else', () => {
    const bytes = fs.readFileSync(file);
    const json = inspectBuildingGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const names = json.nodes.filter(n => n.mesh !== undefined).map(n => n.name).sort();
    const expected = Object.entries(KIT_PARTS).flatMap(([part, channels]) => channels.map(c => `${part}__${c}`)).sort();
    expect(names).toEqual(expected);
    for (const m of json.meshes) for (const p of m.primitives) {
      expect(p.attributes.COLOR_0).toBeDefined();
      expect(p.attributes.NORMAL).toBeDefined();
    }
  });
});

describe('a footprint read as a house', () => {
  it('knows a rectangle, an L and neither', () => {
    expect(footprintFrame(rect(0, 0, 6, 4, 0.3)).kind).toBe('rect');
    const L = [[0, 0], [14, 0], [14, 6], [6, 6], [6, 13], [0, 13]];
    const f = footprintFrame(L);
    expect(f.kind).toBe('ortho');
    expect(f.rects.length).toBe(2);
    const covered = f.rects.reduce((s, r) => s + 4 * r.hl * r.hs, 0);
    expect(covered).toBeCloseTo(14 * 6 + 6 * 7, 0);
    const star = Array.from({ length: 10 }, (_, i) => [Math.cos(i * Math.PI / 5) * (i % 2 ? 4 : 9), Math.sin(i * Math.PI / 5) * (i % 2 ? 4 : 9)]);
    expect(footprintFrame(star).kind).toBe('complex');
  });
  it('types a building by its tags, its size and the land use round it', () => {
    expect(classifyBuilding({ kind: 'yes', area: 15 })).toBe('shed');
    expect(classifyBuilding({ kind: 'yes', area: 40 })).toBe('outbuilding');
    expect(classifyBuilding({ kind: 'house', area: 140 })).toBe('villa');
    expect(classifyBuilding({ kind: 'residential', area: 600 })).toBe('block');
    expect(classifyBuilding({ kind: 'industrial', area: 900 })).toBe('hall');
    expect(classifyBuilding({ kind: 'yes', area: 400, landuse: 'farmland', depth: 14 })).toBe('barn');
    /* a farmhouse stands in the same yard as its barn: the barn is the deep one */
    expect(classifyBuilding({ kind: 'yes', area: 140, landuse: 'farmyard', depth: 8.5 })).toBe('villa');
    /* Lidingö's names: a water tower keeps the batch's drawing, a heating plant is a hall */
    expect(classifyBuilding({ kind: 'yes', area: 120, name: 'Näsets vattentorn' })).toBeNull();
    expect(classifyBuilding({ kind: 'yes', area: 900, name: 'Miljövänlig fjärrvärme' })).toBe('hall');
    expect(classifyBuilding({ kind: 'yes', area: 300, name: 'Näsets förskola' })).toBe('villa');
    expect(classifyBuilding({ kind: 'yes', area: 12, name: 'Garbage Room' })).toBe('shed');
    expect(classifyBuilding({ kind: 'yes', area: 3000, name: 'Hållängetskolan' })).toBe('school');
    expect(classifyBuilding({ kind: 'yes', area: 2000, name: 'Kempehallen' })).toBe('hall');
    /* the other grounds' tags, and Lantmäteriet's purpose where a measured ground carries it */
    expect(classifyBuilding({ kind: 'garage', area: 40 })).toBe('garage');
    expect(classifyBuilding({ kind: 'hut', area: 12 })).toBe('shed');
    expect(classifyBuilding({ kind: 'farm', area: 160 })).toBe('villa');
    expect(classifyBuilding({ kind: 'farm_auxiliary', area: 400 })).toBe('barn');
    expect(classifyBuilding({ kind: 'sport', area: 428 })).toBe('hall');
    expect(classifyBuilding({ kind: 'yes', area: 140, subtype: 'Bostad' })).toBe('villa');
    expect(classifyBuilding({ kind: 'yes', area: 40, subtype: 'Komplementbyggnad' })).toBe('garage');
    /* a church keeps the batch's drawing */
    expect(classifyBuilding({ kind: 'yes', area: 300, name: 'Läby kyrka' })).toBeNull();
  });
  it('leaves what would stand out from a mapped wall off a mapped-only ground, and keeps the rest', async () => {
    const { mappedOnlyPart, MAPPED_ONLY_LEAVES } = await import('./house-kit.mjs');
    expect(MAPPED_ONLY_LEAVES).toEqual(['porch', 'porch_low', 'balcony', 'chimney', 'chimney_brick']);
    for (const part of MAPPED_ONLY_LEAVES) expect(mappedOnlyPart({ part })).toBeNull();
    expect(mappedOnlyPart({ part: 'entrance', x: 1 })).toEqual({ part: 'door_plain', x: 1 });
    for (const part of ['window', 'door', 'corner', 'downpipe', 'garage_door']) expect(mappedOnlyPart({ part }).part).toBe(part);
    const r = recorder();
    const ring = rect(0, 0, 8, 5);
    const plan = planHouse({ ring, type: 'villa', base: 0, skirt: 1, palette, seed: 3, front: [0, 1], emit: r.emit, mappedOnly: true });
    expect(plan.parts.some(p => MAPPED_ONLY_LEAVES.includes(p.part))).toBe(false);
    expect(plan.parts.some(p => p.part === 'window')).toBe(true);
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toContain("mappedOnly: M.infra.objectPlacement === 'mapped-only'");
  });
  it('reads a pack that calls every building a house as saying nothing by it', async () => {
    const { genericHouseTag } = await import('./house-kit.mjs');
    const all = Array.from({ length: 40 }, () => ({ kind: 'house' }));
    expect(genericHouseTag(all)).toBe(true);
    expect(genericHouseTag([...all.slice(0, 20), ...Array.from({ length: 20 }, () => ({ kind: 'yes' }))])).toBe(false);
    expect(genericHouseTag(all.slice(0, 5))).toBe(false);
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toContain("kind: houseKitGenericHouse && kind === 'house' ? 'yes' : kind");
  });
  it('finds the nearest road', () => {
    const d = nearestRoadDirection(0, 0, [[[-50, 20], [50, 20]]], 70);
    expect(d[0]).toBeCloseTo(0, 6); expect(d[1]).toBeCloseTo(1, 6);
    expect(nearestRoadDirection(0, 0, [[[-50, 200], [50, 200]]], 70)).toBeNull();
  });
});

describe('planning a house', () => {
  const plan = (ring, type, extra = {}) => {
    const r = recorder();
    const seed = seedOf(...ring[0]);
    const out = planHouse({ ring, type, base: 10, skirt: 1.5, palette, seed, front: [0, 1], emit: r.emit, ...extra });
    return { ...out, tris: r.tris };
  };
  it('is the same plan every time', () => {
    const a = plan(rect(3, 4, 6, 4, 0.2), 'villa'), b = plan(rect(3, 4, 6, 4, 0.2), 'villa');
    expect(b.parts).toEqual(a.parts);
    expect(b.tris.length).toBe(a.tris.length);
  });
  it('turns every roof slope up and stands the walls on the footprint', () => {
    for (let s = 0; s < 40; s++) {
      const ring = rect(s * 31, -s * 17, 5 + (s % 5), 3.5 + (s % 3) * 0.7, s * 0.37);
      const p = plan(ring, 'villa');
      const roofs = p.tris.filter(t => t.col === palette.roof);
      expect(roofs.length).toBeGreaterThan(0);
      for (const t of roofs) expect(normal(t.p)[1]).toBeGreaterThan(0);
      /* the walls' feet are the footprint's corners */
      const feet = p.tris.filter(t => t.col === palette.wall).flatMap(t => t.p).filter(q => Math.abs(q[1] - 8.5) < 1e-6);
      for (const q of feet) expect(ring.some(c => Math.hypot(c[0] - q[0], c[1] - q[2]) < 1e-6)).toBe(true);
      expect(p.ridge).toBeGreaterThan(p.eave);
    }
  });
  it('lays the parts on the walls: a door toward the road, windows clear of corners and of each other', () => {
    const ring = rect(0, 0, 6, 4);
    const p = plan(ring, 'villa');
    const door = p.parts.find(q => q.part === 'door');
    expect(door).toBeDefined();
    expect(door.nz).toBeCloseTo(1, 6);           /* the road is to +z */
    expect(door.z).toBeCloseTo(4, 2);
    const corners = p.parts.filter(q => q.part === 'corner');
    expect(corners.length).toBe(4);
    const onWall = p.parts.filter(q => PART_SIZE[q.part] && !q.part.startsWith('chimney'));
    for (const q of onWall) {
      /* on the wall it faces, clear of the corners */
      const along = Math.abs(q.nx) > 0.5 ? q.z : q.x, half = Math.abs(q.nx) > 0.5 ? 4 : 6;
      expect(Math.abs(Math.abs(q.nx) > 0.5 ? q.x : q.z)).toBeCloseTo(Math.abs(q.nx) > 0.5 ? 6 : 4, 2);
      expect(Math.abs(along) + PART_SIZE[q.part][0] / 2).toBeLessThanOrEqual(half - 0.2);
    }
    const sameRow = (a, b) => a.nx === b.nx && a.nz === b.nz && Math.abs(a.y - b.y) < 0.5;
    for (const a of onWall) for (const b of onWall) {
      if (a === b || !sameRow(a, b) || a.part.startsWith('porch') || b.part.startsWith('porch')) continue;
      const gap = Math.hypot(a.x - b.x, a.z - b.z);
      expect(gap).toBeGreaterThanOrEqual((PART_SIZE[a.part][0] + PART_SIZE[b.part][0]) / 2 - 1e-6);
    }
  });
  it('gives each type its own parts', () => {
    const parts = (type, ring = rect(0, 0, 12, 7)) => new Set(plan(ring, type).parts.map(q => q.part));
    expect(parts('hall', rect(0, 0, 25, 14))).toContain('roller_door');
    expect(parts('barn')).toContain('barn_door');
    expect(parts('store')).toContain('shopfront');
    expect(parts('block', rect(0, 0, 20, 7))).toContain('balcony');
    expect(parts('shed', rect(0, 0, 2.5, 2))).toContain('door_board');
  });
  it('draws an L with a cross gable and a flat roof where nothing else fits', () => {
    const L = [[0, 0], [14, 0], [14, 6], [6, 6], [6, 13], [0, 13]];
    const p = plan(L, 'villa');
    expect(p.frame).toBe('ortho');
    expect(p.roof).toBe('gable');
    const star = Array.from({ length: 10 }, (_, i) => [Math.cos(i * Math.PI / 5) * (i % 2 ? 4 : 9), Math.sin(i * Math.PI / 5) * (i % 2 ? 4 : 9)]);
    expect(plan(star, 'villa').roof).toBe('flat');
  });
  it('a part matrix takes the part\'s +z out of its wall and keeps its handedness', () => {
    const m = partMatrix({ x: 5, y: 2, z: -3, nx: 0.6, nz: 0.8, sx: 1, sy: 2, sz: 1 });
    const out = new Vector3(0, 0, 1).applyMatrix4(m);
    expect(out.x).toBeCloseTo(5.6, 6); expect(out.z).toBeCloseTo(-2.2, 6);
    expect(new Vector3(0, 1, 0).applyMatrix4(m).y).toBeCloseTo(4, 6);
    expect(m.determinant()).toBeGreaterThan(0);
  });
  it('spreads its random numbers', () => {
    const v = Array.from({ length: 2000 }, (_, i) => rnd(i * 7919, 3));
    const mean = v.reduce((s, x) => s + x, 0) / v.length;
    expect(mean).toBeGreaterThan(0.45); expect(mean).toBeLessThan(0.55);
    expect(Math.min(...v)).toBeGreaterThanOrEqual(0); expect(Math.max(...v)).toBeLessThan(1);
  });
});

describe('main.js', () => {
  const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  it('draws the kit only where a course asks for it, and ?houses=before is the before', () => {
    expect(houseKitAllowed('?bana=veckefjarden&houses=before')).toBe(false);
    expect(houseKitAllowed('?bana=veckefjarden')).toBe(true);
    expect(main).toMatch(/SCENERY\?\.houseKit && !sourceBuildingView && houseKitAllowed\(\)/);
    const veck = fs.readFileSync(new URL('./scenery/veckefjarden.js', import.meta.url), 'utf8');
    expect(veck).toMatch(/export const houseKit = true/);
  });
  it('keeps the kit to the inner ring and leaves the surroundings\' inferred houses alone', () => {
    expect(main).toMatch(/houseKit && !isClub && houseKitInner\(cx, cz\)/);
    expect(main).toMatch(/houseKit && !q\.surr && houseKitInner\(px, pz\)/);
  });
});

describe('the measured roofs', () => {
  /* each course that opts in, and every routing that shares its ground (and its scenery module) */
  const GROUNDS = { veckefjarden: ['veckefjarden', 'veckefjarden-korthalsbanan'], puttom: ['puttom'], angso: ['angso'],
    upsala: ['upsala', 'upsala-mellanbanan'], lidingo: ['lidingo'], norrfallsviken: ['norrfallsviken'],
    ribbingsfors: ['ribbingsfors'], tortuna: ['tortuna'], visby: ['visby'] };
  it('reach every course but Johannesberg\'s', () => {
    const index = JSON.parse(fs.readFileSync(new URL('../../public/courses/index.json', import.meta.url), 'utf8'));
    const covered = Object.values(GROUNDS).flat();
    for (const { slug } of index.courses) expect(covered.includes(slug)).toBe(!slug.startsWith('johannesberg'));
  });
  const packBuildings = async slug => {
    const { inflateRawSync } = await import('node:zlib');
    const buf = fs.readFileSync(new URL(`../../public/courses/${slug}/pack.bin`, import.meta.url));
    const hl = buf.readUInt32LE(4), H = JSON.parse(buf.subarray(8, 8 + hl).toString('utf8'));
    const at = 8 + hl + H.HF0.bytes + H.HF1.bytes;
    return { buf, buildings: JSON.parse(inflateRawSync(buf.subarray(at, at + H.VEC.bytes)).toString('utf8')).infra.buildings };
  };
  it.each(Object.entries(GROUNDS))('are tied to the footprints of %s\'s packs, and its scenery module opts in', async (name, slugs) => {
    const { ringCheck, measuredRoofs, measuredRoofFor, roofAlbedo } = await import('./house-kit.mjs');
    /* the runtime file: each coloured roof as [index, ringCheck, colour]; the review record holds the rest */
    const own = JSON.parse(fs.readFileSync(new URL(`./scenery/${name}-roof-colours.json`, import.meta.url), 'utf8'));
    const review = JSON.parse(fs.readFileSync(new URL(`../../../../${own.review}`, import.meta.url), 'utf8'));
    expect(own.schemaVersion).toBe(2);
    expect(own.review).toBe(`geobuild/facilities/roof-colours/${name}.json`);
    expect(own.packSha256).toBe(review.packSha256);
    expect(own.roofs).toEqual(review.buildings.filter(b => b.roof).map(b => [b.index, b.ringCheck, b.roof]));
    const first = await packBuildings(slugs[0]);
    expect(createHash('sha256').update(first.buf).digest('hex')).toBe(own.packSha256);
    const table = measuredRoofs(own);
    expect(table.size).toBe(own.roofs.length);
    expect(table.size).toBeGreaterThan(review.buildings.length * 0.85);
    for (const slug of slugs) {
      const { buildings } = await packBuildings(slug);
      expect(review.buildings.length).toBe(buildings.length);
      for (const [index, check] of own.roofs) expect(check).toBe(ringCheck(buildings[index].ring));
    }
    const { buildings } = first;
    const [index, , roof] = own.roofs[0];
    expect(measuredRoofFor(table, index, buildings[index].ring)).toEqual(roofAlbedo(linear(parseInt(roof.slice(1), 16))));
    /* a changed footprint gives up its measured roof */
    expect(measuredRoofFor(table, index, buildings[index].ring.map(([x, z]) => [x + 1, z]))).toBeNull();
    /* no roof the player takes is green: a gone building or a hut under trees keeps the palette's */
    for (const [, , colour] of own.roofs) {
      const h = parseInt(colour.slice(1), 16), [r, g, bl] = [h >> 16, (h >> 8) & 255, h & 255];
      expect(g - r >= 6 && g - bl >= 10).toBe(false);
    }
    expect(own.source.attribution).toMatch(/Lantmäteriet.*CC BY 4\.0/);
    expect(review.source.attribution).toMatch(/Lantmäteriet.*CC BY 4\.0/);
    for (const b of review.buildings) expect(Object.keys(b).every(k => ['index', 'ringCheck', 'kind', 'roof', 'pixels', 'kept', 'vegetation', 'spread', 'reason', 'sampled'].includes(k))).toBe(true);
    /* the runtime file stays small: a few dozen bytes a roof */
    expect(fs.statSync(new URL(`./scenery/${name}-roof-colours.json`, import.meta.url)).size).toBeLessThan(600 + own.roofs.length * 34);
    const module = fs.readFileSync(new URL(`./scenery/${name}.js`, import.meta.url), 'utf8');
    expect(module).toContain(`import roofColours from './${name}-roof-colours.json' with { type: 'json' };`);
    expect(module).toMatch(/export const houseKit = true;/);
    expect(module).toMatch(/export \{ roofColours \};/);
  });
  it('leave Johannesberg as it was', () => {
    const module = fs.readFileSync(new URL('./scenery/johannesberg.js', import.meta.url), 'utf8');
    expect(module).not.toMatch(/houseKit/);
  });
  it('ease a glinting roof toward paint and give back the chroma the haze took', async () => {
    const { roofAlbedo, ROOF_EASE } = await import('./house-kit.mjs');
    const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const dark = linear(0x47535e), d = roofAlbedo(dark);
    expect(lum(d)).toBeCloseTo(lum(dark), 9);
    expect(d[2] - d[0]).toBeGreaterThan(dark[2] - dark[0]);
    const white = roofAlbedo(linear(0xf3f1ed));
    expect(lum(white)).toBeLessThan(ROOF_EASE.ceiling);
    expect(lum(white)).toBeGreaterThan(ROOF_EASE.knee);
    const red = roofAlbedo(linear(0xc4917f));
    expect(red[0]).toBeGreaterThan(red[1]); expect(red[1]).toBeGreaterThan(red[2]);
    expect(red.every(v => v >= 0)).toBe(true);
  });
  it('?roofs=palette is the before, and both switches leave the prepared data alone', async () => {
    const { measuredRoofsAllowed } = await import('./house-kit.mjs');
    const { preparedTintAllowed } = await import('./prepared-ground-tint.mjs');
    expect(measuredRoofsAllowed('?roofs=palette')).toBe(false);
    expect(measuredRoofsAllowed('?bana=veckefjarden')).toBe(true);
    expect(preparedTintAllowed('?bana=veckefjarden&houses=before&roofs=palette')).toBe(true);
  });
});

describe('clear of the trees', () => {
  it('leaves a porch off where a trunk stands in its strip, and an entrance keeps only its doors', async () => {
    const { clearOfTrees } = await import('./house-kit.mjs');
    /* a wall facing +z at z = 0; a porch's strip reaches 2.75 m out of it */
    const porch = { part: 'porch', x: 0, y: 0, z: 0, nx: 0, nz: 1 };
    expect(clearOfTrees(porch, () => [[0.5, 1.5]])).toBeNull();
    expect(clearOfTrees(porch, () => [[0.5, -3]])).toBe(porch);         /* inside the house: the lattice's business */
    expect(clearOfTrees(porch, () => [[4, 1]])).toBe(porch);            /* beside the strip */
    expect(clearOfTrees(porch, () => [[0, 3.6]])).toBe(porch);          /* in front of it */
    expect(clearOfTrees({ ...porch, part: 'entrance' }, () => [[0.3, 1]]).part).toBe('door_plain');
    expect(clearOfTrees({ ...porch, part: 'window' }, () => [[0, 0.5]]).part).toBe('window');
  });
  it('plans round the trees it is given, and main.js gives it the trunks', () => {
    const r = recorder();
    const ring = rect(0, 0, 6, 4);
    /* the first house of this size that takes a porch */
    let args = null, porch = null;
    for (let seed = 1; seed < 400 && !porch; seed++) {
      args = { ring, type: 'villa', base: 0, skirt: 1, palette, seed, front: [0, 1], emit: r.emit };
      porch = planHouse(args).parts.find(q => q.part.startsWith('porch'));
    }
    expect(porch).toBeDefined();
    const crowded = planHouse({ ...args, treesNear: () => [[porch.x, porch.z + 1.2]] });
    expect(crowded.parts.some(q => q.part.startsWith('porch'))).toBe(false);
    expect(crowded.parts.some(q => q.part === 'door')).toBe(true);
    expect(crowded.treeBlocked).toBe(1);
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toContain('treesNear: houseKitTreesNear');
    expect(main).toMatch(/for \(const T of trees\) for \(let k = 0; k < T\.length; k \+= 6\)/);
  });
  it('takes the flat windows and doors on every house at low quality', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toContain('const houseKitReach = LOWQ ? -1 : PARTS_REACH;');
    expect(main).toContain('houseKitParts.push(near ? p : partAt(p, fromHoles, houseKitReach))');
  });
});

describe('how much of each part', () => {
  it('lays every part as modelled near the holes, and flat windows and doors beyond them', async () => {
    const { partAt, PARTS_REACH, FAR_PART, allPartsEverywhere } = await import('./house-kit.mjs');
    const p = { part: 'window', x: 1, y: 2, z: 3, nx: 0, nz: 1, sx: 1, sy: 1, sz: 1 };
    expect(partAt(p, PARTS_REACH - 1)).toBe(p);
    const far = partAt(p, PARTS_REACH + 1);
    expect(far.part).toBe('window_far');
    expect([far.sx, far.sy]).toEqual(PART_SIZE.window);
    expect([far.x, far.y, far.z, far.nx, far.nz]).toEqual([1, 2, 3, 0, 1]);
    /* everything else keeps its own shape out there: porches, chimneys, corner boards */
    for (const part of ['porch', 'chimney', 'corner', 'garage_door', 'balcony']) expect(partAt({ ...p, part }, 5000).part).toBe(part);
    /* every flat plate is in the kit, and stands for a part the planner lays */
    for (const [near, flat] of Object.entries(FAR_PART)) { expect(PART_SIZE[near]).toBeDefined(); expect(KIT_PARTS[flat]).toBeDefined(); }
    expect(allPartsEverywhere('?houseparts=all')).toBe(true);
    expect(allPartsEverywhere('?bana=veckefjarden')).toBe(false);
  });
  it('measures from the hole lines, as the bands of trees do, never from the camera', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/const fromHoles = HOLES\.reduce\(\(best, h\) => Math\.min\(best, distToLine\(cx, cz, h\.line\)\), Infinity\);/);
    expect(main).toMatch(/houseKitParts\.push\(near \? p : partAt\(p, fromHoles, houseKitReach\)\)/);
  });
});
