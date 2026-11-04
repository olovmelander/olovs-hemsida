/* Streams the published height tiles the view asks for.

   These are the simulator's own content-addressed tiles, verified the same way,
   so a tile is never decoded on trust and the two modes share one HTTP cache.
   Work is spread out on purpose: fetching and inflating are asynchronous, and
   the part that takes the main thread (painting and uploading) is rationed per
   frame, so a hole's tiles arriving never stutters a pan. */
import { verifyChunkAssetWeb } from '../../../../packages/course-v2/runtime/decode-web.mjs';
import { resolveV2AssetUrl } from '../../../../packages/course-v2/runtime/http.mjs';
import { bakeTileRelief, decodeTileHeights, sampleTile } from './map-height.mjs';
import { buildTileTree, TILE_SAMPLES } from './map-lod.mjs';
import { bakeHillShade, shadeKey } from './map-horizon.mjs';
import { raiseHouses } from './map-houses.mjs';
import { plantTile } from './map-trees.mjs';

export const MAP_OFFLINE_CACHE = 'banvy-map-offline-v1';
const MAX_FETCHES = 6;
const UPLOADS_PER_FRAME = 2;
const SHADES_PER_FRAME = 2;
/* At most about 2.7 MB of GPU memory a tile, on a 1 m tile; this keeps the map's
   textures under 130 MB however long the round. */
const MAX_RESIDENT_TILES = 48;

/* The tree pictures are one small download shared by a whole course, and addressed
   by content, so the first visit keeps them: no later visit, and no bad signal, has
   to fetch them again. */
export async function fetchKeptFile(url) {
  const cache = globalThis.caches ? await caches.open(MAP_OFFLINE_CACHE).catch(() => null) : null;
  const held = await cache?.match(url).catch(() => null);
  if (held) return new Uint8Array(await held.arrayBuffer());
  const response = await fetch(url);
  if (!response.ok) throw new Error(`bilddata saknas (${response.status})`);
  const kept = response.clone();
  cache?.put(url, kept).catch(() => {});
  return new Uint8Array(await response.arrayBuffer());
}

/* A house's corner can lie just over its tile's edge; the nearest sample will do. */
const sampleWithin = (node, heights, x, z) => sampleTile(heights, (x - node.x0) / node.size, (z - node.z0) / node.size, TILE_SAMPLES);

