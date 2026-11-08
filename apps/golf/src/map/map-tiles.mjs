/* Streams the published height tiles the view asks for.

   These are the simulator's own content-addressed tiles, verified the same way,
   so a tile is never decoded on trust and the two modes share one HTTP cache.
   Work is spread out on purpose: fetching and inflating are asynchronous, and
   the part that takes the main thread (painting and uploading) is rationed per
   frame, so a hole's tiles arriving never stutters a pan. */
import { verifyChunkAssetWeb } from '../../../../packages/course-v2/runtime/decode-web.mjs';
import { resolveV2AssetUrl } from '../../../../packages/course-v2/runtime/http.mjs';
import { bakeTileRelief, decodeTileHeights, sampleTile } from './map-height.mjs';
import { boxInFrustum, buildTileTree, TILE_SAMPLES } from './map-lod.mjs';
import { bakeHillShade, shadeKey } from './map-horizon.mjs';
import { raiseHouses } from './map-houses.mjs';
import { createFarBlocker, createFarSample, farForestCells, FAR_FOREST, pictureSampler, plantFarCell, readForestPicture } from './map-far-forest.mjs';
import { plantTile } from './map-trees.mjs';

export const MAP_OFFLINE_CACHE = 'banvy-map-offline-v1';
const MAX_FETCHES = 6;
const UPLOADS_PER_FRAME = 2;
const SHADES_PER_FRAME = 2;
/* At most about 2.7 MB of GPU memory a tile, on a 1 m tile; this keeps the map's
   textures under 130 MB however long the round. */
const MAX_RESIDENT_TILES = 48;

/* How long a tile that could not be had waits before it is asked for again. */
const RETRY_MS = 15000;
/* The forest beyond the 1 m ground: a tile's trees are about 7 KB against its ground's
   50, so a wide view can keep them without loading the ground under them. */
const FOREST_FETCHES = 3, FOREST_PLANTS_PER_FRAME = 2;
/* A far cell is planted on the main thread from pictures already in memory, about
   half a millisecond a cell here and 2-4 ms with the CPU slowed four times: cells are
   planted until this much of a frame is spent, at least one. A whole ground's far wood is about a million trees,
   32 MB: past this many the cells farthest from the eye give theirs back, and are
   planted again if the view comes back. */
const FAR_PLANTING_MS = 3, FAR_RESIDENT_TREES = 300000;

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

