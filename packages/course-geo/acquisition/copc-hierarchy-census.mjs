/* A census of a COPC file's octree hierarchy, taken over range requests.

   Reads the LAS 1.4 header, the COPC info VLR and the hierarchy pages — about
   200 KB per Puttom item — and sums per-node point counts over census
   windows. No point byte is decoded, so the census cannot be wrong about the
   data the way a reader can: it is what every later bounded read is held to
   (within 1%), and it turns "the reader under-read" from an inference into a
   number. Only aggregates leave this module; the caller supplies the
   authenticated range function and keeps its credentials to itself.          */

const LAS_HEADER_BYTES = 375;
const VLR_HEADER_BYTES = 54;
const COPC_INFO_BYTES = 160;
const HIERARCHY_ENTRY_BYTES = 32;
export const DEFAULT_MAX_PAGES = 512;

function finiteBbox(value, label) {
  if (!Array.isArray(value) || value.length !== 4 || value.some(item => !Number.isFinite(item)) ||
      value[0] >= value[2] || value[1] >= value[3]) {
    throw new TypeError(`${label} must be a finite non-empty [minX, minY, maxX, maxY] bbox`);
  }
  return value;
}

function round(value, decimals = 3) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function asBuffer(value, label) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError(`${label} must be a Buffer or Uint8Array`);
}

export function parseLasHeader(input) {
  const b = asBuffer(input, 'LAS header');
  if (b.length < LAS_HEADER_BYTES) throw new Error(`LAS header needs ${LAS_HEADER_BYTES} bytes, got ${b.length}`);
  if (b.toString('latin1', 0, 4) !== 'LASF') throw new Error('not a LAS file: missing LASF signature');
  const major = b[24];
  const minor = b[25];
  if (major !== 1 || minor !== 4) throw new Error(`COPC requires LAS 1.4, found ${major}.${minor}`);
  const headerSize = b.readUInt16LE(94);
  if (headerSize !== LAS_HEADER_BYTES) throw new Error(`LAS 1.4 header size must be ${LAS_HEADER_BYTES}, found ${headerSize}`);
  const pointFormat = b[104] & 0x3f;
  if (pointFormat < 6 || pointFormat > 8) throw new Error(`COPC requires point record format 6-8, found ${pointFormat}`);
  return Object.freeze({
    version: `${major}.${minor}`,
    headerSize,
    pointDataOffset: b.readUInt32LE(96),
    vlrCount: b.readUInt32LE(100),
    pointFormat,
    pointLength: b.readUInt16LE(105),
    scale: Object.freeze([b.readDoubleLE(131), b.readDoubleLE(139), b.readDoubleLE(147)]),
    offset: Object.freeze([b.readDoubleLE(155), b.readDoubleLE(163), b.readDoubleLE(171)]),
    max: Object.freeze([b.readDoubleLE(179), b.readDoubleLE(195), b.readDoubleLE(211)]),
    min: Object.freeze([b.readDoubleLE(187), b.readDoubleLE(203), b.readDoubleLE(219)]),
    evlrCount: b.readUInt32LE(243),
    pointCount: Number(b.readBigUInt64LE(247)),
  });
}

