/* Bounded reads of a Laserdata Skog COPC item in Node, over authenticated
   range requests, decoded with laz-perf through the copc package.

   Node selection follows the item's OWN subdivision (copc-nodes.mjs), and
   every decoded node is held to the hierarchy's point count exactly -- the
   equivalence gate the plan asks for, at the granularity where it can be
   exact. Points are then filtered by their real coordinates. The getter
   carries the caller's headers; nothing here knows a credential.            */
import { Copc } from 'copc';
import { parseCopcInfoVlr, parseHierarchyPage, parseLasHeader } from '../acquisition/copc-hierarchy-census.mjs';
import { nodeKey, nodesForWindow, safeCopcUrl } from './copc-nodes.mjs';

export { createNodeCache, nodeFootprint, nodeKey, nodesForWindow, safeCopcUrl } from './copc-nodes.mjs';

const LAS_HEADER_BYTES = 375;
const COPC_VLR_BYTES = 54 + 160;

/** Open an item: header, COPC info, the complete hierarchy, and a decoder. */
export async function openItem({ url, headers = {}, fetchImpl = globalThis.fetch, timeoutMs = 180_000, maxPages = 512 }) {
  const safe = safeCopcUrl(url);
  const transfer = { requests: 0, bytes: 0 };
  const range = async (offset, length) => {
    const response = await fetchImpl(safe.href, {
      headers: { ...headers, Range: `bytes=${offset}-${offset + length - 1}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status !== 206) throw new Error(`range request returned HTTP ${response.status}${response.status === 401 || response.status === 403 ? ' (denied)' : ''}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length !== length) throw new Error(`range returned ${buffer.length} of ${length} bytes at ${offset}`);
    transfer.requests++;
    transfer.bytes += buffer.length;
    return buffer;
  };
  const header = parseLasHeader(await range(0, LAS_HEADER_BYTES));
  const info = parseCopcInfoVlr(await range(LAS_HEADER_BYTES, COPC_VLR_BYTES));
  const entries = [];
  const pending = [{ offset: info.rootHierarchyOffset, size: info.rootHierarchySize }];
  const seen = new Set();
  let pages = 0;
  while (pending.length) {
    if (pages >= maxPages) throw new Error(`hierarchy exceeded ${maxPages} pages`);
    const page = pending.shift();
    const key = `${page.offset}:${page.size}`;
    if (seen.has(key)) throw new Error(`hierarchy page ${key} referenced twice`);
    seen.add(key);
    for (const entry of parseHierarchyPage(await range(page.offset, page.size))) {
      if (entry.pointCount === -1) pending.push({ offset: entry.offset, size: entry.byteSize });
      else if (entry.pointCount > 0) entries.push(entry);
    }
    pages++;
  }
  const total = entries.reduce((sum, entry) => sum + entry.pointCount, 0);
  if (total !== header.pointCount) throw new Error(`hierarchy sums to ${total} points; header declares ${header.pointCount}`);
  const getter = async (begin, end) => new Uint8Array(await range(begin, end - begin));
  const copc = await Copc.create(getter);
  return Object.freeze({
    url: safe.href,
    header,
    info,
    dataBounds: Object.freeze([header.min[0], header.min[1], header.max[0], header.max[1]]),
    entries: Object.freeze(entries),
    hierarchyPages: pages,
    getter,
    copc,
    transfer,
  });
}

/** Decode one node; the point count must equal the hierarchy's, exactly. */
export async function decodeNode(item, entry, cache = null) {
  const key = nodeKey(entry);
  const cached = cache?.get(key);
  if (cached) return cached;
  const view = await Copc.loadPointDataView(item.getter, item.copc, {
    pointCount: entry.pointCount,
    pointDataOffset: entry.offset,
    pointDataLength: entry.byteSize,
  });
  if (view.pointCount !== entry.pointCount) {
    throw new Error(`node ${key} decoded ${view.pointCount} points; the hierarchy declares ${entry.pointCount}`);
  }
  const count = view.pointCount;
  const getX = view.getter('X'), getY = view.getter('Y'), getZ = view.getter('Z');
  const getClass = view.getter('Classification'), getReturn = view.getter('ReturnNumber');
  const getReturns = view.getter('NumberOfReturns'), getIntensity = view.getter('Intensity');
  const decoded = {
    key,
    count,
    x: new Float64Array(count),
    y: new Float64Array(count),
    z: new Float32Array(count),
    classification: new Uint8Array(count),
    returnNumber: new Uint8Array(count),
    numberOfReturns: new Uint8Array(count),
    intensity: new Uint16Array(count),
  };
  for (let i = 0; i < count; i++) {
    decoded.x[i] = getX(i);
    decoded.y[i] = getY(i);
    decoded.z[i] = getZ(i);
    decoded.classification[i] = getClass(i);
    decoded.returnNumber[i] = getReturn(i);
    decoded.numberOfReturns[i] = getReturns(i);
    decoded.intensity[i] = getIntensity(i);
  }
  cache?.set(key, decoded);
  return decoded;
}

/** Every point inside the window, from every node that can hold one. */
export async function readWindow(item, bbox, { cache = null, padMetres = 2 } = {}) {
  const entries = nodesForWindow(item.dataBounds, item.entries, bbox, { padMetres });
  const parts = [];
  let decoded = 0;
  let inWindow = 0;
  for (const entry of entries) {
    const node = await decodeNode(item, entry, cache);
    decoded += node.count;
    const keep = [];
    for (let i = 0; i < node.count; i++) {
      const x = node.x[i];
      const y = node.y[i];
      if (x >= bbox[0] && x < bbox[2] && y >= bbox[1] && y < bbox[3]) keep.push(i);
    }
    if (keep.length) parts.push({ node, keep });
    inWindow += keep.length;
  }
  const out = {
    count: inWindow,
    x: new Float64Array(inWindow),
    y: new Float64Array(inWindow),
    z: new Float32Array(inWindow),
    classification: new Uint8Array(inWindow),
    returnNumber: new Uint8Array(inWindow),
    numberOfReturns: new Uint8Array(inWindow),
    intensity: new Uint16Array(inWindow),
  };
  let o = 0;
  const byClass = {};
  let firstReturns = 0;
  for (const { node, keep } of parts) {
    for (const i of keep) {
      out.x[o] = node.x[i];
      out.y[o] = node.y[i];
      out.z[o] = node.z[i];
      out.classification[o] = node.classification[i];
      out.returnNumber[o] = node.returnNumber[i];
      out.numberOfReturns[o] = node.numberOfReturns[i];
      out.intensity[o] = node.intensity[i];
      byClass[node.classification[i]] = (byClass[node.classification[i]] || 0) + 1;
      if (node.returnNumber[i] === 1) firstReturns++;
      o++;
    }
  }
  return Object.freeze({
    points: out,
    statistics: Object.freeze({
      nodes: entries.length,
      decodedPoints: decoded,
      pointsInWindow: inWindow,
      firstReturns,
      byClass,
      nodeCountsExact: true,
    }),
  });
}
