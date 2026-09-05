#!/usr/bin/env node
/* Merge the surveyed surroundings into Ribbingsfors' course model.

   Inputs, all committed:
     osm-surroundings.json        the wide OSM parse (parse-osm-wide.mjs)
     surroundings-traces.json     features read off Esri z17/z18 imagery
     geo_data/course-v2/ribbingsfors/reference/protected-trees-250m.geojson
     tree-cover.json + heightfields.json   the laser products already in the build

   Every merge REPLACES a derived section wholesale from those inputs, so the
   script is idempotent and safe to rerun; nothing it writes depends on what a
   previous run wrote. Run it after build-course.mjs, which still owns the
   terrain, the break water and the playing surfaces:

     node ribbingsforsbuild/build-course.mjs      (needs the geo toolchain)
     node ribbingsforsbuild/apply-surroundings.mjs

   It needs no GDAL. Gates inside: the Skagern ring must read laser-flat at
   lake level over its interior, no hole line may fall inside it, and every
   tee pad is re-checked against the merged road set. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bearing, centroid, decodeHF, lcg, pointInPoly, polyArea, polyLen, ring1, r1,
} from '../geobuild/lib.mjs';
import { teeRoadClearance } from './tee-road-clearance.mjs';
import { uniteLakeRings } from './lake-union.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const model = readJson(path.join(HERE, 'course-model.json'));
const osm = readJson(path.join(HERE, 'osm-surroundings.json'));
const traces = readJson(path.join(HERE, 'surroundings-traces.json'));
const treeCover = readJson(path.join(HERE, 'tree-cover.json'));
const heightfields = readJson(path.join(HERE, 'heightfields.json'));
const protectedTrees = readJson(path.join(ROOT,
  'geo_data/course-v2/ribbingsfors/reference/protected-trees-250m.geojson'));

const FRAME = { easting: 448975.5, northing: 6536024.5 };
const LAKE_LEVEL = 69.3; /* Lantmäteriet break geometry; the vista DTM reads 69.35 on open water */

/* ---------------------------------------------------------------- heights */
function sampler(spec) {
  const values = decodeHF(spec);
  return (x, z) => {
    const fi = (x - spec.x0) / spec.dx, fj = (z - spec.z0) / spec.dx;
    const i = Math.floor(fi), j = Math.floor(fj);
    if (i < 0 || j < 0 || i >= spec.nx - 1 || j >= spec.nz - 1) return null;
    const tx = fi - i, tz = fj - j, k = j * spec.nx + i;
    return values[k] * (1 - tx) * (1 - tz) + values[k + 1] * tx * (1 - tz) +
      values[k + spec.nx] * (1 - tx) * tz + values[k + spec.nx + 1] * tx * tz;
  };
}
const vistaH = sampler(heightfields.hf1);
const coreH = sampler(heightfields.hf0);
/* the finest laser product at a point: 4 m over the course window, 32 m beyond */
const dtmH = (x, z) => coreH(x, z) ?? vistaH(x, z);
/* Lantmäteriet item 653_44 in local metres: the break geometry describes the
   lake only inside it (E 440000–450000, N 6530000–6540000) */
const ITEM = { x0: 440000 - FRAME.easting, x1: 450000 - FRAME.easting, z0: FRAME.northing - 6540000, z1: FRAME.northing - 6530000 };
const insideItem = (x, z) => x >= ITEM.x0 && x <= ITEM.x1 && z >= ITEM.z0 && z <= ITEM.z1;