/** The COPC info VLR is required to be the first VLR, immediately after the header. */
export function parseCopcInfoVlr(input) {
  const b = asBuffer(input, 'COPC info VLR');
  if (b.length < VLR_HEADER_BYTES + COPC_INFO_BYTES) {
    throw new Error(`COPC info VLR needs ${VLR_HEADER_BYTES + COPC_INFO_BYTES} bytes, got ${b.length}`);
  }
  const userId = b.toString('latin1', 2, 18).replace(/\0.*$/, '');
  const recordId = b.readUInt16LE(18);
  const recordLength = b.readUInt16LE(20);
  if (userId !== 'copc' || recordId !== 1 || recordLength !== COPC_INFO_BYTES) {
    throw new Error(`first VLR is not the COPC info record (user ${JSON.stringify(userId)}, id ${recordId}, length ${recordLength})`);
  }
  const p = VLR_HEADER_BYTES;
  const halfSize = b.readDoubleLE(p + 24);
  const spacing = b.readDoubleLE(p + 32);
  if (!(halfSize > 0) || !(spacing > 0)) throw new Error('COPC info carries a non-positive half-size or spacing');
  return Object.freeze({
    center: Object.freeze([b.readDoubleLE(p), b.readDoubleLE(p + 8), b.readDoubleLE(p + 16)]),
    halfSize,
    spacing,
    rootHierarchyOffset: Number(b.readBigUInt64LE(p + 40)),
    rootHierarchySize: Number(b.readBigUInt64LE(p + 48)),
    gpsTimeMinimum: b.readDoubleLE(p + 56),
    gpsTimeMaximum: b.readDoubleLE(p + 64),
  });
}

export function parseHierarchyPage(input) {
  const b = asBuffer(input, 'hierarchy page');
  if (b.length % HIERARCHY_ENTRY_BYTES !== 0) {
    throw new Error(`hierarchy page length ${b.length} is not a multiple of ${HIERARCHY_ENTRY_BYTES}`);
  }
  const entries = [];
  for (let o = 0; o < b.length; o += HIERARCHY_ENTRY_BYTES) {
    entries.push(Object.freeze({
      d: b.readInt32LE(o),
      x: b.readInt32LE(o + 4),
      y: b.readInt32LE(o + 8),
      z: b.readInt32LE(o + 12),
      offset: Number(b.readBigUInt64LE(o + 16)),
      byteSize: b.readInt32LE(o + 24),
      pointCount: b.readInt32LE(o + 28),
    }));
  }
  return entries;
}

export function nodeSizeMetres(copcInfo, depth) {
  return (2 * copcInfo.halfSize) / 2 ** depth;
}

/**
 * The node's footprint in the plane; every z slice of a key shares it.
 *
 * The COPC specification subdivides the cube in the info VLR. Lantmäteriet's
 * Untwine-built half-tile items do NOT: each axis is subdivided over the
 * header's data extent (Y over the 5 km half, Z over the point heights), and
 * only X coincides with the cube because the data is 10 km wide. Measured by
 * decoding nodes at every depth of all three Puttom items
 * (copc-reader/verify-octree-convention.mjs): beyond depth 1 the cube rule
 * fits a third of the nodes in Y, the extent rule fits every one in X and Y
 * (Z to 0.01 m boundary rounding). A reader that prunes by the cube reads the
 * wrong ground, which is what the 52-point PDAL window was. So when the
 * header's X/Y bounds are known they are the subdivision origin; the cube is
 * only the fallback when nothing better exists.
 */
export function nodeBounds(copcInfo, node, dataBounds = null) {
  if (dataBounds) {
    const sizeX = (dataBounds[2] - dataBounds[0]) / 2 ** node.d;
    const sizeY = (dataBounds[3] - dataBounds[1]) / 2 ** node.d;
    const minX = dataBounds[0] + node.x * sizeX;
    const minY = dataBounds[1] + node.y * sizeY;
    return [minX, minY, minX + sizeX, minY + sizeY];
  }
  const size = nodeSizeMetres(copcInfo, node.d);
  const minX = copcInfo.center[0] - copcInfo.halfSize + node.x * size;
  const minY = copcInfo.center[1] - copcInfo.halfSize + node.y * size;
  return [minX, minY, minX + size, minY + size];
}

function overlapArea(a, b) {
  return Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) *
    Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
}

