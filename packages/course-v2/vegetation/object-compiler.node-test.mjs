import test from 'node:test';
import assert from 'node:assert/strict';
import { readChunk } from '../chunk-node.mjs';
import { validateObjectRegistry } from '../object-registry.mjs';
import { createRaster, voidMask } from './canopy-fields.mjs';
import { standField, standFieldSummary } from './stand-fields.mjs';
import { assignStableIds, parseTreeId, registryDiff, treeId } from './registry-identity.mjs';
import {
  assignRecordsToTiles,
  compileObjectChunks,
  headingFromId,
  objectCompilationSummary,
  treeRecord,
} from './object-compiler.mjs';

const GROUND = 'puttom';
const TILES = [
  { id: 'l0/0/0', lod: 0, bounds: { minEasting: 697000, minNorthing: 7025000, minHeightRH2000: 30, maxEasting: 697256, maxNorthing: 7025256, maxHeightRH2000: 60 } },
  { id: 'l0/1/0', lod: 0, bounds: { minEasting: 697256, minNorthing: 7025000, minHeightRH2000: 30, maxEasting: 697512, maxNorthing: 7025256, maxHeightRH2000: 60 } },
  { id: 'l1/0/0', lod: 1, bounds: { minEasting: 697000, minNorthing: 7025000, minHeightRH2000: 30, maxEasting: 697512, maxNorthing: 7025256, maxHeightRH2000: 60 } },
];

function candidate(easting, northing, height, radius) {
  return { centroid: { easting, northing }, heightMetres: height, equivalentRadiusMetres: radius, objectHeightMetres: height };
}

test('ids are sequential, deterministic and preserved across a sub-metre rebuild', () => {
  const first = assignStableIds({
    groundId: GROUND,
    candidates: [
      { easting: 697100, northing: 7025100, objectHeightMetres: 20 },
      { easting: 697050, northing: 7025120, objectHeightMetres: 15 },
      { easting: 697300, northing: 7025050, objectHeightMetres: 9 },
    ],
  });
  assert.deepEqual(first.records.map(record => record.id), [treeId(GROUND, 1), treeId(GROUND, 2), treeId(GROUND, 3)]);
  assert.equal(first.records[0].easting, 697050, 'ids are handed out west to east');
  assert.deepEqual(first.added.length, 3);
  assert.deepEqual(first.missing, []);
  assert.equal(parseTreeId(first.records[2].id).sequence, 3);

  /* a rebuild that shifts every tree 0.3 m, loses one and finds one */
  const second = assignStableIds({
    groundId: GROUND,
    previous: first.records,
    candidates: [
      { easting: 697100.3, northing: 7025100.1, objectHeightMetres: 20.4 },
      { easting: 697050.2, northing: 7025119.8, objectHeightMetres: 15.1 },
      { easting: 697400, northing: 7025100, objectHeightMetres: 12 },
    ],
  });
  const byPosition = Object.fromEntries(second.records.map(record => [record.easting, record.id]));
  assert.equal(byPosition[697100.3], first.records.find(r => r.easting === 697100).id);
  assert.equal(byPosition[697050.2], first.records.find(r => r.easting === 697050).id);
  assert.equal(byPosition[697400], treeId(GROUND, 4), 'new trees continue the sequence');
  assert.deepEqual(second.missing, [{ id: treeId(GROUND, 3), status: 'missing-needs-review' }]);
  assert.deepEqual(second.moved, [], 'a 0.3 m shift is not a move');
  assert.equal(second.matched.length, 2);

  /* a 20 m tree and a 5 m sapling at the same spot are not the same tree */
  const swapped = assignStableIds({
    groundId: GROUND,
    previous: first.records,
    candidates: [{ easting: 697100, northing: 7025100, objectHeightMetres: 5 }],
  });
  assert.equal(swapped.matched.length, 0);
  assert.equal(swapped.records[0].id, treeId(GROUND, 4));
  assert.throws(() => assignStableIds({ groundId: GROUND, previous: [{ id: 'tree-angso-000001', easting: 0, northing: 0 }], candidates: [] }), /does not belong/);
});

