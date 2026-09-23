#!/usr/bin/env node
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TerrainTileManager, TERRAIN_TILE_QUALITY_PROFILES } from '../packages/course-v2/runtime/terrain-tile-manager.mjs';
import { courseSourceRevision } from './course-source-revision.mjs';

const source = await fs.readFile('tests/fixtures/terrain-tile-manager-2026-09-22.txt', 'utf8');
const Baseline = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).TerrainTileManager;
const sha = data => createHash('sha256').update(data).digest('hex');
const root = 'apps/golf/public/';
const verified = async ref => {
  const data = await fs.readFile(root + ref.url);
  assert.equal(data.length, ref.bytes); assert.equal(sha(data), ref.sha256);
  return JSON.parse(data);
};
const index = JSON.parse(await fs.readFile(root + 'courses/v2-index.json'));
const results = [];
for (const entry of index.courses) {
  const course = await verified(entry.manifest), ground = await verified(course.groundManifest);
  const a = new Baseline({ ground, courseSlug: course.slug }), b = new TerrainTileManager({ ground, courseSlug: course.slug });
  const centre = ground.frame.origin;
  let comparisons = 0;
  for (const profile of Object.values(TERRAIN_TILE_QUALITY_PROFILES).flatMap(Object.values)) {
    for (const hole of course.holes) for (let step = 0; step < 12; step++) {
      const angle = step / 12 * Math.PI * 2;
      const camera = { easting: centre.easting + Math.cos(angle) * (100 + step * 150),
        northing: centre.northing + Math.sin(angle) * (100 + step * 150), heightRH2000: ground.bounds.maxHeightRH2000 + 10 + step * 35 };
      const residentTileIds = ground.tiles.filter((_, i) => (i + step) % 6 < step % 7).map(t => t.id);
      if (step % 2) residentTileIds.push('shell');
      const input = { camera, viewportHeightPixels: step % 2 ? 2160 : 700,
        fieldOfViewYRadians: step % 2 ? .8 : 1.2, ...profile,
        activeTileIds: hole.tileIds, residentTileIds,
        visible: tile => step % 3 === 0 || (tile.bounds.maxEasting >= camera.easting - 1200 && tile.bounds.minNorthing <= camera.northing + 1200) };
      if (step === 3) {
        const tile = ground.tiles[(hole.number * 17) % ground.tiles.length];
        a.setRenderErrorMetres(tile.id, tile.geometricErrorMetres + 2);
        b.setRenderErrorMetres(tile.id, tile.geometricErrorMetres + 2);
      }
      if (step === 7) { a.resetHysteresis(); b.resetHysteresis(); }
      assert.deepEqual(b.plan(input), a.plan(input), `${course.slug} hole ${hole.number} step ${step}`);
      assert.deepEqual(b.refined, a.refined);
      comparisons++;
    }
  }
  results.push({ course: course.slug, manifestSha256: entry.manifest.sha256, groundSha256: course.groundManifest.sha256,
    tiles: ground.tiles.length, holes: course.holes.length, comparisons, exact: true });
}
const report = { revision: courseSourceRevision(process.cwd()), baselineSourceSha256: sha(source),
  mode: 'verified public manifests; synthetic camera and visibility/residency sequences; all holes and four backend/device budgets; exact complete plans and hysteresis', results };
await fs.mkdir('output/performance-audit/terrain-plans-2026-09-22', { recursive: true });
await fs.writeFile('output/performance-audit/terrain-plans-2026-09-22/all-course-parity.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ courses: results.length, exactPlans: results.reduce((n, r) => n + r.comparisons, 0) }));