/* ------------------------------------------------- the Skagern lake ring */
function stitchSkagern() {
  const runs = osm.skagern.outerRuns.map(run => run.map(([x, z]) => [x, z]));
  /* Chain runs whose endpoints nearly meet (members missing from the extract
     leave gaps of a few tens of metres). */
  const chain = runs.shift();
  while (runs.length) {
    let best = null;
    for (let index = 0; index < runs.length; index++) {
      const run = runs[index];
      const candidates = [
        { d: Math.hypot(chain.at(-1)[0] - run[0][0], chain.at(-1)[1] - run[0][1]), index, reverse: false, append: true },
        { d: Math.hypot(chain.at(-1)[0] - run.at(-1)[0], chain.at(-1)[1] - run.at(-1)[1]), index, reverse: true, append: true },
        { d: Math.hypot(chain[0][0] - run.at(-1)[0], chain[0][1] - run.at(-1)[1]), index, reverse: false, append: false },
        { d: Math.hypot(chain[0][0] - run[0][0], chain[0][1] - run[0][1]), index, reverse: true, append: false },
      ];
      for (const candidate of candidates) if (!best || candidate.d < best.d) best = candidate;
    }
    if (!best || best.d > 90) throw new Error(`Skagern shoreline runs do not chain (gap ${best?.d.toFixed(0)} m)`);
    const run = runs.splice(best.index, 1)[0];
    if (best.reverse) run.reverse();
    if (best.append) chain.push(...run); else chain.unshift(...run);
  }
  /* The chain runs from the box's east edge to its north edge along the west
     shore of the main basin; the open water lies north-east of it, so the ring
     closes through the north-east corner of the keep box. */
  const first = chain[0], last = chain.at(-1);
  const corner = [4600, -4600];
  const onEast = point => Math.abs(point[0] - 4600) < 2;
  const onNorth = point => Math.abs(point[1] + 4600) < 2;
  if (!((onEast(first) && onNorth(last)) || (onNorth(first) && onEast(last)))) {
    throw new Error('Skagern chain no longer ends on the east and north box edges; re-derive the closure');
  }
  let ring = onNorth(last) ? [...chain, corner] : [...chain.reverse(), corner];
  /* The blind corner closure sweeps in a triangle of LAND at the far
     north-east (the extract's shoreline exits the box before the basin turns),
     measured at 70.6–73.6 m over x>4200, z<-3600. Cut the corner along the
     diagonal x - z = 7600, whose inside — (4000,-3000) and (3000,-4000) —
     reads 69.35 laser-flat. */
  const clipped = [];
  const keepSide = point => point[0] - point[1] <= 7600;
  for (let index = 0; index < ring.length; index++) {
    const current = ring[index], previous = ring[(index + ring.length - 1) % ring.length];
    if (keepSide(current) !== keepSide(previous)) {
      const f0 = previous[0] - previous[1] - 7600, f1 = current[0] - current[1] - 7600;
      const t = f0 / (f0 - f1);
      clipped.push([previous[0] + (current[0] - previous[0]) * t,
        previous[1] + (current[1] - previous[1]) * t]);
    }
    if (keepSide(current)) clipped.push(current);
  }
  ring = clipped;
  /* Gate: the interior must read laser-flat at lake level. Sample the vista
     heightfield on a grid well inside the ring; a wrong closure would sweep in
     land (or the lower river reach below the Gullspång outlet) and fail. */
  let inside = 0, flat = 0, worst = 0;
  for (let z = -4550; z < 2400; z += 150) for (let x = -1650; x < 4600; x += 150) {
    if (!pointInPoly(x, z, ring)) continue;
    const height = vistaH(x, z);
    if (height === null) continue;
    inside++;
    const misfit = Math.abs(height - 69.35);
    if (misfit < 0.75) flat++;
    worst = Math.max(worst, misfit);
  }
  const share = flat / Math.max(1, inside);
  console.log(`Skagern ring: ${ring.length} pts, ${inside} interior vista samples, ` +
    `${(share * 100).toFixed(1)}% within 0.75 m of 69.35 (worst ${worst.toFixed(2)} m)`);
  /* measured 99.0% on 2026-09-04 with the corner cut; the residual is 32 m
     vista cells averaging shore into water */
  if (share < 0.95) throw new Error('Skagern ring interior is not laser-flat lake water; closure is wrong');
  for (const hole of model.holes) for (const [x, z] of hole.line) {
    if (pointInPoly(x, z, ring)) throw new Error(`hole ${hole.n} line point [${x},${z}] falls inside the Skagern ring`);
  }
  /* the OSM candidate: one polygon, still to be reconciled with the laser
     shoreline in the union below */
  return { ring, area: Math.round(Math.abs(polyArea(ring))) };
}