test('the registry diff lists added, kept, moved, removed and changed', () => {
  const before = [
    { id: 'tree-puttom-000001', easting: 1, northing: 1, objectHeightMetres: 10, radiusMetres: 2, confidence: 0.8 },
    { id: 'tree-puttom-000002', easting: 5, northing: 5, objectHeightMetres: 12, radiusMetres: 2, confidence: 0.8 },
  ];
  const after = [
    { id: 'tree-puttom-000001', easting: 1.2, northing: 1, objectHeightMetres: 11, radiusMetres: 2, confidence: 0.8 },
    { id: 'tree-puttom-000003', easting: 9, northing: 9, objectHeightMetres: 8, radiusMetres: 1, confidence: 0.7 },
  ];
  const diff = registryDiff(before, after);
  assert.deepEqual(diff.added, ['tree-puttom-000003']);
  assert.deepEqual(diff.removed, ['tree-puttom-000002']);
  assert.deepEqual(diff.kept, ['tree-puttom-000001']);
  assert.deepEqual(diff.moved, []);
  assert.deepEqual(diff.changed, [{ id: 'tree-puttom-000001', field: 'objectHeightMetres', before: 10, after: 11 }]);
});

test('records are built with the accuracy floors, a deterministic heading and validate strictly', () => {
  const record = treeRecord({
    id: treeId(GROUND, 7),
    groundId: GROUND,
    candidate: candidate(697100.123456, 7025100.5, 21.3456, 3.21),
    baseHeightRH2000: 44.7,
    sourceId: 'laser-lm-skog-26f015',
    capturedAt: '2026-06-11',
    truthZone: 'A',
    confidence: 0.83,
    horizontalAccuracyMetres: 0.3,
    verticalAccuracyMetres: 0.1,
  });
  assert.equal(record.horizontalAccuracyMetres, 1.5, 'the floor wins over a copied source accuracy');
  assert.equal(record.verticalAccuracyMetres, 1.5);
  assert.equal(record.easting, 697100.123);
  assert.equal(record.headingDegrees, headingFromId(record.id));
  assert.ok(record.headingDegrees >= 0 && record.headingDegrees < 360);
  assert.equal(record.subtype, null);
  assert.deepEqual(validateObjectRegistry({ schemaVersion: 1, groundId: GROUND, tileId: 'l0/0/0', records: [record] }), []);
  assert.throws(() => treeRecord({ id: 'x', groundId: GROUND, candidate: candidate(1, 1, 1, 1), baseHeightRH2000: Number.NaN, sourceId: 's', capturedAt: '2026-01-01', truthZone: 'A', confidence: 1 }), /published DTM/);
});

test('records are assigned to the finest tile that contains them; outsiders are named', () => {
  const records = [
    { id: 'a', easting: 697100, northing: 7025100 },
    { id: 'b', easting: 697256, northing: 7025100 },
    { id: 'c', easting: 697600, northing: 7025100 },
  ];
  const { byTile, outside } = assignRecordsToTiles(records, TILES);
  assert.deepEqual(byTile.get('l0/0/0').map(r => r.id), ['a']);
  assert.deepEqual(byTile.get('l0/1/0').map(r => r.id), ['b'], 'a point on the shared edge goes to the tile whose minimum it equals');
  assert.deepEqual(outside, ['c']);
});