function area(bbox) {
  return (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
}

function clipBounds(bounds, clip) {
  if (!clip) return bounds;
  const out = [Math.max(bounds[0], clip[0]), Math.max(bounds[1], clip[1]), Math.min(bounds[2], clip[2]), Math.min(bounds[3], clip[3])];
  return out[0] < out[2] && out[1] < out[3] ? out : null;
}

/**
 * Points inside each window, estimated as the area-weighted share of every
 * node that touches it. Nodes are cubes, so the share is exact for a node
 * wholly inside the window and proportional for one cut by its edge. The
 * octree cube is larger than the item's data (a 10 km cube around a 10 x 5 km
 * half-tile), so a node's footprint is first clipped to the header's X/Y
 * bounds: the points can only lie there, and without the clip a node
 * straddling the item's edge lends its points to ground the scan never saw
 * -- which is exactly what the seam windows showed before this existed.
 */
export function windowCensus(nodes, copcInfo, window, dataBounds = null) {
  const bbox = finiteBbox(window.bboxEpsg3006, `window ${window.id}`);
  let estimated = 0;
  const byDepth = {};
  let maxDepth = -1;
  const touched = [];
  for (const node of nodes) {
    const bounds = clipBounds(nodeBounds(copcInfo, node, dataBounds), dataBounds);
    if (!bounds) continue;
    const fraction = overlapArea(bounds, bbox) / area(bounds);
    if (fraction <= 0) continue;
    touched.push({ node, fraction, bounds });
    estimated += node.pointCount * fraction;
    byDepth[node.d] = (byDepth[node.d] || 0) + node.pointCount * fraction;
    if (node.d > maxDepth) maxDepth = node.d;
  }
  const deepest = touched.filter(entry => entry.node.d === maxDepth);
  const emptyDeepest = deepest.filter(entry => entry.node.pointCount === 0).length;
  const wholly = touched.filter(entry => entry.fraction >= 1 - 1e-9).length;
  const windowArea = area(bbox);
  return Object.freeze({
    id: window.id,
    bboxEpsg3006: bbox.map(value => round(value, 3)),
    squareMetres: round(windowArea, 1),
    estimatedPoints: Math.round(estimated),
    estimatedAllReturnDensityPerSquareMetre: round(estimated / windowArea, 3),
    pointsByDepth: Object.fromEntries(Object.entries(byDepth).map(([depth, value]) => [depth, Math.round(value)])),
    nodesTouched: touched.length,
    nodesWhollyInside: wholly,
    deepestDepth: maxDepth,
    deepestNodeSizeMetres: maxDepth >= 0
      ? round((dataBounds ? (dataBounds[2] - dataBounds[0]) : 2 * copcInfo.halfSize) / 2 ** maxDepth, 3)
      : null,
    deepestNodesTouched: deepest.length,
    deepestNodesEmpty: emptyDeepest,
  });
}

/**
 * Walk the hierarchy. Sub-pages are followed only where their node touches a
 * census window unless `full` is set, which keeps a windowed census to a
 * handful of requests on a 10 x 10 km item.
 */
export async function hierarchyCensus({ range, windows, full = false, maxPages = DEFAULT_MAX_PAGES }) {
  if (typeof range !== 'function') throw new TypeError('range(offset, length) is required');
  if (!Array.isArray(windows) || windows.length === 0) throw new TypeError('at least one census window is required');
  for (const window of windows) finiteBbox(window.bboxEpsg3006, `window ${window.id}`);
  const started = performance.now();
  let requests = 0;
  let bytes = 0;
  const read = async (offset, length) => {
    const buffer = asBuffer(await range(offset, length), 'range result');
    if (buffer.length !== length) throw new Error(`range returned ${buffer.length} of ${length} bytes at ${offset}`);
    requests++;
    bytes += buffer.length;
    return buffer;
  };
  const header = parseLasHeader(await read(0, LAS_HEADER_BYTES));
  const copcInfo = parseCopcInfoVlr(await read(LAS_HEADER_BYTES, VLR_HEADER_BYTES + COPC_INFO_BYTES));
  const dataBounds = [header.min[0], header.min[1], header.max[0], header.max[1]];
  const touchesWindow = node => {
    const bounds = clipBounds(nodeBounds(copcInfo, node, dataBounds), dataBounds);
    return bounds !== null && windows.some(window => overlapArea(bounds, window.bboxEpsg3006) > 0);
  };
  const nodes = [];
  const pending = [{ offset: copcInfo.rootHierarchyOffset, size: copcInfo.rootHierarchySize }];
  const seenPages = new Set();
  let pagesRead = 0;
  let pagesSkipped = 0;
  while (pending.length) {
    if (pagesRead >= maxPages) throw new Error(`hierarchy census exceeded ${maxPages} pages`);
    const page = pending.shift();
    const key = `${page.offset}:${page.size}`;
    if (seenPages.has(key)) throw new Error(`hierarchy page ${key} is referenced twice`);
    seenPages.add(key);
    if (page.size <= 0 || page.size > 64 * 1024 * 1024) throw new Error(`hierarchy page ${key} has an implausible size`);
    const entries = parseHierarchyPage(await read(page.offset, page.size));
    pagesRead++;
    for (const entry of entries) {
      if (entry.pointCount === -1) {
        if (full || touchesWindow(entry)) pending.push({ offset: entry.offset, size: entry.byteSize });
        else pagesSkipped++;
        continue;
      }
      if (entry.pointCount < 0) throw new Error(`hierarchy entry at depth ${entry.d} has point count ${entry.pointCount}`);
      nodes.push(entry);
    }
  }
  const nodesByDepth = {};
  const pointsByDepth = {};
  let total = 0;
  for (const node of nodes) {
    nodesByDepth[node.d] = (nodesByDepth[node.d] || 0) + 1;
    pointsByDepth[node.d] = (pointsByDepth[node.d] || 0) + node.pointCount;
    total += node.pointCount;
  }
  const complete = pagesSkipped === 0;
  if (complete && total !== header.pointCount) {
    throw new Error(`hierarchy sums to ${total} points but the header declares ${header.pointCount}`);
  }
  return Object.freeze({
    header: {
      version: header.version,
      pointFormat: header.pointFormat,
      pointLength: header.pointLength,
      pointCount: header.pointCount,
      vlrCount: header.vlrCount,
      evlrCount: header.evlrCount,
      min: header.min.map(value => round(value, 3)),
      max: header.max.map(value => round(value, 3)),
      scale: [...header.scale],
    },
    copc: {
      center: copcInfo.center.map(value => round(value, 4)),
      halfSizeMetres: round(copcInfo.halfSize, 4),
      spacingMetres: round(copcInfo.spacing, 6),
      rootHierarchyOffset: copcInfo.rootHierarchyOffset,
      rootHierarchySize: copcInfo.rootHierarchySize,
      gpsTimeMinimum: round(copcInfo.gpsTimeMinimum, 3),
      gpsTimeMaximum: round(copcInfo.gpsTimeMaximum, 3),
    },
    hierarchy: {
      pagesRead,
      pagesSkipped,
      complete,
      nodes: nodes.length,
      nodesByDepth,
      pointsByDepth,
      sumOfNodePoints: total,
      matchesHeader: complete ? total === header.pointCount : null,
    },
    dataBounds,
    windows: windows.map(window => windowCensus(nodes, copcInfo, window, dataBounds)),
    transfer: { requests, bytes, elapsedMilliseconds: round(performance.now() - started, 1) },
  });
}

/** An HTTP range reader over fetch; the caller supplies the headers, so the secret never enters this module. */
export function httpRangeReader(url, { fetchImpl = globalThis.fetch, headers = {}, timeoutMs = 120_000 } = {}) {
  return async function range(offset, length) {
    const response = await fetchImpl(url, {
      headers: { ...headers, Range: `bytes=${offset}-${offset + length - 1}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status !== 206) {
      throw new Error(`range request returned HTTP ${response.status}${response.status === 401 || response.status === 403 ? ' (denied)' : ''}`);
    }
    return Buffer.from(await response.arrayBuffer());
  };
}
