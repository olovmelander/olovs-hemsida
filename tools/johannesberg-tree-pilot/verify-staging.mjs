#!/usr/bin/env node
/* Verify a staged (or the live) public root for one ground the way the
   production workflow's validate stage does, over the whole root (every
   course of every ground), its ground manifest and every tile layer, through verifyAssetGraph
   with the supported features; then decode every object chunk and count the
   tree records, typed records and play zones.
   usage: node tools/johannesberg-tree-pilot/verify-staging.mjs [--public output/course-workflow/johannesberg/staging-public] [--ground johannesberg] */
import fs from 'node:fs';
import path from 'node:path';
import { loadGround } from '../../packages/course-workflow/audit.mjs';
import { verifyAssetGraph } from '../../packages/course-v2/graph-node.mjs';
import { readChunk } from '../../packages/course-v2/chunk-node.mjs';
import { V2_SUPPORTED_FEATURES } from '../../packages/course-v2/schema.mjs';
import { ROOT } from './panels.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const publicRoot = flag('public', 'output/course-workflow/johannesberg/staging-public');
const groundId = flag('ground', 'johannesberg');
const graph = loadGround(ROOT, groundId, publicRoot);
const read = url => fs.readFileSync(path.join(ROOT, publicRoot, url));
const resources = new Map();
const add = ref => resources.set(ref.url, read(ref.url));
/* the whole root: every course of every ground, as the app's verifier sees it */
for (const entry of graph.index.courses) {
  add(entry.manifest);
  const course = JSON.parse(read(entry.manifest.url));
  add(course.groundManifest); add(course.routing);
  const ground = JSON.parse(read(course.groundManifest.url));
  add(ground.shell);
  for (const tile of ground.tiles) Object.values(tile.layers).filter(Boolean).forEach(add);
}
const integrity = verifyAssetGraph({ root: graph.index, resources, supportedFeatures: V2_SUPPORTED_FEATURES });
const counts = { trees: 0, typed: { conifer: 0, broadleaf: 0, null: 0 }, play: { near: 0, woodland: 0, none: 0 }, objectTiles: 0, standTiles: 0, attributeTiles: 0 };
for (const tile of graph.ground.tiles.filter(t => t.lod === 0)) {
  if (tile.layers.stands) counts.standTiles++;
  if (!tile.layers.objects) continue;
  counts.objectTiles++;
  const chunk = readChunk(read(tile.layers.objects.url));
  if (chunk.header.requiredFeatures.includes('object-registry-tree-attributes-v1')) counts.attributeTiles++;
  for (const record of chunk.content.records) {
    if (record.class !== 'tree') continue;
    counts.trees++;
    counts.typed[record.subtype ?? 'null'] = (counts.typed[record.subtype ?? 'null'] || 0) + 1;
    counts.play[record.play ?? 'none']++;
  }
}
console.log(JSON.stringify({ publicRoot, groundId, courses: graph.courses.map(c => c.slug), groundManifest: graph.courses[0].groundManifest.url, integrity: Boolean(integrity), counts }, null, 1));