/* ------------------------------------------- one lake from two records */
function uniteSkagern(osmRing, breakLakes) {
  const started = Date.now();
  /* tolerance by distance from the played ground: the shoreline a golfer
     stands beside keeps 1 m, the far basin costs nothing per terrain sample */
  const play = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const hole of model.holes) for (const [x, z] of hole.line) {
    play.x0 = Math.min(play.x0, x); play.x1 = Math.max(play.x1, x);
    play.z0 = Math.min(play.z0, z); play.z1 = Math.max(play.z1, z);
  }
  const playDistance = (x, z) => Math.hypot(Math.max(play.x0 - x, 0, x - play.x1), Math.max(play.z0 - z, 0, z - play.z1));
  const union = uniteLakeRings({
    authoritative: breakLakes.map(w => w.ring),
    candidate: osmRing,
    level: 69.35,             /* what the laser reads on open water */
    dtmTolerance: 0.35,
    authoritativeScope: insideItem,
    dtm: dtmH,
    spacing: 2,
    minimumHectares: 0.5,
    toleranceAt: (x, z) => { const d = playDistance(x, z); return d < 300 ? 1.0 : d < 1000 ? 2.5 : d < 2000 ? 6 : 12; },
  });
  const [main, ...fragments] = union.rings;
  /* Gate: the laser shoreline must come back out. Every break-geometry vertex
     on a real shore (not the item's clip edge) within 1.4 km of the origin
     must lie within 3 m of the union ring at the median, 12 m at the 90th. */
  const segD = (p, a, b) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz;
    let t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
  };
  const ringD = (p, r) => { let best = Infinity; for (let i = 0, j = r.length - 1; i < r.length; j = i++) best = Math.min(best, segD(p, r[j], r[i])); return best; };
  const residuals = breakLakes.flatMap(w => w.ring)
    .filter(p => p[0] < ITEM.x1 - 2 && Math.hypot(p[0], p[1]) < 1400)
    .map(p => ringD(p, main.ring)).sort((a, b) => a - b);
  const p50 = residuals[residuals.length >> 1], p90 = residuals[Math.floor(residuals.length * 0.9)];
  console.log(`Skagern union: ${union.rings.length} ring(s), ${union.hectares} ha in ${Date.now() - started} ms; ` +
    `main ${main.ring.length} pts / ${main.hectares} ha; OSM-only water refused on land ${union.dropped.osmOnlyLandHectares} ha, ` +
    `kept where laser-flat ${union.kept.osmOnlyInsideScopeHectares} ha; laser shoreline residual p50 ${p50.toFixed(2)} m, p90 ${p90.toFixed(2)} m over ${residuals.length} vertices`);
  if (p50 > 3 || p90 > 12) throw new Error('the union ring does not reproduce the laser shoreline; check the raster spacing and tolerances');
  const prov = 'ONE ring for the lake: Lantmäteriet break geometry (laser-exact) wherever item 653_44 draws a shoreline, ' +
    'OSM shoreline (ODbL) beyond the item, and OSM water inside the item only where the DTM reads laser-flat at lake level ' +
    '(ribbingsforsbuild/lake-union.mjs). Level 69.3 from the break geometry; the vista DTM reads 69.35 on open water; ' +
    'OSM ele=66.9 rejected. Two low islets inside the ring are drowned simplifications.';
  return {
    lake: { ring: ring1(main.ring), level: LAKE_LEVEL, isLake: true, isSea: false,
      area: Math.round(main.hectares * 10000), name: 'Skagern', prov },
    fragments: fragments.map((fragment, index) => ({
      ring: ring1(fragment.ring), level: LAKE_LEVEL, isLake: false, isSea: false,
      area: Math.round(fragment.hectares * 10000), name: `Skagern (fragment ${index + 1})`,
      prov: 'laser-flat water at lake level the OSM shoreline encloses beyond the break geometry, disconnected from the main ring by land the DTM refuses; ' + prov,
    })),
    report: { p50: +p50.toFixed(2), p90: +p90.toFixed(2), vertices: residuals.length, refusedHectares: union.dropped.osmOnlyLandHectares },
  };
}

