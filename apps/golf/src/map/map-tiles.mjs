/* Streams the published height tiles the view asks for.

   These are the simulator's own content-addressed tiles, verified the same way,
   so a tile is never decoded on trust and the two modes share one HTTP cache.
   Work is spread out on purpose: fetching and inflating are asynchronous, and
   the part that takes the main thread (painting and uploading) is rationed per
   frame, so a hole's tiles arriving never stutters a pan. */
import { verifyChunkAssetWeb } from '../../../../packages/course-v2/runtime/decode-web.mjs';
import { resolveV2AssetUrl } from '../../../../packages/course-v2/runtime/http.mjs';
import { bakeTileRelief, decodeTileHeights, sampleTile } from './map-height.mjs';
import { boxInFrustum, buildTileTree, forestInView, TILE_SAMPLES } from './map-lod.mjs';
import { bakeHillShade, shadeKey } from './map-horizon.mjs';
import { raiseHouses } from './map-houses.mjs';
import { buildingCentre, raiseClubBuilding, replacedBy } from './map-club-buildings.mjs';
import { createFarBlocker, createFarSample, farForestCells, FAR_FOREST, pictureSampler, plantFarCell, readForestPicture } from './map-far-forest.mjs';
import { plantTile, TREE_FLOATS } from './map-trees.mjs';

import { MAP_OFFLINE_CACHE } from './map-offline-status.mjs';
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
/* Houses are filed in squares of a 1 m tile's size and raised a few milliseconds a frame. */
const HOUSE_CELL_METRES = 256, HOUSE_RAISING_MS = 4;

/* The tree pictures are one small download shared by a whole course, and addressed
   by content, so the first visit keeps them: no later visit, and no bad signal, has
   to fetch them again. */

async function optionalOfflineCache() {
  try { return await globalThis.caches?.open(MAP_OFFLINE_CACHE); }
  catch { return null; }
}

export async function fetchKeptFile(url) {
  const cache = await optionalOfflineCache();
  const held = await cache?.match(url).catch(() => null);
  if (held) return new Uint8Array(await held.arrayBuffer());
  const response = await fetch(url);
  if (!response.ok) throw new Error(`bilddata saknas (${response.status})`);
  cache?.put(url, response.clone()).catch(() => {});
  return new Uint8Array(await response.arrayBuffer());
}


