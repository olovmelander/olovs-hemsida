#!/usr/bin/env node
/* Suppress representative stand placements in dated, reviewed playing areas.
 * The measured canopy channels and all individual crown records stay intact. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { pointInPoly } from '../../geobuild/lib.mjs';
import { orthophotoRing } from './reviewed-orthophoto.mjs';
import { readChunk, writeChunk, assetReferenceForChunk } from '../../packages/course-v2/chunk-node.mjs';
import { assembleVegetationGraph } from '../../packages/course-v2/vegetation/publish-vegetation.mjs';
import { writeGroundGraphFiles } from '../../packages/course-v2/emit-ground-graph-node.mjs';

export function reviewedPlayingAreas(review) {
  return [...review.holes.flatMap(h => [...(h.green ? [h.green] : []), ...(h.tees ?? []),
    ...(h.fairways ?? []), ...(h.bunkers?.accepted ?? [])]), ...(review.sceneryBunkers?.accepted ?? [])]
    .map(e => {
      const { ring } = orthophotoRing(review, e);
      return { id: e.id, ring, bounds: [Math.min(...ring.map(p => p[0])), Math.min(...ring.map(p => p[1])),
        Math.max(...ring.map(p => p[0])), Math.max(...ring.map(p => p[1]))] };
    });
}

export function nearRing(e, n, ring, margin) {
  if (pointInPoly(e, n, ring)) return true;
  return ring.slice(1).some((b, i) => {
    const a = ring[i], dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((e-a[0])*dx+(n-a[1])*dy)/(dx*dx+dy*dy || 1)));
    return Math.hypot(e-a[0]-t*dx, n-a[1]-t*dy) <= margin;
  });
}

export function excludeReviewedStandCells(header, source, areas) {
  const payload = Uint8Array.from(source), s = header.standField;
  // A stand may jitter anywhere in its 4 m cell. Its half diagonal protects
  // the reviewed edge without moving or claiming a measured tree position.
  const margin = s.cellMetres / Math.SQRT2;
  const candidates = areas.filter(a => a.bounds[0] <= header.bounds.maxEasting + margin &&
    a.bounds[2] >= header.bounds.minEasting - margin && a.bounds[1] <= header.bounds.maxNorthing + margin &&
    a.bounds[3] >= header.bounds.minNorthing - margin);
  let changed = 0, eligibleCanopyRemoved = 0;
  for (let row = 0; row < s.height; row++) for (let col = 0; col < s.width; col++) {
    const i = (row*s.width+col)*4;
    if (!(payload[i+3] & 1) || (payload[i+3] & 4)) continue;
    const e = header.bounds.minEasting+(col+.5)*s.cellMetres;
    const n = header.bounds.maxNorthing-(row+.5)*s.cellMetres;
    if (!candidates.some(a => e >= a.bounds[0]-margin && e <= a.bounds[2]+margin &&
      n >= a.bounds[1]-margin && n <= a.bounds[3]+margin && nearRing(e,n,a.ring,margin))) continue;
    payload[i+3] |= 4; changed++;
    if (payload[i]) eligibleCanopyRemoved++;
  }
  return { payload, changed, eligibleCanopyRemoved };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const publicDir = path.join(root, 'apps/golf/public');
  const read = u => fs.readFileSync(path.join(publicDir,u));
  const json = u => JSON.parse(read(u));
  const sha = b => createHash('sha256').update(b).digest('hex');
  const reviewBytes = fs.readFileSync(path.join(root,'visbybuild/mapping/orthophoto-review-2026.json'));
  const areas = reviewedPlayingAreas(JSON.parse(reviewBytes));
  const entry = json('courses/v2-index.json').courses.find(c => c.slug === 'visby');
  const course = json(entry.manifest.url), ground = json(course.groundManifest.url);
  assert.equal(ground.groundId, 'visby');
  const resources = new Map([[ground.shell.url,read(ground.shell.url)]]), layerChunks = new Map();
  const objectLayers = {}, standLayers = {}, changes = [];
  let individualCrowns = 0;
  for (const tile of ground.tiles) {
    for (const reference of Object.values(tile.layers)) if (reference) resources.set(reference.url,read(reference.url));
    if (tile.layers.objects) {
      objectLayers[tile.id] = tile.layers.objects;
      const objects = readChunk(read(tile.layers.objects.url)).content.records;
      individualCrowns += objects.length;
      for (const o of objects) if (areas.some(a => pointInPoly(o.easting,o.northing,a.ring)))
        throw new Error(`Individual crown ${o.id} needs source-image review before changing a playing area`);
    }
    if (!tile.layers.stands) continue;
    const original = readChunk(read(tile.layers.stands.url));
    const result = excludeReviewedStandCells(original.header,original.payload,areas);
    standLayers[tile.id] = tile.layers.stands;
    if (!result.changed) continue;
    for (let i = 0; i < result.payload.length; i++) if (i%4 !== 3) assert.equal(result.payload[i],original.payload[i]);
    const bytes = writeChunk({header:original.header,payload:result.payload,codec:original.codec});
    const reference = assetReferenceForChunk(bytes,{kind:'stands',directory:'grounds/visby/stands'});
    resources.delete(tile.layers.stands.url);
    standLayers[tile.id] = reference; layerChunks.set(reference.url,bytes);
    changes.push({tileId:tile.id,previous:tile.layers.stands,updated:reference,
      excludedCellsAdded:result.changed,eligibleCanopyCellsRemoved:result.eligibleCanopyRemoved});
  }
  const report = {schemaVersion:1,groundId:'visby',reviewedAt:'2026-09-09',
    review:{path:'visbybuild/mapping/orthophoto-review-2026.json',sha256:sha(reviewBytes)},
    inputGround:course.groundManifest,reviewedAreas:areas.length,individualCrownsPreserved:individualCrowns,
    method:'Add the excluded flag to measured stand cells within a cell half diagonal of the reviewed 2026 playing polygons. All canopy measurements, crown objects and terrain bytes are preserved.',
    changes,excludedCellsAdded:changes.reduce((s,c)=>s+c.excludedCellsAdded,0),
    eligibleCanopyCellsRemoved:changes.reduce((s,c)=>s+c.eligibleCanopyCellsRemoved,0)};
  console.log(JSON.stringify({changedTiles:changes.length,excludedCellsAdded:report.excludedCellsAdded,
    eligibleCanopyCellsRemoved:report.eligibleCanopyCellsRemoved,individualCrowns}));
  if (process.argv.includes('--write')) {
    const graph = await assembleVegetationGraph({slug:'visby',rootEntry:entry,courseManifest:course,
      groundManifest:ground,routingContent:readChunk(read(course.routing.url)).content,
      resources,layerChunks,objectLayers,standLayers,
      sourceManifestSha256:sha(fs.readFileSync(path.join(root,'geo_data/course-v2/visby/source-manifest.json'))),
      readAsset:async u=>read(u)});
    await writeGroundGraphFiles(publicDir,graph);
    if (changes.length) fs.writeFileSync(path.join(root,'geo_data/course-v2/visby/vegetation/orthophoto-exclusion-review.json'),JSON.stringify(report,null,2)+'\n');
  }
}
