import test from 'node:test';
import assert from 'node:assert/strict';
import { compileTerrainRings, createRingSampler } from './terrain-rings.mjs';
import { readChunk } from './chunk-node.mjs';
import { decodeTerrainGrid } from './terrain-grid.mjs';

/* a smooth field plus one sharp bump near the centre, sampled at any spacing */
function field(easting, northing) {
  const dx = easting - 1000, dy = northing - 2000;
  return 40 + 0.004 * dx + Math.sin(dy / 90) * 3 + (Math.hypot(dx - 7, dy + 5) < 6 ? 4 : 0);
}

function level({ lod, spacing, originEasting, originNorthing, tilesPerSide, tileSegments, heightScaleMetres }) {
  const size = tilesPerSide * tileSegments + 1;
  const heights = new Float64Array(size * size);
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    heights[row * size + column] = field(originEasting + column * spacing, originNorthing - row * spacing);
  }
  return { lod, sampleSpacingMetres: spacing, originEasting, originNorthing, tilesPerSide, heightScaleMetres, heights };
}

/* tileSegments 8: l0 1 m over 32 m (4 tiles), l1 2 m over 64 m (4 tiles),
   l2 4 m over 128 m (4 tiles), l3 8 m over 128 m (2 tiles), l4 16 m root.
   Every finer ring is a whole number of the coarser level's tiles, placed on
   its lattice, so each tile lies inside exactly one coarser tile and a
   coarser tile is covered by finer ones wholly or not at all. */
function rings() {
  const seg = 8;
  return [
    level({ lod: 0, spacing: 1, originEasting: 984, originNorthing: 2016, tilesPerSide: 4, tileSegments: seg, heightScaleMetres: 0.01 }),
    level({ lod: 1, spacing: 2, originEasting: 968, originNorthing: 2032, tilesPerSide: 4, tileSegments: seg, heightScaleMetres: 0.02 }),
    level({ lod: 2, spacing: 4, originEasting: 936, originNorthing: 2064, tilesPerSide: 4, tileSegments: seg, heightScaleMetres: 0.04 }),
    level({ lod: 3, spacing: 8, originEasting: 936, originNorthing: 2064, tilesPerSide: 2, tileSegments: seg, heightScaleMetres: 0.08 }),
    level({ lod: 4, spacing: 16, originEasting: 936, originNorthing: 2064, tilesPerSide: 1, tileSegments: seg, heightScaleMetres: 0.16 }),
  ];
}

test('nested rings compile into one explicit quadtree with a single root as the shell', () => {
  const compiled = compileTerrainRings({ groundId: 'test-ground', courseSlugs: ['test-course'], levels: rings(), tileSegments: 8 });
  assert.equal(compiled.tiles.length, 16 + 16 + 16 + 4 + 1);
  assert.equal(compiled.stats.rootTiles, 1);
  const byId = new Map(compiled.tiles.map(tile => [tile.id, tile]));
  /* parents are found by footprint, not by index arithmetic: the course
     tiles start one l1 tile in from the l1 origin */
  assert.equal(byId.get('l0/0/0').parentId, 'l1/1/1');
  assert.equal(byId.get('l0/3/3').parentId, 'l1/2/2');
  assert.equal(byId.get('l1/0/0').parentId, 'l2/1/1');
  assert.equal(byId.get('l2/0/0').parentId, 'l3/0/0');
  assert.equal(byId.get('l2/2/2').parentId, 'l3/1/1');
  assert.equal(byId.get('l3/1/1').parentId, 'l4/0/0');
  assert.equal(byId.get('l4/0/0').parentId, null);
  for (const tile of compiled.tiles) {
    if (!tile.parentId) continue;
    const parent = byId.get(tile.parentId);
    assert.ok(parent.bounds.minEasting <= tile.bounds.minEasting && parent.bounds.maxEasting >= tile.bounds.maxEasting);
    assert.ok(parent.bounds.minNorthing <= tile.bounds.minNorthing && parent.bounds.maxNorthing >= tile.bounds.maxNorthing);
    assert.equal(parent.lod, tile.lod + 1);
  }
  /* the shell is the root's payload under the ground's bounds */
  const shell = readChunk(compiled.resources.get(compiled.shell.url));
  assert.equal(shell.header.id, 'shell');
  assert.deepEqual(shell.header.bounds, compiled.bounds);
  assert.equal(compiled.bounds.minEasting, 936);
  assert.equal(compiled.bounds.maxEasting, 936 + 128);
  /* the coarser levels measure their error against the finest data under them:
     the bump only exists at 1 m, so the l1 tile over it carries it and the
     l1 tiles away from the course carry only their own quantization */
  assert.ok(byId.get('l1/2/2').geometricErrorMetres > 1, `bump error ${byId.get('l1/2/2').geometricErrorMetres}`);
  assert.ok(byId.get('l1/0/0').geometricErrorMetres < 0.5, `outer l1 error ${byId.get('l1/0/0').geometricErrorMetres}`);
  /* every chunk decodes to the level it was cut from, on that level's lattice */
  const tile = byId.get('l2/0/1');
  const chunk = readChunk(compiled.resources.get(tile.layers.terrain.url));
  const heights = decodeTerrainGrid(chunk.payload, chunk.header.grid);
  assert.equal(chunk.header.grid.heightScaleMetres, 0.04);
  assert.equal(chunk.header.grid.sampleSpacingMetres, 4);
  assert.ok(Math.abs(heights[0] - field(tile.bounds.minEasting, tile.bounds.maxNorthing)) <= 0.02);
  assert.equal(chunk.header.grid.geometricErrorMetres, tile.geometricErrorMetres);
});

