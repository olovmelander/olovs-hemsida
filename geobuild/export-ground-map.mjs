#!/usr/bin/env node
/* Export a course's mapped geometry as RFC 7946 longitude/latitude GeoJSON.
 * Run from the repository root:
 *   node geobuild/export-ground-map.mjs --build upsalabuild \
 *     --also-build upsalamellanbuild --out upsalabuild/cache/ground-map.geojson
 * Optional: --ground upsala (published v2 ground), --root /path/to/repository,
 *           --no-v2 (explicitly omit published individual-object registries).
 * No network requests or raster copying. Source geometry is not improved by
 * exporting it. Unknown accuracy stays null; inferred shapes stay inferred.
 * mappedFeatures.rings means [outer, ...holes]; ordinary fairway.rings means
 * multiple independent polygons, matching those two existing model contracts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const BUILD_SLUGS = {
  geobuild: 'veckefjarden', puttombuild: 'puttom', upsalabuild: 'upsala',
  upsalamellanbuild: 'upsala-mellanbanan', angsobuild: 'angso',
  johannesbergbuild: 'johannesberg', nvgkbuild: 'norrfallsviken',
  ribbingsforsbuild: 'ribbingsfors',
};
const GEOMETRY_KEYS = new Set([
  'ring', 'rings', 'holes', 'line', 'lines', 'c', 'point', 'coordinates',
  'geometry', 'sourceGeometry', 'originalPixelRings', 'cx', 'cz',
]);
const hash = value => createHash('sha256').update(value).digest('hex');
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const isPoint = p => Array.isArray(p) && p.length >= 2 &&
  Number.isFinite(p[0]) && Number.isFinite(p[1]);
const isRing = p => Array.isArray(p) && p.length >= 3 && p.every(isPoint);
const round = n => Math.round(n * 1e9) / 1e9;

function scalarMetadata(value) {
  if (!value || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => !GEOMETRY_KEYS.has(key)));
}

function canonicalRing(ring) {
  let r = ring.slice();
  if (r.length > 1 && same(r[0], r.at(-1))) r.pop();
  const candidates = [r, r.slice().reverse()].map(points => {
    let minimum = 0;
    for (let i = 1; i < points.length; i++) {
      if (points[i][0] < points[minimum][0] ||
          (points[i][0] === points[minimum][0] && points[i][1] < points[minimum][1])) minimum = i;
    }
    return JSON.stringify(points.slice(minimum).concat(points.slice(0, minimum)));
  });
  return candidates.sort()[0];
}

function orientPolygon(rings) {
  return rings.map((ring, index) => {
    const areaTwice = ring.reduce((sum, a, i) => {
      const b = ring[(i + 1) % ring.length];
      return sum + a[0] * b[1] - b[0] * a[1];
    }, 0);
    if (!areaTwice) throw new Error('degenerate zero-area polygon');
    return (areaTwice > 0) === (index === 0) ? ring : ring.slice().reverse();
  });
}

function geometryKey(geometry) {
  if (geometry.type === 'Polygon') {
    return `Polygon:${canonicalRing(geometry.coordinates[0])}:` +
      geometry.coordinates.slice(1).map(canonicalRing).sort().join('|');
  }
  if (geometry.type === 'LineString') {
    return `LineString:${[JSON.stringify(geometry.coordinates),
      JSON.stringify(geometry.coordinates.slice().reverse())].sort()[0]}`;
  }
  return `${geometry.type}:${JSON.stringify(geometry.coordinates)}`;
}

function classify(record, fallback) {
  const prov = record?.prov || record?.provenance || fallback ||
    (/^[wnr]\d+(?:-|$)/.test(record?.id || '') ? 'osm' : 'source-model-unrated');
  const method = record?.placementMethod || record?.measurementMethod || null;
  const synthetic = /synth|infer|procedural|card-fit/i.test(`${prov} ${method || ''}`);
  const osm = /osm/i.test(String(prov));
  const surveyed = !synthetic && !osm &&
    (method === 'survey' || /Geod\.|total.?station|nätverks.?rtk/i.test(method || ''));
  return {
    provenance: prov,
    placementMethod: method || (synthetic ? 'inferred' : osm ? 'osm-mapping' : null),
    surveyed,
    horizontalAccuracyMetres: record?.horizontalAccuracyMetres ??
      record?.sourceAbsoluteHorizontalAccuracyM ?? record?.positionalAccuracyMetres ?? null,
  };
}

export async function exportGroundMap({ root = process.cwd(), builds, ground = null, includeV2 = true }) {
  root = path.resolve(root);
  if (!Array.isArray(builds) || !builds.length) throw new Error('at least one build is required');
  const features = [], unique = new Map(), exteriorEvidence = new Set();
  const metadata = {
    schemaVersion: 1,
    coordinateReferenceSystem: 'OGC:CRS84',
    coordinateOrder: 'longitude, latitude',
    geometryMeaning: 'Existing mapped evidence; completeness and absolute accuracy are not guaranteed.',
    modelSources: [], publishedGrounds: [],
    limitations: [
      'Legacy coordinates invert each model\'s own flat-earth frame; no independent registration or accuracy improvement is implied.',
      'Unknown horizontal accuracy is null. Capture dates, measurement methods and geometry provenance remain source attributes.',
      'Routes and tee marks can be card-fitted or inferred. They are not a survey of daily marker or flag positions.',
      'A LiDAR crown candidate is not a surveyed stem. Per-tree species are unknown unless explicitly sourced.',
      'Procedural trees sampled from stand fields are not individual mapped objects and are not exported as trees.',
      'Geographic extents retain the model\'s surrounding context, including full roads and waterways beyond the playing area.',
    ],
    duplicatesMerged: 0, legacyExteriorsReplacedByEvidence: 0,
  };
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];

  function add(geometry, record, context, fallback) {
    if (geometry.type === 'Polygon') geometry.coordinates = orientPolygon(geometry.coordinates);
    const evidence = classify(record, fallback);
    const properties = {
      ...scalarMetadata(record), ...evidence,
      featureKind: context.kind,
      occurrences: [{ build: context.build, path: context.path, kind: context.kind,
        ...(context.hole == null ? {} : { hole: context.hole }),
        ...(record?.id == null ? {} : { sourceRecordId: record.id }),
        provenance: evidence.provenance,
        horizontalAccuracyMetres: evidence.horizontalAccuracyMetres,
      }],
    };
    const key = geometryKey(geometry);
    const existing = unique.get(key);
    if (existing) {
      existing.properties.occurrences.push(...properties.occurrences);
      const sources = new Set([...(existing.properties.sourceIds || []),
        existing.properties.sourceId, ...(properties.sourceIds || []), properties.sourceId].filter(Boolean));
      if (sources.size) existing.properties.sourceIds = [...sources].sort();
      metadata.duplicatesMerged++;
      return;
    }
    const visit = coordinates => {
      if (isPoint(coordinates)) {
        bounds[0] = Math.min(bounds[0], coordinates[0]); bounds[1] = Math.min(bounds[1], coordinates[1]);
        bounds[2] = Math.max(bounds[2], coordinates[0]); bounds[3] = Math.max(bounds[3], coordinates[1]);
      } else coordinates.forEach(visit);
    };
    visit(geometry.coordinates);
    const feature = { type: 'Feature', id: `mapped-${hash(key).slice(0, 20)}`, geometry, properties };
    unique.set(key, feature); features.push(feature);
  }

  // Load models first so detailed evidence can supersede a backing bare ring
  // even when that bare ring occurs in another routing's shared scenery.
  const models = builds.map(build => {
    const file = path.resolve(root, build, 'course-model.json'), bytes = fs.readFileSync(file);
    const model = JSON.parse(bytes);
    if (!Number.isFinite(model.origin?.lat) || !Number.isFinite(model.origin?.lon) ||
        !(model.mPerLat > 0) || !(model.mPerLon > 0)) throw new Error(`invalid frame: ${build}`);
    const transform = p => {
      if (!isPoint(p)) throw new Error(`invalid coordinate in ${build}: ${JSON.stringify(p)}`);
      const point = [round(model.origin.lon + p[0] / model.mPerLon), round(model.origin.lat - p[1] / model.mPerLat)];
      if (Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) throw new Error(`out-of-range coordinate in ${build}`);
      return point;
    };
    const ring = input => {
      if (!isRing(input)) throw new Error(`invalid polygon ring in ${build}`);
      const output = input.map(transform).filter((p, i, all) => !i || !same(p, all[i - 1]));
      if (!same(output[0], output.at(-1))) output.push(output[0].slice());
      if (output.length < 4) throw new Error(`degenerate polygon ring in ${build}`);
      return output;
    };
    metadata.modelSources.push({ build, file: path.relative(root, file), sha256: hash(bytes),
      localFrame: { origin: model.origin, mPerLat: model.mPerLat, mPerLon: model.mPerLon } });
    return { build, model, transform, ring };
  });

  for (const { build, model, ring } of models) {
    for (const field of ['mappedFeatures', 'sourceFeatures']) {
      for (const [index, record] of (model.scenery?.[field] || []).entries()) {
        const rings = record.rings || (record.ring ? [record.ring, ...(record.holes || [])] : null);
        if (!rings?.length) throw new Error(`${build}.scenery.${field}[${index}] lacks polygon geometry`);
        const coordinates = rings.map(ring);
        exteriorEvidence.add(canonicalRing(coordinates[0]));
        add({ type: 'Polygon', coordinates }, record,
          { build, path: `scenery.${field}[${index}]`, kind: record.kind || 'mapped-surface' });
      }
    }
  }

  for (const { build, model: m, transform, ring } of models) {
    function polygon(record, at, kind, hole = null, fallback = null) {
      const outer = isRing(record) ? record : record?.ring;
      if (!outer) return false;
      const coordinates = [ring(outer), ...(!Array.isArray(record) ? record.holes || [] : []).map(ring)];
      if (Array.isArray(record) && exteriorEvidence.has(canonicalRing(coordinates[0]))) {
        metadata.legacyExteriorsReplacedByEvidence++; return true;
      }
      add({ type: 'Polygon', coordinates }, record, { build, path: at, kind, hole }, fallback);
      return true;
    }
    function line(record, at, kind, hole = null, fallback = null) {
      const points = Array.isArray(record) ? record : record?.line;
      if (!Array.isArray(points) || points.length < 2 || !points.every(isPoint)) return false;
      add({ type: 'LineString', coordinates: points.map(transform) }, record, { build, path: at, kind, hole }, fallback);
      return true;
    }
    function point(record, at, kind, hole = null, fallback = null) {
      const p = isPoint(record) ? record : record?.c || record?.point ||
        (Number.isFinite(record?.cx) && Number.isFinite(record?.cz) ? [record.cx, record.cz] : null);
      if (!isPoint(p)) return false;
      add({ type: 'Point', coordinates: transform(p) }, record, { build, path: at, kind, hole }, fallback);
      return true;
    }
    function geometries(records, at, kind, fallback = null) {
      for (const [index, record] of (records || []).entries()) {
        const label = `${at}[${index}]`;
        if (!polygon(record, label, kind, null, fallback) && !line(record, label, kind, null, fallback) &&
            !point(record, label, kind, null, fallback)) {
          throw new Error(`unsupported geometry: ${build}.${label}`);
        }
      }
    }
    for (const [index, h] of (m.holes || []).entries()) {
      const at = `holes[${index}]`, n = h.n ?? index + 1;
      line({ line: h.line, prov: h.lineSrc || 'source-model-unrated', par: h.par, strokeIndex: h.idx }, `${at}.line`, 'playing-route', n);
      polygon(h.green, `${at}.green`, 'green', n);
      if (h.green?.c) point({ c: h.green.c, prov: 'model-reference-point', note: 'Nominal green reference; not a surveyed or current flag.' }, `${at}.green.c`, 'green-reference', n);
      for (const field of ['fairway', 'semi', 'fringe', 'rough']) {
        const surface = h[field];
        if (!surface) continue;
        if (surface.rings) surface.rings.forEach((r, i) => polygon({ ...scalarMetadata(surface), ring: r }, `${at}.${field}.rings[${i}]`, field, n));
        else polygon(surface, `${at}.${field}`, field, n);
      }
      (h.tees?.pads || []).forEach((p, i) => polygon(p, `${at}.tees.pads[${i}]`, 'tee-platform', n));
      (h.tees?.marks || []).forEach((p, i) => point({ ...p, teeName: m.card?.teeNames?.[i] ?? null,
        prov: p.prov || 'model-tee-mark', note: 'Nominal tee mark; daily marker position is not verified.' }, `${at}.tees.marks[${i}]`, 'tee-reference', n));
      (h.bunkers || []).forEach((p, i) => polygon(p, `${at}.bunkers[${i}]`, 'bunker', n));
    }
    const surfaceKinds = { greens: 'green', fairways: 'fairway', tees: 'tee-platform',
      bunkers: 'bunker', grass: 'grass', range: 'driving-range', practiceGreens: 'practice-green',
      hardstanding: 'hardstanding', greenExclusions: 'green-exclusion', rangeTargets: 'range-target' };
    for (const [key, kind] of Object.entries(surfaceKinds)) geometries(m.scenery?.[key], `scenery.${key}`, kind);
    for (const [key, records] of Object.entries(m.vegetation || {})) {
      if (Array.isArray(records)) geometries(records, `vegetation.${key}`, key, 'model-vegetation-unrated');
    }
    geometries(m.water, 'water', 'water');
    geometries(m.streams, 'streams', 'waterway');
    geometries(m.pois, 'pois', 'point-of-interest');
    (m.coast?.chains || []).forEach((record, index) => {
      if (!line(record, `coast.chains[${index}]`, 'coastline')) throw new Error(`unsupported coastline: ${build}:${index}`);
    });
    geometries(m.coast?.beaches, 'coast.beaches', 'beach');
    for (const [key, records] of Object.entries(m.infra || {})) {
      if (key === 'farB' || key === 'power' || !Array.isArray(records)) continue;
      if (key === 'mappedPoints' || key === 'points') {
        records.forEach((record, index) => {
          const tags = record.tags || {};
          const kind = tags.natural === 'tree' ? 'tree-osm-point' :
            tags.barrier || tags.amenity || tags.man_made || tags.golf || 'mapped-point';
          const item = tags.natural === 'tree' ? { ...record, species: tags.species || null,
            speciesStatus: tags.species ? 'OSM tag; not independently verified' : 'not identified',
            positionMeaning: 'OSM tree point; not matched to a LiDAR crown or surveyed stem.' } : record;
          if (!point(item, `infra.${key}[${index}]`, kind)) throw new Error(`unsupported mapped point: ${build}:${index}`);
        });
        continue;
      }
      geometries(records, `infra.${key}`, key);
    }
    const power = m.infra?.power;
    geometries(power?.lines, 'infra.power.lines', 'power-line', 'osm');
    geometries(power?.towers, 'infra.power.towers', 'power-tower', 'osm');
    geometries(power?.poles, 'infra.power.poles', 'power-pole', 'osm');
    for (const [index, box] of (m.infra?.farB || []).entries()) {
      if (box.length !== 6 || !box.every(Number.isFinite)) throw new Error(`unsupported farB at ${build}:${index}`);
      const [cx, cz, hw, hd, angle, industrial] = box, c = Math.cos(angle), s = Math.sin(angle);
      const outer = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => [cx + u * c - v * s, cz + u * s + v * c]);
      polygon({ ring: outer, prov: 'simplified-osm-oriented-box', industrial: Boolean(industrial),
        note: 'Distant rendering box; not the original building footprint. Height and roof shape are not surveyed.' }, `infra.farB[${index}]`, 'building-context-box');
    }
  }

  if (includeV2) {
    const publicRoot = path.join(root, 'apps/golf/public');
    const indexFile = path.join(publicRoot, 'courses/v2-index.json');
    if (!fs.existsSync(indexFile)) throw new Error('v2 index missing; use --no-v2 only if omitting published objects is intentional');
    const index = JSON.parse(fs.readFileSync(indexFile));
    const { readChunk } = await import(pathToFileURL(path.join(root, 'packages/course-v2/chunk-node.mjs')));
    const { sweref99TmToLatLon } = await import(pathToFileURL(path.join(root, 'packages/course-geo/chmv2/projection.mjs')));
    const seenGrounds = new Set(), seenObjects = new Set();
    function asset(reference) {
      const file = path.resolve(publicRoot, reference.url);
      if (!file.startsWith(publicRoot + path.sep)) throw new Error('v2 reference leaves public root');
      const bytes = fs.readFileSync(file);
      if (bytes.length !== reference.bytes || hash(bytes) !== reference.sha256) throw new Error(`v2 asset integrity mismatch: ${reference.url}`);
      return bytes;
    }
    for (const build of builds) {
      const slug = BUILD_SLUGS[path.basename(build)];
      const course = index.courses.find(item => ground ? item.groundId === ground : item.slug === slug);
      if (!course) {
        if (ground) throw new Error(`published ground not found: ${ground}`);
        metadata.publishedGrounds.push({ build, status: 'No matching published course; use --ground to select one explicitly.' });
        continue;
      }
      if (seenGrounds.has(course.groundId)) continue;
      seenGrounds.add(course.groundId);
      const manifest = JSON.parse(asset(course.manifest)), reference = manifest.groundManifest;
      const published = JSON.parse(asset(reference));
      const summary = { groundId: published.groundId, reference, individualObjectTiles: 0,
        individualObjectsExported: 0, lidarCrownCandidatesExported: 0, standFieldTiles: 0,
        standFieldStatus: 'Retained in the referenced ground graph; no procedural individual trees exported.',
        projection: 'EPSG:3006 inverse via repository GRS80 series. SWEREF99 and WGS84 treated as coincident; no epoch transformation.',
      };
      for (const tile of published.tiles) {
        if (tile.layers?.stands) summary.standFieldTiles++;
        if (!tile.layers?.objects) continue;
        summary.individualObjectTiles++;
        const chunk = readChunk(asset(tile.layers.objects));
        for (const record of chunk.content.records) {
          const identity = `${published.groundId}:${record.id}`;
          if (seenObjects.has(identity)) continue;
          seenObjects.add(identity);
          const [lat, lon] = sweref99TmToLatLon(record.easting, record.northing);
          const crown = record.class === 'tree' && record.placementMethod === 'derived-lidar';
          add({ type: 'Point', coordinates: [round(lon), round(lat)] }, {
            ...record, prov: record.placementMethod,
            ...(crown ? { positionMeaning: 'LiDAR crown candidate; stem position is not surveyed.',
              species: null, speciesStatus: 'not identified', shapeMeaning: 'radius is an estimated crown radius' } : {}),
            chunkSha256: tile.layers.objects.sha256,
          }, { build: null, path: `${published.groundId}/${tile.id}/${record.id}`,
            kind: crown ? 'tree-crown-candidate' : record.class });
          summary.individualObjectsExported++;
          if (crown) summary.lidarCrownCandidatesExported++;
        }
      }
      metadata.publishedGrounds.push(summary);
    }
  } else {
    metadata.limitations.push('Published v2 individual objects were explicitly omitted (--no-v2).');
  }
  metadata.featureCounts = {};
  for (const feature of features) metadata.featureCounts[feature.properties.featureKind] =
    (metadata.featureCounts[feature.properties.featureKind] || 0) + 1;
  metadata.totalFeatures = features.length;
  return { type: 'FeatureCollection', ...(features.length ? { bbox: bounds } : {}), metadata, features };
}

async function main(argv) {
  const options = { builds: [], includeV2: true };
  for (let i = 0; i < argv.length; i++) {
    const option = argv[i];
    if (option === '--no-v2') { options.includeV2 = false; continue; }
    if (option === '--help') {
      console.log('Usage: node geobuild/export-ground-map.mjs --build upsalabuild [--also-build upsalamellanbuild] --out map.geojson [--ground upsala] [--root repo] [--no-v2]');
      return;
    }
    if (!['--build', '--also-build', '--out', '--root', '--ground'].includes(option)) throw new Error(`unknown option: ${option}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${option}`);
    if (option === '--build' || option === '--also-build') options.builds.push(value);
    else options[option.slice(2)] = value;
  }
  if (!options.builds.length || !options.out) throw new Error('--build and --out are required');
  const collection = await exportGroundMap(options);
  const out = path.resolve(options.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(collection) + '\n');
  console.log(JSON.stringify({ out, features: collection.features.length,
    duplicatesMerged: collection.metadata.duplicatesMerged,
    counts: collection.metadata.featureCounts, bbox: collection.bbox }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
