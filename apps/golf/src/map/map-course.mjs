/* One course, in the map's world.

   Everything a golfer sees comes from two things the app already publishes for
   every layout: the GPK1 pack (holes, greens, fairways, bunkers, water, forest,
   paths) and the ground manifest (the height tiles). Neither is copied or
   rebaked, so the map cannot drift from the course the simulator draws, and a
   republished course reaches the map by itself. */
import { inflate } from '../engine/codec.js';
import { decodeLandcover } from '../engine/landcover.mjs';
import { resolvePublishedGraph } from '../engine/v2-graph-source.mjs';
import { fetchLandcover, fetchPack, packRequestUrl } from '../loader/pack.js';
import { createMapFrame } from './map-frames.mjs';
import { groupBunkers, waterShape } from './map-measure.mjs';

const ringOf = item => (Array.isArray(item) ? item : item?.ring);
const isPoint = point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]);
const validRing = (ring, least = 3) => Array.isArray(ring) && ring.length >= least && ring.every(isPoint);

function bbox(points) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of points) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return { x0, z0, x1, z1 };
}

/* A layout whose greens all share one drawn shape has placeholder greens, not
   mapped ones: real greens never agree on their size. Their centres can still be
   used, but their edges say nothing, and the map must not read them as fact. */
export function greensAreGeneric(rings) {
  if (rings.length < 2) return false;
  const span = ring => {
    let widest = 0;
    for (const a of ring) for (const b of ring) widest = Math.max(widest, Math.hypot(a[0] - b[0], a[1] - b[1]));
    return widest;
  };
  const first = span(rings[0]);
  return rings.every(ring => ring.length === rings[0].length && Math.abs(span(ring) - first) < 0.15);
}

export function buildMapCourse({ meta, geo, vectors, ground, course, landcover = null, mown = null }) {
  const frame = createMapFrame(ground.groundId, ground.frame);
  const place = point => frame.toWorld(point[0], point[1]);
  const placeAll = points => points.map(place);
  const rings = (items, least = 3) => (items ?? []).map(ringOf).filter(ring => validRing(ring, least)).map(placeAll);

  const holes = vectors.holes.map(hole => ({
    n: hole.n,
    par: hole.par,
    index: hole.idx ?? null,
    name: hole.name ?? null,
    note: hole.note ?? null,
    lengths: hole.t ?? [],
    line: placeAll(hole.line),
    pin: place(hole.pin ?? hole.green.c),
    green: { ring: placeAll(hole.green.ring), c: place(hole.green.c) },
    /* A tee's own position and card length, one per tee colour in the course's
       tee order. The hole's line starts at the back tee, whichever is played. */
    tees: (hole.tees?.marks ?? []).filter(mark => isPoint(mark?.c))
      .map(mark => ({ point: place(mark.c), metres: mark.m ?? null })),
    fairways: rings(hole.fairway?.rings),
    teePads: rings(hole.tees?.pads),
    bunkers: rings(hole.bunkers),
    tileIds: course.holes?.find(entry => entry.number === hole.n)?.tileIds ?? [],
  }));

  const { scenery = {}, veg = {}, infra = {} } = vectors;
  const lines = items => (items ?? [])
    .filter(item => validRing(item?.line, 2))
    .map(item => ({ line: placeAll(item.line), width: Number.isFinite(item.w) ? item.w : null, kind: item.kind ?? null }));

  const features = {
    landuse: (infra.landuse ?? []).filter(item => validRing(item?.ring))
      .map(item => ({ ring: placeAll(item.ring), kind: item.kind ?? null })),
    forest: rings([...(veg.forest ?? []), ...(veg.wood ?? [])]),
    scrub: rings(veg.scrub),
    wetland: rings(veg.wetland),
    openSand: rings(veg.sand),
    rock: rings(veg.rock),
    water: (vectors.water ?? []).filter(item => validRing(item?.ring))
      .map(item => ({ ring: placeAll(item.ring), sea: Boolean(item.isSea) })),
    streams: lines(vectors.streams),
    roads: lines(infra.roads),
    tracks: lines(infra.tracks),
    paths: lines(infra.paths),
    parking: rings(infra.parking),
    buildings: rings(infra.buildings),
    structures: (infra.buildings ?? []).filter(item => validRing(item?.ring))
      .map(item => ({ ring: placeAll(item.ring), height: Number.isFinite(item.h) ? item.h : null })),
    range: rings(scenery.range),
    /* The other layouts on a shared ground are real grass on the same land, and
       a short layout's bunkers are only here: the 9-hole records carry none. */
    otherGreens: rings([...(scenery.greens ?? []), ...(scenery.practiceGreens ?? [])]),
    otherFairways: rings(scenery.fairways),
    otherTees: rings(scenery.tees),
    otherBunkers: rings(scenery.bunkers),
    grass: rings(scenery.grass),
  };

  const played = holes.flatMap(hole => [...hole.line, ...hole.green.ring]);
  const playedTiles = new Set(holes.flatMap(hole => hole.tileIds));
  const datum = ground.frame.origin.heightRH2000;
  const heights = ground.tiles.filter(tile => playedTiles.has(tile.id)).map(tile => tile.bounds);
  return {
    slug: meta.slug,
    name: meta.name,
    club: meta.club ?? meta.name,
    par: meta.par,
    tees: meta.tees,
    geo,
    frame,
    ground,
    holes,
    features,
    hazards: {
      bunkers: groupBunkers([...holes.flatMap(hole => hole.bunkers), ...features.otherBunkers]),
      waters: features.water.map(item => waterShape(item.ring)),
    },
    landcover,
    mown,
    woodland: scenery.woodlandContext ?? null,
    reserves: (infra.reserves ?? []).map(item => ({ ring: item.ring, bb: bbox(item.ring) })),
    bounds: bbox(played),
    greensApproximate: greensAreGeneric(holes.map(hole => hole.green.ring)),
    /* The tint runs over the land the course is actually played on. */
    heightLow: heights.length ? Math.min(...heights.map(b => b.minHeightRH2000)) - datum : 0,
    heightHigh: heights.length ? Math.max(...heights.map(b => b.maxHeightRH2000)) - datum : 60,
  };
}

export async function loadMapCourse(slug) {
  const response = await fetch(`${import.meta.env.BASE_URL}courses/index.json`);
  if (!response.ok) throw new Error(`banlistan kunde inte hämtas (${response.status})`);
  const manifest = await response.json();
  const meta = manifest.courses.find(entry => entry.slug === slug);
  if (!meta) throw new Error(`banan ${slug} finns inte`);
  /* Land cover is an appearance record: without it the forest falls back to its
     mapped outlines and the course still opens. */
  const raster = async record => {
    if (!record?.url) return null;
    try {
      const url = `${import.meta.env.BASE_URL}${record.url}?v=${record.sha256.slice(0, 16)}`;
      return await decodeLandcover(await fetchLandcover(url, record.sha256), inflate);
    } catch (error) {
      console.warn('landcover:', error.message);
      return null;
    }
  };
  const [pack, graph, landcover, mown] = await Promise.all([
    fetchPack(packRequestUrl(meta), meta.sha256),
    resolvePublishedGraph({ slug, packMeta: meta }),
    raster(meta.landcover),
    raster(meta.mownSurface),
  ]);
  const vectors = JSON.parse(new TextDecoder().decode(await inflate(pack.sv)));
  return buildMapCourse({ meta, geo: pack.H.GEO, vectors, ground: graph.ground, course: graph.course, landcover, mown });
}