/* --------------------------------------- synthesized Skagersvik housing */
function synthesizeVillageHouses(roads, residentialRings, realBuildings) {
  const rand = lcg(740); /* the club number, for determinism */
  const houses = [];
  const buildingCentres = realBuildings.map(building => centroid(building.ring));
  const occupied = (x, z, radius) =>
    buildingCentres.some(([bx, bz]) => Math.hypot(bx - x, bz - z) < radius) ||
    houses.some(house => Math.hypot(house[0] - x, house[1] - z) < radius);
  for (const { ring } of residentialRings) {
    for (const way of roads) {
      for (let index = 1; index < way.line.length; index++) {
        const a = way.line[index - 1], b = way.line[index];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let along = 14; along < length - 8; along += 27) {
          const t = along / length;
          const px = a[0] + (b[0] - a[0]) * t, pz = a[1] + (b[1] - a[1]) * t;
          const ux = (b[0] - a[0]) / length, uz = (b[1] - a[1]) / length;
          for (const side of [-1, 1]) {
            const x = px - uz * side * 14, z = pz + ux * side * 14;
            if (!pointInPoly(x, z, ring)) continue;
            if (occupied(x, z, 17)) continue;
            houses.push([r1(x), r1(z), r1(7.5 + rand() * 3.5), r1(9 + rand() * 3.5),
              r1(3.6 + rand() * 1.4), +bearing(ux, uz).toFixed(2)]);
          }
        }
      }
    }
  }
  return houses;
}

/* ----------------------------------------------- protected-tree circles */
/* Measured ONCE (2026-09-04) against the pristine build-course tree-cover
   raster — the 2023 laser CHM with only the playing-surface/water/building
   burns — a tree counting as confirmed when any cell within 4 m holds a >=3 m
   canopy return. 86 of 88 confirmed. The measurement is frozen here rather
   than recomputed because this script's own open burns (the parking lot has
   an oak standing in it) would otherwise flip records on a rerun. */
const LASER_UNCONFIRMED_OBJECT_IDS = new Set([
  9267, /* Alm 368 cm at [766.3,-500.9], the estate farmyard; no 2023 canopy return */
  15731, /* Ek 336 cm at [40.6,-168.3]; no 2023 canopy return */
]);
function protectedTreeFeatures() {
  const circle = (c, radius, count = 12) => Array.from({ length: count }, (_, index) => {
    const angle = index / count * Math.PI * 2;
    return [r1(c[0] + Math.cos(angle) * radius), r1(c[1] + Math.sin(angle) * radius)];
  });
  const trees = [];
  let laserConfirmed = 0;
  for (const feature of protectedTrees.features) {
    const p = feature.properties;
    const c = [r1(p.eastingEpsg3006 - FRAME.easting), r1(FRAME.northing - p.northingEpsg3006)];
    const confirmed = !LASER_UNCONFIRMED_OBJECT_IDS.has(p.sourceObjectId);
    if (confirmed) laserConfirmed++;
    trees.push({ c, species: p.speciesSv, circumferenceCm: p.circumferenceCm,
      giant: p.giantTreeSv === 'Ja', confirmed,
      crownRadius: Math.min(11, Math.max(4, (p.circumferenceCm || 200) / 55)) });
  }
  return {
    laserConfirmed,
    /* Only laser-confirmed individuals become canopy geometry; the two
       unconfirmed records stay evidence (a missing return is a review signal,
       not proof of felling — reference/README.md). */
    rings: trees.filter(tree => tree.confirmed).map(tree => circle(tree.c, tree.crownRadius)),
    trees,
  };
}

/* ---------------------------------------------------------------- merge */
const skagernOsm = stitchSkagern();
const smallLakes = osm.lakes.map(lake => {
  const c = centroid(lake.ring);
  const level = vistaH(c[0], c[1]);
  return { ring: lake.ring, level: r1(level ?? LAKE_LEVEL), isLake: false, isSea: false,
    area: lake.area, prov: `OSM ${lake.id} (ODbL); level read from the vista DTM at its centroid` };
});
const breakWater = model.water.filter(w => (w.prov || '').startsWith('Lantmäteriet'));
if (breakWater.length !== model.water.filter(w => !w.name && !(w.prov || '').startsWith('OSM')).length &&
    breakWater.length === 0) throw new Error('no break-geometry water found; wrong base model');
/* The two break-geometry arms are consumed by the union and leave model.water,
   so a rerun finds them under sourceWater instead: idempotent either way. */
const breakLakes = model.sourceWater?.breakLakes ?? breakWater.filter(w => w.isLake);
if (breakLakes.length !== 2) throw new Error(`expected the two break-geometry Skagern arms, found ${breakLakes.length}`);
model.sourceWater = { ...(model.sourceWater || {}), breakLakes,
  note: "Lantmäteriet break-geometry lake polygons at 69.3 m, laser-exact inside item 653_44; folded into the Skagern ring by lake-union.mjs and not drawn on their own (the pack never carries this key)" };
