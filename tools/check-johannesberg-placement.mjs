/* Inspect GPU-bound marker transforms through both published course packs.
 * BANVY_GPU=1 node tools/check-johannesberg-placement.mjs http://127.0.0.1:8647
 * Source interpretation is checked separately by validate-alignment.py. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';
import { ringSD } from '../apps/golf/src/engine/geom.js';
import { reviewedTeeMarkerPositions } from '../apps/golf/src/engine/reviewed-tee-marker-placement.mjs';

const base = process.argv.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:8647';
const out = 'johannesbergbuild/cache/placement-browser';
fs.mkdirSync(out, { recursive: true });
const report = { capturedAt: new Date().toISOString(), courses: [], passed: false };
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
try {
  for (const [slug, build, pairs, unresolved] of [
    ['johannesberg', 'johannesbergbuild', 83, 7], ['johannesberg-9', 'johannesberg9build', 15, 3],
  ]) {
    console.log(`checking ${slug}`);
    const model = JSON.parse(fs.readFileSync(`${build}/course-model.json`));
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(`${base}/?bana=${slug}&det=1&ljus=dag`, { timeout: 120000 });
    await page.waitForSelector('#boot.done', { timeout: +(process.env.BANVY_BOOT_TIMEOUT || 420) * 1000 });
    const runtime = await page.evaluate(() => {
      const V = window.V3D;
      const markers = V.teeMarkerGeometry(), boundary = V.boundaryMarkerGeometry();
      return { holes: V.HOLES, markers, boundary, marking: V.M.marking, water: V.M.water,
        postHeights: V.M.marking.flatMap(m => m.pts.map(([x, z]) => ({ x, z, height: V.terrainH(x, z) }))),
        terrain: V.v2Terrain(),
        heights: [...markers, ...boundary].map(m => V.terrainH(m.position[0], m.position[2])) };
    });
    fs.writeFileSync(`${out}/${slug}-runtime.json`, JSON.stringify(runtime));
    assert.deepEqual(errors, [], 'browser errors');
    if (slug === 'johannesberg') assert.equal(runtime.terrain.ready, true, 'default metre terrain must serve');
    const expected = [], padCount = model.holes.reduce((n, h) => n + h.tees.pads.length, 0);
    let suppressed = 0;
    for (const h of model.holes) for (const [teeIndex, mark] of h.tees.marks.entries()) {
      const got = runtime.holes.find(x => x.n === h.n).tees.marks[teeIndex];
      assert.deepEqual(got.c, mark.c, `H${h.n} tee ${teeIndex}: runtime reference`);
      assert.equal(got.sourcePadId, mark.sourcePadId, 'runtime platform identity');
      const positions = reviewedTeeMarkerPositions(h, mark);
      if (mark.orthophotoReference.kind === 'unresolved-guide-tee-reference') {
        assert.equal(positions.length, 0); suppressed++; continue;
      }
      assert.equal(positions.length, 2, `H${h.n} tee ${teeIndex}: accepted reference lost its pair`);
      const rings = mark.referenceSurfaceKind === 'fairway' ? h.fairway.rings
        : mark.referenceSurfaceKind === 'mown-ground' ? [mark.referenceSurfaceRing]
          : h.tees.pads.filter(p => p.id === mark.sourcePadId).map(p => p.ring);
      for (const p of positions) expected.push({ hole: h.n, teeIndex, p, rings, bearing: mark.b });
    }
    assert.equal(suppressed, unresolved);
    assert.equal(expected.length, pairs * 2);
    assert.equal(runtime.markers.length, expected.length, 'GPU sphere count');
    let minimumEdge = Infinity, minimumSeparation = Infinity;
    expected.forEach((e, i) => {
      const actual = runtime.markers[i], p = [actual.position[0], actual.position[2]];
      assert.ok(Math.hypot(p[0] - e.p[0], p[1] - e.p[1]) < .002, `GPU H${e.hole} tee ${e.teeIndex} moved`);
      const edge = Math.max(...e.rings.map(r => -ringSD(...p, r)));
      minimumEdge = Math.min(minimumEdge, edge);
      assert.ok(edge >= actual.radius + .019, `GPU H${e.hole} tee ${e.teeIndex}: full sphere leaves surface`);
      assert.ok(Math.abs(actual.position[1] - runtime.heights[i] - .11) < .002, 'sphere ground anchoring');
      for (let j = 0; j < i; j++) if (expected[j].hole === e.hole && expected[j].teeIndex !== e.teeIndex) {
        const q = runtime.markers[j].position;
        const separation = Math.hypot(p[0] - q[0], p[1] - q[2]);
        minimumSeparation = Math.min(minimumSeparation, separation);
        assert.ok(separation >= .349, 'coloured marker spheres collide');
      }
    });
    for (let i = 0; i < expected.length; i += 2) {
      const a = runtime.markers[i].position, b = runtime.markers[i + 1].position;
      const bearing = expected[i].bearing * Math.PI / 180;
      assert.ok(Math.abs((a[0] - b[0]) * Math.sin(bearing) + (a[2] - b[2]) * Math.cos(bearing)) < .002,
        'actual pair is not perpendicular to play');
    }
    const posts = model.marking.flatMap(m => m.pts.map(p => ({ p, id: m.id, colour: m.color })));
    assert.equal(runtime.marking.length, 5, 'five reviewed OB corridors');
    const missingPosts = posts.filter(e => !runtime.boundary.some(a =>
      Math.hypot(a.position[0] - e.p[0], a.position[2] - e.p[1]) < .002));
    assert.equal(runtime.boundary.length, posts.length, `GPU OB post count; missing ${JSON.stringify(missingPosts)}`);
    posts.forEach((e, i) => {
      const a = runtime.boundary[i];
      assert.equal(a.colour, e.colour);
      assert.ok(Math.hypot(a.position[0] - e.p[0], a.position[2] - e.p[1]) < .002, `OB post ${e.id} moved`);
      assert.ok(Math.abs(a.position[1] - runtime.heights[expected.length + i]) < .002, 'OB ground anchoring');
    });
    assert.ok(runtime.marking.every(m => m.physicalPostPositionsObserved === false && m.postPlacementKind === 'illustrative-distance-spacing'));
    const result = { slug, pads: padCount, pairs, suppressed, spheres: runtime.markers.length,
      minimumEdgeClearanceM: minimumEdge, minimumInterColourDistanceM: minimumSeparation,
      obCorridors: runtime.marking.length, obPosts: posts.length, errors, captures: [] };
    const views = slug === 'johannesberg'
      ? [{ hole: 3, tee: 2 }, { hole: 10, tee: 4 }, { hole: 12, tee: 2 }, { ob: 2 }, { ob: 18 }]
      : [{ hole: 3, tee: 0 }, { hole: 5, tee: 1 }];
    for (const view of views) {
      const coords = view.ob ? model.marking.find(m => m.hole === view.ob).pts
        : [model.holes.find(h => h.n === view.hole).tees.marks[view.tee].c];
      const x = coords.reduce((n, p) => n + p[0] / coords.length, 0);
      const z = coords.reduce((n, p) => n + p[1] / coords.length, 0);
      const extent = Math.max(20, ...coords.map(p => Math.hypot(p[0] - x, p[1] - z)));
      await page.evaluate(({ x, z, extent }) => {
        const V = window.V3D, y = V.terrainH(x, z);
        V.placeCamera([x, y + extent * 1.6, z + extent * .9], [x, y, z]);
      }, { x, z, extent });
      await page.waitForFunction(() => window.V3D.settled(), null, { timeout: 60000 });
      await page.evaluate(() => window.V3D.prepareCapture());
      const file = `${slug}-${view.ob ? `ob-${view.ob}` : `tee-${view.hole}-${view.tee}`}.png`;
      await page.screenshot({ path: path.join(out, file), animations: 'disabled', timeout: 60000 });
      result.captures.push(file);
    }
    report.courses.push(result);
    console.log(JSON.stringify(result));
    await page.close();
  }
  report.passed = true;
} finally {
  await browser.close();
  fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
}
