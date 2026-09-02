import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hierarchyCensus,
  httpRangeReader,
  nodeBounds,
  parseCopcInfoVlr,
  parseHierarchyPage,
  parseLasHeader,
  windowCensus,
} from './copc-hierarchy-census.mjs';

/* exact binary values, so node bounds and window overlaps carry no rounding
   and the expected shares below are exact */
const CENTER = [700000, 7000000, 100];
const HALF = 4096;

function lasHeader({ pointCount, pointFormat = 6, major = 1, minor = 4, headerSize = 375 } = {}) {
  const b = Buffer.alloc(375);
  b.write('LASF', 0, 'latin1');
  b[24] = major;
  b[25] = minor;
  b.writeUInt16LE(headerSize, 94);
  b.writeUInt32LE(1000, 96);
  b.writeUInt32LE(3, 100);
  b[104] = pointFormat;
  b.writeUInt16LE(30, 105);
  b.writeDoubleLE(0.01, 131); b.writeDoubleLE(0.01, 139); b.writeDoubleLE(0.01, 147);
  b.writeDoubleLE(535000, 155); b.writeDoubleLE(6715000, 163); b.writeDoubleLE(0, 171);
  /* the data fills the whole synthetic cube, so clipping to the header is a no-op here */
  b.writeDoubleLE(CENTER[0] + HALF, 179); b.writeDoubleLE(CENTER[0] - HALF, 187);
  b.writeDoubleLE(CENTER[1] + HALF, 195); b.writeDoubleLE(CENTER[1] - HALF, 203);
  b.writeDoubleLE(165.71, 211); b.writeDoubleLE(0.04, 219);
  b.writeBigUInt64LE(BigInt(pointCount), 247);
  return b;
}

function copcVlr({ rootOffset, rootSize, userId = 'copc', recordId = 1, length = 160 } = {}) {
  const b = Buffer.alloc(54 + 160);
  b.write(userId, 2, 'latin1');
  b.writeUInt16LE(recordId, 18);
  b.writeUInt16LE(length, 20);
  const p = 54;
  b.writeDoubleLE(CENTER[0], p); b.writeDoubleLE(CENTER[1], p + 8); b.writeDoubleLE(CENTER[2], p + 16);
  b.writeDoubleLE(HALF, p + 24);
  b.writeDoubleLE(78.125, p + 32);
  b.writeBigUInt64LE(BigInt(rootOffset), p + 40);
  b.writeBigUInt64LE(BigInt(rootSize), p + 48);
  b.writeDoubleLE(1, p + 56); b.writeDoubleLE(2, p + 64);
  return b;
}

function page(entries) {
  const b = Buffer.alloc(entries.length * 32);
  entries.forEach((entry, index) => {
    const o = index * 32;
    b.writeInt32LE(entry.d, o); b.writeInt32LE(entry.x, o + 4); b.writeInt32LE(entry.y, o + 8); b.writeInt32LE(entry.z, o + 12);
    b.writeBigUInt64LE(BigInt(entry.offset || 0), o + 16);
    b.writeInt32LE(entry.byteSize || 0, o + 24);
    b.writeInt32LE(entry.pointCount, o + 28);
  });
  return b;
}

/* A file laid out as header | VLR | ... | sub-page | root page. The root holds
   depth 0 and 1 nodes plus a reference to a sub-page holding depth 2 nodes in
   the south-west quadrant only. */
function syntheticFile() {
  const subEntries = [
    { d: 2, x: 0, y: 0, z: 0, pointCount: 40 },
    { d: 2, x: 1, y: 0, z: 0, pointCount: 60 },
    { d: 2, x: 0, y: 1, z: 0, pointCount: 0 },
    { d: 2, x: 1, y: 1, z: 1, pointCount: 100 },
  ];
  const subPage = page(subEntries);
  const subOffset = 2000;
  const rootEntries = [
    { d: 0, x: 0, y: 0, z: 0, pointCount: 8 },
    { d: 1, x: 0, y: 0, z: 0, pointCount: 16 },
    { d: 1, x: 1, y: 0, z: 0, pointCount: 24 },
    { d: 1, x: 0, y: 1, z: 0, pointCount: 32 },
    { d: 1, x: 1, y: 1, z: 0, pointCount: 40 },
    { d: 2, x: 0, y: 0, z: 0, pointCount: -1, offset: subOffset, byteSize: subPage.length },
  ];
  const rootPage = page(rootEntries);
  const rootOffset = 4000;
  const total = 8 + 16 + 24 + 32 + 40 + 40 + 60 + 0 + 100;
  const file = Buffer.alloc(rootOffset + rootPage.length);
  lasHeader({ pointCount: total }).copy(file, 0);
  copcVlr({ rootOffset, rootSize: rootPage.length }).copy(file, 375);
  subPage.copy(file, subOffset);
  rootPage.copy(file, rootOffset);
  return { file, total };
}