const skagern = uniteSkagern(skagernOsm.ring, breakLakes);
/* the two arms are consumed by the union; the break-geometry ponds stay */
model.water = [...breakWater.filter(w => !w.isLake), skagern.lake, ...skagern.fragments, ...smallLakes];
for (const hole of model.holes) for (const [x, z] of hole.line) {
  if (pointInPoly(x, z, skagern.lake.ring)) throw new Error(`hole ${hole.n} line point [${x},${z}] falls inside the Skagern ring`);
}

/* The satellite traces are the BASE; apply-surface-traces.mjs re-lays them
   on the laser channel bottoms afterwards (laser-ditches.json). A rerun of
   this script alone must not undo that, so laser-laid streams are kept. */
const laserLaid = (model.streams || []).some(st => /laser-ditches\.mjs/.test(st.prov || ''));
model.streams = laserLaid ? model.streams : [
  ...traces.features.ditches.map(d => ({ line: d.line, w: d.w, prov: d.prov, name: d.name })),
  ...(traces.features.connectors || []).map(d => ({ line: d.line, w: d.w, prov: d.prov })),
];

const treeWork = protectedTreeFeatures();
model.vegetation = {
  forest: osm.forest,
  wood: treeWork.rings,
  scrub: osm.scrub,
  wetland: osm.wetland,
  sand: [], rock: [],
};

const yardBuildings = traces.features.yard.buildings.map((building, index) => {
  const cos = Math.cos(building.rot), sin = Math.sin(building.rot);
  const w = building.w / 2, d = building.d / 2;
  const corner = (sx, sz) => [r1(building.c[0] + sx * w * cos - sz * d * sin),
    r1(building.c[1] + sx * w * sin + sz * d * cos)];
  return { id: `ribbingsfors-yard-${index}`, ring: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)],
    h: building.h, kind: 'shed', name: null, amenity: null,
    prov: 'greenkeeping yard trace; satellite interpretation' };
});
/* footprints measured off the orthoimagery that OSM has no way of supplying */
const tracedBuildings = (traces.features.buildings || []).map(building => {
  const cos = Math.cos(building.rot), sin = Math.sin(building.rot);
  const w = building.w / 2, d = building.d / 2;
  const corner = (sx, sz) => [r1(building.c[0] + sx * w * cos - sz * d * sin),
    r1(building.c[1] + sx * w * sin + sz * d * cos)];
  return { id: building.id, ring: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)],
    h: building.h, kind: building.kind, name: building.name ?? null, amenity: building.amenity ?? null, prov: building.prov };
});
/* a traced footprint of the same id REPLACES build-course's placeholder */
const clubhouse = tracedBuildings.some(b => b.id === 'ribbingsfors-clubhouse-provisional') ? null
  : model.infra.buildings.find(b => b.id === 'ribbingsfors-clubhouse-provisional');
const nearBuildings = osm.buildings.filter(b => {
  const [x, z] = centroid(b.ring);
  return Math.hypot(x, z) <= 1500;
});
const farBuildings = osm.buildings.filter(b => !nearBuildings.includes(b));
const residential = [...osm.landuse.filter(item => item.kind === 'residential')];
const villageHouses = synthesizeVillageHouses(
  [...osm.roads, ...osm.tracks], residential, osm.buildings);