export async function fetchTileBytes(url, { signal } = {}) {
  if (globalThis.caches) {
    const held = await (await caches.open(MAP_OFFLINE_CACHE)).match(url).catch(() => null);
    if (held) return new Uint8Array(await held.arrayBuffer());
  }
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`terrängdata saknas (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

export function createTileStore({ ground, baseHref, renderer, painter, rules, structures = [], onChange }) {
  const { nodes, root } = buildTileTree(ground);
  const datum = ground.frame.origin.heightRH2000;
  const pending = new Map();      /* wanted, by node id, this view's order */
  const uploads = [];             /* decoded and waiting for their turn */
  let active = 0, clock = 0, disposed = false, bytesFetched = 0, failures = 0;

  const isReady = node => node.state === 'ready';
  const fileUrl = file => resolveV2AssetUrl(file.url, baseHref);

  /* The vegetation on a 1 m tile is an extra, a few kilobytes: if it fails the
     tile is still the right ground. */
  async function loadVegetation(node, heights) {
    const read = async reference => {
      if (!reference) return null;
      const bytes = await fetchTileBytes(fileUrl(reference));
      bytesFetched += bytes.byteLength;
      return verifyChunkAssetWeb(reference, bytes);
    };
    try {
      const [stands, objects] = await Promise.all([read(node.layers.stands), read(node.layers.objects)]);
      const stand = stands && { payload: stands.payload, section: stands.header.standField };
      node.stand = stand;
      node.trees = plantTile({ node, heights, stand, objects: objects?.content?.records, ground, rules });
    } catch (error) {
      node.stand = null;
      node.trees = null;
      console.warn(`map vegetation ${node.id}: ${error.message}`);
    }
  }

  async function loadTile(node) {
    node.state = 'loading';
    try {
      const bytes = await fetchTileBytes(fileUrl(node.layers.terrain));
      bytesFetched += bytes.byteLength;
      const { header, payload } = await verifyChunkAssetWeb(node.layers.terrain, bytes);
      const decoded = decodeTileHeights(payload, header.grid, datum);
      if (disposed) return;
      node.decoded = decoded;
      node.minHeight = decoded.min;
      node.maxHeight = decoded.max;
      node.relief = bakeTileRelief(decoded.heights, decoded.width, decoded.height, node.spacing);
      if (node.lod === 0) {
        await loadVegetation(node, decoded.heights);
        const inside = structures.filter(({ ring }) => {
          const [x, z] = ring[0];
          return x >= node.x0 && x < node.x0 + node.size && z >= node.z0 && z < node.z0 + node.size;
        });
        node.houses = inside.length ? raiseHouses(inside, (x, z) => sampleWithin(node, decoded.heights, x, z)) : null;
      }
      if (disposed) return;
      uploads.push(node);
    } catch (error) {
      failures++;
      node.state = 'failed';
      console.warn(`map tile ${node.id}: ${error.message}`);
    } finally {
      active--;
      pump();
      onChange();
    }
  }

  function pump() {
    while (active < MAX_FETCHES && pending.size) {
      const [id, node] = pending.entries().next().value;
      pending.delete(id);
      if (node.state) continue;
      active++;
      loadTile(node);
    }
  }

  function evict(keep) {
    const resident = [...nodes.values()].filter(node => node.state === 'ready' && node.lod < 4 && !keep.has(node));
    const excess = resident.length + keep.size - MAX_RESIDENT_TILES;
    if (excess <= 0) return;
    resident.sort((a, b) => a.used - b.used);
    for (const node of resident.slice(0, excess)) {
      renderer.releaseTile(node);
      node.decoded = null;
      node.relief = null;
      node.stand = null;
      node.trees = null;
      node.houses = null;
      node.shadeKey = null;
      node.state = null;
    }
  }

  return {
    nodes,
    root,
    isReady,
    fileUrl,

    /* The view's request replaces the last one: tiles the camera has left are
       dropped before they start, so a fast swipe spends nothing on them. */
    request(wanted) {
      pending.clear();
      for (const { node } of wanted) if (!node.state) pending.set(node.id, node);
      pump();
    },
    prefetch(tileNodes) {
      for (const node of tileNodes) if (!node.state && !pending.has(node.id)) pending.set(node.id, node);
      pump();
    },

    /* Returns how many tiles are still on their way to the screen. */
    drainUploads() {
      for (let i = 0; i < UPLOADS_PER_FRAME && uploads.length; i++) {
        const node = uploads.shift();
        const paint = painter.paint(node);
        renderer.uploadTile(node, node.decoded, node.relief, paint);
        node.relief = null;
        node.stand = null;
        node.state = 'ready';
        node.used = ++clock;
      }
      return uploads.length;
    },

    markUsed(patches) {
      clock++;
      const keep = new Set();
      for (const { node } of patches) {
        node.used = clock;
        for (let at = node; at; at = at.parent) keep.add(at);
      }
      evict(keep);
    },

    /* The height at a point, from the finest tile in memory: a walk down the tree,
       because a hill's shadow asks this thousands of times a tile. */
    heightAt(x, z) {
      let node = root, best = null;
      while (node) {
        const u = (x - node.x0) / node.size, v = (z - node.z0) / node.size;
        if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) break;
        if (node.state === 'ready' && node.decoded) best = node;
        node = node.children[(v >= 0.5 ? 2 : 0) + (u >= 0.5 ? 1 : 0)];
      }
      if (!best) return NaN;
      return sampleTile(best.decoded.heights, (x - best.x0) / best.size, (z - best.z0) / best.size, TILE_SAMPLES);
    },

    /* One or two tiles' hill shadows a frame, the nearest first. Returns how many
       are still waiting, so a low sun fills in without a pause. */
    bakeHillShades(patches, sun, exaggeration, ceiling) {
      const key = shadeKey(sun, exaggeration);
      let baked = 0, waiting = 0;
      const seen = new Set();
      for (const { node } of patches) {
        if (seen.has(node) || node.shadeKey === key) continue;
        seen.add(node);
        if (baked >= SHADES_PER_FRAME) { waiting++; continue; }
        renderer.uploadShade(node, bakeHillShade({ node, sun, heightAt: this.heightAt, exaggeration, ceiling }));
        node.shadeKey = key;
        baked++;
      }
      return waiting;
    },

    stats: () => ({
      resident: [...nodes.values()].filter(isReady).length,
      metreTiles: [...nodes.values()].filter(node => node.lod === 0 && isReady(node)).length,
      bytesFetched,
      failures,
      busy: active + pending.size + uploads.length,
    }),

    /* After a lost context nothing on the GPU survives; decoded heights do, but
       the simplest correct thing is to stream the view again. */
    forgetGpu() {
      pending.clear();
      uploads.length = 0;
      for (const node of nodes.values()) {
        if (node.state === 'ready' || node.state === 'failed') node.state = null;
        node.gpu = null;
        node.shadeKey = null;
      }
    },

    dispose() { disposed = true; pending.clear(); },
  };
}
