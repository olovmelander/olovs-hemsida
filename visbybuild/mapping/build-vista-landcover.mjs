#!/usr/bin/env node
/* Gotland's land cover out to the horizon, from a wide OSM extract.

   WHY. Visby's `vegetation.forest/wood/scrub/wetland/sand/rock` were ALL empty
   and its `infra.landuse` too, because the committed OSM context is clipped to
   the played property -- inside which OSM genuinely has no vegetation polygon
   of any class. That is a true statement about 123 ha and a useless one about
   the 16 km world the ring graph now renders: the far vista ring plants cones
   on any land that is not declared open, and with nothing declared open it
   would have carpeted Gotland. This extract measures what is actually there:
   311 farmland polygons against 32 forest. Gotland is FARMED, and a horizon
   that ignores that is wrong in the direction nobody notices until they look.

   The extract is four raw-API tiles over +-6 km (Overpass resets on responses
   this size here; the map API does not) and everything is CLIPPED to the keep
   box rather than merely filtered -- a kept-whole coastline or power line
   reaches tens of kilometres, which is the Ribbingsfors lesson.

   This is VISTA DRESSING and the model says so: it feeds the far ring's open-
   land test and the ground tint beyond the measured window. It never plants a
   tree on the course -- `vegetationPlacement: 'measured-only'` short-circuits
   the legacy planter, and the LiDAR generation owns everything inside its own
   coverage.

     node visbybuild/mapping/build-vista-landcover.mjs
   reads visbybuild/cache/osm/wide-*.osm (gitignored; refetch with the header's
   own bboxes) and writes the committed EPSG:3006 artifact. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { latLonToSweref99Tm } from '../../packages/course-geo/chmv2/projection.mjs';
import { VISBY_FRAME } from '../frame.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const CACHE = path.join(HERE, '..', 'cache', 'osm');
const OUT = path.join(ROOT, 'geo_data', 'course-v2', 'visby', 'mapping', 'osm-vista-landcover-epsg3006.geojson');
const KEEP = 6000;   /* metres: the far ring reaches 5,400 and wants a margin */

const BBOXES = ['18.028,57.388,18.129,57.443', '18.129,57.388,18.229,57.443',
                '18.028,57.443,18.129,57.497', '18.129,57.443,18.229,57.497'];

/* landuse=forest is a plantation and natural=wood a stand; the engine tints and
   plants them the same and the distinction is kept because OSM keeps it. */
const VEGETATION = {
  forest: ['landuse=forest'], wood: ['natural=wood'], scrub: ['natural=scrub'],
  wetland: ['natural=wetland', 'natural=marsh'], sand: ['natural=beach', 'natural=sand', 'natural=shingle'],
  rock: ['natural=bare_rock', 'natural=scree', 'natural=rock'],
};
/* every one of these is ground a conifer does not stand on, which is the whole
   job: `openLand` in the vista ring refuses a cone inside any of them */
const LANDUSE = {
  farmland: ['landuse=farmland'], meadow: ['landuse=meadow'], grass: ['landuse=grass', 'natural=grassland'],
  orchard: ['landuse=orchard', 'landuse=vineyard'], farmyard: ['landuse=farmyard'],
  residential: ['landuse=residential'], industrial: ['landuse=industrial', 'landuse=quarry'],
  commercial: ['landuse=commercial', 'landuse=retail'], recreation: ['landuse=recreation_ground', 'leisure=park', 'leisure=pitch', 'leisure=garden'],
  cemetery: ['landuse=cemetery', 'amenity=grave_yard'],
  /* heath is Gotland's own open ground -- hallmark, ljung and juniper, and the
     reserve text for this coast names it. Open, not forest. */
  heath: ['natural=heath'],
};

/* A lazy regex over OSM XML attributes a self-closing node's tags to the NEXT
   tagged element; CLAUDE.md records the hour that cost at Ribbingsfors. The
   alternation is the correct form. */
const parse = text => {
  const nodes = new Map();
  for (const match of text.matchAll(/<node\b([^>]*?)(\/>|>([\s\S]*?)<\/node>)/g)) {
    const attrs = match[1];
    const id = /\bid="(-?\d+)"/.exec(attrs)?.[1];
    const lat = Number(/\blat="([-\d.]+)"/.exec(attrs)?.[1]);
    const lon = Number(/\blon="([-\d.]+)"/.exec(attrs)?.[1]);
    if (id && Number.isFinite(lat) && Number.isFinite(lon)) nodes.set(id, [lon, lat]);
  }
  const ways = new Map();
  for (const match of text.matchAll(/<way\b([^>]*?)(\/>|>([\s\S]*?)<\/way>)/g)) {
    const id = /\bid="(-?\d+)"/.exec(match[1])?.[1];
    const body = match[3] ?? '';
    if (!id) continue;
    ways.set(id, {
      refs: [...body.matchAll(/<nd ref="(-?\d+)"\s*\/>/g)].map(nd => nd[1]),
      tags: Object.fromEntries([...body.matchAll(/<tag k="([^"]*)" v="([^"]*)"\s*\/>/g)].map(tag => [tag[1], tag[2]])),
    });
  }
  const relations = new Map();
  for (const match of text.matchAll(/<relation\b([^>]*?)(\/>|>([\s\S]*?)<\/relation>)/g)) {
    const id = /\bid="(-?\d+)"/.exec(match[1])?.[1];
    const body = match[3] ?? '';
    if (!id) continue;
    relations.set(id, {
      members: [...body.matchAll(/<member type="([^"]*)" ref="(-?\d+)" role="([^"]*)"\s*\/>/g)]
        .map(member => ({ type: member[1], ref: member[2], role: member[3] })),
      tags: Object.fromEntries([...body.matchAll(/<tag k="([^"]*)" v="([^"]*)"\s*\/>/g)].map(tag => [tag[1], tag[2]])),
    });
  }
  return { nodes, ways, relations };
};