model.infra = {
  paths: osm.paths,
  tracks: osm.tracks,
  roads: osm.roads,
  buildings: [...(clubhouse ? [clubhouse] : []), ...nearBuildings, ...tracedBuildings, ...yardBuildings],
  farB: [
    ...farBuildings.map(b => {
      const [x, z] = centroid(b.ring);
      /* principal axis from the ring's longest edge */
      let best = 0, rot = 0;
      for (let index = 1; index < b.ring.length; index++) {
        const dx = b.ring[index][0] - b.ring[index - 1][0], dz = b.ring[index][1] - b.ring[index - 1][1];
        const length = Math.hypot(dx, dz);
        if (length > best) { best = length; rot = bearing(dx, dz); }
      }
      const area = Math.abs(polyArea(b.ring));
      const w = Math.max(5, Math.min(30, best));
      const d = Math.max(4, Math.min(30, area / Math.max(1, w)));
      return [r1(x), r1(z), r1(w), r1(d), b.h || 4.2, +rot.toFixed(2)];
    }),
    ...villageHouses,
  ],
  parking: [
    ...osm.parking.map(p => ({ id: p.id, ring: p.ring, surface: p.surface, area: p.area })),
    ...traces.features.parking.map((p, index) => ({ id: `ribbingsfors-parking-${index}`,
      ring: p.ring, surface: p.surface, area: Math.round(Math.abs(polyArea(p.ring))) })),
  ],
  piers: [
    ...osm.piers,
    ...traces.features.piers.map((pier, index) => ({ id: `ribbingsfors-pier-${index}`, line: pier.line })),
  ],
  pitches: [],
  landuse: [
    ...osm.farmland,
    ...osm.landuse,
    { ring: traces.features.manorPrecinct.ring, kind: traces.features.manorPrecinct.kind },
  ],
  reserves: [],
  power: osm.power,
  railway: osm.railway.map(r => ({ id: r.id, line: r.line, usage: r.usage, kind: r.kind, name: r.name })),
};

model.surround = {
  clearfells: traces.features.clearfells.map(item => item.ring),
  yard: traces.features.yard.ring,
  hayfields: null, /* the OSM farmland rings already carry the field tint */
  /* the reedy bays: OSM wetland doubles as silt-shallow margins, so the bed
     reads a few decimetres down instead of the default lake carve */
  shallows: osm.wetland,
};

model.pois = osm.pois;

model.scenery = {
  greens: traces.features.practiceGreens.map(green => {
    const ring = [];
    for (let index = 0; index < 14; index++) {
      const angle = index / 14 * Math.PI * 2;
      ring.push([r1(green.c[0] + Math.cos(angle) * green.r), r1(green.c[1] + Math.sin(angle) * green.r)]);
    }
    return ring;
  }),
  fairways: [], tees: [], bunkers: [],
  grass: osm.grass,
  range: [ring1(traces.features.range.ring)],
  rangeFacilities: null,
  cartPark: null,
};

model.evidence.surroundings = {
  osm: `${osm.source} (ODbL, © OpenStreetMap contributors); projection ${osm.projection}`,
  satellite: traces.registration.method,
  protectedTrees: {
    source: 'Länsstyrelsen Västra Götaland, LstO Skyddsvärda Träd (CC0), 88 records within 250 m',
    laserConfirmed: treeWork.laserConfirmed,
    note: 'only laser-confirmed individuals are drawn; per-record data stays in geo_data/course-v2/ribbingsfors/reference/',
  },
  skagern: { prov: skagern.lake.prov, laserShorelineResidual: skagern.report },
  rangeCorrection: 'the guide-interpreted range ellipse lay on open lake water; replaced by the satellite trace between holes 9 and 1',
};
model.evidence.protectedTrees = treeWork.trees.filter(tree => tree.giant).map(tree => ({
  c: tree.c, species: tree.species, circumferenceCm: tree.circumferenceCm,
  source: 'Länsstyrelsen Västra Götaland Skyddsvärda Träd (CC0)',
}));

/* ----------------------------------------------------- tree-cover rebuild
   Same rules as build-course.mjs makeTreeCover, extended with the new open
   burns; the laser CHM cells already in the committed raster are kept (the
   canopy source is not available without credentials, so cells are only ever
   ADDED from polygons or OPENED by burns, never re-derived). */