const range = file => async (offset, length) => file.subarray(offset, offset + length);

test('LAS header and COPC info VLR parse and refuse the wrong things', () => {
  const header = parseLasHeader(lasHeader({ pointCount: 123 }));
  assert.equal(header.pointCount, 123);
  assert.equal(header.pointFormat, 6);
  assert.equal(header.min[0], CENTER[0] - HALF);
  assert.throws(() => parseLasHeader(Buffer.alloc(375)), /LASF/);
  assert.throws(() => parseLasHeader(lasHeader({ pointCount: 1, minor: 2 })), /LAS 1.4/);
  assert.throws(() => parseLasHeader(lasHeader({ pointCount: 1, pointFormat: 3 })), /format 6-8/);
  const info = parseCopcInfoVlr(copcVlr({ rootOffset: 10, rootSize: 32 }));
  assert.equal(info.halfSize, HALF);
  assert.equal(info.rootHierarchyOffset, 10);
  assert.throws(() => parseCopcInfoVlr(copcVlr({ rootOffset: 10, rootSize: 32, userId: 'lasf' })), /not the COPC info/);
  assert.throws(() => parseHierarchyPage(Buffer.alloc(33)), /multiple of 32/);
});

test('node bounds follow the header extent per axis when known, and the cube otherwise', () => {
  const info = parseCopcInfoVlr(copcVlr({ rootOffset: 10, rootSize: 32 }));
  assert.deepEqual(nodeBounds(info, { d: 0, x: 0, y: 0 }), [CENTER[0] - HALF, CENTER[1] - HALF, CENTER[0] + HALF, CENTER[1] + HALF]);
  const d1 = nodeBounds(info, { d: 1, x: 1, y: 0 });
  assert.equal(d1[0], CENTER[0]);
  assert.equal(d1[2] - d1[0], HALF);
  /* a half-tile item: the data fills the southern half of the cube in Y, and
     the keys subdivide THAT, so depth-1 y=1 is the upper half of the data */
  const half = [CENTER[0] - HALF, CENTER[1] - HALF, CENTER[0] + HALF, CENTER[1]];
  const extentNode = nodeBounds(info, { d: 1, x: 1, y: 1 }, half);
  assert.deepEqual(extentNode, [CENTER[0], CENTER[1] - HALF / 2, CENTER[0] + HALF, CENTER[1]]);
  assert.equal(extentNode[3] - extentNode[1], HALF / 2, 'nodes are rectangular under the extent rule');
});