test('a published tile is reused byte for byte when it decodes to the compiled heights', () => {
  const first = compileTerrainRings({ groundId: 'g', courseSlugs: ['c'], levels: rings(), tileSegments: 8 });
  const published = new Map(first.tiles.filter(tile => tile.lod === 0).map(tile => {
    const chunkBytes = first.resources.get(tile.layers.terrain.url);
    const chunk = readChunk(chunkBytes);
    return [tile.id, { chunk: chunkBytes, reference: tile.layers.terrain, grid: chunk.header.grid, heights: decodeTerrainGrid(chunk.payload, chunk.header.grid) }];
  }));
  const second = compileTerrainRings({
    groundId: 'g', courseSlugs: ['c'], levels: rings(), tileSegments: 8,
    reuse: (lod, column, row) => published.get(`l${lod}/${column}/${row}`) ?? null,
  });
  assert.equal(second.stats.reusedTiles, 16);
  const changed = rings();
  changed[0].heights[5] += 1;
  assert.throws(() => compileTerrainRings({
    groundId: 'g', courseSlugs: ['c'], levels: changed, tileSegments: 8,
    reuse: (lod, column, row) => published.get(`l${lod}/${column}/${row}`) ?? null,
  }), /differs from the compiled heights/);
});

test('misaligned or unnested rings are refused', () => {
  const misaligned = rings();
  misaligned[1] = { ...misaligned[1], originEasting: 975 };
  const partial = rings();
  partial[1] = { ...partial[1], tilesPerSide: 3, heights: partial[1].heights.subarray(0, 25 * 25) };
  assert.throws(() => compileTerrainRings({ groundId: 'g', courseSlugs: ['c'], levels: partial, tileSegments: 8 }), /whole level 2 tiles/);
  assert.throws(() => compileTerrainRings({ groundId: 'g', courseSlugs: ['c'], levels: misaligned, tileSegments: 8 }), /not aligned/);
  const escaping = rings();
  escaping[0] = level({ lod: 0, spacing: 1, originEasting: 900, originNorthing: 2016, tilesPerSide: 4, tileSegments: 8, heightScaleMetres: 0.01 });
  assert.throws(() => compileTerrainRings({ groundId: 'g', courseSlugs: ['c'], levels: escaping, tileSegments: 8 }), /leaves level/);
  const twoRoots = rings().slice(0, 4);
  assert.throws(() => compileTerrainRings({ groundId: 'g', courseSlugs: ['c'], levels: twoRoots, tileSegments: 8 }), /single root/);
});

test('the ring sampler reads the finest level under a point', () => {
  const sample = createRingSampler(rings());
  assert.ok(Math.abs(sample(1000, 2000) - field(1000, 2000)) < 1e-9, 'inside the 1 m ring the 1 m data is exact');
  assert.ok(Math.abs(sample(940, 2060) - field(940, 2060)) < 0.5, 'far out the 8 m data still answers');
  assert.ok(Number.isNaN(sample(0, 0)));
});

/* THE STANDARD'S WIDENING: a level zero that grows around the published
   tiles keeps them -- same bounds, same heights to the byte -- under the ids
   of their new lattice positions. The reuse entry says which tile it was
   (`id`) and carries its payload; the compiler re-addresses it rather than
   re-encoding the DTM read, so a rounding tie stays as published. */
