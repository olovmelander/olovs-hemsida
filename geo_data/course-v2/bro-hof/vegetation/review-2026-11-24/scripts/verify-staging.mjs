/* Verifies the staged reviewed generation of Bro Hof: graph integrity over every course of the staged index (other
   courses' bytes are read from the live root, which the light staging copy does not hold) and the staged tree records.
   Nothing under apps/ is written.
   node geo_data/course-v2/bro-hof/vegetation/review-2026-11-24/scripts/verify-staging.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { loadGroundConfig, ROOT } from '../../../../../../tools/tree-pipeline/config.mjs';
import { verifyAssetGraph } from '../../../../../../packages/course-v2/graph-node.mjs';
import { readChunk } from '../../../../../../packages/course-v2/chunk-node.mjs';
import { V2_SUPPORTED_FEATURES } from '../../../../../../packages/course-v2/schema.mjs';

const ctx = loadGroundConfig(ROOT, 'bro-hof');
const staging = path.join(ROOT, ctx.config.publication.stagingRoot), live = path.join(ROOT, 'apps/golf/public');
const read = url => fs.readFileSync(fs.existsSync(path.join(staging, url)) ? path.join(staging, url) : path.join(live, url));
const index = JSON.parse(fs.readFileSync(path.join(staging, 'courses/v2-index.json'), 'utf8'));
const resources = new Map();
const add = ref => resources.set(ref.url, read(ref.url));
let ground = null, groundUrl = null;
for (const entry of index.courses) {
  add(entry.manifest);
  const course = JSON.parse(read(entry.manifest.url));
  add(course.groundManifest); add(course.routing);
  const g = JSON.parse(read(course.groundManifest.url));
  add(g.shell);
  for (const tile of g.tiles) Object.values(tile.layers).filter(Boolean).forEach(add);
  if (entry.slug === 'bro-hof-stadium') { ground = g; groundUrl = course.groundManifest.url; }
}
const integrity = Boolean(verifyAssetGraph({ root: index, resources, supportedFeatures: V2_SUPPORTED_FEATURES }));
const counts = { trees: 0, typed: {}, play: {}, inScope: 0, objectTiles: 0, standTiles: 0, attributeTiles: 0 };
const s = ctx.config.publication.scope;
for (const tile of ground.tiles.filter(t => t.lod === 0)) {
  if (tile.layers.stands) counts.standTiles++;
  if (!tile.layers.objects) continue;
  counts.objectTiles++;
  const chunk = readChunk(read(tile.layers.objects.url));
  if (chunk.header.requiredFeatures.includes('object-registry-tree-attributes-v1')) counts.attributeTiles++;
  for (const r of chunk.content.records) {
    if (r.class !== 'tree') continue;
    counts.trees++;
    counts.typed[r.subtype ?? 'null'] = (counts.typed[r.subtype ?? 'null'] || 0) + 1;
    counts.play[r.play ?? 'none'] = (counts.play[r.play ?? 'none'] || 0) + 1;
    if (r.easting >= s[0] && r.easting < s[2] && r.northing >= s[1] && r.northing < s[3]) counts.inScope++;
  }
}
const out = { stagingRoot: ctx.config.publication.stagingRoot, groundManifest: groundUrl, integrity, counts, gate: 'held-out gate FAIL (P 0.784, R 0.807 on 166 crowns); no owner exception in trees.json', verifiedAt: new Date().toISOString() };
fs.writeFileSync(path.join(ROOT, ctx.config.publication.compileOut, 'staging-verification.json'), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out, null, 1));