test('a windowed census descends only the pages its windows touch, and a full one reproduces the header', async () => {
  const { file, total } = syntheticFile();
  /* the two windows are the south-west and north-east depth-1 quadrants of the cube */
  const southWest = { id: 'sw', bboxEpsg3006: [CENTER[0] - HALF, CENTER[1] - HALF, CENTER[0], CENTER[1]] };
  const northEast = { id: 'ne', bboxEpsg3006: [CENTER[0], CENTER[1], CENTER[0] + HALF, CENTER[1] + HALF] };

  const windowed = await hierarchyCensus({ range: range(file), windows: [northEast] });
  assert.equal(windowed.hierarchy.pagesRead, 1);
  assert.equal(windowed.hierarchy.pagesSkipped, 1);
  assert.equal(windowed.hierarchy.complete, false);
  assert.equal(windowed.hierarchy.matchesHeader, null);
  const ne = windowed.windows[0];
  /* a quarter of the root node plus the whole north-east depth-1 node; the
     sub-page only tiles the south-west quadrant and was rightly skipped */
  assert.equal(ne.estimatedPoints, 8 / 4 + 40);
  assert.equal(ne.deepestDepth, 1);
  assert.equal(ne.nodesWhollyInside, 1);
  assert.deepEqual(ne.pointsByDepth, { 0: 2, 1: 40 });

  const complete = await hierarchyCensus({ range: range(file), windows: [southWest, northEast], full: true });
  assert.equal(complete.hierarchy.pagesRead, 2);
  assert.equal(complete.hierarchy.complete, true);
  assert.equal(complete.hierarchy.sumOfNodePoints, total);
  assert.equal(complete.hierarchy.matchesHeader, true);
  assert.deepEqual(complete.hierarchy.nodesByDepth, { 0: 1, 1: 4, 2: 4 });
  const sw = complete.windows.find(window => window.id === 'sw');
  /* a quarter of the root, the whole depth-1 south-west node, and the four
     depth-2 nodes that tile exactly that quadrant */
  assert.equal(sw.estimatedPoints, 8 / 4 + 16 + 40 + 60 + 0 + 100);
  assert.equal(sw.deepestDepth, 2);
  assert.equal(sw.deepestNodeSizeMetres, HALF / 2);
  assert.equal(sw.deepestNodesTouched, 4);
  assert.equal(sw.deepestNodesEmpty, 1);
  assert.equal(sw.nodesWhollyInside, 5);
  assert.equal(complete.transfer.requests, 4);
});

test('the census refuses a hierarchy that disagrees with its header', async () => {
  const { file } = syntheticFile();
  const wrong = Buffer.from(file);
  wrong.writeBigUInt64LE(1n, 247);
  const windows = [{ id: 'all', bboxEpsg3006: [CENTER[0] - HALF, CENTER[1] - HALF, CENTER[0] + HALF, CENTER[1] + HALF] }];
  await assert.rejects(hierarchyCensus({ range: range(wrong), windows, full: true }), /declares 1/);
  await assert.rejects(hierarchyCensus({ range: async () => Buffer.alloc(10), windows }), /range returned 10 of 375/);
});

test('the range reader passes headers through and reports denials without echoing them', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { status: calls.length === 1 ? 206 : 401, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  };
  const reader = httpRangeReader('https://dl1.lantmateriet.se/x.copc.laz', { fetchImpl, headers: { Authorization: 'Basic secret' } });
  const bytes = await reader(10, 3);
  assert.equal(bytes.length, 3);
  assert.equal(calls[0].init.headers.Range, 'bytes=10-12');
  assert.equal(calls[0].init.headers.Authorization, 'Basic secret');
  await assert.rejects(reader(0, 1), error => /HTTP 401 \(denied\)/.test(error.message) && !/secret/.test(error.message));
});

test('windowCensus weights cut nodes by area, clipped to the data extent', () => {
  const info = parseCopcInfoVlr(copcVlr({ rootOffset: 10, rootSize: 32 }));
  const nodes = [{ d: 0, x: 0, y: 0, z: 0, pointCount: 1000 }];
  const half = { id: 'half', bboxEpsg3006: [CENTER[0] - HALF, CENTER[1] - HALF, CENTER[0], CENTER[1] + HALF] };
  const census = windowCensus(nodes, info, half);
  assert.equal(census.estimatedPoints, 500);
  assert.equal(census.estimatedAllReturnDensityPerSquareMetre, Math.round(500 / (HALF * 2 * HALF) * 1000) / 1000);
  /* the item's data only fills the southern half of the cube: a window over
     the northern half gets nothing, a window over the southern half gets it all */
  const south = [CENTER[0] - HALF, CENTER[1] - HALF, CENTER[0] + HALF, CENTER[1]];
  const northWindow = { id: 'north', bboxEpsg3006: [CENTER[0] - HALF, CENTER[1], CENTER[0] + HALF, CENTER[1] + HALF] };
  const southWindow = { id: 'south', bboxEpsg3006: south };
  assert.equal(windowCensus(nodes, info, northWindow, south).estimatedPoints, 0);
  assert.equal(windowCensus(nodes, info, southWindow, south).estimatedPoints, 1000);
  assert.equal(windowCensus(nodes, info, half, south).estimatedPoints, 500);
});
