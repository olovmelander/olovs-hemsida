import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { readdressChunk } from './readdress-chunk.mjs';
import { readChunk } from './chunk-node.mjs';
import { decodeTerrainGrid } from './terrain-grid.mjs';

/* Real published chunks of every layer kind, so the formats exercised are
   the ones a publish will move: Puttom's level zero carries terrain, an
   object registry and a stand field on its first tile. */
const publicDirectory = new URL('../../apps/golf/public/', import.meta.url);
const read = p => fs.readFileSync(new URL(p, publicDirectory));
const readJson = p => JSON.parse(read(p).toString('utf8'));
const root = readJson('courses/v2-index.json');
const course = readJson(root.courses.find(c => c.slug === 'puttom').manifest.url);
const ground = readJson(course.groundManifest.url);
const tile = ground.tiles.find(t => t.lod === 0 && t.layers.objects && t.layers.stands);
const moved = `l0/${Number(tile.id.split('/')[1]) + 4}/${Number(tile.id.split('/')[2]) + 4}`;

test('a terrain chunk moves to a new lattice id with its payload byte for byte', () => {
  const bytes = read(tile.layers.terrain.url);
  const was = readChunk(bytes);
  const now = readdressChunk(bytes, tile.layers.terrain, moved);
  assert.equal(now.header.id, moved);
  assert.equal(now.reference.kind, 'terrain');
  assert.equal(now.reference.url.replace(/\/[^/]+$/, ''), tile.layers.terrain.url.replace(/\/[^/]+$/, ''), 'the same directory');
  assert.notEqual(now.reference.sha256, tile.layers.terrain.sha256, 'a new header is a new content address');
  const decoded = readChunk(now.chunk);
  assert.deepEqual(decoded.header.bounds, was.header.bounds);
  assert.deepEqual(decoded.header.grid, was.header.grid);
  assert.equal(decoded.header.decodedSha256, was.header.decodedSha256, 'the payload digest is unchanged');
  assert.deepEqual(decodeTerrainGrid(decoded.payload, decoded.header.grid), decodeTerrainGrid(was.payload, was.header.grid));
  /* moving it back reproduces the published bytes exactly */
  const back = readdressChunk(now.chunk, now.reference, tile.id);
  assert.equal(Buffer.compare(back.chunk, bytes), 0);
  assert.equal(back.reference.sha256, tile.layers.terrain.sha256);
});

test('an object registry moves with its payload tileId re-pointed and nothing else changed', () => {
  const bytes = read(tile.layers.objects.url);
  const was = readChunk(bytes);
  const now = readdressChunk(bytes, tile.layers.objects, moved);
  const decoded = readChunk(now.chunk);
  assert.equal(decoded.header.id, moved);
  assert.equal(decoded.content.tileId, moved);
  assert.deepEqual(decoded.content.records, was.content.records);
  assert.equal(decoded.header.records.count, was.header.records.count);
  assert.deepEqual(decoded.header.bounds, was.header.bounds);
  assert.equal(Buffer.compare(readdressChunk(now.chunk, now.reference, tile.id).chunk, bytes), 0);
});

test('a stand field moves with its payload untouched', () => {
  const bytes = read(tile.layers.stands.url);
  const was = readChunk(bytes);
  const now = readdressChunk(bytes, tile.layers.stands, moved);
  const decoded = readChunk(now.chunk);
  assert.equal(decoded.header.id, moved);
  assert.deepEqual(decoded.header.standField, was.header.standField);
  assert.equal(decoded.header.decodedSha256, was.header.decodedSha256);
  assert.equal(Buffer.compare(decoded.payload, was.payload), 0);
  assert.equal(Buffer.compare(readdressChunk(now.chunk, now.reference, tile.id).chunk, bytes), 0);
});

test('a chunk of another kind, or a malformed id, is refused', () => {
  const bytes = read(tile.layers.terrain.url);
  assert.throws(() => readdressChunk(bytes, { ...tile.layers.terrain, kind: 'objects' }, moved), /is a terrain chunk, not objects/);
  assert.throws(() => readdressChunk(bytes, tile.layers.terrain, 'shell'), /lattice id/);
});