export function createTileStore({ ground, baseHref, renderer, painter, rules, structures = [], farForest = null, onChange }) {
  const { nodes, root } = buildTileTree(ground);
  const datum = ground.frame.origin.heightRH2000;
  const pending = new Map();      /* wanted, by node id, this view's order */
  const uploads = [];             /* decoded and waiting for their turn */
  const forestWanted = new Map(); /* tiles whose trees this view could use */
  const forestPlanting = [];      /* their records in, waiting to be planted */
  const metreTiles = [...nodes.values()].filter(node => node.lod === 0 && node.layers.stands);
  let forestActive = 0;
  let active = 0, clock = 0, disposed = false, bytesFetched = 0, failures = 0;
  /* Past the 1 m tiles, the forest picture's wood (map-far-forest.mjs), once its
     samples are read: until then, and if they cannot be, the painted canopy alone. */
  const templates = rules.catalogue.species;
  const far = farForest?.land?.forestBytes ? farForestCells(root, metreTiles) : { cells: [] };
  const farSample = createFarSample({ templates });
  let farWanted = [], farResident = 0, farEye = [0, 0, 0], farView = 0;
  let forestAt = null, blockerFor = null;
  if (far.cells.length) {
    const { land } = farForest;
    readForestPicture(land.forestBytes).then(picture => {
      if (disposed) return;
      forestAt = pictureSampler({ picture, x0: land.x0, z0: land.z0, spacing: land.spacing });
      blockerFor = createFarBlocker(farForest);
      onChange();
    }).catch(error => console.warn('map far forest:', error.message));
  }
  const releaseFar = cell => {
    if (!cell.forestGpu) return;
    farResident -= cell.forestGpu.count;
    renderer.releaseForest(cell.forestGpu);
    cell.forestGpu = null;
    cell.groundLod = undefined;
  };

  const isReady = node => node.state === 'ready';
  const fileUrl = file => resolveV2AssetUrl(file.url, baseHref);

  const readLayer = async reference => {
    if (!reference) return null;
    const bytes = await fetchTileBytes(fileUrl(reference));
    bytesFetched += bytes.byteLength;
    return verifyChunkAssetWeb(reference, bytes);
  };

  /* The vegetation on a 1 m tile is an extra, a few kilobytes: if it fails the
     tile is still the right ground. */
  async function loadVegetation(node, heights) {
    const read = readLayer;
    try {
      const [stands, objects] = await Promise.all([read(node.layers.stands), read(node.layers.objects)]);
      const stand = stands && { payload: stands.payload, section: stands.header.standField };
      node.stand = stand;
      node.trees = plantTile({ node, heights, stand, objects: objects?.content?.records, ground, rules });
      farSample.add(node, node.trees);
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
      /* Signal comes and goes on a golf course: look for it again shortly. */
      node.state = 'failed';
      node.failedAt = performance.now();
      setTimeout(onChange, RETRY_MS);
      console.warn(`map tile ${node.id}: ${error.message}`);
    } finally {
      active--;
      pump();
      onChange();
    }
  }

  /* Only a tile's trees, on whatever ground is in memory. They stay for the visit:
     a whole ground's are a few megabytes. A wood is a nicety: one that cannot be had
     waits its turn again, as a tile does. */
  async function loadForest(node) {
    node.forest = 'loading';
    try {
      const [stands, objects] = await Promise.all([readLayer(node.layers.stands), readLayer(node.layers.objects)]);
      node.forestRecords = { stand: stands && { payload: stands.payload, section: stands.header.standField }, objects: objects?.content?.records };
      forestPlanting.push(node);
    } catch (error) {
      node.forest = 'failed';
      node.failedAt = performance.now();
      setTimeout(onChange, RETRY_MS);
      console.warn(`map forest ${node.id}: ${error.message}`);
    } finally {
      forestActive--;
      pumpForest();
      onChange();
    }
  }

  function pumpForest() {
    while (forestActive < FOREST_FETCHES && forestWanted.size) {
      const [id, node] = forestWanted.entries().next().value;
      forestWanted.delete(id);
      forestActive++;
      loadForest(node);
    }
  }

  const wanting = node => !node.state || (node.state === 'failed' && performance.now() - node.failedAt >= RETRY_MS);

  function pump() {
    while (active < MAX_FETCHES && pending.size) {
      const [id, node] = pending.entries().next().value;
      pending.delete(id);
      if (!wanting(node)) continue;
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

  function finestAt(x, z) {
    let node = root, best = null;
    while (node) {
      const u = (x - node.x0) / node.size, v = (z - node.z0) / node.size;
      if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) break;
      if (node.state === 'ready' && node.decoded) best = node;
      node = node.children[(v >= 0.5 ? 2 : 0) + (u >= 0.5 ? 1 : 0)];
    }
    return best;
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
      for (const { node } of wanted) if (wanting(node)) pending.set(node.id, node);
      pump();
    },
    prefetch(tileNodes) {
      for (const node of tileNodes) if (wanting(node) && !pending.has(node.id)) pending.set(node.id, node);
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
      for (let i = 0; i < FOREST_PLANTS_PER_FRAME && forestPlanting.length; i++) {
        const node = forestPlanting.shift();
        const { stand, objects } = node.forestRecords;
        const trees = plantTile({ node, stand, objects: objects ?? null, ground, rules, groundAt: this.heightAt });
        node.forestRecords = null;
        farSample.add(node, trees);
        node.forestGpu = trees.length ? renderer.uploadForest(trees) : null;
        node.forest = 'ready';
      }
      const planting = performance.now();
      while (farWanted.length && performance.now() - planting < FAR_PLANTING_MS) {
        const cell = farWanted.shift();
        const trees = plantFarCell({ cell, core: far.core, covered: far.covered, forestAt, blocked: blockerFor(cell), heightAt: this.heightAt, sample: farSample, templates });
        releaseFar(cell);
        cell.forestGpu = trees.length ? renderer.uploadForest(trees) : null;
        cell.groundLod = finestAt(cell.x0 + cell.size / 2, cell.z0 + cell.size / 2)?.lod ?? Infinity;
        farResident += cell.forestGpu?.count ?? 0;
      }
      if (farResident > FAR_RESIDENT_TREES) {
        const away = cell => Math.hypot(cell.x0 + cell.size / 2 - farEye[0], cell.z0 + cell.size / 2 - farEye[2]);
        const spare = far.cells.filter(cell => cell.forestGpu && cell.seen !== farView).sort((a, b) => away(b) - away(a));
        for (const cell of spare) {
          if (farResident <= FAR_RESIDENT_TREES) break;
          releaseFar(cell);
        }
      }
      return uploads.length + forestPlanting.length + farWanted.length;
    },

    /* The forest in view, as far as a tree still reads. Its tiles are asked for nearest
       first, and those a 1 m tile already plants are left to it. */
    forest({ planes, eye, reach, exaggeration }) {
      const standing = [], missing = [];
      for (const node of metreTiles) {
        const away = Math.hypot(node.x0 + node.size / 2 - eye[0], node.z0 + node.size / 2 - eye[2]) - node.size;
        if (away > reach || !boxInFrustum(planes, node.x0, node.minY * exaggeration, node.z0, node.x0 + node.size, node.maxY * exaggeration, node.z0 + node.size)) continue;
        if (node.forestGpu) standing.push({ node, reach: away });
        else if (!node.gpu?.trees && (!node.forest || (node.forest === 'failed' && performance.now() - node.failedAt >= RETRY_MS))) missing.push({ node, away });
      }
      forestWanted.clear();
      for (const { node } of missing.sort((a, b) => a.away - b.away)) forestWanted.set(node.id, node);
      pumpForest();
      /* The far wood waits for enough measured trees to be drawn from, and is planted
         again when finer ground arrives under it, so it stands on what is drawn. */
      const farMissing = [];
      farEye = eye;
      farView++;
      if (forestAt && farSample.count >= FAR_FOREST.minimumSamples) {
        for (const cell of far.cells) {
          const away = Math.max(0, Math.hypot(cell.x0 + cell.size / 2 - eye[0], cell.z0 + cell.size / 2 - eye[2]) - cell.size * 0.71);
          if (away > reach || !boxInFrustum(planes, cell.x0, cell.minY * exaggeration, cell.z0, cell.x0 + cell.size, (cell.maxY + 40) * exaggeration, cell.z0 + cell.size)) continue;
          cell.seen = farView;
          if (cell.forestGpu) standing.push({ node: cell, reach: away });
          const lod = finestAt(cell.x0 + cell.size / 2, cell.z0 + cell.size / 2)?.lod;
          if (lod !== undefined && !(cell.groundLod <= lod)) farMissing.push({ cell, away });
        }
      }
      farWanted = farMissing.sort((a, b) => a.away - b.away).map(({ cell }) => cell);
      if (farWanted.length) onChange();
      return standing;
    },

    /* All the view went through stays, drawn or not, or a tile thrown out as soon as it
       arrives is asked for again, for ever: a still map at full speed, fetching 4 MB a
       second, on a view that needs more tiles than the budget. */
    markUsed({ patches, wanted, visited }) {
      clock++;
      const keep = new Set(visited);
      for (const { node } of patches) {
        node.used = clock;
        for (let at = node; at; at = at.parent) keep.add(at);
      }
      for (const { node } of wanted) {
        for (let at = node; at; at = at.parent) keep.add(at);
      }
      evict(keep);
    },

    /* The height at a point, from the finest tile in memory: a walk down the tree,
       because a hill's shadow asks this thousands of times a tile. */
    heightAt(x, z) {
      const best = finestAt(x, z);
      if (!best) return NaN;
      return sampleTile(best.decoded.heights, (x - best.x0) / best.size, (z - best.z0) / best.size, TILE_SAMPLES);
    },

    /* Whether every point stands on 1 m ground that is in memory yet. */
    onMetreGround: points => points.every(([x, z]) => finestAt(x, z)?.lod === 0),

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
      busy: active + pending.size + uploads.length + forestActive + forestWanted.size + forestPlanting.length + farWanted.length,
      farTrees: far.cells.reduce((sum, cell) => sum + (cell.forestGpu?.count ?? 0), 0),
    }),

    /* After a lost context nothing on the GPU survives; decoded heights do, but
       the simplest correct thing is to stream the view again. */
    forgetGpu() {
      pending.clear();
      /* A tile waiting its turn to upload is lost with the queue, or it stays
         "loading" for good and its ground never comes back. */
      const queued = new Set(uploads);
      uploads.length = 0;
      forestWanted.clear();
      forestPlanting.length = 0;
      farWanted = [];
      farResident = 0;
      for (const cell of far.cells) {
        cell.forestGpu = null;
        cell.groundLod = undefined;
      }
      for (const node of nodes.values()) {
        if (node.state === 'ready' || node.state === 'failed' || queued.has(node)) node.state = null;
        node.forestGpu = null;
        if (node.forest !== 'loading') node.forest = null;
        node.gpu = null;
        node.shadeKey = null;
      }
    },

    dispose() { disposed = true; pending.clear(); },
  };
}
