/* One course, in the map's world.

   Everything a golfer sees comes from two things the app already publishes for
   every layout: the GPK1 pack (holes, greens, fairways, bunkers, water, forest,
   paths) and the ground manifest (the height tiles). Neither is copied or
   rebaked, so the map cannot drift from the course the simulator draws, and a
   republished course reaches the map by itself. */
import { inflate } from '../engine/codec.js';
import { decodeLandcover } from '../engine/landcover.mjs';
import { resolvePublishedGraph } from '../engine/v2-graph-source.mjs';
import { fetchLandcover, fetchPack, fetchSidecar, packRequestUrl } from '../loader/pack.js';
import { createMapFrame } from './map-frames.mjs';
import { groupBunkers, waterShape } from './map-measure.mjs';
import { outlineOverLand } from './map-land.mjs';

/* Traced ground, by the layer the map paints it in. */
const TRACED_SURFACES = Object.freeze({
  practice_green: 'otherGreens', practice_bunker: 'otherBunkers', range_bunker: 'otherBunkers',
  mown_approach: 'otherFairways', range_tee_pad: 'otherTees', range_mat: 'mats', range_target_surface: 'grass',
  paved_path: 'paved', terrace: 'paved', non_turf_island: 'bare', sports_court: 'courts',
  clubhouse_roof_section: 'roofs', roof_solar: 'solar',
});
/* Norrfällsviken's source traces that reached no other list. */
const TRACED_SOURCES = Object.freeze({
  'lm-practice-green': 'practice_green', 'lm-range-field': 'range_target_surface',
  'lm-range-shelter': 'clubhouse_roof_section', 'lm-practice-shed': 'clubhouse_roof_section',
});
/* The surroundings record's roads carry a class, not a width. */
const ROAD_WIDTHS = Object.freeze({ trunk: 10, secondary: 8, tertiary: 7, unclassified: 5, residential: 5, living_street: 4, pedestrian: 3 });

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

/* The record main.js accepts, and only that: a half-written one must not take the
   map down with it. */
export const validSurroundings = record => (record?.version === 1 && Array.isArray(record.buildings) && record.box && record.inner ? record : null);

/* The box a far building is published as: centre, half sizes and turn. */
function buildingCorners([cx, cz, halfWidth, halfDepth, turn]) {
  const c = Math.cos(turn), s = Math.sin(turn);
  return [[-halfWidth, -halfDepth], [halfWidth, -halfDepth], [halfWidth, halfDepth], [-halfWidth, halfDepth]]
    .map(([u, v]) => [cx + u * c - v * s, cz + u * s + v * c]);
}