function rebuildTreeCover() {
  const { cell, x0, z0, nx, nz } = treeCover;
  const buffer = Buffer.from(treeCover.b64, 'base64');
  const values = new Uint8Array(nx * nz);
  for (let index = 0; index < values.length; index++) {
    values[index] = (buffer[index >> 2] >> ((index & 3) * 2)) & 3;
  }
  const treeRings = [...osm.forest, ...model.vegetation.wood];
  const openRings = [];
  for (const hole of model.holes) {
    openRings.push(hole.green.ring, ...hole.fairway.rings,
      ...hole.tees.pads.map(pad => pad.ring), ...hole.bunkers.map(bunker => bunker.ring));
  }
  openRings.push(...model.water.map(item => item.ring),
    ...model.infra.buildings.map(item => item.ring),
    ...model.infra.parking.map(item => item.ring),
    ...model.scenery.range, ...model.scenery.greens,
    traces.features.yard.ring);
  const bboxOf = ring => {
    let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9;
    for (const [x, z] of ring) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); bz0 = Math.min(bz0, z); bz1 = Math.max(bz1, z); }
    return { bx0, bx1, bz0, bz1 };
  };
  const treeSet = treeRings.map(ring => ({ ring, bb: bboxOf(ring) }));
  const openSet = openRings.map(ring => ({ ring, bb: bboxOf(ring) }));
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * cell, z = z0 + j * cell, index = j * nx + i;
    if (values[index] !== 3 && treeSet.some(({ ring, bb }) =>
      x >= bb.bx0 && x <= bb.bx1 && z >= bb.bz0 && z <= bb.bz1 && pointInPoly(x, z, ring))) values[index] = 3;
    if (openSet.some(({ ring, bb }) =>
      x >= bb.bx0 && x <= bb.bx1 && z >= bb.bz0 && z <= bb.bz1 && pointInPoly(x, z, ring))) values[index] = 2;
  }
  const packed = Buffer.alloc(Math.ceil(values.length / 4));
  for (let index = 0; index < values.length; index++) {
    packed[index >> 2] |= (values[index] & 3) << ((index & 3) * 2);
  }
  treeCover.b64 = packed.toString('base64');
  treeCover.source = treeCover.source.replace(/\s*Surroundings pass:.*$/, '') +
    ' Surroundings pass: OSM woodland and laser-confirmed protected trees added; the Skagern ring, range, practice greens, parking, yard and merged buildings burned open.';
}
rebuildTreeCover();

/* ------------------------------------------------------------------ gates */
for (const hole of model.holes) for (let index = 0; index < hole.tees.pads.length; index++) {
  const pad = hole.tees.pads[index];
  for (const road of model.infra.roads) {
    const clearance = teeRoadClearance(pad.ring, road);
    if (clearance < -1e-6) {
      throw new Error(`hole ${hole.n} tee ${hole.t[index]} overlaps road ${road.id || road.kind} by ${(-clearance).toFixed(2)} m`);
    }
  }
}
const teeTotals = model.card.teeNames.map((_, index) =>
  model.holes.reduce((sum, hole) => sum + hole.t[index], 0));
model.card.teeNames.forEach((name, index) => {
  if (teeTotals[index] !== model.card.publishedNineHoleTotals[name]) {
    throw new Error(`${name} rows total ${teeTotals[index]} after merge`);
  }
});

const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
writeJson(path.join(HERE, 'course-model.json'), model);
writeJson(path.join(HERE, 'tree-cover.json'), treeCover);

console.log(`water: ${model.water.length} rings (${breakWater.filter(w => !w.isLake).length} break ponds + Skagern${skagern.fragments.length ? ` + ${skagern.fragments.length} fragment(s)` : ''} + ${smallLakes.length} OSM ponds)`);
console.log(laserLaid ? `streams: ${model.streams.length} laser-laid ditch runs kept (apply-surface-traces.mjs)` : `streams: ${model.streams.length} traced ditches (replacing the 4 synthetic guide crossings)`);
console.log(`vegetation: ${model.vegetation.forest.length} forest, ${model.vegetation.wood.length} protected-tree crowns ` +
  `(${treeWork.laserConfirmed}/${treeWork.trees.length} laser-confirmed), ${model.vegetation.wetland.length} wetland`);
console.log(`infra: ${model.infra.roads.length} roads, ${model.infra.tracks.length} tracks, ${model.infra.paths.length} paths, ` +
  `${model.infra.railway.length} railway runs, ${model.infra.buildings.length} near buildings, ` +
  `${model.infra.farB.length} far/synthesized (${villageHouses.length} village houses), ` +
  `${model.infra.parking.length} parking, ${model.infra.piers.length} piers, ` +
  `${model.infra.power.towers.length} power towers, ${model.infra.landuse.length} landuse rings`);
console.log(`surround: ${model.surround.clearfells.length} clearfells, yard ${model.surround.yard ? 'yes' : 'no'}, ` +
  `${model.surround.shallows.length} reed-shallow rings; pois: ${model.pois.length}`);
console.log('wrote course-model.json and tree-cover.json');
