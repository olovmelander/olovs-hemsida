import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { openCog, parseTiffHeader } from './cog-reader.mjs';

/* Build a tiny tiled, deflated, predictor-2 GeoTIFF in memory: 2 x 2 tiles
   of 4 x 4 pixels, values = column + 10 * row over the 8 x 8 image. */
function syntheticTiff() {
  const width = 8, height = 8, tile = 4;
  const tiles = [];
  for (let tr = 0; tr < 2; tr++) for (let tc = 0; tc < 2; tc++) {
    const raw = Buffer.alloc(tile * tile);
    for (let r = 0; r < tile; r++) for (let c = 0; c < tile; c++) raw[r * tile + c] = (tc * tile + c) + 10 * (tr * tile + r);
    /* predictor 2: store horizontal differences */
    const diff = Buffer.from(raw);
    for (let r = 0; r < tile; r++) for (let c = tile - 1; c > 0; c--) diff[r * tile + c] = (raw[r * tile + c] - raw[r * tile + c - 1]) & 0xff;
    tiles.push(zlib.deflateSync(diff));
  }
  const entries = [];
  const dataStart = 4096;
  let cursor = dataStart;
  const offsets = [], counts = [];
  for (const bytes of tiles) { offsets.push(cursor); counts.push(bytes.length); cursor += bytes.length; }
  const arrays = Buffer.alloc(256);
  let arrayCursor = 0;
  const arrayAt = values => { const at = 1024 + arrayCursor; for (const v of values) { arrays.writeUInt32LE(v, arrayCursor); arrayCursor += 4; } return at; };
  const doublesAt = values => { const at = 1024 + arrayCursor; for (const v of values) { arrays.writeDoubleLE(v, arrayCursor); arrayCursor += 8; } return at; };
  const add = (tag, type, count, value) => entries.push({ tag, type, count, value });
  add(256, 4, 1, width); add(257, 4, 1, height); add(258, 3, 1, 8); add(259, 3, 1, 8); add(277, 3, 1, 1);
  add(317, 3, 1, 2); add(322, 4, 1, tile); add(323, 4, 1, tile);
  add(324, 4, 4, arrayAt(offsets)); add(325, 4, 4, arrayAt(counts)); add(339, 3, 1, 1);
  add(33550, 12, 3, doublesAt([0.5, 0.5, 0])); add(33922, 12, 6, doublesAt([0, 0, 0, 1000, 2000, 0]));
  entries.sort((a, b) => a.tag - b.tag);
  const file = Buffer.alloc(cursor);
  file.write('II', 0, 'latin1'); file.writeUInt16LE(42, 2); file.writeUInt32LE(8, 4);
  file.writeUInt16LE(entries.length, 8);
  entries.forEach((entry, i) => {
    const o = 10 + i * 12;
    file.writeUInt16LE(entry.tag, o); file.writeUInt16LE(entry.type, o + 2); file.writeUInt32LE(entry.count, o + 4);
    if (entry.type === 3 && entry.count === 1) file.writeUInt16LE(entry.value, o + 8);
    else file.writeUInt32LE(entry.value, o + 8);
  });
  arrays.copy(file, 1024, 0, arrayCursor);
  tiles.forEach((bytes, i) => bytes.copy(file, offsets[i]));
  return file;
}

test('a tiled deflate predictor-2 GeoTIFF reads back exactly, tile by tile', async () => {
  const file = syntheticTiff();
  const calls = [];
  const range = async (offset, length) => { calls.push([offset, length]); return file.subarray(offset, Math.min(file.length, offset + length)); };
  const [tags] = parseTiffHeader(file);
  assert.equal(tags.get(256).values[0], 8);
  const cog = await openCog(range, { headerBytes: 2048 });
  assert.equal(cog.tilesAcross, 2);
  assert.equal(cog.predictor, 2);
  assert.equal(cog.originX, 1000);
  assert.equal(cog.originY, 2000);
  assert.deepEqual(cog.pixelOf(1000.75, 1999.25), [1, 1]);
  assert.equal(await cog.sample(0, 0), 0);
  assert.equal(await cog.sample(7, 0), 7);
  assert.equal(await cog.sample(3, 5), 53);
  assert.equal(await cog.sample(6, 7), 76);
  assert.ok(Number.isNaN(await cog.sample(8, 0)));
  assert.equal(cog.cachedTiles, 4);
  const tileReads = calls.filter(([offset]) => offset >= 4096).length;
  assert.equal(tileReads, 4, 'each tile fetched once');
});

test('unsupported layouts are refused', async () => {
  const file = syntheticTiff();
  file.writeUInt16LE(43, 2);
  await assert.rejects(openCog(async (o, l) => file.subarray(o, o + l)), /classic little-endian/);
});
