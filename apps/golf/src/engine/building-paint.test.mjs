/* Painted buildings: a wall's foot darker where it meets the ground, walls only
   and back to full colour a metre up; the Blender models' foot lighter and
   lower, their own colours kept and a self-painting material left alone; a
   roof slope darker at its eaves and lit along its ridge, over the very same
   outline; and main.js wiring all of it, each behind its before. */
import fs from 'node:fs';
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Matrix4, Mesh, MeshStandardMaterial } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { BUILDING_PAINT, wallFootAt, groundCache, stampGround, groundModel, roofSlope } from './building-paint.mjs';

const { batch, model } = BUILDING_PAINT.foot;
const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const norm = v => Math.hypot(...v);
const areaNormal = (a, b, c) => cross(sub(b, a), sub(c, a));

describe('painted buildings', () => {
  it('darken a wall\'s foot where it meets the ground, back to its colour a metre up, and walls only', () => {
    expect(wallFootAt(0, 0, batch)).toBeCloseTo(batch.floor, 9);
    expect(wallFootAt(batch.metres / 2, 0, batch)).toBeCloseTo((batch.floor + 1) / 2, 9);
    expect(wallFootAt(batch.metres, 0, batch)).toBe(1);
    expect(wallFootAt(3, 0, batch)).toBe(1);
    /* roofs, paving and decks keep their colour at the ground */
    for (const normalY of [0.8, 0.95, 1, -1]) expect(wallFootAt(0, normalY, batch)).toBe(1);
    /* the models model their own plinths: a lighter foot, over less of the wall */
    expect(model.floor).toBeGreaterThan(batch.floor);
    expect(model.metres).toBeLessThan(batch.metres);
    expect(wallFootAt(0, 0, model)).toBeCloseTo(model.floor, 9);
  });

  it('light a roof slope along its ridge over the same outline, a touch darker at its eaves', () => {
    const colour = [0.6, 0.3, 0.2];
    for (const points of [[[0, 3, 0], [10, 3, 0], [10, 5, 2], [0, 5, 2]], [[0, 3, 0], [10, 3, 0], [5, 5, 3]]]) {
      const tris = [];
      roofSlope((...t) => tris.push(t), points, colour);
      expect(tris).toHaveLength(points.length === 4 ? 4 : 3);
      /* the same area, facing the same way */
      const whole = points.length === 4 ? [areaNormal(points[0], points[1], points[2]), areaNormal(points[0], points[2], points[3])]
        : [areaNormal(...points)];
      const total = whole.reduce((s, n) => [s[0] + n[0], s[1] + n[1], s[2] + n[2]], [0, 0, 0]);
      const parts = tris.map(([a, b, c]) => areaNormal(a, b, c));
      const sum = parts.reduce((s, n) => [s[0] + n[0], s[1] + n[1], s[2] + n[2]], [0, 0, 0]);
      expect(norm(sub(sum, total))).toBeLessThan(1e-9);
      for (const n of parts) expect(n[0] * total[0] + n[1] * total[1] + n[2] * total[2]).toBeGreaterThan(0);
      /* every corner coloured by its height: eaves darker, the band's foot the colour, the ridge lit */
      const { eave, light } = BUILDING_PAINT.ridge;
      for (const [a, b, c, ca, cb, cc] of tris) for (const [p, col] of [[a, ca], [b, cb], [c, cc]]) {
        const k = p[1] === 3 ? eave : p[1] === 5 ? light : 1;
        expect(col.map((v, i) => v / colour[i])).toEqual([k, k, k].map(v => expect.closeTo(v, 9)));
      }
    }
  });

  it('cut a gable roof and its end walls at the same points: no edge ends in the middle of another', () => {
    /* main.js house(): two slopes on the long axis and the two gable ends, overhang and all */
    const hw = 4.5, hd = 3.4, e = 3.06, r = 5.2;
    const P = (u, v, y) => [u, y, v];
    const tris = [];
    const push = (...t) => tris.push(t.slice(0, 3));
    roofSlope(push, [P(-hw, -hd, e), P(hw, -hd, e), P(hw, 0, r), P(-hw, 0, r)], [1, 0, 0]);
    roofSlope(push, [P(hw, hd, e), P(-hw, hd, e), P(-hw, 0, r), P(hw, 0, r)], [1, 0, 0]);
    roofSlope(push, [P(hw, -hd, e), P(hw, hd, e), P(hw, 0, r)], [0, 1, 0], { shade: false });
    roofSlope(push, [P(-hw, hd, e), P(-hw, -hd, e), P(-hw, 0, r)], [0, 1, 0], { shade: false });
    const corners = tris.flat();
    const onEdgeInside = (p, a, b) => {
      const ab = sub(b, a), ap = sub(p, a), t = (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2);
      return t > 1e-9 && t < 1 - 1e-9 && norm(cross(ab, ap)) < 1e-9;
    };
    for (const [a, b, c] of tris) for (const [p, q] of [[a, b], [b, c], [c, a]])
      for (const v of corners) expect(onEdgeInside(v, p, q)).toBe(false);
    /* the end walls keep their one colour */
    const ends = [];
    roofSlope((...t) => ends.push(t), [P(hw, -hd, e), P(hw, hd, e), P(hw, 0, r)], [0.3, 0.4, 0.5], { shade: false });
    for (const t of ends) for (const col of t.slice(3)) expect(col).toEqual([0.3, 0.4, 0.5]);
  });

  it('stamp each vertex with the ground under it, in the world, once per small cell', () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 7, 0.1, 50, 2, 50], 3));
    let calls = 0;
    const ground = groundCache((x, z) => { calls++; return x === 100 && z === 30 ? NaN : x / 10 + z / 100; });
    stampGround(geometry, ground, new Matrix4().makeTranslation(100, 0, 30));
    const stamped = Array.from(geometry.getAttribute('aGround').array);
    /* the corner the ground has no height for sits far below it: no foot */
    expect(stamped[0]).toBe(-1e4);
    expect(stamped[1]).toBeCloseTo(101 / 10 + 30.0 / 100, 1);
    expect(stamped[2]).toBeCloseTo(150 / 10 + 80 / 100, 5);
    ground(150, 80); ground(150.05, 80.02);
    expect(calls).toBe(3);
  });

  it('give a Blender model the foot on its own materials, and leave a self-painting material alone', () => {
    const root = new Group();
    const brick = new MeshStandardMaterial({ color: 0xae6744 }), paving = new MeshStandardMaterial({ color: 0x888888 });
    paving.colorNode = { self: true };
    const wall = new Mesh(new BoxGeometry(4, 3, 4), brick), annex = new Mesh(new BoxGeometry(2, 2, 2), brick);
    const ground = new Mesh(new BoxGeometry(20, 0.1, 20), paving);
    const clone = new Mesh(wall.geometry, brick);
    wall.position.set(10, 1.5, 0); annex.position.set(-10, 1, 0); clone.position.set(0, 1.5, 20);
    root.add(wall, annex, ground, clone);
    const report = groundModel(root, (x, z) => x / 100);
    expect(report).toMatchObject({ meshes: 3, materials: 1, copies: 1 });
    expect(brick.colorNode).toBeTruthy();
    expect(brick.color.getHex()).toBe(0xae6744);
    expect(paving.colorNode).toEqual({ self: true });
    expect(ground.geometry.getAttribute('aGround')).toBeUndefined();
    /* a clone shares its template's geometry: it gets its own copy, stamped where it stands */
    expect(clone.geometry).not.toBe(wall.geometry);
    expect(wall.geometry.getAttribute('aGround').array[0]).toBeCloseTo(0.12, 6);
    expect(clone.geometry.getAttribute('aGround').array[0]).toBeCloseTo(0.02, 6);
  });

  it('paint a second placement of one model, and a building\'s nodes one call apiece: materials once, geometry each its own', () => {
    const template = new Group(), brick = new MeshStandardMaterial({ color: 0xae6744 });
    template.add(new Mesh(new BoxGeometry(4, 3, 4), brick));
    /* two placements of the same file: clones share its geometry and materials */
    const east = template.clone(true), west = template.clone(true);
    east.position.set(10, 0, 0); west.position.set(-10, 0, 0);
    const ground = (x, z) => x / 100;
    expect(groundModel(east, ground)).toMatchObject({ meshes: 1, materials: 1, copies: 0 });
    const colour = brick.colorNode;
    /* the second is painted too -- its material is not taken for one that paints itself -- and stamped where it stands */
    expect(groundModel(west, ground)).toMatchObject({ meshes: 1, materials: 1, copies: 1 });
    expect(brick.colorNode).toBe(colour);
    const [a, b] = [east, west].map(o => o.children[0].geometry);
    expect(b).not.toBe(a);
    expect(a.getAttribute('aGround').array[0]).toBeCloseTo(0.12, 6);
    expect(b.getAttribute('aGround').array[0]).toBeCloseTo(-0.08, 6);
  });

  it('is wired in main.js: the batch\'s foot and ridges, every model\'s foot, each behind its before', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/const WALL_BASE_ON = new URLSearchParams\(location\.search\)\.get\('wallbase'\) !== '0';/);
    expect(main).toMatch(/const ROOF_RIDGE_ON = new URLSearchParams\(location\.search\)\.get\('roofridge'\) !== '0';/);
    /* the facilities, the landmarks and each authored model, as each is installed */
    expect(main).toMatch(/stats\.facilities = facilityArchitecture\.report;\n\s+paintBuildingModel\(facilityArchitecture\.root\);/);
    expect(main).toMatch(/for \(const root of landmarkArchitecture\.roots \|\| \[\]\) paintBuildingModel\(root\);/);
    expect(main).toMatch(/scene\.add\(authoredModel\.object\);\n\s+paintBuildingModel\(authoredModel\.object\);/);
    /* the batch: its foot on its own material, and every gable and hip slope through the ridge */
    expect(main).toMatch(/stampGround\(g, groundCache\(terrainH\)\)/);
    expect(main).toMatch(/buildingMaterial\.colorNode = wallFootColour\(BUILDING_PAINT\.foot\.batch\);/);
    /* six slopes, and the two gable ends cut where their slopes are */
    expect((main.match(/slope\(\[P\(/g) || []).length).toBe(8);
    expect((main.match(/slope\(\[P\([^\n]*\], wall, false\);/g) || []).length).toBe(2);
    expect(main).toMatch(/const slope = \(points, col, shade = true\) => \{\n\s+stats\.buildingPaint\.roofSlopes\+\+;\n\s+if \(ROOF_RIDGE_ON\) roofSlope\(triC, points, col, \{ shade \}\);\n\s+else if \(points\.length === 4\) quad\(\.\.\.points, col\);\n\s+else tri\(\.\.\.points, col\);/);
  });
});