export async function fetchTileBytes(url, { signal } = {}) {
  const cache = await optionalOfflineCache();
  const held = await cache?.match(url).catch(() => null);
  if (held) return new Uint8Array(await held.arrayBuffer());
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`terrängdata saknas (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

export function createTileStore({ ground, baseHref, renderer, painter, rules, structures = [], awaitingAppearance = false, onChange }) {
  const { nodes, root } = buildTileTree(ground);
  const datum = ground.frame.origin.heightRH2000;
  const pending = new Map();      /* wanted, by node id, this view's order */
  const uploads = [];             /* decoded and waiting for their turn */
  const forestWanted = new Map(); /* tiles whose trees this view could use */
  const forestPlanting = [];      /* their records in, waiting to be planted */
  const metreTiles = [...nodes.values()].filter(node => node.lod === 0 && (node.layers.stands || node.layers.objects));
  let forestActive = 0;
  let active = 0, clock = 0, disposed = false, bytesFetched = 0, failures = 0;
  /* Past the 1 m tiles, the forest picture's wood (map-far-forest.mjs), once its
     samples are read: until then, and if they cannot be, the painted canopy alone. */
  const templates = rules.catalogue.species;
  let far = { cells: [] };
  let repaints = [];
  const farSample = createFarSample({ templates });
  let farWanted = [], farResident = 0, farEye = [0, 0, 0], farView = 0;
  let forestAt = null, blockerFor = null;
  function addFarForest(farForest) {
    if (!farForest?.land?.forestBytes || far.cells.length) return;
    far = farForestCells(root, metreTiles.filter(node => node.layers.stands));
    if (!far.cells.length) return;
    const { land } = farForest;
    readForestPicture(land.forestBytes).then(picture => {
      if (disposed) return;
      forestAt = pictureSampler({ picture, x0: land.x0, z0: land.z0, spacing: land.spacing });
      blockerFor = createFarBlocker(farForest);
      onChange();
    }).catch(error => console.warn('map far forest:', error.message));
  }
  /* Houses: the layout's, raised from their footprints, and the club's own
     (map-club-buildings.mjs) in place of those they stand for. Each 256 m square's
     share is raised on the finest ground in memory, and again when finer ground arrives
     under it, so a house stands at every zoom and not only where the 1 m ground is
     drawn (owner, 27 November: zoomed out, the houses went). */
  let houseCells = [], housesWaiting = 0;
  function fileHouses(club) {
    for (const cell of houseCells) if (cell.gpu) renderer.releaseHouses(cell.gpu);
    const replaced = replacedBy(club?.replaces);
    const cells = new Map();
    const add = ([x, z], kind, item) => {
      const i = Math.floor(x / HOUSE_CELL_METRES), j = Math.floor(z / HOUSE_CELL_METRES), key = `${i},${j}`;
      if (!cells.has(key)) cells.set(key, { x0: i * HOUSE_CELL_METRES, z0: j * HOUSE_CELL_METRES, size: HOUSE_CELL_METRES, structures: [], buildings: [], gpu: null, groundLod: Infinity });
      cells.get(key)[kind].push(item);
    };
    for (const structure of structures) if (!replaced(structure)) add(structure.ring[0], 'structures', structure);
    for (const building of club?.buildings ?? []) add(buildingCentre(building), 'buildings', building);
    houseCells = [...cells.values()];
  }
  fileHouses(null);
  function raiseCell(cell, lod) {
    const parts = [];
    if (cell.structures.length) parts.push(raiseHouses(cell.structures, heightAtPoint));
    for (const building of cell.buildings) parts.push(raiseClubBuilding(building, heightAtPoint));
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    if (cell.gpu) renderer.releaseHouses(cell.gpu);
    cell.gpu = null;
    if (length) {
      const mesh = new Float32Array(length);
      let at = 0;
      for (const part of parts) { mesh.set(part, at); at += part.length; }
      cell.gpu = renderer.uploadHouses(mesh);
    }
    cell.groundLod = lod;
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

  // Rendering and shot planning can request the same published layer at once.
  const reading = new Map();
  function readLayer(reference) {
    if (!reference) return null;
    if (!reading.has(reference)) {
      const request = fetchTileBytes(fileUrl(reference)).then(bytes => {
        bytesFetched += bytes.byteLength;
        return verifyChunkAssetWeb(reference, bytes);
      }).finally(() => reading.delete(reference));
      reading.set(reference, request);
    }
    return reading.get(reference);
  }

  async function readTerrain(node) {
    if (node.decoded) return node.decoded;
    const { header, payload } = await readLayer(node.layers.terrain);
    return decodeTileHeights(payload, header.grid, datum);
  }

  async function readVegetation(node, heights) {
    const [stands, objects] = await Promise.all([readLayer(node.layers.stands), readLayer(node.layers.objects)]);
    const stand = stands && { payload: stands.payload, section: stands.header.standField };
    const trees = plantTile({ node, heights, stand, objects: objects?.content?.records, ground, rules });
    return { stand, trees };
  }

  /* The vegetation on a 1 m tile is an extra, a few kilobytes: if it fails the
     tile is still the right ground. */
  async function loadVegetation(node, heights) {
    try {
      const { stand, trees } = await readVegetation(node, heights);
      node.stand = stand;
      node.trees = trees;
    } catch (error) {
      node.stand = null;
      node.trees = null;
      console.warn(`map vegetation ${node.id}: ${error.message}`);
    }
  }

  /* Vegetation owns one buffer independent of the displayed terrain LOD.
     A fine height tile upgrades the planting previously rooted on coarse
     ground. Evicting the height tile leaves its trees available. */
  function installForest(node, trees, metreGround = false) {
    const next = trees.length ? renderer.uploadForest(trees) : null;
    if (node.forestGpu) renderer.releaseForest(node.forestGpu);
    node.forestGpu = next;
    node.forest = 'ready';
    node.forestOnMetreGround = metreGround;
    node.crownHeight = node.crownRadius = 0;
    for (let i = 0; i < trees.length; i += TREE_FLOATS) {
      const shape = templates[trees[i + 6]];
      node.crownHeight = Math.max(node.crownHeight, trees[i + 5] * shape.templateHeight);
      node.crownRadius = Math.max(node.crownRadius, trees[i + 4] * shape.templateRadius);
    }
    farSample.add(node, trees);
  }

  async function loadTile(node) {
    node.state = 'loading';
    try {
      const decoded = await readTerrain(node);
      if (disposed) return;
      node.decoded = decoded;
      node.minHeight = decoded.min;
      node.maxHeight = decoded.max;
      node.relief = bakeTileRelief(decoded.heights, decoded.width, decoded.height, node.spacing);
      if (node.lod === 0) await loadVegetation(node, decoded.heights);
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
      if (disposed || node.forest === 'ready') return;
      node.forest = 'queued';
      node.forestRecords = { stand: stands && { payload: stands.payload, section: stands.header.standField }, objects: objects?.content?.records };
      forestPlanting.push(node);
    } catch (error) {
      if (disposed || node.forest === 'ready') return;
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
      if (node.forest && node.forest !== 'failed') continue;
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
      node.shadeKey = null;
      node.state = null;
    }
  }

  function heightAtPoint(x, z) {
    const best = finestAt(x, z);
    if (!best) return NaN;
    return sampleTile(best.decoded.heights, (x - best.x0) / best.size, (z - best.z0) / best.size, TILE_SAMPLES);
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
    setAppearance(nextPainter, farForest, complete) {
      painter = nextPainter;
      awaitingAppearance = !complete;
      repaints = [...nodes.values()].filter(isReady);
      addFarForest(farForest);
      onChange();
    },

    // Read the hole's physical data without enqueuing textures or changing the camera.
    // Keep the returned arrays even if the renderer later evicts this node.
    async shotTile(id) {
      const node = nodes.get(id);
      if (node?.lod !== 0) throw new Error(`Hålets höjddata saknas: ${id}`);
      const { heights, width, missing } = await readTerrain(node);
      const trees = node.trees ?? (await readVegetation(node, heights)).trees;
      const crowns = new Float32Array(trees.length / TREE_FLOATS * 3);
      for (let i = 0, j = 0; i < trees.length; i += TREE_FLOATS, j += 3) {
        crowns[j] = trees[i];
        crowns[j + 1] = trees[i + 2];
        crowns[j + 2] = trees[i + 4] * templates[trees[i + 6]].templateRadius;
      }
      // The renderer fills no-data samples for its mesh. A shot needs an actual
      // elevation everywhere along the carry, so preserve holes in the survey.
      const shotHeights = missing ? heights.slice() : heights;
      if (missing) for (let i = 0; i < missing.length; i++) if (missing[i]) shotHeights[i] = NaN;
      return { x0: node.x0, z0: node.z0, size: node.size, heights: shotHeights, width, crowns };
    },

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
        if (node.trees && !node.forestOnMetreGround) installForest(node, node.trees, true);
        node.relief = null;
        if (!awaitingAppearance) node.stand = null;
        node.state = 'ready';
        node.used = ++clock;
      }
      const repaint = repaints.shift();
      if (repaint && isReady(repaint) && repaint.gpu) {
        renderer.repaintTile(repaint, painter.paint(repaint));
        if (!awaitingAppearance) repaint.stand = null;
      }
      for (let i = 0; i < FOREST_PLANTS_PER_FRAME && forestPlanting.length; i++) {
        const node = forestPlanting.shift();
        const { stand, objects } = node.forestRecords;
        node.forestRecords = null;
        if (node.forest === 'ready') continue;
        const trees = plantTile({ node, stand, objects: objects ?? null, ground, rules, groundAt: this.heightAt });
        installForest(node, trees);
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
      return uploads.length + repaints.length + forestPlanting.length + farWanted.length;
    },

    /* The forest in view, as far as a tree still reads. Its tiles are asked for nearest
       first, and those a 1 m tile already plants are left to it. */
    forest({ planes, eye, reach, exaggeration, holeTiles = [] }) {
      const standing = [], missing = [];
      for (const node of metreTiles) {
        const away = Math.hypot(node.x0 + node.size / 2 - eye[0], node.z0 + node.size / 2 - eye[2]) - node.size;
        const foreground = holeTiles.includes(node.id);
        if ((!foreground && away > reach) || !forestInView(node, planes, exaggeration)) continue;
        if (node.forestGpu) standing.push({ node, reach: away, foreground });
        else if (!node.forest || (node.forest === 'failed' && performance.now() - node.failedAt >= RETRY_MS)) {
          missing.push({ node, away, foreground });
        }
      }
      forestWanted.clear();
      for (const { node } of missing.sort((a, b) => Number(b.foreground) - Number(a.foreground) || a.away - b.away)) forestWanted.set(node.id, node);
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
    heightAt: heightAtPoint,

    /* The club's own buildings, once their record is in: they take their places and
       the footprints they stand for leave. */
    setClubBuildings(club) {
      fileHouses(club);
      onChange();
    },

    /* The houses in view, out to `reach`: a few squares raised a frame, nearest first. */
    houses({ planes, eye, reach, exaggeration }) {
      const drawn = [], wanted = [];
      for (const cell of houseCells) {
        const cx = cell.x0 + cell.size / 2, cz = cell.z0 + cell.size / 2;
        const away = Math.max(0, Math.hypot(cx - eye[0], cz - eye[2]) - cell.size * 0.71);
        if (away > reach || !boxInFrustum(planes, cell.x0, root.minY * exaggeration, cell.z0, cell.x0 + cell.size, (root.maxY + 60) * exaggeration, cell.z0 + cell.size)) continue;
        const lod = finestAt(cx, cz)?.lod;
        if (lod === undefined) continue;
        if (!cell.gpu || lod < cell.groundLod) wanted.push({ cell, away, lod });
        else drawn.push(cell.gpu);
      }
      wanted.sort((a, b) => a.away - b.away);
      const started = performance.now();
      let left = 0;
      for (const { cell, lod } of wanted) {
        if (performance.now() - started > HOUSE_RAISING_MS) { left++; if (cell.gpu) drawn.push(cell.gpu); continue; }
        raiseCell(cell, lod);
        if (cell.gpu) drawn.push(cell.gpu);
      }
      housesWaiting = left;
      if (left) onChange();
      return drawn;
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
      busy: active + pending.size + repaints.length + uploads.length + forestActive + forestWanted.size + forestPlanting.length + farWanted.length + housesWaiting,
      houses: houseCells.reduce((sum, cell) => sum + (cell.gpu?.count ?? 0), 0) / 3,
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
      repaints = [];
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
        node.forestOnMetreGround = false;
        node.forestRecords = null;
        if (node.forest !== 'loading') node.forest = null;
        node.gpu = null;
        node.shadeKey = null;
      }
      for (const cell of houseCells) {
        cell.gpu = null;
        cell.groundLod = Infinity;
      }
    },

    dispose() { disposed = true; pending.clear(); },
  };
}