export function buildMapCourse({ meta, geo, vectors, ground, course, landcover = null, mown = null, surroundings = null }) {
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

  const { scenery = {}, veg = {}, infra = {}, surround = {} } = vectors;
  const lines = items => (items ?? [])
    .filter(item => validRing(item?.line, 2))
    .map(item => ({ line: placeAll(item.line), width: Number.isFinite(item.w) ? item.w : null, kind: item.kind ?? null }));
  const far = validSurroundings(surroundings);
  /* A yard or a hayfield is published as one ring, a clear-fell as a list of them. */
  const ringOrRings = value => (isPoint(value?.[0]) ? rings([value]) : rings(value));
  const traced = Object.fromEntries(Object.values(TRACED_SURFACES).map(name => [name, []]));
  const tracedLines = [];
  const named = (scenery.sourceFeatures ?? []).filter(item => TRACED_SOURCES[item.id]).map(item => ({ ...item, kind: TRACED_SOURCES[item.id] }));
  for (const item of [...(scenery.mappedFeatures ?? []), ...named]) {
    if (item.kind === 'ditch') tracedLines.push(item);
    const layer = traced[TRACED_SURFACES[item.kind]];
    if (layer) layer.push(...(item.rings ?? (item.ring ? [item.ring] : [])));
  }
  const power = [infra.power, far?.power];
  const allBuildings = [...(infra.farB ?? []), ...(far?.buildings ?? [])].filter(box => box.length >= 5 && box.slice(0, 5).every(Number.isFinite));

  const features = {
    landuse: [...(infra.landuse ?? []), ...(far?.landuse ?? [])].filter(item => validRing(item?.ring))
      .map(item => ({ ring: placeAll(item.ring), kind: item.kind ?? null })),
    forest: rings([...(veg.forest ?? []), ...(veg.wood ?? [])]),
    scrub: rings(veg.scrub),
    wetland: rings(veg.wetland),
    openSand: rings(veg.sand),
    rock: rings(veg.rock),
    water: [...(vectors.water ?? []), ...(far?.water ?? []).filter(item => Number.isFinite(item.level))]
      .filter(item => validRing(item?.ring))
      .map(item => ({ ring: placeAll(item.ring), sea: Boolean(item.isSea), overLand: outlineOverLand(ground.groundId, item.ring),
        /* a pack's own body, known by its outline as the shores were baked from it */
        shoreKey: vectors.water?.includes(item) ? { points: item.ring.length, first: item.ring[0] } : null })),
    streams: lines(vectors.streams),
    roads: lines([...(infra.roads ?? []), ...(far?.roads ?? []).map(road => ({ ...road, w: ROAD_WIDTHS[road.kind] ?? 5 }))]),
    tracks: lines(infra.tracks),
    paths: lines(infra.paths),
    parking: rings(infra.parking),
    buildings: rings([...(infra.buildings ?? []), ...(far?.landmarks ?? [])]),
    /* Everything beyond the extract: thousands of boxes, kept as bare corners. */
    farBuildings: allBuildings.map(box => placeAll(buildingCorners(box))),
    structures: [...(infra.buildings ?? []), ...(far?.landmarks ?? [])].filter(item => validRing(item?.ring))
      .map(item => ({ ring: placeAll(item.ring), height: Number.isFinite(item.h) ? item.h : null })),
    range: rings(scenery.range),
    /* The other layouts on a shared ground are real grass on the same land, and
       a short layout's bunkers are only here: the 9-hole records carry none. */
    otherGreens: rings([...(scenery.greens ?? []), ...(scenery.practiceGreens ?? []), ...traced.otherGreens]),
    otherFairways: rings([...(scenery.fairways ?? []), ...traced.otherFairways]),
    otherTees: rings([...(scenery.tees ?? []), ...traced.otherTees]),
    otherBunkers: rings([...(scenery.bunkers ?? []), ...traced.otherBunkers]),
    grass: rings([...(scenery.grass ?? []), ...traced.grass]),
    /* What the simulator stands on the ground besides the course. */
    hayfields: ringOrRings(surround.hayfields),
    yards: ringOrRings(surround.yard),
    clearfells: ringOrRings(surround.clearfells),
    shallows: ringOrRings(surround.shallows),
    basins: rings(infra.basins),
    bridges: rings(infra.bridges),
    drains: lines([...(infra.drainage ?? []), ...tracedLines]),
    railways: lines([...(infra.railway ?? []), ...(far?.railway ?? [])]),
    piers: lines([...(infra.piers ?? []), ...(far?.piers ?? [])]),
    barriers: lines(infra.barriers),
    lifts: lines(far?.lifts),
    powerLines: power.flatMap(each => lines(each?.lines)),
    masts: [...power.flatMap(each => (each?.towers ?? [])), ...(far?.towers ?? []).map(item => item.c),
      ...(infra.mappedPoints ?? []).filter(item => item.tags?.man_made === 'mast').map(item => item.c)].filter(isPoint).map(place),
    poles: power.flatMap(each => (each?.poles ?? []).filter(isPoint)).map(place),
    pitches: [...(infra.pitches ?? []), ...(far?.sports ?? [])].filter(item => validRing(item?.ring))
      .map(item => ({ ring: placeAll(item.ring), court: /tennis|padel/.test(item.sport ?? '') || item.kind === 'track' })),
    pistes: rings(far?.pistes),
    mats: rings([...traced.mats, ...(scenery.rangeFacilities?.bays ?? []).filter(isPoint).map(([x, z]) => [[x - 1.2, z - 1.2], [x + 1.2, z - 1.2], [x + 1.2, z + 1.2], [x - 1.2, z + 1.2]])]),
    paved: rings(traced.paved),
    bareGround: rings(traced.bare),
    courts: rings(traced.courts),
    roofs: rings(traced.roofs),
    solar: rings(traced.solar),
    nets: (scenery.rangeFacilities?.nets ?? []).filter(line => validRing(line, 2)).map(placeAll),
    cartParks: scenery.cartPark && validRing(scenery.cartPark.line, 2) ? [placeAll(scenery.cartPark.line)] : [],
    /* Out of bounds and penalty areas, stake by stake as they stand. */
    stakes: (vectors.marking ?? []).flatMap(item => (item.pts ?? []).filter(isPoint).map(point => ({ point: place(point), colour: item.c }))),
    outOfBounds: (vectors.outOfBounds?.lines ?? []).filter(item => item.virtual === true && validRing(item.line, 2)).map(item => placeAll(item.line)),
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
  const sidecar = async (record, read, what) => {
    if (!record?.url) return null;
    try {
      return await read(`${import.meta.env.BASE_URL}${record.url}?v=${record.sha256.slice(0, 16)}`, record.sha256);
    } catch (error) {
      console.warn(`${what}:`, error.message);
      return null;
    }
  };
  const raster = record => sidecar(record, async (url, sha) => decodeLandcover(await fetchLandcover(url, sha), inflate), 'landcover');
  const [pack, graph, landcover, mown, surroundings] = await Promise.all([
    fetchPack(packRequestUrl(meta), meta.sha256),
    resolvePublishedGraph({ slug, packMeta: meta }),
    raster(meta.landcover),
    raster(meta.mownSurface),
    sidecar(meta.surroundings, (url, sha) => fetchSidecar(url, sha, 'surroundings'), 'surroundings'),
  ]);
  const vectors = JSON.parse(new TextDecoder().decode(await inflate(pack.sv)));
  return buildMapCourse({ meta, geo: pack.H.GEO, vectors, ground: graph.ground, course: graph.course, landcover, mown, surroundings });
}