test('a published tile is carried to a wider lattice under its new id with its payload intact', () => {
  const seg = 8;
  const narrow = compileTerrainRings({ groundId: 'g', courseSlugs: ['c'], levels: rings(), tileSegments: seg });
  const boundsKey = b => `${b.minEasting}|${b.maxNorthing}`;
  const published = new Map(narrow.tiles.filter(tile => tile.lod === 0).map(tile => {
    const chunkBytes = narrow.resources.get(tile.layers.terrain.url);
    const chunk = readChunk(chunkBytes);
    return [boundsKey(tile.bounds), {
      id: tile.id, chunk: chunkBytes, reference: tile.layers.terrain, grid: chunk.header.grid, payload: chunk.payload,
      bounds: chunk.header.bounds, heights: decodeTerrainGrid(chunk.payload, chunk.header.grid),
    }];
  }));
  /* level zero eight tiles wide over the same 64 m square as level 1, the old
     four-wide window in its middle at columns and rows 2-5 */
  const wide = rings();
  wide[0] = level({ lod: 0, spacing: 1, originEasting: 968, originNorthing: 2032, tilesPerSide: 8, tileSegments: seg, heightScaleMetres: 0.01 });
  const compiled = compileTerrainRings({
    groundId: 'g', courseSlugs: ['c'], levels: wide, tileSegments: seg,
    reuse: (lod, column, row) => (lod === 0 ? published.get(boundsKey({ minEasting: 968 + column * seg, maxNorthing: 2032 - row * seg })) ?? null : null),
  });
  assert.equal(compiled.stats.reusedTiles, 16);
  assert.equal(compiled.tiles.filter(tile => tile.lod === 0).length, 64);
  for (const [key, was] of published) {
    const now = compiled.tiles.find(tile => tile.lod === 0 && boundsKey(tile.bounds) === key);
    assert.ok(now, `${was.id} has no tile at its position`);
    const [, c, r] = was.id.match(/^l0\/(\d+)\/(\d+)$/).map(Number);
    assert.equal(now.id, `l0/${c + 2}/${r + 2}`, 'the id is the new lattice position');
    assert.equal(now.parentId, narrow.tiles.find(tile => tile.id === was.id).parentId, 'level one did not move, so the parent is the same tile');
    const chunk = readChunk(compiled.resources.get(now.layers.terrain.url));
    assert.equal(chunk.header.id, now.id, 'the chunk names the tile it is served as');
    assert.equal(Buffer.compare(chunk.payload, was.payload), 0, 'the payload is the published one, byte for byte');
    assert.deepEqual(chunk.header.bounds, was.bounds);
    assert.deepEqual(chunk.header.grid, was.grid);
    assert.notEqual(now.layers.terrain.sha256, was.reference.sha256, 'a new header is a new content address');
  }
  /* a tile that did not move is still carried verbatim */
  const same = compileTerrainRings({
    groundId: 'g', courseSlugs: ['c'], levels: rings(), tileSegments: seg,
    reuse: (lod, column, row) => (lod === 0 ? published.get(boundsKey({ minEasting: 984 + column * seg, maxNorthing: 2016 - row * seg })) ?? null : null),
  });
  for (const tile of same.tiles.filter(tile => tile.lod === 0)) {
    assert.deepEqual(tile.layers.terrain, narrow.tiles.find(candidate => candidate.id === tile.id).layers.terrain);
  }
  /* an entry that moves but brings no payload cannot be re-addressed */
  assert.throws(() => compileTerrainRings({
    groundId: 'g', courseSlugs: ['c'], levels: wide, tileSegments: seg,
    reuse: (lod, column, row) => {
      const entry = lod === 0 ? published.get(boundsKey({ minEasting: 968 + column * seg, maxNorthing: 2032 - row * seg })) : null;
      return entry ? { ...entry, payload: undefined } : null;
    },
  }), /carries no payload to re-address/);
});

/* the decoder hands back float32, so a one-quantum rounding tie at 45 m reads
   0.0100021 m, not 0.01: it must be counted as a tie, and two quanta refused */
test('a one-quantum tie survives float32 noise; two quanta are drift', () => {
  const first = compileTerrainRings({ groundId: 'g', courseSlugs: ['c'], levels: rings(), tileSegments: 8 });
  const entry = tile => {
    const chunkBytes = first.resources.get(tile.layers.terrain.url);
    const chunk = readChunk(chunkBytes);
    return { chunk: chunkBytes, reference: tile.layers.terrain, grid: chunk.header.grid, heights: decodeTerrainGrid(chunk.payload, chunk.header.grid) };
  };
  const published = new Map(first.tiles.filter(tile => tile.lod === 0).map(tile => [tile.id, entry(tile)]));
  const noisy = published.get('l0/0/0');
  noisy.heights[10] = Math.fround(noisy.heights[10] + 0.01) + 2.2e-6;
  const reused = compileTerrainRings({ groundId: 'g', courseSlugs: ['c'], levels: rings(), tileSegments: 8, reuse: (lod, c, r) => published.get(`l${lod}/${c}/${r}`) ?? null });
  assert.equal(reused.stats.reusedTiles, 16);
  assert.ok(reused.stats.reuseTies >= 1);
  noisy.heights[10] += 0.01;
  assert.throws(() => compileTerrainRings({ groundId: 'g', courseSlugs: ['c'], levels: rings(), tileSegments: 8, reuse: (lod, c, r) => published.get(`l${lod}/${c}/${r}`) ?? null }), /differs from the compiled heights/);
});