const local = ([lon, lat]) => {
  const [easting, northing] = latLonToSweref99Tm(lat, lon);
  return [easting - VISBY_FRAME.easting, VISBY_FRAME.northing - northing];
};

/* Sutherland-Hodgman against the keep box: clip, never merely filter. */
const clip = ring => {
  let out = ring;
  const edges = [
    [point => point[0] >= -KEEP, (a, b) => [-KEEP, a[1] + (b[1] - a[1]) * (-KEEP - a[0]) / (b[0] - a[0])]],
    [point => point[0] <= KEEP, (a, b) => [KEEP, a[1] + (b[1] - a[1]) * (KEEP - a[0]) / (b[0] - a[0])]],
    [point => point[1] >= -KEEP, (a, b) => [a[0] + (b[0] - a[0]) * (-KEEP - a[1]) / (b[1] - a[1]), -KEEP]],
    [point => point[1] <= KEEP, (a, b) => [a[0] + (b[0] - a[0]) * (KEEP - a[1]) / (b[1] - a[1]), KEEP]],
  ];
  for (const [inside, cross] of edges) {
    const next = [];
    for (let index = 0; index < out.length; index++) {
      const current = out[index], previous = out[(index + out.length - 1) % out.length];
      if (inside(current)) {
        if (!inside(previous)) next.push(cross(previous, current));
        next.push(current);
      } else if (inside(previous)) next.push(cross(previous, current));
    }
    out = next;
    if (!out.length) return [];
  }
  return out;
};

const area = ring => Math.abs(ring.reduce((sum, point, index) => {
  const next = ring[(index + 1) % ring.length];
  return sum + point[0] * next[1] - next[0] * point[1];
}, 0)) / 2;

const match = (tags, list) => list.some(pair => {
  const [key, value] = pair.split('=');
  return tags[key] === value;
});

const { nodes, ways, relations } = (() => {
  const merged = { nodes: new Map(), ways: new Map(), relations: new Map() };
  for (const file of fs.readdirSync(CACHE).filter(name => /^wide-\d+\.osm$/.test(name)).sort()) {
    const piece = parse(fs.readFileSync(path.join(CACHE, file), 'utf8'));
    for (const key of ['nodes', 'ways', 'relations']) for (const [id, value] of piece[key]) merged[key].set(id, value);
  }
  return merged;
})();

const features = [];
const counts = {};
const push = (kind, group, ring, id) => {
  const clipped = clip(ring);
  if (clipped.length < 3 || area(clipped) < 400) return;
  counts[`${group}.${kind}`] = (counts[`${group}.${kind}`] ?? 0) + 1;
  features.push({
    type: 'Feature', id,
    properties: { group, kind, sourceId: id, areaSquareMetres: Math.round(area(clipped)) },
    /* closed, as GeoJSON requires; the model conversion drops the repeat */
    geometry: { type: 'Polygon', coordinates: [[...clipped, clipped[0]].map(([x, z]) => [
      +(VISBY_FRAME.easting + x).toFixed(3), +(VISBY_FRAME.northing - z).toFixed(3)])] },
  });
};

const closedRing = refs => {
  if (refs.length < 4 || refs[0] !== refs.at(-1)) return null;
  const ring = refs.slice(0, -1).map(ref => nodes.get(ref)).filter(Boolean);
  return ring.length === refs.length - 1 ? ring.map(local) : null;
};

const classify = tags => {
  for (const [kind, list] of Object.entries(VEGETATION)) if (match(tags, list)) return ['vegetation', kind];
  for (const [kind, list] of Object.entries(LANDUSE)) if (match(tags, list)) return ['landuse', kind];
  return null;
};

const usedByRelation = new Set();
for (const [id, relation] of relations) {
  if (relation.tags.type !== 'multipolygon') continue;
  const hit = classify(relation.tags);
  if (!hit) continue;
  for (const member of relation.members) {
    if (member.type !== 'way' || member.role === 'inner') continue;
    const way = ways.get(member.ref);
    const ring = way && closedRing(way.refs);
    if (ring) { push(hit[1], hit[0], ring, `relation/${id}/${member.ref}`); usedByRelation.add(member.ref); }
  }
}
for (const [id, way] of ways) {
  if (usedByRelation.has(id)) continue;
  const hit = classify(way.tags);
  if (!hit) continue;
  const ring = closedRing(way.refs);
  if (ring) push(hit[1], hit[0], ring, `way/${id}`);
}

fs.writeFileSync(OUT, `${JSON.stringify({
  type: 'FeatureCollection',
  crs: { type: 'name', properties: { name: 'EPSG:3006' } },
  name: 'visby-vista-landcover',
  description: ('OpenStreetMap land cover around Kronholmen, clipped to +-6 km of the Visby frame, for the '
                + 'far vista ring and the ground tint beyond the measured window. Vista dressing, not a survey '
                + 'of the played property: nothing here plants a tree on the course, which is measured-only.'),
  source: { api: 'https://api.openstreetmap.org/api/0.6/map', bboxes: BBOXES, retrieved: '2026-09-08',
            licence: 'ODbL 1.0, (c) OpenStreetMap contributors' },
  frame: { easting: VISBY_FRAME.easting, northing: VISBY_FRAME.northing, keepBoxMetres: KEEP },
  counts,
  features,
}, null, 1)}\n`);
console.log(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([key, value]) => `${String(value).padStart(4)} ${key}`).join('\n'));
console.log(`\n${features.length} features -> ${path.relative(ROOT, OUT)}`);