test('compiled chunks round-trip through the loader and refuse an unreviewed zone-A record', () => {
  const make = (sequence, easting, zone, extra = {}) => treeRecord({
    id: treeId(GROUND, sequence),
    groundId: GROUND,
    candidate: candidate(easting, 7025100, 14, 2.5),
    baseHeightRH2000: 40 + sequence,
    sourceId: 'laser-lm-skog-23f028',
    capturedAt: '2023-06-07',
    truthZone: zone,
    confidence: 0.7,
    ...extra,
  });
  const compiled = compileObjectChunks({
    groundId: GROUND,
    tiles: TILES,
    records: [make(2, 697300, 'B'), make(1, 697100, 'A'), make(3, 697110, 'A')],
  });
  assert.equal(compiled.chunks.length, 2);
  const summary = objectCompilationSummary(compiled);
  assert.equal(summary.records, 3);
  assert.equal(summary.tiles, 2);
  const first = compiled.chunks.find(chunk => chunk.tileId === 'l0/0/0');
  assert.equal(first.reference.kind, 'objects');
  assert.match(first.reference.url, /^grounds\/puttom\/objects\/[a-f0-9]{64}\.bvch$/);
  const decoded = readChunk(first.bytes);
  assert.equal(decoded.header.kind, 'objects');
  assert.equal(decoded.inspection.recordCount, 2);
  assert.deepEqual(decoded.inspection.byTruthZone, { A: 2, B: 0, C: 0 });
  assert.deepEqual(decoded.content.records.map(record => record.id), [treeId(GROUND, 1), treeId(GROUND, 3)]);
  assert.deepEqual(decoded.header.bounds, TILES[0].bounds, 'the chunk carries its tile\'s bounds, height range included');
  /* a base height the tile cannot hold is refused */
  assert.throws(() => compileObjectChunks({ groundId: GROUND, tiles: TILES, records: [make(90, 697100, 'B')] }), /outside the declared chunk bounds/);
  assert.equal(compiled.layers.get('l0/1/0').sha256, compiled.chunks.find(chunk => chunk.tileId === 'l0/1/0').reference.sha256);

  /* byte-identical on a second compile */
  const again = compileObjectChunks({ groundId: GROUND, tiles: TILES, records: [make(2, 697300, 'B'), make(1, 697100, 'A'), make(3, 697110, 'A')] });
  assert.deepEqual(again.chunks.map(chunk => chunk.reference.sha256), compiled.chunks.map(chunk => chunk.reference.sha256));

  assert.throws(() => compileObjectChunks({
    groundId: GROUND, tiles: TILES,
    records: [make(1, 697100, 'A', { placementMethod: 'source-constrained-procedural' })],
  }), /may not be procedurally placed/);
  assert.throws(() => compileObjectChunks({
    groundId: GROUND, tiles: TILES,
    records: [make(1, 697100, 'A', { reviewStatus: 'pending' })],
  }), /must be approved/);
  assert.throws(() => compileObjectChunks({ groundId: GROUND, tiles: TILES, records: [make(1, 699999, 'A')] }), /outside every finest tile/);
});

test('stand fields aggregate canopy fraction and heights per campaign', () => {
  const width = 16;
  const height = 8;
  const raster = createRaster({ width, height, sampleSpacingMetres: 1, originEasting: 697000, originNorthing: 7025004, fill: 0 });
  /* west half closed 12 m canopy, east half open ground, one void */
  for (let row = 0; row < height; row++) for (let column = 0; column < 8; column++) raster.values[row * width + column] = 12 + (row % 2);
  raster.values[3 * width + 10] = Number.NaN;
  const ownership = new Uint8Array(width * height);
  for (let row = 0; row < 4; row++) for (let column = 0; column < width; column++) ownership[row * width + column] = 1;
  const field = standField(raster, { voids: voidMask(raster), ownership, cellMetres: 8 });
  assert.equal(field.columns, 2);
  assert.equal(field.rows, 1);
  assert.equal(field.cellMetres, 8);
  assert.equal(field.canopyFraction[0], 1);
  assert.equal(field.canopyFraction[1], 0);
  assert.ok(Math.abs(field.meanHeight[0] - 12.5) < 1e-6);
  assert.ok(Number.isNaN(field.meanHeight[1]));
  assert.equal(field.mixed[0], 1, 'both campaigns inside the cell');
  assert.equal(field.campaign[0], 1, 'ties go north');
  assert.ok(field.measuredFraction[1] < 1 && field.measuredFraction[1] > 0.98);
  const summary = standFieldSummary(field);
  assert.equal(summary.closedCanopyCells, 1);
  assert.equal(summary.mixedCells, 2);
  assert.throws(() => standField(raster, { voids: new Uint8Array(3) }), /must match/);
});
